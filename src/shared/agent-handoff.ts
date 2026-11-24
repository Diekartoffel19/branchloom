export interface HandoffPassage {
  id: string;
  title: string;
  source: string;
  sourceAt: string;
  text: string;
  fingerprint: string;
  selected: boolean;
  truncated: boolean;
  redacted: boolean;
}

export interface AgentHandoffPreview {
  token: string;
  projectId: string;
  cardId: string;
  sourceSessionId: string;
  targetAgentId: string;
  useWorktree: boolean;
  createdAt: string;
  passages: HandoffPassage[];
}

export interface AgentHandoffSelection {
  id: string;
  fingerprint: string;
  text: string;
}

export interface AgentHandoffReceipt {
  token: string;
  projectId: string;
  cardId: string;
  sourceSessionId: string;
  targetSessionId: string;
  targetAgentId: string;
  selectedSources: Array<{ id: string; fingerprint: string }>;
  contentSha256: string;
  startedAt: string;
}
