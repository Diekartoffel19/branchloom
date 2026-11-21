import { contextBridge, ipcRenderer } from 'electron';
import type { StudioAPI, SessionEvent, BrowserState } from '../shared/types';

const invoke = <T>(name: keyof StudioAPI, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(`studio:${String(name)}`, ...args) as Promise<T>;

const studio: StudioAPI = {
  projects: () => invoke('projects'),
  createProject: (input) => invoke('createProject', input),
  snapshot: (projectId) => invoke('snapshot', projectId),
  createColumn: (input) => invoke('createColumn', input),
  updateColumn: (input) => invoke('updateColumn', input),
  createCard: (input) => invoke('createCard', input),
  updateCard: (input) => invoke('updateCard', input),
  moveCard: (input) => invoke('moveCard', input),
  setCardArchived: (input) => invoke('setCardArchived', input),
  agents: () => invoke('agents'),
  detectAgents: () => invoke('detectAgents'),
  saveAgent: (input) => invoke('saveAgent', input),
  startSession: (input) => invoke('startSession', input),
  resumeCodexSession: (input) => invoke('resumeCodexSession', input),
  sendSession: (input) => invoke('sendSession', input),
  writeSessionInput: (input) => invoke('writeSessionInput', input),
  resizeSession: (input) => invoke('resizeSession', input),
  stopSession: (id) => invoke('stopSession', id),
  createWorkflow: (input) => invoke('createWorkflow', input),
  setWorkflowState: (input) => invoke('setWorkflowState', input),
  setProjectQueue: (input) => invoke('setProjectQueue', input),
  workflowAgentSettings: () => invoke('workflowAgentSettings'),
  saveWorkflowAgentSettings: (input) => invoke('saveWorkflowAgentSettings', input),
  proposeWorkflow: (input) => invoke('proposeWorkflow', input),
  acceptWorkflowProposal: (input) => invoke('acceptWorkflowProposal', input),
  previewTrelloImport: (input) => invoke('previewTrelloImport', input),
  acceptTrelloImport: (input) => invoke('acceptTrelloImport', input),
  reviewCardWorktree: (cardId) => invoke('reviewCardWorktree', cardId),
  mergeCardWorktree: (input) => invoke('mergeCardWorktree', input),
  saveNote: (input) => invoke('saveNote', input),
  deleteNote: (id) => invoke('deleteNote', id),
  exportMemoryVault: (projectId) => invoke('exportMemoryVault', projectId),
  transcribe: (audio) => invoke('transcribe', audio),
  onSessionEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: SessionEvent): void => callback(payload);
    ipcRenderer.on('studio:session-event', listener);
    return () => ipcRenderer.removeListener('studio:session-event', listener);
  },
  browserState: () => invoke('browserState'),
  browserNavigate: (address) => invoke('browserNavigate', address),
  browserBack: () => invoke('browserBack'),
  browserForward: () => invoke('browserForward'),
  browserReload: () => invoke('browserReload'),
  browserCapture: () => invoke('browserCapture'),
  browserOpenExternal: () => invoke('browserOpenExternal'),
  browserNewTab: () => invoke('browserNewTab'),
  browserSelectTab: (id) => invoke('browserSelectTab', id),
  browserCloseTab: (id) => invoke('browserCloseTab', id),
  browserSetVisible: (visible) => invoke('browserSetVisible', visible),
  browserSetBounds: (bounds) => invoke('browserSetBounds', bounds),
  onBrowserState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: BrowserState): void => callback(payload);
    ipcRenderer.on('studio:browser-state', listener);
    return () => ipcRenderer.removeListener('studio:browser-state', listener);
  },
  onBrowserSearchShortcut: (callback) => {
    const listener = (): void => callback();
    ipcRenderer.on('studio:browser-search-shortcut', listener);
    return () => ipcRenderer.removeListener('studio:browser-search-shortcut', listener);
  },
};

contextBridge.exposeInMainWorld('studio', studio);
