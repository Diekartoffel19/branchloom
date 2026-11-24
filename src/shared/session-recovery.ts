import type { SessionState } from './types';

export type ConnectionSignal = 'online' | 'offline';

export interface SessionConnectionEvent {
  signal: ConnectionSignal;
  observedAt: string;
}

export interface SessionRecoveryState {
  sessionId: string;
  signal: ConnectionSignal;
  checkedAt: string;
  sessionState: SessionState;
  process: 'attached' | 'unconfirmed' | 'ended' | 'interrupted';
  events: SessionConnectionEvent[];
}
