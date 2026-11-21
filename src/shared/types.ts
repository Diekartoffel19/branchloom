export type SessionState = 'running' | 'exited' | 'failed' | 'stopped';
export type WorkflowState = 'draft' | 'running' | 'paused' | 'done';
export type QueueState = 'off' | 'running' | 'paused';
export type CardPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export type ColumnEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export interface Project { id: string; name: string; path: string; createdAt: string }
export interface Column { id: string; projectId: string; name: string; position: number; autoStart: boolean; agentId: string | null; model: string | null; effort: ColumnEffort | null }
export interface Card { id: string; projectId: string; columnId: string; title: string; description: string; priority: CardPriority; labels: string[]; position: number; createdAt: string; updatedAt: string; archivedAt: string | null }
export type BulkCardAction = { projectId: string; cardIds: string[]; action: 'move'; columnId: string } | { projectId: string; cardIds: string[]; action: 'archive' };
export interface CardAttachment { id: string; cardId: string; name: string; size: number; addedAt: string; available: boolean; canOpen: boolean }
export interface AgentPreset { id: string; name: string; kind: 'codex' | 'claude' | 'gemini' | 'antigravity' | 'custom'; command: string; args: string[]; model: string | null; enabled: boolean }
export interface AgentDetection { kind: AgentPreset['kind']; command: string; available: boolean; version: string | null; status: 'ready' | 'found' | 'missing' | 'timeout' | 'error'; profileId?: string }
export interface Session { id: string; projectId: string; cardId: string; agentId: string; state: SessionState; startedAt: string; endedAt: string | null; exitCode: number | null; output: string; worktreePath?: string | null }
export type CommandShell = 'powershell' | 'cmd';
export interface CommandTerminal { id: string; projectId: string; shell: CommandShell; state: SessionState; startedAt: string; endedAt: string | null; exitCode: number | null; output: string }
export interface CommandTerminalEvent { terminalId: string; projectId: string; type: 'output' | 'state'; data: string; state?: SessionState }
export interface SessionSearchHit { sessionId: string; cardId: string; cardTitle: string; agentName: string; startedAt: string; snippet: string }
export interface WorkflowStep { id: string; columnId: string; agentId: string | null; requireApproval: boolean }
export interface Workflow { id: string; projectId: string; name: string; cardIds: string[]; steps: WorkflowStep[]; state: WorkflowState; currentStep: number; pauseReason?: 'approval' | 'manual' | 'review' | 'user'; queueSkip?: { reason: string; at: string }; createdAt: string; updatedAt: string }
export interface ProjectQueue { projectId: string; state: QueueState; templateWorkflowId: string | null; activeWorkflowId: string | null; pauseReason: string | null; completedCount: number; updatedAt: string | null }
export interface WorkflowAgentSettings { agentId: string | null; model: string | null; effort: 'low' | 'medium' | 'high' | null }
export interface WorkflowProposal { title: string; explanation: string; cards: Array<{ title: string; description: string }>; columnIds: string[] }
export interface MemoryNote { id: string; projectId: string; title: string; body: string; tags: string[]; links: string[]; createdAt: string; updatedAt: string }
export interface MemoryVaultExportResult { count: number; directory: string }
export interface MemoryVaultImportFile { key: string; title: string; tags: string[]; eligible: boolean; reason: string | null }
export interface MemoryVaultImportPreview { token: string; directoryName: string; files: MemoryVaultImportFile[]; eligible: number }
export interface MemoryVaultImportResult { count: number }
export interface ProjectPackagePreview { fingerprint: string; name: string; columns: number; cards: number; notes: number; workflows: number }
export interface ProjectPackageExportResult { file: string; columns: number; cards: number; notes: number; workflows: number }
export interface ProjectSnapshot { project: Project; columns: Column[]; cards: Card[]; agents: AgentPreset[]; sessions: Session[]; workflows: Workflow[]; notes: MemoryNote[]; queue: ProjectQueue }
export interface SessionEvent { sessionId: string; cardId: string; type: 'output' | 'state'; data: string; state?: SessionState }
export interface BrowserBounds { x: number; y: number; width: number; height: number }
export interface BrowserTabState { id: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error: string | null }
export interface BrowserState { tabs: BrowserTabState[]; activeTabId: string | null; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error: string | null }
export interface BrowserCaptureResult { width: number; height: number }
export interface TrelloImportCard { sourceId: string; title: string; description: string; labels: string[]; labelNote: string | null; listName: string | null; archived: boolean; eligible: boolean; reason: string | null; importedCardId: string | null }
export interface TrelloImportPreview { fingerprint: string; boardName: string | null; cards: TrelloImportCard[]; total: number; eligible: number; duplicates: number }
export interface TrelloImportResult { created: Card[]; skippedDuplicateIds: string[] }
export interface WorktreeReview { cardId: string; path: string; branch: string; targetPath: string; targetBranch: string | null; sourceHead: string; targetHead: string; sourceStatus: string[]; targetStatus: string[]; uncommittedStat: string; committedStat: string; ahead: number; behind: number; canFastForward: boolean; blockers: string[]; previewToken: string }

