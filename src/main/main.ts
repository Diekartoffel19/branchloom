import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import type { AgentPreset, CommandTerminalEvent, QueueState, SessionEvent, StudioAPI, WorkflowAgentSettings, WorkflowProposal, WorkflowStep, WorkflowState } from '../shared/types';
import { StudioBrowser } from './browser';
import { BrowserSessionPersistence } from './browser-persistence';
import { detectAgents, SessionRunner } from './cli';
import { CommandTerminalRunner } from './command-terminal';
import { mergeCardWorktree, reviewCardWorktree } from './git-worktree';
import { reviewCardConflicts } from './conflict-radar';
import { exportMemoryVaultToDirectory } from './memory-vault';
import { scanMemoryVault } from './memory-vault-import';
import { StudioStore } from './store';
import { parseProjectPackage, PROJECT_PACKAGE_LIMIT } from './project-package';
import { ProjectQueueEngine } from './queue';
import { WorkflowEngine } from './workflows';
import { proposeWorkflow } from './workflow-planner';
import { transcribeAudio } from './voice/transcribe';

let window: BrowserWindow | null = null;
let store: StudioStore | null = null;
let runner: SessionRunner | null = null;
let commandRunner: CommandTerminalRunner | null = null;
let browser: StudioBrowser | null = null;
const smoke = process.argv.includes('--studio-smoke');
const smokeDataDirectory = smoke ? mkdtempSync(join(tmpdir(), 'branchloom-smoke-')) : null;
const devDataDirectory = !app.isPackaged ? process.env.BRANCHLOOM_DEV_USER_DATA : undefined;
if (smokeDataDirectory) {
  app.setPath('userData', smokeDataDirectory);
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

function mustStore(): StudioStore {
  if (!store) throw new Error('Store is not ready');
  return store;
}

function installIpc(): void {
  const db = mustStore();
  let workflowEngine: WorkflowEngine;
  let queueEngine: ProjectQueueEngine;
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
  bind('resumeCodexSession', (input: { sessionId: string }) => runner?.resumeCodex(input));
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
  bind('acceptWorkflowProposal', (input: { projectId: string; proposal: WorkflowProposal }) => db.acceptWorkflowProposal(input));
  bind('previewTrelloImport', (input: { projectId: string; json: string }) => db.previewTrelloImport(input));
  bind('acceptTrelloImport', (input: { projectId: string; columnId: string; json: string; fingerprint: string; sourceIds: string[] }) => db.acceptTrelloImport(input));
  bind('reviewCardWorktree', (cardId: string) => reviewCardWorktree(db, cardId));
  bind('reviewCardConflicts', (cardId: string) => reviewCardConflicts(db, cardId, db.runningSessionsForProject(db.card(cardId).projectId)));
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
  // `npm start` runs the built renderer from source, while `npm run dev`
  // explicitly opts into Vite. Electron's app.isPackaged is false in both
  // source modes, so it cannot decide this on its own.
  if (!app.isPackaged && process.env.JARVIS_STUDIO_DEV_SERVER === '1') void window.loadURL('http://127.0.0.1:5181');
  else void window.loadFile(join(__dirname, '../../dist/renderer/index.html'));
  if (smoke) {
    const failSmoke = (error: unknown) => {
      console.error('STUDIO_SMOKE_FAILED: renderer/IPC/SQLite/Board', error);
      app.exit(1);
    };
    window.webContents.once('did-finish-load', () => {
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
              args: ['/C', 'echo JARVIS_STUDIO_AGENT_OK'], model: null, enabled: true,
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
              return true;
            })()
          `;
          void smokeWindow.webContents.executeJavaScript(boardScript).then(() => {
            process.stdout.write('STUDIO_SMOKE_OK\n');
            app.quit();
          }).catch(failSmoke);
        });
        smokeWindow.webContents.reload();
      }).catch(failSmoke);
    });
    window.webContents.once('did-fail-load', (_event, code, description) => {
      console.error(`STUDIO_SMOKE_FAILED (${code}): ${description}`);
      app.exit(1);
    });
  }
  window.on('closed', () => { browser?.dispose(); browser = null; window = null; });
}

app.whenReady().then(() => {
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

app.on('before-quit', () => {
  browser?.dispose();
  browser = null;
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
