import type { SessionState } from './types';

export type WorkflowProgressState = 'pending' | 'running' | 'complete' | 'needs_review' | 'manual_wait';

export interface WorkflowRunEvidenceRow {
  stepIndex: number;
  cardId: string;
  cardTitle: string | null;
  state: WorkflowProgressState;
  session: {
    id: string;
    agentName: string;
    state: SessionState;
    startedAt: string;
    endedAt: string | null;
    exitCode: number | null;
  } | null;
  missingSession: boolean;
}

export interface WorkflowRunEvidence {
  projectId: string;
  workflowId: string;
  rows: WorkflowRunEvidenceRow[];
  moreAvailable: boolean;
}