export interface StudioAPI {
  projects(): Promise<Project[]>;
  createProject(input: { name: string; path: string }): Promise<Project>;
  exportProjectPackage(projectId: string): Promise<ProjectPackageExportResult | null>;
  previewProjectPackage(): Promise<ProjectPackagePreview | null>;
  importProjectPackage(input: { fingerprint: string; name: string; path: string }): Promise<Project>;
  snapshot(projectId: string): Promise<ProjectSnapshot>;
  createColumn(input: { projectId: string; name: string; autoStart?: boolean; agentId?: string | null; model?: string | null; effort?: ColumnEffort | null }): Promise<Column>;
  updateColumn(input: { id: string; name?: string; autoStart?: boolean; agentId?: string | null; model?: string | null; effort?: ColumnEffort | null }): Promise<Column>;
  reorderColumn(input: { id: string; direction: 'left' | 'right' }): Promise<Column>;
  deleteColumn(id: string): Promise<void>;
  createCard(input: { projectId: string; columnId: string; title: string; description?: string; priority?: CardPriority; labels?: string[] }): Promise<Card>;
  updateCard(input: { id: string; title?: string; description?: string; priority?: CardPriority; labels?: string[] }): Promise<Card>;
  moveCard(input: { id: string; columnId: string }): Promise<Card>;
  bulkUpdateCards(input: BulkCardAction): Promise<Card[]>;
  reorderCard(input: { id: string; direction: 'up' | 'down' }): Promise<Card>;
  setCardArchived(input: { id: string; archived: boolean }): Promise<Card>;
  cardAttachments(cardId: string): Promise<CardAttachment[]>;
  chooseCardAttachments(cardId: string): Promise<CardAttachment[] | null>;
  openCardAttachment(input: { cardId: string; attachmentId: string }): Promise<void>;
  removeCardAttachment(input: { cardId: string; attachmentId: string }): Promise<void>;
  agents(): Promise<AgentPreset[]>;
  detectAgents(): Promise<AgentDetection[]>;
  saveAgent(input: Omit<AgentPreset, 'id'> & { id?: string }): Promise<AgentPreset>;
  startSession(input: { cardId: string; agentId?: string; prompt?: string; useWorktree?: boolean }): Promise<Session>;
  resumeCodexSession(input: { sessionId: string }): Promise<Session>;
  sendSession(input: { sessionId: string; text: string }): Promise<void>;
  writeSessionInput(input: { sessionId: string; data: string }): Promise<void>;
  resizeSession(input: { sessionId: string; cols: number; rows: number }): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  commandTerminals(projectId: string): Promise<CommandTerminal[]>;
  startCommandTerminal(input: { projectId: string; shell: CommandShell }): Promise<CommandTerminal>;
  writeCommandTerminal(input: { terminalId: string; data: string }): Promise<void>;
  resizeCommandTerminal(input: { terminalId: string; cols: number; rows: number }): Promise<void>;
  stopCommandTerminal(terminalId: string): Promise<void>;
  onCommandTerminalEvent(callback: (event: CommandTerminalEvent) => void): () => void;
  searchSessionTranscripts(input: { projectId: string; query: string }): Promise<SessionSearchHit[]>;
  sessionForProject(input: { projectId: string; sessionId: string }): Promise<Session>;
  createWorkflow(input: { projectId: string; name: string; cardIds: string[]; steps: WorkflowStep[] }): Promise<Workflow>;
  updateDraftWorkflow(input: { id: string; name: string; cardIds: string[]; steps: WorkflowStep[] }): Promise<Workflow>;
  deleteDraftWorkflow(id: string): Promise<string>;
  setWorkflowState(input: { id: string; state: WorkflowState }): Promise<Workflow>;
  setProjectQueue(input: { projectId: string; state: QueueState; templateWorkflowId?: string }): Promise<ProjectQueue>;
  queueCandidates(projectId: string): Promise<Card[]>;
  skipQueuedCard(input: { projectId: string; workflowId: string; reason: string }): Promise<ProjectQueue>;
  workflowAgentSettings(): Promise<WorkflowAgentSettings>;
  saveWorkflowAgentSettings(input: WorkflowAgentSettings): Promise<WorkflowAgentSettings>;
  proposeWorkflow(input: { projectId: string; request: string }): Promise<WorkflowProposal>;
  acceptWorkflowProposal(input: { projectId: string; proposal: WorkflowProposal }): Promise<Workflow>;
  previewTrelloImport(input: { projectId: string; json: string }): Promise<TrelloImportPreview>;
  acceptTrelloImport(input: { projectId: string; columnId: string; json: string; fingerprint: string; sourceIds: string[] }): Promise<TrelloImportResult>;
  reviewCardWorktree(cardId: string): Promise<WorktreeReview | null>;
  mergeCardWorktree(input: { cardId: string; previewToken: string; confirm: boolean }): Promise<WorktreeReview>;
  saveNote(input: { projectId: string; id?: string; title: string; body: string; tags: string[]; links: string[] }): Promise<MemoryNote>;
  deleteNote(id: string): Promise<void>;
  exportMemoryVault(projectId: string): Promise<MemoryVaultExportResult | null>;
  previewMemoryVaultImport(projectId: string): Promise<MemoryVaultImportPreview | null>;
  acceptMemoryVaultImport(input: { projectId: string; token: string; keys: string[] }): Promise<MemoryVaultImportResult>;
  transcribe(audio: Uint8Array): Promise<string>;
  onSessionEvent(callback: (event: SessionEvent) => void): () => void;
  browserState(): Promise<BrowserState>;
  browserNavigate(address: string): Promise<BrowserState>;
  browserBack(): Promise<BrowserState>;
  browserForward(): Promise<BrowserState>;
  browserReload(): Promise<BrowserState>;
  browserCapture(): Promise<BrowserCaptureResult>;
  browserOpenExternal(): Promise<void>;
  browserNewTab(): Promise<BrowserState>;
  browserSelectTab(id: string): Promise<BrowserState>;
  browserCloseTab(id: string): Promise<BrowserState>;
  browserSetVisible(visible: boolean): Promise<BrowserState>;
  browserSetBounds(bounds: BrowserBounds | null): Promise<BrowserState>;
  onBrowserState(callback: (state: BrowserState) => void): () => void;
  onBrowserSearchShortcut(callback: () => void): () => void;
}
