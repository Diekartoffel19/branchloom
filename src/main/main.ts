import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import type { AgentPreset, CommandTerminalEvent, QueueState, SessionEvent, StudioAPI, WorkflowAgentSettings, WorkflowProposal, WorkflowStep, WorkflowState } from '../shared/types';
import { StudioBrowser } from './browser';
import { createDiagnosticCard } from './error-catcher';
import { cardQaReports, cardQaScreenshot, runCardQa, runCardQaBatch } from './card-qa';
import { createQaFixCard, previewQaFixCard } from './qa-fix-card';
import { DesignInspector, designSelections } from './design-inspection';
import { addCardContextReference, cardContextCandidateFromAttachment, cardContextReferences, previewCardContextReference, removeCardContextReference } from './card-context';
import { createOutputErrorCard, previewOutputErrors } from './output-errors';
import { BrowserSessionPersistence } from './browser-persistence';
import { detectAgents, SessionRunner } from './cli';
import { CommandTerminalRunner } from './command-terminal';
import { mergeCardWorktree, reviewCardWorktree } from './git-worktree';
import { previewPrDraft } from './pr-draft';
import { scanProjectComponents } from './component-catalog';
import { checkoutMilestone, compareMilestone, createMilestone, listMilestones } from './milestones';
import { createReviewComment, listReviewComments, previewCardDiff } from './diff-review';
import { acknowledgeQaInboxReport, acknowledgeReviewInboxComment, reviewInboxItems } from './review-inbox';
import { globalInboxItems } from './global-inbox';
import { acceptReviewedPlan, createPlanComment, listPlanComments, listReviewedPlans, saveReviewedPlan } from './plan-review';
import { createReviewRuleFromComment, deleteReviewRule, listReviewRules, updateReviewRule } from './review-rules';
import { reviewCardWorktreeConflicts, reviewProjectConflicts } from './conflict-radar';
import { exportMemoryVaultToDirectory } from './memory-vault';
import { scanMemoryVault } from './memory-vault-import';
import { StudioStore } from './store';
import { createCardFromWhiteboardEdge, createWhiteboardEdge, createWhiteboardNode, deleteWhiteboardEdge, deleteWhiteboardNode, updateWhiteboardNode, whiteboardSnapshot } from './whiteboard';
import { analyzeWhiteboardImpact, createCardFromWhiteboardImpact } from './whiteboard-impact';
import { acceptRepoMap, previewRepoMap } from './repo-map-import';
import { parseProjectPackage, PROJECT_PACKAGE_LIMIT } from './project-package';
import { ProjectQueueEngine } from './queue';
import { WorkflowEngine } from './workflows';
import { proposeWorkflow } from './workflow-planner';
import { discussTaskDraft } from './task-draft';
import { convertIdeaToCard, discussIdea, listIdeas, saveIdea } from './ideas';
import { transcribeAudio } from './voice/transcribe';
import { projectChangelog } from './changelog';
import { scanThemeTokens } from './theme-tokens';
import { applyThemeTokenEdit, previewThemeTokenEdit } from './theme-token-edit';

let window: BrowserWindow | null = null;
let store: StudioStore | null = null;
let runner: SessionRunner | null = null;
let commandRunner: CommandTerminalRunner | null = null;
let queueEngine: ProjectQueueEngine;
let browser: StudioBrowser | null = null;
let designInspector: DesignInspector | null = null;
let smokeQaServer: ReturnType<typeof createServer> | null = null;
const smoke = process.argv.includes('--studio-smoke');
const smokeDataDirectory = smoke ? mkdtempSync(join(tmpdir(), 'branchloom-smoke-')) : null;
const devDataDirectory = !app.isPackaged ? process.env.BRANCHLOOM_DEV_USER_DATA : undefined;
if (smokeDataDirectory) {
  app.setPath('userData', smokeDataDirectory);
  mkdirSync(join(smokeDataDirectory, 'src'));
  writeFileSync(join(smokeDataDirectory, 'src', 'widget.ts'), 'export const widget = 1;');
  writeFileSync(join(smokeDataDirectory, 'screen.ts'), "import './src/widget';");
  writeFileSync(join(smokeDataDirectory, 'src', 'theme.css'), ':root { --smoke-ink: #243b32; }\n');
  writeFileSync(join(smokeDataDirectory, 'page.ts'), "import './screen';");
  writeFileSync(join(smokeDataDirectory, 'app.ts'), "import './page';");
} else if (devDataDirectory) {
  if (!isAbsolute(devDataDirectory)) throw new Error('BRANCHLOOM_DEV_USER_DATA muss ein absoluter Pfad sein.');
  mkdirSync(devDataDirectory, { recursive: true });
  app.setPath('userData', devDataDirectory);
} else {
  // Keep the existing Jarvis Studio profile when upgrading to Branchloom.
  // Changing the Electron/package name must not make projects appear to vanish.
  const dataDirectory = join(app.getPath('appData'), 'jarvis-studio');
  mkdirSync(dataDirectory, { recursive: true });
  app.setPath('userData', dataDirectory);
}

// A second normal app process must not reopen the live SQLite profile and
// mistake its running PTYs for sessions interrupted by a restart. Isolated
// developer/smoke profiles are kept independent for tests.
const sharedProfileInstance = !smokeDataDirectory && !devDataDirectory;
const ownsSharedProfile = !sharedProfileInstance || app.requestSingleInstanceLock();
if (sharedProfileInstance && ownsSharedProfile) {
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
}

function mustStore(): StudioStore {
  if (!store) throw new Error('Store is not ready');
  return store;
}

