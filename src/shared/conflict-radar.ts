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
