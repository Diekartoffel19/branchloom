import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentPreset, SessionEvent, StudioAPI, WorkflowAgentSettings, WorkflowProposal, WorkflowStep, WorkflowState } from '../shared/types';
import { StudioBrowser } from './browser';
import { detectAgents, SessionRunner } from './cli';
import { StudioStore } from './store';
import { WorkflowEngine } from './workflows';
import { proposeWorkflow } from './workflow-planner';
import { transcribeAudio } from './voice/transcribe';

let window: BrowserWindow | null = null;
let store: StudioStore | null = null;
let runner: SessionRunner | null = null;
let browser: StudioBrowser | null = null;
const smoke = process.argv.includes('--studio-smoke');
const smokeDataDirectory = smoke ? mkdtempSync(join(tmpdir(), 'jarvis-studio-smoke-')) : null;
if (smokeDataDirectory) app.setPath('userData', smokeDataDirectory);

function mustStore(): StudioStore {
  if (!store) throw new Error('Store is not ready');
  return store;
}

function installIpc(): void {
  const db = mustStore();
  let workflowEngine: WorkflowEngine;
  runner = new SessionRunner(db, (event: SessionEvent) => {
    if (window && !window.isDestroyed()) window.webContents.send('studio:session-event', event);
  }, (session, finalMessage) => workflowEngine.onSessionFinished(session, finalMessage));
  workflowEngine = new WorkflowEngine(db, runner);

  const bind = <K extends keyof StudioAPI>(name: K, handler: (...args: never[]) => unknown): void => {
    ipcMain.handle(`studio:${String(name)}`, (event, ...args: unknown[]) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Ungültiger IPC-Absender.');
      return (handler as (...values: unknown[]) => unknown)(...args);
    });
  };
  bind('projects', () => db.projects());
  bind('createProject', (input: { name: string; path: string }) => db.createProject(input));
  bind('snapshot', (projectId: string) => db.snapshot(projectId));
  bind('createColumn', (input: { projectId: string; name: string; autoStart?: boolean; agentId?: string | null }) => db.createColumn(input));
  bind('updateColumn', (input: { id: string; name?: string; autoStart?: boolean; agentId?: string | null }) => db.updateColumn(input));
  bind('createCard', (input: { projectId: string; columnId: string; title: string; description?: string }) => db.createCard(input));
  bind('updateCard', (input: { id: string; title?: string; description?: string }) => db.updateCard(input));
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
    return moved;
  });
  bind('agents', () => db.agents());
  bind('detectAgents', () => detectAgents());
  bind('saveAgent', (input: Omit<AgentPreset, 'id'> & { id?: string }) => db.saveAgent(input));
  bind('startSession', (input: { cardId: string; agentId?: string; prompt?: string }) => runner?.start(input));
  bind('sendSession', (input: { sessionId: string; text: string }) => runner?.send(input));
  bind('stopSession', (sessionId: string) => runner?.stop(sessionId));
  bind('createWorkflow', (input: { projectId: string; name: string; cardIds: string[]; steps: WorkflowStep[] }) => db.createWorkflow(input));
  bind('setWorkflowState', (input: { id: string; state: WorkflowState }) => workflowEngine.setState(input));
  bind('workflowAgentSettings', () => db.workflowAgentSettings());
  bind('saveWorkflowAgentSettings', (input: WorkflowAgentSettings) => db.saveWorkflowAgentSettings(input));
  bind('proposeWorkflow', (input: { projectId: string; request: string }) => proposeWorkflow(db, input));
  bind('acceptWorkflowProposal', (input: { projectId: string; proposal: WorkflowProposal }) => db.acceptWorkflowProposal(input));
  bind('previewTrelloImport', (input: { projectId: string; json: string }) => db.previewTrelloImport(input));
  bind('acceptTrelloImport', (input: { projectId: string; columnId: string; json: string; fingerprint: string; sourceIds: string[] }) => db.acceptTrelloImport(input));
  bind('saveNote', (input: { projectId: string; id?: string; title: string; body: string; tags: string[]; links: string[] }) => db.saveNote(input));
  bind('deleteNote', (id: string) => db.deleteNote(id));
  bind('transcribe', (audio: Uint8Array) => {
    if (!(audio instanceof Uint8Array) || audio.byteLength === 0 || audio.byteLength > 8 * 1024 * 1024) throw new Error('Die Audioaufnahme muss zwischen 1 Byte und 8 MiB groß sein.');
    return transcribeAudio(audio);
  });
  bind('browserState', () => browser?.state());
  bind('browserNavigate', (address: string) => browser?.navigate(address));
  bind('browserBack', () => browser?.back());
  bind('browserForward', () => browser?.forward());
  bind('browserReload', () => browser?.reload());
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
    title: 'Jarvis Studio',
    backgroundColor: '#10151e',
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
  });
  // `npm start` runs the built renderer from source, while `npm run dev`
  // explicitly opts into Vite. Electron's app.isPackaged is false in both
  // source modes, so it cannot decide this on its own.
  if (!app.isPackaged && process.env.JARVIS_STUDIO_DEV_SERVER === '1') void window.loadURL('http://127.0.0.1:5181');
  else void window.loadFile(join(__dirname, '../../dist/renderer/index.html'));
  if (smoke) {
    window.webContents.once('did-finish-load', () => {
      process.stdout.write('STUDIO_SMOKE_OK\n');
      app.quit();
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
  console.error('[Jarvis Studio] startup failed', error);
  app.quit();
});

app.on('before-quit', () => {
  browser?.dispose();
  browser = null;
  runner?.dispose();
  runner = null;
  store?.close();
  store = null;
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => {
  if (smokeDataDirectory) {
    try { rmSync(smokeDataDirectory, { recursive: true, force: true }); } catch { /* OS may still hold a cache file briefly. */ }
  }
});
