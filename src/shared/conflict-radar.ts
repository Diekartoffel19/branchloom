export type ConflictRadarState = 'idle' | 'clear' | 'overlap' | 'unknown';

export interface ConflictRadarPeer {
  cardId: string;
  cardTitle: string;
  sessionId: string;
  state: Exclude<ConflictRadarState, 'idle'>;
  changedCount: number | null;
  commonPaths: string[];
  commonCount: number;
  reason: string | null;
}

export interface ConflictRadarResult {
  cardId: string;
  sessionId: string | null;
  checkedAt: string;
  state: ConflictRadarState;
  ownChangedCount: number | null;
  peers: ConflictRadarPeer[];
  reason: string | null;
}

export interface ProjectConflictPair {
  leftCardId: string;
  leftCardTitle: string;
  rightCardId: string;
  rightCardTitle: string;
  commonPaths: string[];
  commonCount: number;
}

export interface ProjectConflictIssue {
  cardId: string;
  cardTitle: string;
  reason: string;
}

export interface ProjectConflictRadarResult {
  projectId: string;
  checkedAt: string;
  state: ConflictRadarState;
  runningCount: number | null;
  pairCount: number;
  pairs: ProjectConflictPair[];
  issues: ProjectConflictIssue[];
  reason: string | null;
}
