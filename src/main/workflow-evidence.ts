import type { WorkflowRunEvidence, WorkflowRunEvidenceRow } from '../shared/workflow-evidence';
import type { StudioStore } from './store';

const MAX_ROWS = 200;

interface Row {
  step_index: number;
  card_id: string;
  card_title: string | null;
  progress_state: WorkflowRunEvidenceRow['state'];
  linked_session_id: string | null;
  session_id: string | null;
  agent_name: string | null;
  session_state: NonNullable<WorkflowRunEvidenceRow['session']>['state'] | null;
  started_at: string | null;
  ended_at: string | null;
  exit_code: number | null;
}

/** Read only recorded progress. No transcript or inferred completion is returned. */
export function workflowRunEvidence(store: StudioStore, input: { projectId: string; workflowId: string }): WorkflowRunEvidence {
  if (!input || typeof input.projectId !== 'string' || !input.projectId || typeof input.workflowId !== 'string' || !input.workflowId) {
    throw new Error('Ungültige Workflow-Verlaufsabfrage.');
  }
  store.project(input.projectId);
  const workflow = store.workflow(input.workflowId);
  if (workflow.projectId !== input.projectId) throw new Error('Workflow gehört zu einem anderen Projekt.');
  const rows = store.db.prepare(`SELECT progress.step_index, progress.card_id,
      card.title AS card_title, progress.state AS progress_state,
      progress.session_id AS linked_session_id, session.id AS session_id,
      agent.name AS agent_name, session.state AS session_state,
      session.started_at, session.ended_at, session.exit_code
    FROM workflow_progress progress
    LEFT JOIN cards card ON card.id = progress.card_id AND card.project_id = ?
    LEFT JOIN sessions session ON session.id = progress.session_id
      AND session.project_id = ? AND session.card_id = progress.card_id
    LEFT JOIN agents agent ON agent.id = session.agent_id
    WHERE progress.workflow_id = ?
    ORDER BY progress.step_index, progress.rowid
    LIMIT ?`).all(input.projectId, input.projectId, input.workflowId, MAX_ROWS + 1) as Row[];
  return {
    projectId: input.projectId,
    workflowId: workflow.id,
    moreAvailable: rows.length > MAX_ROWS,
    rows: rows.slice(0, MAX_ROWS).map((row) => ({
      stepIndex: row.step_index,
      cardId: row.card_id,
      cardTitle: row.card_title,
      state: row.progress_state,
      session: row.session_id && row.session_state && row.started_at ? {
        id: row.session_id,
        agentName: row.agent_name ?? 'Entfernter Agent',
        state: row.session_state,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        exitCode: row.exit_code,
      } : null,
      missingSession: row.linked_session_id !== null && row.session_id === null,
    })),
  };
}