function installIpc(): void {
  const db = mustStore();
  let workflowEngine: WorkflowEngine;
  let previewedPackage: { file: string; fingerprint: string } | null = null;
  let previewedVault: { projectId: string; root: string; fingerprint: string; token: string } | null = null;
  const packageContent = (file: string): { json: string; fingerprint: string } => {
    if (statSync(file).size > PROJECT_PACKAGE_LIMIT) throw new Error('Projektpaket ist größer als 8 MiB.');
    const json = readFileSync(file, 'utf8');
    parseProjectPackage(json);
    return { json, fingerprint: createHash('sha256').update(json).digest('hex') };
  };
  runner = new SessionRunner(db, (event: SessionEvent) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:session-event', event);
  }, (session, finalMessage) => {
    workflowEngine.onSessionFinished(session, finalMessage);
    queueEngine.onSessionFinished(session);
  });
  workflowEngine = new WorkflowEngine(db, runner);
  queueEngine = new ProjectQueueEngine(db, workflowEngine);
  commandRunner = new CommandTerminalRunner(db, (event: CommandTerminalEvent) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:command-terminal-event', event);
  });

  const bind = <K extends keyof StudioAPI>(name: K, handler: (...args: never[]) => unknown): void => {
    ipcMain.handle(`studio:${String(name)}`, (event, ...args: unknown[]) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Ungültiger IPC-Absender.');
      return (handler as (...values: unknown[]) => unknown)(...args);
    });
  };
  bind('projects', () => db.projects());
  bind('componentCatalog', (projectId: string) => scanProjectComponents(db.project(projectId).path));
  bind('createProject', (input: { name: string; path: string }) => db.createProject(input));
  bind('exportProjectPackage', async (projectId: string) => {
    if (!window || window.isDestroyed()) throw new Error('Das Exportfenster ist nicht verfügbar.');
    const data = db.exportProjectPackage(projectId);
    const content = JSON.stringify(data, null, 2) + '\n';
    if (Buffer.byteLength(content, 'utf8') > PROJECT_PACKAGE_LIMIT) throw new Error('Projektpaket ist größer als 8 MiB.');
    const choice = await dialog.showSaveDialog(window, { title: 'Projektpaket speichern', defaultPath: 'branchloom-project.json', filters: [{ name: 'Branchloom Projektpaket', extensions: ['json'] }] });
    if (choice.canceled || !choice.filePath) return null;
    try { writeFileSync(choice.filePath, content, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Die Datei existiert bereits. Wähle einen neuen Dateinamen.');
      throw error;
    }
    return { file: choice.filePath, columns: data.columns.length, cards: data.cards.length, notes: data.notes.length, workflows: data.workflows.length };
  });
  bind('previewProjectPackage', async () => {
    if (!window || window.isDestroyed()) throw new Error('Das Importfenster ist nicht verfügbar.');
    previewedPackage = null;
    const choice = await dialog.showOpenDialog(window, { title: 'Projektpaket auswählen', properties: ['openFile'], filters: [{ name: 'Branchloom Projektpaket', extensions: ['json'] }] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    const file = choice.filePaths[0];
    const { json, fingerprint } = packageContent(file);
    const data = parseProjectPackage(json);
    previewedPackage = { file, fingerprint };
    return { fingerprint, name: data.name, columns: data.columns.length, cards: data.cards.length, notes: data.notes.length, workflows: data.workflows.length };
  });
  bind('importProjectPackage', (input: { fingerprint: string; name: string; path: string }) => {
    if (!previewedPackage || input.fingerprint !== previewedPackage.fingerprint) throw new Error('Projektpaket erneut auswählen.');
    const { json, fingerprint } = packageContent(previewedPackage.file);
    if (fingerprint !== previewedPackage.fingerprint) throw new Error('Projektpaket wurde nach der Vorschau verändert. Bitte erneut auswählen.');
    const created = db.importProjectPackage({ name: input.name, path: input.path, json });
    previewedPackage = null;
    return created;
  });
  bind('snapshot', (projectId: string) => db.snapshot(projectId));
  bind('projectChangelog', (input: Parameters<StudioAPI['projectChangelog']>[0]) => projectChangelog(db, input.projectId, input.period));
  bind('listMilestones', (projectId: string) => listMilestones(db, projectId));
  bind('createMilestone', (input: Parameters<StudioAPI['createMilestone']>[0]) => createMilestone(db, input));
  bind('compareMilestone', (input: Parameters<StudioAPI['compareMilestone']>[0]) => compareMilestone(db, input));
  bind('checkoutMilestone', (input: Parameters<StudioAPI['checkoutMilestone']>[0]) => checkoutMilestone(db, input));
  bind('ideas', (projectId: string) => listIdeas(db, projectId));
  bind('saveIdea', (input: Parameters<StudioAPI['saveIdea']>[0]) => saveIdea(db, input));
  bind('discussIdea', (input: Parameters<StudioAPI['discussIdea']>[0]) => discussIdea(db, input));
  bind('convertIdeaToCard', (input: Parameters<StudioAPI['convertIdeaToCard']>[0]) => convertIdeaToCard(db, input));
  bind('whiteboard', (projectId: string) => whiteboardSnapshot(db, projectId));
  bind('themeTokens', (projectId: string) => scanThemeTokens(db, projectId));
  bind('previewThemeTokenEdit', (input: Parameters<StudioAPI['previewThemeTokenEdit']>[0]) => previewThemeTokenEdit(db, input));
  bind('applyThemeTokenEdit', (input: Parameters<StudioAPI['applyThemeTokenEdit']>[0]) => applyThemeTokenEdit(db, input));
  bind('whiteboardImpact', (input: Parameters<StudioAPI['whiteboardImpact']>[0]) => analyzeWhiteboardImpact(db, input));
  bind('createCardFromWhiteboardImpact', (input: Parameters<StudioAPI['createCardFromWhiteboardImpact']>[0]) => createCardFromWhiteboardImpact(db, input));
  bind('previewRepoMap', (projectId: string) => previewRepoMap(db, projectId));
  bind('acceptRepoMap', (input: Parameters<StudioAPI['acceptRepoMap']>[0]) => acceptRepoMap(db, input));
  bind('createWhiteboardNode', (input: Parameters<StudioAPI['createWhiteboardNode']>[0]) => createWhiteboardNode(db, input));
  bind('updateWhiteboardNode', (input: Parameters<StudioAPI['updateWhiteboardNode']>[0]) => updateWhiteboardNode(db, input));
  bind('deleteWhiteboardNode', (input: Parameters<StudioAPI['deleteWhiteboardNode']>[0]) => deleteWhiteboardNode(db, input));
  bind('createWhiteboardEdge', (input: Parameters<StudioAPI['createWhiteboardEdge']>[0]) => createWhiteboardEdge(db, input));
  bind('createCardFromWhiteboardEdge', (input: Parameters<StudioAPI['createCardFromWhiteboardEdge']>[0]) => createCardFromWhiteboardEdge(db, input));
  bind('deleteWhiteboardEdge', (input: Parameters<StudioAPI['deleteWhiteboardEdge']>[0]) => deleteWhiteboardEdge(db, input));
  bind('createColumn', (input: Parameters<StudioAPI['createColumn']>[0]) => db.createColumn(input));
  bind('updateColumn', (input: Parameters<StudioAPI['updateColumn']>[0]) => db.updateColumn(input));
  bind('reorderColumn', (input: Parameters<StudioAPI['reorderColumn']>[0]) => db.reorderColumn(input));
  bind('deleteColumn', (id: string) => db.deleteColumn(id));
  bind('createCard', (input: Parameters<StudioAPI['createCard']>[0]) => {
    const card = db.createCard(input);
    queueEngine.onBoardChanged(card.projectId);
    return card;
  });
  bind('updateCard', (input: Parameters<StudioAPI['updateCard']>[0]) => db.updateCard(input));
  bind('setCardArchived', (input: { id: string; archived: boolean }) => {
    const card = db.setCardArchived(input);
    queueEngine.onBoardChanged(card.projectId);
    return card;
  });
  bind('cardAttachments', (cardId: string) => db.cardAttachments(cardId));
  bind('chooseCardAttachments', async (cardId: string) => {
    if (db.card(cardId).archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    if (!window || window.isDestroyed()) throw new Error('Das Dateifenster ist nicht verfügbar.');
    const choice = await dialog.showOpenDialog(window, { title: 'Dateien mit Karte verknüpfen', properties: ['openFile', 'multiSelections'] });
    return choice.canceled || !choice.filePaths.length ? null : db.addCardAttachments(cardId, choice.filePaths);
  });
  bind('openCardAttachment', async (input: { cardId: string; attachmentId: string }) => {
    const path = db.attachmentPathForCard(input);
    const error = await shell.openPath(path);
    if (error) throw new Error(`Datei konnte nicht geöffnet werden: ${error}`);
  });
  bind('removeCardAttachment', (input: { cardId: string; attachmentId: string }) => db.removeCardAttachment(input));
  bind('cardContextReferences', (cardId: string) => cardContextReferences(db, cardId));
  bind('cardContextCandidateFromAttachment', (input: Parameters<StudioAPI['cardContextCandidateFromAttachment']>[0]) => cardContextCandidateFromAttachment(db, input));
  bind('addCardContextReference', (input: Parameters<StudioAPI['addCardContextReference']>[0]) => addCardContextReference(db, input));
  bind('previewCardContextReference', (input: Parameters<StudioAPI['previewCardContextReference']>[0]) => previewCardContextReference(db, input));
  bind('removeCardContextReference', (input: Parameters<StudioAPI['removeCardContextReference']>[0]) => removeCardContextReference(db, input));
  bind('moveCard', (input: { id: string; columnId: string }) => {
    const before = db.card(input.id);
    const moved = db.moveCard(input);
    const column = db.column(input.columnId);
    if (before.columnId !== column.id && column.autoStart && column.agentId) {
      try { runner?.start({ cardId: moved.id, agentId: column.agentId }); }
      catch (error) {
        // A failed launch must not make the board look as though an agent ran.
        db.moveCard({ id: moved.id, columnId: before.columnId });
        throw error;
      }
    }
    queueEngine.onBoardChanged(moved.projectId);
    return moved;
  });
  bind('bulkUpdateCards', (input: Parameters<StudioAPI['bulkUpdateCards']>[0]) => db.bulkUpdateCards(input));
  bind('reorderCard', (input: Parameters<StudioAPI['reorderCard']>[0]) => db.reorderCard(input));
  bind('agents', () => db.agents());
  bind('detectAgents', () => detectAgents(db.agents()));
  bind('saveAgent', (input: Omit<AgentPreset, 'id'> & { id?: string }) => db.saveAgent(input));
  bind('startSession', (input: { cardId: string; agentId?: string; prompt?: string; useWorktree?: boolean }) => runner?.start(input));
  bind('resumeCodexSession', (input: { sessionId: string; picker?: boolean }) => runner?.resumeCodex(input));
  bind('acknowledgeInterruptedSession', (input: { projectId: string; sessionId: string }) => db.acknowledgeInterruptedSession(input));
  bind('sendSession', (input: { sessionId: string; text: string }) => runner?.send(input));
  bind('writeSessionInput', (input: { sessionId: string; data: string }) => runner?.writeRaw(input));
  bind('resizeSession', (input: { sessionId: string; cols: number; rows: number }) => runner?.resize(input));
  bind('stopSession', (sessionId: string) => {
    runner?.stop(sessionId);
    const stopped = db.session(sessionId);
    workflowEngine.onSessionFinished(stopped);
    queueEngine.onSessionFinished(stopped);
  });
  bind('commandTerminals', (projectId: string) => db.commandTerminals(projectId));
  bind('startCommandTerminal', (input: Parameters<StudioAPI['startCommandTerminal']>[0]) => commandRunner?.start(input));
  bind('writeCommandTerminal', (input: Parameters<StudioAPI['writeCommandTerminal']>[0]) => commandRunner?.write(input));
  bind('resizeCommandTerminal', (input: Parameters<StudioAPI['resizeCommandTerminal']>[0]) => commandRunner?.resize(input));
  bind('stopCommandTerminal', (terminalId: string) => commandRunner?.stop(terminalId));
  bind('searchSessionTranscripts', (input: { projectId: string; query: string }) => db.searchSessionTranscripts(input.projectId, input.query));
  bind('sessionForProject', (input: { projectId: string; sessionId: string }) => db.sessionForProject(input.projectId, input.sessionId));
  bind('createWorkflow', (input: { projectId: string; name: string; cardIds: string[]; steps: WorkflowStep[] }) => db.createWorkflow(input));
  bind('updateDraftWorkflow', (input: Parameters<StudioAPI['updateDraftWorkflow']>[0]) => {
    const result = db.updateDraftWorkflow(input);
    queueEngine.onBoardChanged(result.projectId);
    return result;
  });
  bind('deleteDraftWorkflow', (id: string) => {
    const projectId = db.deleteDraftWorkflow(id);
    queueEngine.onBoardChanged(projectId);
    return projectId;
  });
  bind('setWorkflowState', (input: { id: string; state: WorkflowState }) => {
    const workflow = workflowEngine.setState(input);
    queueEngine.onBoardChanged(workflow.projectId);
    return workflow;
  });
  bind('setProjectQueue', (input: { projectId: string; state: QueueState; templateWorkflowId?: string }) => queueEngine.setState(input));
  bind('queueCandidates', (projectId: string) => db.queueCandidates(projectId, 5));
  bind('skipQueuedCard', (input: Parameters<StudioAPI['skipQueuedCard']>[0]) => db.skipQueuedCard(input));
  bind('workflowAgentSettings', () => db.workflowAgentSettings());
  bind('saveWorkflowAgentSettings', (input: WorkflowAgentSettings) => db.saveWorkflowAgentSettings(input));
  bind('proposeWorkflow', (input: { projectId: string; request: string }) => proposeWorkflow(db, input));
  bind('proposeReviewedWorkflow', async (input: { projectId: string; request: string }) => saveReviewedPlan(db, { ...input, proposal: await proposeWorkflow(db, input) }));
  bind('reviewedPlans', (projectId: string) => listReviewedPlans(db, projectId));
  bind('planComments', (planId: string) => listPlanComments(db, planId));
  bind('createPlanComment', (input: Parameters<StudioAPI['createPlanComment']>[0]) => createPlanComment(db, input));
  bind('acceptReviewedPlan', (input: Parameters<StudioAPI['acceptReviewedPlan']>[0]) => acceptReviewedPlan(db, input));
  bind('discussTaskDraft', (input: Parameters<StudioAPI['discussTaskDraft']>[0]) => discussTaskDraft(db, input));
  bind('acceptWorkflowProposal', (input: { projectId: string; proposal: WorkflowProposal }) => db.acceptWorkflowProposal(input));
  bind('previewTrelloImport', (input: { projectId: string; json: string }) => db.previewTrelloImport(input));
  bind('acceptTrelloImport', (input: { projectId: string; columnId: string; json: string; fingerprint: string; sourceIds: string[] }) => db.acceptTrelloImport(input));
  bind('reviewCardWorktree', (cardId: string) => reviewCardWorktree(db, cardId));
  bind('previewPrDraft', (cardId: string) => previewPrDraft(db, cardId));
  bind('previewCardDiff', (cardId: string) => previewCardDiff(db, cardId));
  bind('listReviewComments', (cardId: string) => listReviewComments(db, cardId));
  bind('createReviewComment', (input: Parameters<StudioAPI['createReviewComment']>[0]) => createReviewComment(db, input));
  bind('reviewInboxItems', (input: Parameters<StudioAPI['reviewInboxItems']>[0]) => reviewInboxItems(db, input));
  bind('globalInboxItems', (input: Parameters<StudioAPI['globalInboxItems']>[0]) => globalInboxItems(db, input));
  bind('acknowledgeReviewInboxComment', (input: Parameters<StudioAPI['acknowledgeReviewInboxComment']>[0]) => acknowledgeReviewInboxComment(db, input));
  bind('acknowledgeQaInboxReport', (input: Parameters<StudioAPI['acknowledgeQaInboxReport']>[0]) => acknowledgeQaInboxReport(db, input));
  bind('reviewRules', (projectId: string) => listReviewRules(db, projectId));
  bind('createReviewRuleFromComment', (input: Parameters<StudioAPI['createReviewRuleFromComment']>[0]) => createReviewRuleFromComment(db, input));
  bind('updateReviewRule', (input: Parameters<StudioAPI['updateReviewRule']>[0]) => updateReviewRule(db, input));
  bind('deleteReviewRule', (input: Parameters<StudioAPI['deleteReviewRule']>[0]) => deleteReviewRule(db, input));
  bind('reviewCardConflicts', (cardId: string) => reviewCardWorktreeConflicts(db, cardId));
  bind('reviewProjectConflicts', (projectId: string) => reviewProjectConflicts(db, projectId));
  bind('mergeCardWorktree', (input: { cardId: string; previewToken: string; confirm: boolean }) => mergeCardWorktree(db, input));
  bind('saveNote', (input: { projectId: string; id?: string; title: string; body: string; tags: string[]; links: string[] }) => db.saveNote(input));
  bind('deleteNote', (id: string) => db.deleteNote(id));
  bind('exportMemoryVault', async (projectId: string) => {
    const snapshot = db.snapshot(projectId);
    if (!snapshot.notes.length) throw new Error('Dieses Projekt hat noch keine Memory-Notizen.');
    if (!window || window.isDestroyed()) throw new Error('Das Exportfenster ist nicht verfügbar.');
    const selection = await dialog.showOpenDialog(window, {
      title: 'Ordner für Memory-Export auswählen',
      buttonLabel: 'Neuen Exportordner hier anlegen',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const current = db.snapshot(projectId);
    return exportMemoryVaultToDirectory(current.notes, selection.filePaths[0], current.project.name);
  });
  bind('previewMemoryVaultImport', async (projectId: string) => {
    db.project(projectId);
    if (!window || window.isDestroyed()) throw new Error('Das Importfenster ist nicht verfügbar.');
    previewedVault = null;
    const selection = await dialog.showOpenDialog(window, {
      title: 'Markdown-Vault-Ordner auswählen',
      properties: ['openDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return null;
    const scanned = scanMemoryVault(selection.filePaths[0], db.snapshot(projectId).notes.map((item) => item.title));
    const token = randomUUID();
    previewedVault = { projectId, root: scanned.root, fingerprint: scanned.fingerprint, token };
    return { token, directoryName: basename(scanned.root), files: scanned.files, eligible: scanned.files.filter((item) => item.eligible).length };
  });
  bind('acceptMemoryVaultImport', (input: { projectId: string; token: string; keys: string[] }) => {
    if (!previewedVault || previewedVault.projectId !== input.projectId || previewedVault.token !== input.token) throw new Error('Vault bitte erneut auswählen.');
    if (!Array.isArray(input.keys) || !input.keys.length || input.keys.length > 200 || new Set(input.keys).size !== input.keys.length) throw new Error('Ungültige Dateiauswahl.');
    const scanned = scanMemoryVault(previewedVault.root, db.snapshot(input.projectId).notes.map((item) => item.title));
    if (scanned.fingerprint !== previewedVault.fingerprint) throw new Error('Vault-Dateien wurden seit der Vorschau geändert. Bitte erneut auswählen.');
    const entries = input.keys.map((key) => {
      const file = scanned.parsed.get(key);
      if (!file) throw new Error(`Datei nicht importierbar: ${String(key).slice(0, 100)}`);
      return file;
    });
    const count = db.importMemoryVaultNotes(input.projectId, entries);
    previewedVault = null;
    return { count };
  });
  bind('transcribe', (audio: Uint8Array) => {
    if (!(audio instanceof Uint8Array) || audio.byteLength === 0 || audio.byteLength > 8 * 1024 * 1024) throw new Error('Die Audioaufnahme muss zwischen 1 Byte und 8 MiB groß sein.');
    return transcribeAudio(audio);
  });
  bind('browserState', () => browser?.state());
  bind('browserNavigate', (address: string) => browser?.navigate(address));
  bind('browserBack', () => browser?.back());
  bind('browserForward', () => browser?.forward());
  bind('browserReload', () => browser?.reload());
  bind('browserCapture', () => browser?.captureActive());
  bind('browserOpenExternal', () => browser?.openActiveExternally());
  bind('browserNewTab', () => browser?.newTab());
  bind('browserSelectTab', (id: string) => browser?.selectTab(id));
  bind('browserCloseTab', (id: string) => browser?.closeTab(id));
  bind('browserSetVisible', (visible: boolean) => browser?.setVisible(visible === true));
  bind('browserSetBounds', (bounds: { x: number; y: number; width: number; height: number } | null) => browser?.setBounds(bounds));
  bind('browserCreateDiagnosticCard', (input: Parameters<StudioAPI['browserCreateDiagnosticCard']>[0]) => {
    if (!browser) throw new Error('Browser nicht verfügbar.');
    return createDiagnosticCard(db, input, browser.diagnostic(input.diagnosticId));
  });
  bind('cardQaReports', (cardId: string) => cardQaReports(db, cardId));
  bind('runCardQa', (input: Parameters<StudioAPI['runCardQa']>[0]) => runCardQa(db, input));
  bind('runCardQaBatch', (input: Parameters<StudioAPI['runCardQaBatch']>[0]) => runCardQaBatch(db, input));
  bind('cardQaScreenshot', (input: Parameters<StudioAPI['cardQaScreenshot']>[0]) => cardQaScreenshot(db, input));
  bind('previewQaFixCard', (input: Parameters<StudioAPI['previewQaFixCard']>[0]) => previewQaFixCard(db, input));
  bind('createQaFixCard', (input: Parameters<StudioAPI['createQaFixCard']>[0]) => createQaFixCard(db, input));
  bind('designSelections', (projectId: string) => designSelections(db, projectId));
  bind('designInspectionState', () => designInspector?.state());
  bind('designInspectionApplyThemePreview', (input: Parameters<StudioAPI['designInspectionApplyThemePreview']>[0]) => designInspector?.applyThemePreview(input));
  bind('designInspectionResetThemePreview', (projectId: string) => designInspector?.resetThemePreview(projectId));
  bind('designInspectionStart', (input: Parameters<StudioAPI['designInspectionStart']>[0]) => designInspector?.start(input));
  bind('designInspectionArm', (projectId: string) => designInspector?.arm(projectId));
  bind('designInspectionSelectSelector', (input: Parameters<StudioAPI['designInspectionSelectSelector']>[0]) => designInspector?.selectSelector(input.projectId, input.selector));
  bind('designInspectionSetBounds', (bounds: Parameters<StudioAPI['designInspectionSetBounds']>[0]) => designInspector?.setBounds(bounds));
  bind('designInspectionSetVisible', (visible: boolean) => designInspector?.setVisible(visible === true));
  bind('designViewportCapture', (projectId: string) => designInspector?.captureViewports(projectId));
  bind('designViewportCancel', (projectId: string) => designInspector?.cancelViewportCapture(projectId));
  bind('previewOutputErrors', (input: Parameters<StudioAPI['previewOutputErrors']>[0]) => previewOutputErrors(db, input));
  bind('createOutputErrorCard', (input: Parameters<StudioAPI['createOutputErrorCard']>[0]) => createOutputErrorCard(db, input));
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1500,
    height: 930,
    minWidth: 420,
    minHeight: 650,
    show: !smoke,
    title: 'Branchloom',
    backgroundColor: '#f4f1eb',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  browser = new StudioBrowser(window, (state) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:browser-state', state);
  }, () => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:browser-search-shortcut');
  }, new BrowserSessionPersistence(app.getPath('userData')));
  designInspector = new DesignInspector(window, mustStore(), (selection) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:design-selection', selection);
  });
  // `npm start` runs the built renderer from source, while `npm run dev`
  // explicitly opts into Vite. Electron's app.isPackaged is false in both
  // source modes, so it cannot decide this on its own.
  if (!app.isPackaged && process.env.JARVIS_STUDIO_DEV_SERVER === '1') void window.loadURL('http://127.0.0.1:5181');
  else void window.loadFile(join(__dirname, '../../dist/renderer/index.html'));
  if (smoke) {
    writeFileSync(join(smokeDataDirectory!, 'context.md'), '# BRANCHLOOM_CONTEXT_SMOKE\n');
    writeFileSync(join(smokeDataDirectory!, 'drop.md'), '# BRANCHLOOM_DROP_SMOKE\n');
    const failSmoke = (error: unknown) => {
      console.error('STUDIO_SMOKE_FAILED: renderer/IPC/SQLite/Board', error);
      app.exit(1);
    };
    const qaServerReady = new Promise<string>((resolve, reject) => {
      smokeQaServer = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Branchloom QA Smoke</title><style>:root{--smoke-ink:#243b32}body{min-width:1600px}#design-smoke-target{color:var(--smoke-ink);padding:8px}</style><img id="qa-observation-image"><button id="design-smoke-target">Synthetic design target</button><script>window.__designSmokeClicks=0;document.querySelector("#design-smoke-target").addEventListener("click",()=>window.__designSmokeClicks++);console.error("BRANCHLOOM_QA_SMOKE_ERROR")</script>');
      });
      smokeQaServer.once('error', reject);
      smokeQaServer.listen(0, '127.0.0.1', () => {
        const address = smokeQaServer?.address();
        if (!address || typeof address === 'string') reject(new Error('QA-Smoke-Server hat keinen TCP-Port.'));
        else resolve(`http://127.0.0.1:${address.port}/`);
      });
    });
    window.webContents.once('did-finish-load', () => { void qaServerReady.then((qaUrl) => {
      const script = `
        (async () => {
          for (let attempt = 0; attempt < 600 && !document.querySelector('.app-shell'); attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          if (!document.querySelector('.app-shell') || !document.body.textContent?.includes('Branchloom')) {
            throw new Error('Renderer hat die Oberfläche nicht aufgebaut: ' + document.body.textContent?.slice(0, 200));
          }
          if (!window.studio) throw new Error('Preload-API fehlt.');
          if ((await window.studio.projects()).length !== 0) throw new Error('Smoke-Datenordner ist nicht leer.');
          const project = await window.studio.createProject({ name: 'Smoke-Projekt', path: ${JSON.stringify(smokeDataDirectory)} });
          const initial = await window.studio.snapshot(project.id);
          const todo = initial.columns.find((column) => column.name === 'To Do');
          if (!todo || initial.columns.length < 3) throw new Error('Standardspalten fehlen.');
          const card = await window.studio.createCard({ projectId: project.id, columnId: todo.id, title: 'Smoke-Karte' });
          const wbFolder = await window.studio.createWhiteboardNode({ projectId: project.id, title: 'Smoke-Ordner', x: 10, y: 20, reference: { kind: 'folder', path: 'src' } });
          const wbCard = await window.studio.createWhiteboardNode({ projectId: project.id, title: 'Smoke-Aufgabe', x: 220, y: 20, reference: { kind: 'card', cardId: card.id } });
          await window.studio.createWhiteboardEdge({ projectId: project.id, sourceId: wbFolder.id, targetId: wbCard.id, label: 'gehört zu' });
          const directImpact = await window.studio.whiteboardImpact({ projectId: project.id, nodeId: wbFolder.id });
          if (directImpact.partial || directImpact.importers.length !== 1 || directImpact.importers[0].path !== 'screen.ts') throw new Error('Whiteboard-Änderungswirkung über IPC fehlt.');
          if (directImpact.transitiveImporters.length !== 2 || directImpact.transitiveImporters[0].path !== 'page.ts' || directImpact.transitiveImporters[0].chain[0].line !== 1 || directImpact.transitiveImporters[1].path !== 'app.ts') throw new Error('Whiteboard-Importkette über IPC fehlt.');
          await window.studio.reorderColumn({ id: initial.columns[1].id, direction: 'right' });
          await window.studio.updateColumn({ id: initial.columns[2].id, name: 'Smoke-Umbenannt' });
          const removable = await window.studio.createColumn({ projectId: project.id, name: 'Smoke-Leer' });
          await window.studio.deleteColumn(removable.id);
          const saved = await window.studio.snapshot(project.id);
          if (!saved.cards.some((item) => item.id === card.id && item.title === 'Smoke-Karte')) {
            throw new Error('Karte wurde nicht über IPC und SQLite gespeichert.');
          }
          if (saved.columns[2]?.id !== initial.columns[1].id) throw new Error('Spaltenreihenfolge wurde nicht gespeichert.');
          if (saved.columns[1]?.name !== 'Smoke-Umbenannt') throw new Error('Spaltenname wurde nicht gespeichert.');
          if (saved.columns.some((item) => item.id === removable.id)) throw new Error('Leere Spalte wurde nicht gelöscht.');
          const idea = await window.studio.saveIdea({ projectId: project.id, title: 'Smoke-Idee', body: 'Synthetische Notiz', category: 'backlog', turns: [] });
          if ((await window.studio.ideas(project.id))[0]?.id !== idea.id) throw new Error('Idee wurde nicht über IPC und SQLite gespeichert.');
          const ideaCard = await window.studio.convertIdeaToCard({ projectId: project.id, ideaId: idea.id, columnId: saved.columns[1].id });
          if (ideaCard.title !== idea.title || (await window.studio.ideas(project.id))[0]?.cardId !== ideaCard.id) throw new Error('Idee wurde nicht bewusst in eine Karte übernommen.');
          if ((await window.studio.snapshot(project.id)).sessions.length !== 0) throw new Error('Ideenübernahme startete einen Agenten.');
          const candidates = await window.studio.queueCandidates(project.id);
          if (candidates.length !== 1 || candidates[0].id !== card.id) throw new Error('Queue-Vorschau wich von der freien To-Do-Karte ab.');
          const draft = await window.studio.createWorkflow({ projectId: project.id, name: 'Smoke-Entwurf', cardIds: [card.id], steps: [{ id: 'smoke-step', columnId: saved.columns[2].id, agentId: null, requireApproval: false }] });
          if ((await window.studio.queueCandidates(project.id)).length !== 0) throw new Error('Karte mit Workflow-Entwurf blieb in der Queue.');
          const edited = await window.studio.updateDraftWorkflow({ id: draft.id, name: 'Smoke-Entwurf bearbeitet', cardIds: [card.id], steps: [{ id: 'smoke-step-edited', columnId: saved.columns[2].id, agentId: null, requireApproval: true }] });
          if (edited.name !== 'Smoke-Entwurf bearbeitet' || !edited.steps[0]?.requireApproval) throw new Error('Workflow-Entwurf wurde nicht bearbeitet.');
          await window.studio.deleteDraftWorkflow(draft.id);
          if ((await window.studio.queueCandidates(project.id))[0]?.id !== card.id) throw new Error('Gelöschter Entwurf gab die Karte nicht frei.');
          if (${process.platform === 'win32'}) {
            const terminal = await window.studio.startCommandTerminal({ projectId: project.id, shell: 'cmd' });
            await window.studio.writeCommandTerminal({ terminalId: terminal.id, data: 'set STUDIO_SMOKE_PREFIX=JARVIS_STUDIO_\\r' });
            await window.studio.writeCommandTerminal({ terminalId: terminal.id, data: 'echo %STUDIO_SMOKE_PREFIX%TERMINAL_OK\\r' });
            let echoed = false;
            let lastOutput = '';
            for (let attempt = 0; attempt < 600; attempt++) {
              const row = (await window.studio.commandTerminals(project.id)).find((item) => item.id === terminal.id);
              lastOutput = row?.output ?? '';
              if (row?.output.includes('JARVIS_STUDIO_TERMINAL_OK')) { echoed = true; break; }
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            await window.studio.stopCommandTerminal(terminal.id);
            if (!echoed) throw new Error('cmd-PTY gab keine Ausgabe zurück: ' + lastOutput.slice(-400));
            const agent = await window.studio.saveAgent({
              name: 'Smoke-Agent', kind: 'custom', command: ${JSON.stringify(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'))},
              args: ['/C', 'echo JARVIS_STUDIO_AGENT_OK && echo Error: BRANCHLOOM_OUTPUT_TEST'], model: null, enabled: true,
            });
            const session = await window.studio.startSession({ cardId: card.id, agentId: agent.id, prompt: '' });
            let agentFinished = false;
            for (let attempt = 0; attempt < 600; attempt++) {
              const row = (await window.studio.snapshot(project.id)).sessions.find((item) => item.id === session.id);
              if (row?.state === 'exited' && row.output.includes('JARVIS_STUDIO_AGENT_OK')) { agentFinished = true; break; }
              if (row?.state === 'failed') throw new Error('Lokaler Smoke-Agent ist fehlgeschlagen: ' + row.output.slice(-400));
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            if (!agentFinished) throw new Error('Lokaler Smoke-Agent beendete seinen PTY-Lauf nicht.');
          }
          return true;
        })()
      `;
      void window!.webContents.executeJavaScript(script).then(() => {
        const smokeStore = mustStore();
        const smokeProject = smokeStore.projects()[0]!;
        const smokeSnapshot = smokeStore.snapshot(smokeProject.id);
        const smokeCard = smokeSnapshot.cards.find((item) => item.title === 'Smoke-Karte')!;
        smokeStore.addCardAttachments(smokeCard.id, [join(smokeDataDirectory!, 'drop.md')]);
        const smokePlan = saveReviewedPlan(smokeStore, { projectId: smokeProject.id, request: 'Synthetischen Review-Plan prüfen', proposal: {
          title: 'Smoke-Review-Plan', explanation: 'Nur ein lokaler UI-Test.',
          cards: [{ title: 'Smoke-Review-Aufgabe', description: 'Synthetisch.' }], columnIds: [smokeSnapshot.columns[0]!.id],
        } });
        createPlanComment(smokeStore, { planId: smokePlan.id, fingerprint: smokePlan.fingerprint, line: 1, body: 'BRANCHLOOM_PLAN_REVIEW_SMOKE' });
        smokeStore.db.prepare(`INSERT INTO review_comments (id,card_id,fingerprint,file_path,side,line,body,created_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), smokeCard.id, 'f'.repeat(64), 'src/synthetic.ts', 'new', 14, 'BRANCHLOOM_DIFF_REVIEW_SMOKE', new Date().toISOString());
        const secondProjectPath = join(smokeProject.path, 'second-project');
        mkdirSync(secondProjectPath, { recursive: true });
        const smokeWindow = window!;
        smokeWindow.webContents.once('did-finish-load', () => {
          const boardScript = `
            (async () => {
              for (let attempt = 0; attempt < 600 && ![...document.querySelectorAll('.task-card')].some((item) => item.textContent?.includes('Smoke-Karte')); attempt++) {
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (![...document.querySelectorAll('.task-card')].some((item) => item.textContent?.includes('Smoke-Karte'))) {
                throw new Error('Gespeicherte Karte wurde nach Reload nicht im Board gerendert.');
              }
              const boardProject = (await window.studio.projects())[0];
              const storedColumns = (await window.studio.snapshot(boardProject.id)).columns.map((item) => item.name);
              const renderedColumns = [...document.querySelectorAll('.board-column .column-title h3')].map((item) => item.textContent);
              if (JSON.stringify(renderedColumns) !== JSON.stringify(storedColumns)) throw new Error('Gespeicherte Spaltenreihenfolge wurde nach Reload nicht gerendert.');
              const ideasNavAfterReload = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Ideenraum'));
              if (!ideasNavAfterReload) throw new Error('Ideenraum-Navigation fehlt.');
              ideasNavAfterReload.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.ideas-list-item'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.ideas-list-item')?.textContent?.includes('Smoke-Idee')) throw new Error('Gespeicherte Idee wurde nach Reload nicht angezeigt.');
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board')?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.task-card'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const discussion = [...document.querySelectorAll('.board-header-actions button')].find((item) => item.textContent?.includes('Aufgabe besprechen'));
              if (!discussion) throw new Error('Aufgabenklärung fehlt im Board.');
              discussion.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('[role="dialog"][aria-label="Aufgabe besprechen"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('[role="dialog"][aria-label="Aufgabe besprechen"]')) throw new Error('Aufgabenklärung öffnete sich nicht.');
              document.querySelector('[role="dialog"][aria-label="Aufgabe besprechen"] button[aria-label="Schließen"]')?.click();
              const whiteboardNav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Whiteboard'));
              if (!whiteboardNav) throw new Error('Whiteboard-Navigation fehlt.');
              whiteboardNav.click();
              let whiteboardReady = false;
              for (let attempt = 0; attempt < 300; attempt++) {
                whiteboardReady = Boolean(document.querySelector('.wb-canvas') && document.querySelector('.wb-inspector') && document.querySelector('.wb-node'));
                if (whiteboardReady) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const whiteboard = await window.studio.whiteboard(boardProject.id);
              if (!whiteboardReady || whiteboard.nodes.length !== 2 || whiteboard.edges.length !== 1) throw new Error('Whiteboard-Boxen oder Verbindungen wurden nach Reload nicht angezeigt/gespeichert.');
              const folderNode = [...document.querySelectorAll('.wb-node')].find((item) => item.textContent?.includes('Smoke-Ordner'));
              if (!folderNode) throw new Error('Whiteboard-Ordnerbox fehlt im Canvas.');
              folderNode.click();
              let impactButton;
              for (let attempt = 0; attempt < 100; attempt++) {
                impactButton = [...document.querySelectorAll('.wb-impact button')].find((item) => item.textContent?.includes('Direkte Imports prüfen'));
                if (impactButton && !impactButton.disabled) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!impactButton || impactButton.disabled) throw new Error('Whiteboard-Änderungswirkung fehlt im Inspector.');
              impactButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.wb-impact-result'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.wb-impact-result')?.textContent?.includes('screen.ts:1')) throw new Error('Whiteboard-Importbeleg fehlt im Inspector.');
              if (!document.querySelector('.wb-impact-result')?.textContent?.includes('page.ts:1') || !document.querySelector('.wb-impact-result')?.textContent?.includes('app.ts:1')) throw new Error('Whiteboard-Importkette fehlt im Inspector.');
              if (!document.querySelector('.wb-impact-result')?.textContent?.includes('Bezug: Ordner src')) throw new Error('Whiteboard-Importbeleg zeigt keinen geprüften Bezug.');
              const impactSessionsBefore = (await window.studio.snapshot(boardProject.id)).sessions.length;
              const impactDraftButton = document.querySelector('.wb-impact-result button[aria-label^="Kartenentwurf aus Import"]');
              if (!impactDraftButton) throw new Error('Whiteboard-Importbeleg bietet keinen Kartenentwurf.');
              impactDraftButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('form[aria-label="Karte aus Importbeleg"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const impactForm = document.querySelector('form[aria-label="Karte aus Importbeleg"]');
              if (!impactForm?.querySelector('input') || !impactForm?.querySelector('textarea') || !impactForm.textContent?.includes('screen.ts:1')) throw new Error('Editierbarer Whiteboard-Import-Kartenentwurf fehlt.');
              const impactSubmit = impactForm.querySelector('button[type="submit"]');
              if (!impactSubmit || impactSubmit.disabled) throw new Error('Whiteboard-Import-Kartenentwurf konnte nicht bestätigt werden.');
              impactSubmit.click();
              let impactCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                impactCard = (await window.studio.snapshot(boardProject.id)).cards.find((item) => item.title.includes('Änderung an src/widget.ts prüfen'));
                if (impactCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!impactCard?.description.includes('Whiteboard-Importbezug:') || !impactCard.description.includes('screen.ts:1 importiert src/widget.ts')) throw new Error('Whiteboard-Import-Karte ohne geprüften Quellenbezug.');
              if ((await window.studio.snapshot(boardProject.id)).sessions.length !== impactSessionsBefore) throw new Error('Whiteboard-Import-Karte startete einen Agenten.');
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-drawer')) throw new Error('Neue Whiteboard-Import-Karte wurde nicht geöffnet.');
              document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
              whiteboardNav.click();
              let folderAfterCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                folderAfterCard = [...document.querySelectorAll('.wb-node')].find((item) => item.textContent?.includes('Smoke-Ordner'));
                if (folderAfterCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!folderAfterCard) throw new Error('Whiteboard nach Kartenanlage nicht erreichbar.');
              folderAfterCard.click();
              let impactButtonAgain;
              for (let attempt = 0; attempt < 100; attempt++) {
                impactButtonAgain = [...document.querySelectorAll('.wb-impact button')].find((item) => item.textContent?.includes('Direkte Imports prüfen'));
                if (impactButtonAgain && !impactButtonAgain.disabled) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!impactButtonAgain || impactButtonAgain.disabled) throw new Error('Whiteboard-Importprüfung nach Kartenanlage fehlt.');
              impactButtonAgain.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.wb-impact-result'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.wb-impact-result')) throw new Error('Whiteboard-Importprüfung nach Kartenanlage ohne Ergebnis.');
              const pathInput = [...document.querySelectorAll('.wb-inspector label')].find((item) => item.textContent?.includes('Relativer Ordnerpfad'))?.querySelector('input');
              const pathSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!pathInput || !pathSetter) throw new Error('Whiteboard-Pfadeditor fehlt.');
              pathSetter.call(pathInput, 'anderer-pfad');
              pathInput.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && document.querySelector('.wb-impact-result'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.wb-impact-result')) throw new Error('Veralteter Whiteboard-Importbeleg bleibt nach Pfadänderung sichtbar.');
              const linkedNode = [...document.querySelectorAll('.wb-node')].find((item) => item.textContent?.includes('Smoke-Aufgabe'));
              if (!linkedNode) throw new Error('Verknüpfte Whiteboard-Box fehlt im Canvas.');
              linkedNode.click();
              let openLinkedCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                openLinkedCard = [...document.querySelectorAll('.wb-inspector button')].find((item) => item.textContent?.includes('Karte öffnen'));
                if (openLinkedCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!openLinkedCard) throw new Error('Whiteboard-Kartenlink fehlt im Inspector.');
              openLinkedCard.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-drawer')?.textContent?.includes('Smoke-Karte')) throw new Error('Whiteboard-Kartenlink öffnete nicht die Karte.');
              const qaForm = document.querySelector('.card-drawer .card-qa-form');
              if (!qaForm) throw new Error('Karten-QA-Formular fehlt.');
              for (let attempt = 0; attempt < 100 && document.querySelector('.card-qa')?.textContent?.includes('Gespeicherte Prüfungen werden geladen'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.card-qa')?.textContent?.includes('Gespeicherte Prüfungen werden geladen')) throw new Error('Karten-QA-Berichte wurden nicht geladen.');
              const qaInput = qaForm.querySelector('input');
              if (!qaInput) throw new Error('Karten-QA-URL-Feld fehlt.');
              const qaValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!qaValueSetter) throw new Error('Browser-QA-Eingabe kann im Smoke nicht gesetzt werden.');
              qaValueSetter.call(qaInput, ${JSON.stringify(qaUrl)});
              qaInput.dispatchEvent(new Event('input', { bubbles: true }));
              const qaViewport = qaForm.querySelector('select');
              const viewportSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!qaViewport || !viewportSetter) throw new Error('Karten-QA-Prüfgrößen fehlen.');
              viewportSetter.call(qaViewport, 'tablet');
              qaViewport.dispatchEvent(new Event('change', { bubbles: true }));
              const qaButton = qaForm.querySelector('button[type="submit"]');
              for (let attempt = 0; attempt < 100 && qaButton?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!qaButton || qaButton.disabled) throw new Error('Karten-QA-Schaltfläche wurde nicht aktiv.');
              qaButton?.click();
              let qaReport;
              const qaCard = (await window.studio.snapshot(boardProject.id)).cards.find((item) => item.title === 'Smoke-Karte');
              if (!qaCard) throw new Error('QA-Smoke-Karte fehlt.');
              for (let attempt = 0; attempt < 500; attempt++) {
                qaReport = (await window.studio.cardQaReports(qaCard.id))[0];
                if (qaReport) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (qaReport?.status !== 'failed' || qaReport.viewportWidth !== 768 || qaReport.viewportHeight !== 1024 || !qaReport.diagnostics.some((item) => item.message.includes('BRANCHLOOM_QA_SMOKE_ERROR')) || qaReport.pageCheck !== 'complete' || !qaReport.pageObservations.some((item) => item.kind === 'missing-image-alt') || !qaReport.pageObservations.some((item) => item.kind === 'horizontal-overflow')) throw new Error('Lokale Karten-QA hat Tablet-Viewport, Browserfehler oder DOM-Hinweise nicht gespeichert: ' + JSON.stringify({ report: qaReport, form: qaForm.textContent, value: qaInput.value, disabled: qaButton?.disabled, error: document.querySelector('.card-qa .inline-error')?.textContent }));
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-qa-report')?.textContent?.includes('BRANCHLOOM_QA_SMOKE_ERROR'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-qa-report')?.textContent?.includes('BRANCHLOOM_QA_SMOKE_ERROR') || !document.querySelector('.card-qa-report')?.textContent?.includes('Bildern ohne alt-Attribut') || !document.querySelector('.card-qa-report')?.textContent?.includes('breiter als der sichtbare Inhaltsbereich')) throw new Error('Karten-QA-Bericht wurde nicht samt DOM-Hinweisen sichtbar gerendert.');
              const fixButton = [...document.querySelectorAll('.card-qa-report .card-qa-fix-card button')].find((item) => item.textContent?.includes('Fixkarte vorbereiten'));
              if (!fixButton) throw new Error('QA-Fixkarten-Aktion fehlt im gespeicherten Fehlerbericht.');
              const countBeforeFix = (await window.studio.snapshot(boardProject.id)).cards.length;
              fixButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-qa-fix-card form'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const fixForm = document.querySelector('.card-qa-fix-card form');
              if (!fixForm || !(fixForm.querySelector('textarea')?.value ?? '').includes('BRANCHLOOM_QA_SMOKE_ERROR') || (await window.studio.snapshot(boardProject.id)).cards.length !== countBeforeFix) throw new Error('QA-Fixkarten-Entwurf oder unveränderte Karte vor Bestätigung fehlt.');
              const fixTitle = fixForm.querySelector('input');
              const fixDescription = fixForm.querySelector('textarea');
              const fixColumn = fixForm.querySelector('select');
              const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (!fixTitle || !fixDescription || !fixColumn || !textSetter) throw new Error('QA-Fixkarten-Entwurf ist nicht editierbar.');
              qaValueSetter.call(fixTitle, 'BRANCHLOOM_QA_FIX_CARD'); fixTitle.dispatchEvent(new Event('input', { bubbles: true }));
              textSetter.call(fixDescription, 'Synthetischer Reproduktionsschritt'); fixDescription.dispatchEvent(new Event('input', { bubbles: true }));
              const planningColumn = (await window.studio.snapshot(boardProject.id)).columns.find((item) => item.name === 'Planning');
              if (!planningColumn) throw new Error('Manuelle Planning-Spalte fehlt.');
              viewportSetter.call(fixColumn, planningColumn.id); fixColumn.dispatchEvent(new Event('change', { bubbles: true }));
              fixForm.querySelector('button[type="submit"]')?.click();
              let qaFixCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                qaFixCard = (await window.studio.snapshot(boardProject.id)).cards.find((item) => item.title === 'BRANCHLOOM_QA_FIX_CARD');
                if (qaFixCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!qaFixCard || qaFixCard.columnId !== planningColumn.id || !qaFixCard.description.includes('Synthetischer Reproduktionsschritt') || !qaFixCard.description.includes(qaReport.id) || (await window.studio.snapshot(boardProject.id)).sessions.length !== 1) throw new Error('Bestätigte QA-Fixkarte, Quellenbezug oder Agentenruhe fehlt.');
              const screenshotButton = [...document.querySelectorAll('.card-qa-screenshot button')].find((item) => item.textContent?.includes('Screenshot ansehen'));
              if (!screenshotButton) throw new Error('QA-Screenshot-Knopf fehlt.');
              screenshotButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-qa-screenshot img[src^="data:image/png;base64,"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const screenshotImage = document.querySelector('.card-qa-screenshot img[src^="data:image/png;base64,"]');
              if (!screenshotImage) throw new Error('QA-Screenshot wurde nach Klick nicht im Kartenbericht geöffnet.');
              await screenshotImage.decode();
              if (!screenshotImage.naturalWidth || screenshotImage.naturalWidth > 960 || screenshotImage.naturalHeight > 600) throw new Error('QA-Screenshot überschreitet die begrenzten Bildmaße.');
              for (let attempt = 0; attempt < 100 && qaButton.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (qaButton.disabled) throw new Error('Zweiter QA-Lauf konnte nicht gestartet werden.');
              viewportSetter.call(qaViewport, 'mobile');
              qaViewport.dispatchEvent(new Event('change', { bubbles: true }));
              qaButton.click();
              let comparisonReports;
              for (let attempt = 0; attempt < 300; attempt++) {
                comparisonReports = await window.studio.cardQaReports(qaCard.id);
                if (comparisonReports.length >= 2) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (comparisonReports?.length !== 2 || !comparisonReports.every((item) => item.screenshotAvailable) || comparisonReports[0].viewportWidth !== 390 || comparisonReports[0].viewportHeight !== 844) throw new Error('Zwei QA-Screenshots oder Mobile-Viewport fehlen.');
              for (let attempt = 0; attempt < 100 && document.querySelector('.card-qa-screenshot img'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.card-qa-screenshot img')) throw new Error('Eingeklappter QA-Bericht hielt den geladenen Screenshot im DOM.');
              let comparisonSelects;
              for (let attempt = 0; attempt < 100; attempt++) {
                comparisonSelects = [...document.querySelectorAll('.card-qa-comparison select')];
                if (comparisonSelects.length === 2) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (comparisonSelects?.length !== 2) throw new Error('Visual-Diff-Auswahl fehlt.');
              const selectValueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!selectValueSetter) throw new Error('Visual-Diff-Auswahl kann im Smoke nicht gesetzt werden.');
              selectValueSetter.call(comparisonSelects[0], comparisonReports[1].id);
              comparisonSelects[0].dispatchEvent(new Event('change', { bubbles: true }));
              selectValueSetter.call(comparisonSelects[1], comparisonReports[0].id);
              comparisonSelects[1].dispatchEvent(new Event('change', { bubbles: true }));
              const compareButton = [...document.querySelectorAll('.card-qa-comparison button')].find((item) => item.textContent?.includes('Visuell vergleichen'));
              for (let attempt = 0; attempt < 100 && compareButton?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!compareButton || compareButton.disabled) throw new Error('Visual-Diff-Vergleich wurde nicht aktiv.');
              compareButton.click();
              for (let attempt = 0; attempt < 100 && document.querySelectorAll('.card-qa-comparison-images img').length !== 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const comparedImages = [...document.querySelectorAll('.card-qa-comparison-images img')];
              if (comparedImages.length !== 2) throw new Error('Visual-Diff zeigte nicht beide gespeicherten Bilder.');
              await Promise.all(comparedImages.map((image) => image.decode()));
              if (!document.querySelector('.card-qa-comparison-view')?.textContent?.includes('Viewport: 768 × 1024 px') || !document.querySelector('.card-qa-comparison-view')?.textContent?.includes('Viewport: 390 × 844 px') || !document.querySelector('.card-qa-comparison-view')?.textContent?.includes('Keine Pixelbewertung')) throw new Error('Visual-Diff-Quellen, Prüfgrößen oder Grenzen fehlen.');
              [...document.querySelectorAll('.card-qa-comparison-images button')].find((item) => item.textContent?.includes('Screenshot A vergrößern'))?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-qa-comparison-images figure.expanded'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-qa-comparison-images figure.expanded')) throw new Error('Visual-Diff-Vergrößerung fehlt.');
              [...document.querySelectorAll('.card-qa-comparison-view button')].find((item) => item.textContent?.includes('Vergleich schließen'))?.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.card-qa-comparison-images img'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.card-qa-comparison-images img') || document.activeElement !== compareButton) throw new Error('Geschlossener Visual-Diff hielt Bilder oder Fokus nicht korrekt.');
              const matrix = document.querySelector('.card-qa-viewport-matrix');
              const matrixButton = [...(matrix?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('Gespeicherte Größen ansehen'));
              if (!matrix || !matrixButton || !matrix.textContent?.includes('Prüfgrößen einer Route')) throw new Error('Gespeicherte QA-Prüfgrößen fehlen.');
              if (matrix.querySelector('img')) throw new Error('QA-Prüfgrößen luden Bilder ohne ausdrücklichen Klick.');
              matrixButton.click();
              for (let attempt = 0; attempt < 100 && matrix.querySelectorAll('.card-qa-viewport-matrix-grid img').length !== 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const matrixImages = [...matrix.querySelectorAll('.card-qa-viewport-matrix-grid img')];
              if (matrixImages.length !== 2 || !matrix.textContent?.includes('Kein Screenshot dieser Größe für die Route gespeichert.') || !matrix.textContent?.includes('1280 × 800 px') || !matrix.textContent?.includes('768 × 1024 px') || !matrix.textContent?.includes('390 × 844 px') || !matrix.textContent?.includes('Keine gleichzeitige Live-Vorschau')) throw new Error('QA-Prüfgrößen zeigen nicht die zwei gespeicherten Aufnahmen, die Desktop-Lücke und die Grenzen.');
              if (matrix.querySelectorAll('time').length !== 2 || !matrix.textContent?.includes(${JSON.stringify(qaUrl)})) throw new Error('QA-Prüfgrößen zeigen Quelle und Zeiten nicht.');
              await Promise.all(matrixImages.map((item) => item.decode()));
              [...matrix.querySelectorAll('button')].find((item) => item.textContent?.includes('Größenansicht schließen'))?.click();
              for (let attempt = 0; attempt < 100 && matrix.querySelector('img'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (matrix.querySelector('img') || document.activeElement !== matrixButton) throw new Error('QA-Prüfgrößen hielten Bilder oder Fokus nach Schließen.');
              const qaExtra = qaForm.querySelector('textarea');
              const qaExtraSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
              if (!qaExtra || !qaExtraSetter) throw new Error('Mehrfach-Routenfeld fehlt im Karten-QA-Formular.');
              qaExtraSetter.call(qaExtra, ${JSON.stringify(`${qaUrl}second\n${qaUrl}third`)});
              qaExtra.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && !qaButton.textContent?.includes('Lokale Routen prüfen'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!qaButton.textContent?.includes('Lokale Routen prüfen')) throw new Error('Mehrfach-Routenlauf wurde nicht angeboten.');
              qaButton.click();
              let batchReports;
              for (let attempt = 0; attempt < 500; attempt++) {
                batchReports = await window.studio.cardQaReports(qaCard.id);
                if (batchReports.length === 5 && document.querySelector('.card-qa [role="status"]')?.textContent?.includes('3 von 3 Routen gespeichert')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (batchReports?.length !== 5 || !batchReports.some((item) => item.requestedUrl.endsWith('/second')) || !batchReports.some((item) => item.requestedUrl.endsWith('/third')) || !document.querySelector('.card-qa [role="status"]')?.textContent?.includes('3 von 3 Routen gespeichert')) throw new Error('Mehrfach-Routenlauf speicherte oder zeigte nicht alle drei QA-Berichte.');
              if ((await window.studio.snapshot(boardProject.id)).sessions.length !== 1) throw new Error('Mehrfach-Routenlauf startete einen Agenten.');
              const contextForm = document.querySelector('.card-drawer .card-context-form');
              const contextInput = contextForm?.querySelector('input');
              if (!contextForm || !contextInput) throw new Error('Karten-Kontextformular fehlt.');
              qaValueSetter.call(contextInput, 'context.md');
              contextInput.dispatchEvent(new Event('input', { bubbles: true }));
              const contextButton = contextForm.querySelector('button[type="submit"]');
              for (let attempt = 0; attempt < 100 && contextButton?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!contextButton || contextButton.disabled) throw new Error('Karten-Kontextschaltfläche wurde nicht aktiv.');
              contextButton.click();
              let contextRefs;
              for (let attempt = 0; attempt < 100; attempt++) {
                contextRefs = await window.studio.cardContextReferences(qaCard.id);
                if (contextRefs.length) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (contextRefs?.[0]?.target !== 'context.md') throw new Error('Projektdatei wurde nicht als Kartenkontext gespeichert.');
              let contextPreviewButton;
              for (let attempt = 0; attempt < 100; attempt++) {
                contextPreviewButton = document.querySelector('.card-context-list button.secondary-button');
                if (contextPreviewButton) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!contextPreviewButton) throw new Error('Gespeicherter Kontextbezug wurde nicht im Kartendrawer angezeigt.');
              contextPreviewButton.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-context-preview')?.textContent?.includes('BRANCHLOOM_CONTEXT_SMOKE'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-context-preview')?.textContent?.includes('BRANCHLOOM_CONTEXT_SMOKE')) throw new Error('Begrenzte Projektdatei-Vorschau wurde nicht angezeigt.');
              let dragSource;
              for (let attempt = 0; attempt < 100; attempt++) {
                dragSource = document.querySelector('.card-attachment-name[draggable="true"]');
                if (dragSource) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const dropTarget = document.querySelector('.card-context');
              if (!dragSource || !dropTarget) throw new Error('Kartenanhang oder Kontext-Dropziel fehlt.');
              const transfer = new DataTransfer();
              dragSource.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
              dropTarget.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
              dropTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
              for (let attempt = 0; attempt < 100 && contextInput.value !== 'drop.md'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (contextInput.value !== 'drop.md' || !dropTarget.textContent?.includes('Projektdatei „drop.md“ vorbereitet')) throw new Error('Drag-and-drop füllte den geprüften Kontextentwurf nicht.');
              if ((await window.studio.cardContextReferences(qaCard.id)).length !== 1) throw new Error('Drop speicherte den Kontext ohne Bestätigung.');
              contextButton.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.cardContextReferences(qaCard.id)).length !== 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(await window.studio.cardContextReferences(qaCard.id)).some((item) => item.target === 'drop.md')) throw new Error('Bestätigter Drop wurde nicht als Kartenkontext gespeichert.');
              const outputPanel = document.querySelector('.card-drawer .output-errors');
              for (let attempt = 0; attempt < 100 && !outputPanel?.querySelector('form'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const outputForm = outputPanel?.querySelector('form');
              if (!outputForm?.textContent?.includes('BRANCHLOOM_OUTPUT_TEST')) throw new Error('Gespeicherter Agentenfehler erschien nicht zur Auswahl.');
              outputForm.querySelector('button[type="submit"]')?.click();
              let outputCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                outputCard = (await window.studio.snapshot(boardProject.id)).cards.find((item) => item.title.includes('BRANCHLOOM_OUTPUT_TEST'));
                if (outputCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!outputCard?.description.includes('BRANCHLOOM_OUTPUT_TEST')) throw new Error('Ausgewählter Agentenfehler wurde nicht als Karte gespeichert.');
              if ((await window.studio.snapshot(boardProject.id)).sessions.length !== 1) throw new Error('Fehlerkarten-Anlage startete einen weiteren Agenten.');
              document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
              [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Whiteboard'))?.click();
              let edgeListButton;
              for (let attempt = 0; attempt < 100; attempt++) {
                edgeListButton = document.querySelector('.wb-edge-list-item');
                if (edgeListButton) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!edgeListButton) throw new Error('Whiteboard-Verbindung fehlt in der zugänglichen Auswahl.');
              edgeListButton.click();
              let suggestCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                suggestCard = [...document.querySelectorAll('.wb-inspector button')].find((item) => item.textContent?.includes('Kartenentwurf aus Verbindung'));
                if (suggestCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!suggestCard) throw new Error('Kartenentwurf aus Whiteboard-Verbindung fehlt.');
              suggestCard.click();
              let cardDraft;
              for (let attempt = 0; attempt < 100; attempt++) {
                cardDraft = document.querySelector('.wb-card-form');
                if (cardDraft) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!cardDraft?.querySelector('input')?.value.includes('→') || !cardDraft.querySelector('select')?.value) throw new Error('Editierbarer Whiteboard-Kartenentwurf fehlt.');
              const beforeCardCount = (await window.studio.snapshot(boardProject.id)).cards.length;
              const createFromEdge = [...cardDraft.querySelectorAll('button')].find((item) => item.textContent?.includes('Karte anlegen'));
              if (!createFromEdge) throw new Error('Ausdrückliche Kartenanlage fehlt.');
              createFromEdge.click();
              let createdEdgeCard;
              for (let attempt = 0; attempt < 100; attempt++) {
                createdEdgeCard = (await window.studio.whiteboard(boardProject.id)).edges[0]?.cardId;
                if (createdEdgeCard) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              const afterCardSnapshot = await window.studio.snapshot(boardProject.id);
              if (!createdEdgeCard || afterCardSnapshot.cards.length !== beforeCardCount + 1 || !afterCardSnapshot.cards.find((item) => item.id === createdEdgeCard)?.description.includes('Whiteboard-Bezug:')) throw new Error('Whiteboard-Karte wurde nicht mit Quellenbezug gespeichert.');
              for (let attempt = 0; attempt < 100 && !document.querySelector('.card-drawer'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.card-drawer')) throw new Error('Neue Whiteboard-Karte wurde nicht geöffnet.');
              document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
              const workflowNav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Workflows'));
              if (!workflowNav) throw new Error('Workflow-Navigation fehlt.');
              workflowNav.click();
              let previewVisible = false;
              for (let attempt = 0; attempt < 300; attempt++) {
                previewVisible = Boolean(document.querySelector('.queue-preview ol')?.textContent?.includes('Smoke-Karte'));
                if (previewVisible) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!previewVisible) throw new Error('Nächste freie To-Do-Karte wurde im Workflow nicht angezeigt.');
              const workflowProject = (await window.studio.projects())[0];
              const workflowSnapshot = await window.studio.snapshot(workflowProject.id);
              const workflowCard = workflowSnapshot.cards.find((item) => item.title === 'Smoke-Karte');
              const workflowStepColumn = workflowSnapshot.columns.find((item) => item.name === 'Smoke-Umbenannt');
              if (!workflowCard || !workflowStepColumn) throw new Error('Workflow-Smoke-Daten fehlen.');
              const deleteDraft = await window.studio.createWorkflow({ projectId: workflowProject.id, name: 'Zu löschender Entwurf', cardIds: [workflowCard.id], steps: [{ id: 'delete-smoke-step', columnId: workflowStepColumn.id, agentId: null, requireApproval: false }] });
              document.querySelector('button[aria-label="Aktualisieren"]')?.click();
              let deleteButton;
              for (let attempt = 0; attempt < 300; attempt++) {
                deleteButton = [...document.querySelectorAll('.workflow-list .workflow-card button')].find((item) => item.textContent?.includes('Entwurf löschen'));
                if (deleteButton) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!deleteButton) throw new Error('Entwurf-Löschknopf fehlt.');
              const editButton = [...document.querySelectorAll('.workflow-list .workflow-card button')].find((item) => item.textContent?.includes('Entwurf bearbeiten'));
              if (!editButton) throw new Error('Entwurf-Bearbeitenknopf fehlt.');
              editButton.click();
              let editDialog;
              for (let attempt = 0; attempt < 300; attempt++) {
                editDialog = [...document.querySelectorAll('.dialog.wide')].find((item) => item.textContent?.includes('Workflow-Entwurf bearbeiten'));
                if (editDialog) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!editDialog || editDialog.querySelector('input[placeholder="Zum Beispiel: Implementieren und prüfen"]')?.value !== 'Zu löschender Entwurf') throw new Error('Entwurf-Bearbeitenformular wurde nicht vorausgefüllt.');
              editDialog.querySelector('button[aria-label="Schließen"]')?.click();
              for (let attempt = 0; attempt < 300 && document.querySelector('.dialog.wide'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              deleteButton.click();
              let confirmDelete;
              for (let attempt = 0; attempt < 300; attempt++) {
                confirmDelete = document.querySelector('[role="dialog"][aria-label="Workflow-Entwurf löschen"] .danger-button');
                if (confirmDelete) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!confirmDelete) throw new Error('Bestätigung für Workflow-Entwurf fehlt.');
              confirmDelete.click();
              let draftDeleted = false;
              for (let attempt = 0; attempt < 300; attempt++) {
                draftDeleted = !(await window.studio.snapshot(workflowProject.id)).workflows.some((item) => item.id === deleteDraft.id);
                if (draftDeleted && document.querySelector('.queue-preview ol')?.textContent?.includes('Smoke-Karte')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!draftDeleted || !document.querySelector('.queue-preview ol')?.textContent?.includes('Smoke-Karte')) throw new Error('Workflow-Entwurf wurde nicht sichtbar gelöscht und Karte nicht freigegeben.');
              if (${process.platform === 'win32'}) {
                const activityNav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Aktivität'));
                if (!activityNav) throw new Error('Aktivitätsnavigation fehlt.');
                activityNav.click();
                let openTranscript;
                for (let attempt = 0; attempt < 300; attempt++) {
                  openTranscript = [...document.querySelectorAll('.activity-item button')].find((item) => item.textContent?.includes('Verlauf ansehen'));
                  if (openTranscript) break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                if (!openTranscript) throw new Error('Agentenlauf fehlt in der Aktivitätsansicht.');
                openTranscript.click();
                let saveNote;
                for (let attempt = 0; attempt < 300; attempt++) {
                  saveNote = [...document.querySelectorAll('.activity-transcript-dialog button')].find((item) => item.textContent?.includes('In Memory speichern'));
                  if (saveNote) break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                if (!saveNote) throw new Error('Memory-Übernahme fehlt im Agentenverlauf.');
                saveNote.click();
                let savedNote = false;
                for (let attempt = 0; attempt < 300; attempt++) {
                  const project = (await window.studio.projects())[0];
                  const current = await window.studio.snapshot(project.id);
                  savedNote = current.notes.some((note) => note.title === 'Agentenlauf: Smoke-Karte' && note.tags.includes('agentenlauf') && note.body.includes('JARVIS_STUDIO_AGENT_OK'));
                  if (savedNote && document.querySelector('.topbar-title h1')?.textContent === 'Memory') break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                if (!savedNote || document.querySelector('.topbar-title h1')?.textContent !== 'Memory') throw new Error('Agentenlauf wurde nicht sichtbar als lokale Memory-Notiz gespeichert.');
                let sourceButton;
                for (let attempt = 0; attempt < 300; attempt++) {
                  sourceButton = [...document.querySelectorAll('.memory-modebar button')].find((item) => item.textContent?.includes('Quellverlauf öffnen'));
                  if (sourceButton) break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                if (!sourceButton) throw new Error('Quellverlauf-Link fehlt an der Memory-Notiz.');
                sourceButton.click();
                let sourceOpened = false;
                for (let attempt = 0; attempt < 300; attempt++) {
                  sourceOpened = document.querySelector('.topbar-title h1')?.textContent === 'Aktivität' && Boolean(document.querySelector('.activity-transcript-dialog')?.textContent?.includes('JARVIS_STUDIO_AGENT_OK'));
                  if (sourceOpened) break;
                  await new Promise((resolve) => setTimeout(resolve, 50));
                }
                if (!sourceOpened) throw new Error('Quellverlauf wurde nicht aus Memory geöffnet.');
              }
              const decisionsNav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Entscheidungen'));
              if (!decisionsNav) throw new Error('Review-Inbox-Navigation fehlt.');
              decisionsNav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.decision-review-section')?.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const planInboxButton = [...document.querySelectorAll('.decision-review-item')].find((item) => item.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE'))?.querySelector('button.secondary-button');
              if (!planInboxButton) throw new Error('Plan-Kommentar fehlt in der Review-Inbox.');
              planInboxButton.click();
              for (let attempt = 0; attempt < 100 && (document.activeElement?.id !== 'workflow-plan-review' || !document.querySelector('#workflow-plan-review')?.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.activeElement?.id !== 'workflow-plan-review' || !document.querySelector('#workflow-plan-review')?.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE')) throw new Error('Plan-Navigation setzte den Tastaturfokus nicht auf den gespeicherten Plan: ' + JSON.stringify({ active: document.activeElement?.outerHTML?.slice(0, 250), plan: document.querySelector('#workflow-plan-review')?.textContent?.slice(-300), view: document.querySelector('.topbar-title h1')?.textContent }));
              const decisionsNavAfterPlan = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Entscheidungen'));
              if (!decisionsNavAfterPlan) throw new Error('Rückweg zur Review-Inbox fehlt.');
              decisionsNavAfterPlan.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.decision-review-section')?.textContent?.includes('BRANCHLOOM_DIFF_REVIEW_SMOKE'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const diffInboxButton = [...document.querySelectorAll('.decision-review-item')].find((item) => item.textContent?.includes('BRANCHLOOM_DIFF_REVIEW_SMOKE'))?.querySelector('button.secondary-button');
              if (!diffInboxButton) throw new Error('Diff-Kommentar fehlt in der Review-Inbox.');
              diffInboxButton.click();
              for (let attempt = 0; attempt < 100 && !(document.activeElement?.classList.contains('review-diff-comment') && document.activeElement?.textContent?.includes('BRANCHLOOM_DIFF_REVIEW_SMOKE')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.topbar-title h1')?.textContent !== 'Board' || !document.activeElement?.classList.contains('review-diff-comment') || !document.activeElement?.textContent?.includes('BRANCHLOOM_DIFF_REVIEW_SMOKE')) throw new Error('Diff-Kommentar wurde ohne Worktree nicht geöffnet und fokussiert: ' + JSON.stringify({ view: document.querySelector('.topbar-title h1')?.textContent, active: document.activeElement?.outerHTML?.slice(0, 250), drawer: document.querySelector('.card-drawer')?.textContent?.slice(-350), review: document.querySelector('.review-diff')?.textContent?.slice(-350) }));
              const decisionsNavAfterDiff = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Entscheidungen'));
              if (!decisionsNavAfterDiff) throw new Error('Rückweg zur QA-Inbox fehlt.');
              decisionsNavAfterDiff.click();
              let qaInboxItem;
              for (let attempt = 0; attempt < 100; attempt++) {
                qaInboxItem = document.querySelector('.decision-review-item[data-qa-report-id="' + qaReport.id + '"]');
                if (qaInboxItem?.textContent?.includes('BRANCHLOOM_QA_SMOKE_ERROR')) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!qaInboxItem?.textContent?.includes('BRANCHLOOM_QA_SMOKE_ERROR') || !qaInboxItem.textContent.includes('Route: http://127.0.0.1:')) throw new Error('Echter fehlgeschlagener Browser-QA-Bericht fehlt mit Route und Diagnose in der Inbox.');
              qaInboxItem.querySelector('button.secondary-button')?.click();
              for (let attempt = 0; attempt < 100 && document.activeElement?.id !== 'card-qa-report-' + qaReport.id; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.topbar-title h1')?.textContent !== 'Board' || document.activeElement?.id !== 'card-qa-report-' + qaReport.id || !document.activeElement?.textContent?.includes('BRANCHLOOM_QA_SMOKE_ERROR')) throw new Error('QA-Inbox öffnete und fokussierte den konkreten Kartenbericht nicht.');
              const decisionsNavAfterQa = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Entscheidungen'));
              if (!decisionsNavAfterQa) throw new Error('Rückweg zur QA-Quittierung fehlt.');
              decisionsNavAfterQa.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.decision-review-item[data-qa-report-id="' + qaReport.id + '"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              document.querySelector('.decision-review-item[data-qa-report-id="' + qaReport.id + '"] .decision-subaction')?.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.reviewInboxItems({ projectId: boardProject.id })).items.some((item) => item.id === qaReport.id); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.reviewInboxItems({ projectId: boardProject.id })).items.some((item) => item.id === qaReport.id) || !(await window.studio.cardQaReports(qaCard.id)).some((item) => item.id === qaReport.id)) throw new Error('QA-Quittierung entfernte nicht nur den Inbox-Eintrag.');
              if ((await window.studio.snapshot(boardProject.id)).sessions.length !== 1) throw new Error('QA-Inbox startete einen weiteren Agenten.');
              const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
              const liveProjectComment = await window.studio.createPlanComment({ planId: ${JSON.stringify(smokePlan.id)}, fingerprint: ${JSON.stringify(smokePlan.fingerprint)}, line: 1, body: 'BRANCHLOOM_LIVE_PROJECT_INBOX' });
              if (document.querySelector('.decision-review-section')?.textContent?.includes('BRANCHLOOM_LIVE_PROJECT_INBOX')) throw new Error('Projekt-Inbox wurde ohne Aktualisierung verändert.');
              Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
              document.dispatchEvent(new Event('visibilitychange'));
              for (let attempt = 0; attempt < 100 && !document.querySelector('.decision-review-section')?.textContent?.includes('BRANCHLOOM_LIVE_PROJECT_INBOX'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.decision-review-section')?.textContent?.includes('BRANCHLOOM_LIVE_PROJECT_INBOX') || !(await window.studio.reviewInboxItems({ projectId: boardProject.id })).items.some((item) => item.id === liveProjectComment.id)) throw new Error('Projekt-Inbox lud neuen gespeicherten Kommentar nicht sichtbar nach.');
              const globalButton = [...document.querySelectorAll('.decision-scope button')].find((item) => item.textContent?.includes('Alle Projekte'));
              if (!globalButton) throw new Error('Projektübergreifender Inbox-Modus fehlt.');
              globalButton.click();
              let globalPlan;
              for (let attempt = 0; attempt < 100; attempt++) {
                globalPlan = [...document.querySelectorAll('.cross-project-inbox .decision-item')].find((item) => item.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE'));
                if (globalPlan) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!globalPlan?.textContent?.includes('Projekt: ' + boardProject.name)) throw new Error('Projektzuordnung fehlt in der globalen Inbox.');
              if (document.querySelector('.cross-project-inbox [data-global-inbox-id="qa:' + qaReport.id + '"]')) throw new Error('Quittierte QA steht noch in der globalen Inbox.');
              const liveGlobalComment = await window.studio.createPlanComment({ planId: ${JSON.stringify(smokePlan.id)}, fingerprint: ${JSON.stringify(smokePlan.fingerprint)}, line: 1, body: 'BRANCHLOOM_LIVE_GLOBAL_INBOX' });
              if (document.querySelector('.cross-project-inbox')?.textContent?.includes('BRANCHLOOM_LIVE_GLOBAL_INBOX')) throw new Error('Globale Inbox wurde ohne Aktualisierung verändert.');
              document.dispatchEvent(new Event('visibilitychange'));
              for (let attempt = 0; attempt < 100 && !document.querySelector('.cross-project-inbox')?.textContent?.includes('BRANCHLOOM_LIVE_GLOBAL_INBOX'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.cross-project-inbox')?.textContent?.includes('BRANCHLOOM_LIVE_GLOBAL_INBOX') || !(await window.studio.globalInboxItems()).items.some((item) => item.id === 'plan:' + liveGlobalComment.id)) throw new Error('Globale Inbox lud neuen gespeicherten Kommentar nicht sichtbar nach.');
              if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility); else delete document.visibilityState;
              const refreshedGlobalPlan = [...document.querySelectorAll('.cross-project-inbox .decision-item')].find((item) => item.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE'));
              const refreshedPlanButton = refreshedGlobalPlan?.querySelector('button.secondary-button');
              if (!refreshedPlanButton?.isConnected) throw new Error('Plan-Knopf fehlt nach der Aktualisierung der globalen Inbox.');
              refreshedPlanButton.click();
              for (let attempt = 0; attempt < 200 && document.activeElement?.id !== 'workflow-plan-review'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.activeElement?.id !== 'workflow-plan-review' || !document.activeElement?.textContent?.includes('BRANCHLOOM_PLAN_REVIEW_SMOKE')) throw new Error('Globale Inbox öffnete den konkreten Plan nicht.');
              if ((await window.studio.snapshot(boardProject.id)).sessions.length !== 1) throw new Error('Globale Inbox startete einen Agenten.');
              [...document.querySelectorAll('.sidebar-add')].find((item) => item.textContent?.includes('Projekt hinzufügen'))?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.modal-backdrop form.dialog'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const form = document.querySelector('.modal-backdrop form.dialog');
              const inputs = form?.querySelectorAll('input');
              const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!form || inputs?.length !== 2 || !inputSetter) throw new Error('Zweitprojekt-Dialog fehlt.');
              inputSetter.call(inputs[0], 'Smoke-Zweitprojekt'); inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
              inputSetter.call(inputs[1], ${JSON.stringify(secondProjectPath)}); inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
              form.requestSubmit();
              let secondProject;
              for (let attempt = 0; attempt < 100; attempt++) {
                secondProject = (await window.studio.projects()).find((project) => project.name === 'Smoke-Zweitprojekt');
                if (secondProject && document.querySelector('#project-select')?.value === secondProject.id) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!secondProject || document.querySelector('#project-select')?.value !== secondProject.id) throw new Error('Zweitprojekt wurde nicht sichtbar ausgewählt.');
              const secondSnapshot = await window.studio.snapshot(secondProject.id);
              const secondCard = await window.studio.createCard({ projectId: secondProject.id, columnId: secondSnapshot.columns[0].id, title: 'Zweitprojekt-Aufgabe' });
              const secondWorkflow = await window.studio.createWorkflow({ projectId: secondProject.id, name: 'BRANCHLOOM_GLOBAL_OTHER_PROJECT', cardIds: [secondCard.id],
                steps: [{ id: 'second-approval', columnId: secondSnapshot.columns[0].id, agentId: null, requireApproval: true }] });
              await window.studio.setWorkflowState({ id: secondWorkflow.id, state: 'paused' });
              const projectSelect = document.querySelector('#project-select');
              const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
              if (!projectSelect || !selectSetter) throw new Error('Projektwahl fehlt.');
              selectSetter.call(projectSelect, boardProject.id); projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && document.querySelector('#project-select')?.value !== boardProject.id; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const decisionsAgain = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.includes('Entscheidungen'));
              decisionsAgain?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.decision-scope'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              [...document.querySelectorAll('.decision-scope button')].find((item) => item.textContent?.includes('Alle Projekte'))?.click();
              let otherItem;
              for (let attempt = 0; attempt < 100; attempt++) {
                otherItem = [...document.querySelectorAll('.cross-project-inbox .decision-item')].find((item) => item.textContent?.includes('BRANCHLOOM_GLOBAL_OTHER_PROJECT'));
                if (otherItem) break;
                await new Promise((resolve) => setTimeout(resolve, 50));
              }
              if (!otherItem?.textContent?.includes('Projekt: Smoke-Zweitprojekt') || otherItem.getAttribute('data-global-inbox-id') !== 'workflow:' + secondWorkflow.id) throw new Error('Projektübergreifende Quelle ist falsch zugeordnet.');
              otherItem.querySelector('button.secondary-button')?.click();
              for (let attempt = 0; attempt < 100 && (document.querySelector('#project-select')?.value !== secondProject.id || !document.querySelector('.workflow-list')?.textContent?.includes('BRANCHLOOM_GLOBAL_OTHER_PROJECT')); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('#project-select')?.value !== secondProject.id || !document.querySelector('.workflow-list')?.textContent?.includes('BRANCHLOOM_GLOBAL_OTHER_PROJECT')) throw new Error('Projektwechsel öffnete nicht die exakte Workflow-Quelle.');
              if ((await window.studio.snapshot(secondProject.id)).sessions.length !== 0) throw new Error('Projektwechsel startete einen Agenten.');
              selectSetter.call(projectSelect, boardProject.id); projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && document.querySelector('#project-select')?.value !== boardProject.id; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('#project-select')?.value !== boardProject.id) throw new Error('Smoke-Projekt wurde nicht wiederhergestellt.');
              return true;
            })()
          `;
          void smokeWindow.webContents.executeJavaScript(boardScript).then(async () => {
            execFileSync('git', ['init', '-q', smokeDataDirectory!], { windowsHide: true });
            execFileSync('git', ['-C', smokeDataDirectory!, 'add', '--', 'src/theme.css'], { windowsHide: true });
            execFileSync('git', ['-C', smokeDataDirectory!, '-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Synthetic smoke theme'], { windowsHide: true });
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const nav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Design');
              if (!nav) throw new Error('Design-Navigation fehlt.');
              nav.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.design-inspection-toolbar'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const input = document.querySelector('.design-inspection-toolbar input');
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!input || !setter) throw new Error('Design-URL-Eingabe fehlt.');
              setter.call(input, ${JSON.stringify(qaUrl)});
              input.dispatchEvent(new Event('input', { bubbles: true }));
              const button = document.querySelector('.design-inspection-toolbar button[type="submit"]');
              for (let attempt = 0; attempt < 100 && button?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!button || button.disabled) throw new Error('Design-Vorschau-Knopf blieb gesperrt.');
              button.click();
              for (let attempt = 0; attempt < 300 && !(await window.studio.designInspectionState()).ready; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(await window.studio.designInspectionState()).ready) throw new Error('Lokale Design-Vorschau wurde nicht geladen: ' + document.querySelector('.design-inspection .inline-error')?.textContent);
              const pick = [...document.querySelectorAll('.design-inspection-toolbar button')].find((item) => item.textContent?.includes('Element auswählen'));
              for (let attempt = 0; attempt < 100 && pick?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!pick || pick.disabled) throw new Error('Design-Auswahl blieb gesperrt.');
              pick.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.designInspectionState()).armed; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!(await window.studio.designInspectionState()).armed) throw new Error('Design-Auswahl wurde nicht aktiviert: ' + JSON.stringify({ state: await window.studio.designInspectionState(), rect: document.querySelector('.design-inspection-viewport')?.getBoundingClientRect().toJSON(), error: document.querySelector('.design-inspection .inline-error')?.textContent }));
              return true;
            })()`);
            await designInspector!.smokeClick('#design-smoke-target');
            let saved = false;
            for (let attempt = 0; attempt < 100; attempt++) {
              const items = designSelections(smokeStore, smokeProject.id);
              if (items[0]?.selector.includes('#design-smoke-target') && items[0]?.styles.color && items[0]?.tokens.some((token) => token.name === '--smoke-ink')) { saved = true; break; }
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            if (!saved) throw new Error('Design-Klick speicherte Selektor, berechneten Stil oder CSS-Variable nicht.');
            const visible = await smokeWindow.webContents.executeJavaScript(`(async () => {
              for (let attempt = 0; attempt < 100 && !document.querySelector('.design-inspection-evidence')?.textContent?.includes('#design-smoke-target'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              return document.querySelector('.design-inspection-evidence')?.textContent?.includes('#design-smoke-target') && document.querySelector('.design-inspection-evidence')?.textContent?.includes('rgb(');
            })()`);
            if (!visible) throw new Error('Design-Auswahl erschien nicht sichtbar in der App.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              document.querySelector('.design-inspection-selector summary')?.click();
              const field = document.querySelector('.design-inspection-selector input');
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!field || !setter) throw new Error('CSS-Selektor-Eingabe fehlt.');
              setter.call(field, '#design-smoke-target');
              field.dispatchEvent(new Event('input', { bubbles: true }));
              const button = document.querySelector('.design-inspection-selector button');
              for (let attempt = 0; attempt < 100 && button?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!button || button.disabled) throw new Error('Tastatur-Auswahl blieb gesperrt.');
              button.click();
              return true;
            })()`);
            for (let attempt = 0; attempt < 100 && designSelections(smokeStore, smokeProject.id).length < 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
            if (designSelections(smokeStore, smokeProject.id).length !== 2) throw new Error('CSS-Selektor-Auswahl speicherte keinen zweiten Beleg.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              document.querySelector('.theme-tokens-head button')?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.theme-tokens-list button:last-child'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const item = [...document.querySelectorAll('.theme-tokens-list li')].find((node) => node.textContent?.includes('--smoke-ink'));
              if (!item) throw new Error('Versionierter Smoke-Token fehlt im sichtbaren Design-Panel.');
              [...item.querySelectorAll('button')].find((button) => button.textContent?.includes('Testen'))?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.theme-tokens-preview input'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const field = document.querySelector('.theme-tokens-preview input');
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              if (!field || !setter) throw new Error('Theme-Playground-Eingabe fehlt.');
              setter.call(field, '#aabbcc');
              field.dispatchEvent(new Event('input', { bubbles: true }));
              for (let attempt = 0; attempt < 100 && document.querySelector('.theme-tokens-preview button[type="submit"]')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              document.querySelector('.theme-tokens-preview button[type="submit"]')?.click();
              for (let attempt = 0; attempt < 100 && !(await window.studio.designInspectionState()).themePreview; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.designInspectionState()).themePreview?.value !== '#aabbcc') throw new Error('Theme-Vorschau wurde nicht angewendet: ' + document.querySelector('.theme-tokens-preview')?.textContent);
              return true;
            })()`);
            const changedTheme = await designInspector!.smokeThemeValue('#design-smoke-target', '--smoke-ink');
            if (changedTheme.inline !== '#aabbcc' || changedTheme.computed !== 'rgb(170, 187, 204)') throw new Error('Theme-Vorschau änderte den berechneten Stil nicht: ' + JSON.stringify(changedTheme));
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              [...document.querySelectorAll('.theme-tokens-preview button')].find((button) => button.textContent?.includes('Zurücksetzen'))?.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.designInspectionState()).themePreview; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if ((await window.studio.designInspectionState()).themePreview) throw new Error('Theme-Vorschau blieb nach Zurücksetzen aktiv.');
              return true;
            })()`);
            const resetTheme = await designInspector!.smokeThemeValue('#design-smoke-target', '--smoke-ink');
            if (resetTheme.inline || resetTheme.computed !== 'rgb(36, 59, 50)') throw new Error('Theme-Vorschau wurde nicht rückgängig gemacht: ' + JSON.stringify(resetTheme));
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              const canvas = document.querySelector('.design-viewport-canvas');
              const button = [...(canvas?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('Größen aufnehmen'));
              if (!canvas || !button || button.disabled || canvas.querySelector('img')) throw new Error('Design-Größenaufnahme ist nicht ausdrücklich startbar.');
              button.click();
              for (let attempt = 0; attempt < 800 && canvas.querySelectorAll('img').length !== 3 && !canvas.querySelector('.inline-error'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const images = [...canvas.querySelectorAll('img')];
              if (images.length !== 3 || !canvas.textContent?.includes('1280 × 800 px') || !canvas.textContent?.includes('768 × 1024 px') || !canvas.textContent?.includes('390 × 844 px') || !canvas.textContent?.includes(${JSON.stringify(qaUrl)})) throw new Error('Drei Design-Größen fehlen: ' + canvas.textContent?.slice(0, 800));
              await Promise.all(images.map((image) => image.decode()));
              if (!images.every((image) => image.naturalWidth > 0)) throw new Error('Design-Aufnahmen sind keine lesbaren Bilder.');
              [...canvas.querySelectorAll('button')].find((item) => item.textContent?.includes('Aufnahmen schließen'))?.click();
              for (let attempt = 0; attempt < 100 && canvas.querySelector('img'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (canvas.querySelector('img') || document.activeElement !== button) throw new Error('Design-Aufnahmen blieben nach Schließen sichtbar oder der Fokus ging verloren.');
              return true;
            })()`);
            if (readFileSync(join(smokeDataDirectory!, 'src', 'theme.css'), 'utf8') !== ':root { --smoke-ink: #243b32; }\n' || designSelections(smokeStore, smokeProject.id).length !== 2) throw new Error('Theme-Vorschau änderte Quelldatei oder gespeicherte Auswahl.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              document.querySelector('.theme-tokens-preview button[type="submit"]')?.click();
              for (let attempt = 0; attempt < 100 && (await window.studio.designInspectionState()).themePreview?.value !== '#aabbcc'; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              const reviewButton = [...document.querySelectorAll('.theme-tokens-preview button')].find((button) => button.textContent?.includes('Dateiänderung prüfen'));
              for (let attempt = 0; attempt < 100 && reviewButton?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              reviewButton?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.theme-tokens-edit-review'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.theme-tokens-edit-review')?.textContent?.includes('--smoke-ink: #aabbcc')) throw new Error('CSS-Änderungsdiff fehlt.');
              return true;
            })()`);
            if (readFileSync(join(smokeDataDirectory!, 'src', 'theme.css'), 'utf8') !== ':root { --smoke-ink: #243b32; }\n') throw new Error('CSS-Datei wurde schon bei der Diff-Prüfung geschrieben.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              [...document.querySelectorAll('.theme-tokens-edit-review button')].find((button) => button.textContent?.includes('In CSS übernehmen'))?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.theme-tokens-edit-result'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.theme-tokens-edit-result')?.textContent?.includes('#aabbcc')) throw new Error('CSS-Übernahme wurde nicht sichtbar bestätigt: ' + document.querySelector('.theme-tokens .inline-error')?.textContent);
              for (let attempt = 0; attempt < 100 && document.querySelector('.theme-tokens-edit-result button')?.disabled; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              document.querySelector('.theme-tokens-edit-result button')?.click();
              for (let attempt = 0; attempt < 100 && !document.querySelector('.theme-tokens-edit-review')?.textContent?.includes('#243b32'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (!document.querySelector('.theme-tokens-edit-review')?.textContent?.includes('#243b32')) throw new Error('Rücknahme-Diff fehlt: ' + document.querySelector('.theme-tokens .inline-error')?.textContent);
              return true;
            })()`);
            if (readFileSync(join(smokeDataDirectory!, 'src', 'theme.css'), 'utf8') !== ':root { --smoke-ink: #aabbcc; }\n') throw new Error('CSS-Datei wurde vor Rücknahmebestätigung verändert.');
            await smokeWindow.webContents.executeJavaScript(`(async () => {
              [...document.querySelectorAll('.theme-tokens-edit-review button')].find((button) => button.textContent?.includes('Rücknahme bestätigen'))?.click();
              for (let attempt = 0; attempt < 100 && document.querySelector('.theme-tokens-edit-result'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
              if (document.querySelector('.theme-tokens-edit-result') || !document.querySelector('.theme-tokens')?.textContent?.includes('zurückgenommen')) throw new Error('Rücknahme wurde nicht sichtbar bestätigt: ' + document.querySelector('.theme-tokens .inline-error')?.textContent);
              return true;
            })()`);
            if (readFileSync(join(smokeDataDirectory!, 'src', 'theme.css'), 'utf8') !== ':root { --smoke-ink: #243b32; }\n') throw new Error('CSS-Rücknahme stellte die Quelldatei nicht wieder her.');
            await smokeWindow.webContents.executeJavaScript(`[...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.textContent?.trim() === 'Board')?.click()`);
            for (let attempt = 0; attempt < 100 && designInspector?.state().ready; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
            if (designInspector?.state().ready) throw new Error('Design-Vorschau blieb nach Ansichtswechsel offen.');
            process.stdout.write('STUDIO_SMOKE_OK\n');
            app.quit();
          }).catch(failSmoke);
        });
        smokeWindow.webContents.reload();
      }).catch(failSmoke);
    }).catch(failSmoke); });
    window.webContents.once('did-fail-load', (_event, code, description) => {
      console.error(`STUDIO_SMOKE_FAILED (${code}): ${description}`);
      app.exit(1);
    });
  }
  window.on('closed', () => { designInspector?.dispose(); designInspector = null; browser?.dispose(); browser = null; window = null; });
}

if (ownsSharedProfile) app.whenReady().then(() => {
  const directory = app.getPath('userData');
  mkdirSync(directory, { recursive: true });
  store = new StudioStore(join(directory, 'studio.sqlite'));
  installIpc();
  createWindow();
  app.on('activate', () => { if (!window) createWindow(); });
}).catch((error: unknown) => {
  console.error('[Branchloom] startup failed', error);
  app.quit();
});
else app.quit();

app.on('before-quit', () => {
  smokeQaServer?.close();
  smokeQaServer = null;
  queueEngine?.dispose();
  browser?.dispose();
  browser = null;
  designInspector?.dispose();
  designInspector = null;
  runner?.dispose();
  runner = null;
  commandRunner?.dispose();
  commandRunner = null;
  store?.close();
  store = null;
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => {
  if (smokeDataDirectory) {
    try { rmSync(smokeDataDirectory, { recursive: true, force: true }); } catch { /* OS may still hold a cache file briefly. */ }
  }
});
