export type SessionState = 'running' | 'exited' | 'failed' | 'stopped';
export type WorkflowState = 'draft' | 'running' | 'paused' | 'done';

export interface Project { id: string; name: string; path: string; createdAt: string }
export interface Column { id: string; projectId: string; name: string; position: number; autoStart: boolean; agentId: string | null }
export interface Card { id: string; projectId: string; columnId: string; title: string; description: string; position: number; createdAt: string; updatedAt: string }
export interface AgentPreset { id: string; name: string; kind: 'codex' | 'claude' | 'gemini' | 'custom'; command: string; args: string[]; model: string | null; enabled: boolean }
export interface AgentDetection { kind: AgentPreset['kind']; command: string; available: boolean; version: string | null }
export interface Session { id: string; projectId: string; cardId: string; agentId: string; state: SessionState; startedAt: string; endedAt: string | null; exitCode: number | null; output: string; worktreePath?: string | null }
export interface WorkflowStep { id: string; columnId: string; agentId: string | null; requireApproval: boolean }
export interface Workflow { id: string; projectId: string; name: string; cardIds: string[]; steps: WorkflowStep[]; state: WorkflowState; currentStep: number; pauseReason?: 'approval' | 'manual' | 'review' | 'user'; createdAt: string; updatedAt: string }
export interface WorkflowAgentSettings { agentId: string | null; model: string | null; effort: 'low' | 'medium' | 'high' | null }
export interface WorkflowProposal { title: string; explanation: string; cards: Array<{ title: string; description: string }>; columnIds: string[] }
export interface MemoryNote { id: string; projectId: string; title: string; body: string; tags: string[]; links: string[]; createdAt: string; updatedAt: string }
export interface ProjectSnapshot { project: Project; columns: Column[]; cards: Card[]; agents: AgentPreset[]; sessions: Session[]; workflows: Workflow[]; notes: MemoryNote[] }
export interface SessionEvent { sessionId: string; cardId: string; type: 'output' | 'state'; data: string; state?: SessionState }
export interface BrowserBounds { x: number; y: number; width: number; height: number }
export interface BrowserTabState { id: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error: string | null }
export interface BrowserState { tabs: BrowserTabState[]; activeTabId: string | null; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error: string | null }
export interface TrelloImportCard { sourceId: string; title: string; description: string; listName: string | null; archived: boolean; eligible: boolean; reason: string | null; importedCardId: string | null }
export interface TrelloImportPreview { fingerprint: string; boardName: string | null; cards: TrelloImportCard[]; total: number; eligible: number; duplicates: number }
export interface TrelloImportResult { created: Card[]; skippedDuplicateIds: string[] }

export interface StudioAPI {
  projects(): Promise<Project[]>;
  createProject(input: { name: string; path: string }): Promise<Project>;
  snapshot(projectId: string): Promise<ProjectSnapshot>;
  createColumn(input: { projectId: string; name: string; autoStart?: boolean; agentId?: string | null }): Promise<Column>;
  updateColumn(input: { id: string; name?: string; autoStart?: boolean; agentId?: string | null }): Promise<Column>;
  createCard(input: { projectId: string; columnId: string; title: string; description?: string }): Promise<Card>;
  updateCard(input: { id: string; title?: string; description?: string }): Promise<Card>;
  moveCard(input: { id: string; columnId: string }): Promise<Card>;
  agents(): Promise<AgentPreset[]>;
  detectAgents(): Promise<AgentDetection[]>;
  saveAgent(input: Omit<AgentPreset, 'id'> & { id?: string }): Promise<AgentPreset>;
  startSession(input: { cardId: string; agentId?: string; prompt?: string; useWorktree?: boolean }): Promise<Session>;
  sendSession(input: { sessionId: string; text: string }): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  createWorkflow(input: { projectId: string; name: string; cardIds: string[]; steps: WorkflowStep[] }): Promise<Workflow>;
  setWorkflowState(input: { id: string; state: WorkflowState }): Promise<Workflow>;
  workflowAgentSettings(): Promise<WorkflowAgentSettings>;
  saveWorkflowAgentSettings(input: WorkflowAgentSettings): Promise<WorkflowAgentSettings>;
  proposeWorkflow(input: { projectId: string; request: string }): Promise<WorkflowProposal>;
  acceptWorkflowProposal(input: { projectId: string; proposal: WorkflowProposal }): Promise<Workflow>;
  previewTrelloImport(input: { projectId: string; json: string }): Promise<TrelloImportPreview>;
  acceptTrelloImport(input: { projectId: string; columnId: string; json: string; fingerprint: string; sourceIds: string[] }): Promise<TrelloImportResult>;
  saveNote(input: { projectId: string; id?: string; title: string; body: string; tags: string[]; links: string[] }): Promise<MemoryNote>;
  deleteNote(id: string): Promise<void>;
  transcribe(audio: Uint8Array): Promise<string>;
  onSessionEvent(callback: (event: SessionEvent) => void): () => void;
  browserState(): Promise<BrowserState>;
  browserNavigate(address: string): Promise<BrowserState>;
  browserBack(): Promise<BrowserState>;
  browserForward(): Promise<BrowserState>;
  browserReload(): Promise<BrowserState>;
  browserNewTab(): Promise<BrowserState>;
  browserSelectTab(id: string): Promise<BrowserState>;
  browserCloseTab(id: string): Promise<BrowserState>;
  browserSetVisible(visible: boolean): Promise<BrowserState>;
  browserSetBounds(bounds: BrowserBounds | null): Promise<BrowserState>;
  onBrowserState(callback: (state: BrowserState) => void): () => void;
  onBrowserSearchShortcut(callback: () => void): () => void;
}
