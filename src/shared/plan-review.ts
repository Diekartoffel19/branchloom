import type { WorkflowProposal } from './types';

export interface PlanLine { number: number; text: string }
export interface ReviewedPlan {
  id: string;
  projectId: string;
  request: string;
  proposal: WorkflowProposal;
  fingerprint: string;
  state: 'open' | 'superseded' | 'accepted';
  workflowId: string | null;
  createdAt: string;
}
export interface PlanComment {
  id: string;
  planId: string;
  fingerprint: string;
  line: number;
  text: string;
  body: string;
  createdAt: string;
}

/** The numbered review source is deterministic and derived only from the saved proposal. */
export function planLines(proposal: WorkflowProposal): PlanLine[] {
  const lines: string[] = [`Titel: ${proposal.title}`, 'Begründung:'];
  lines.push(...proposal.explanation.split(/\r?\n/));
  proposal.cards.forEach((card, index) => {
    lines.push(`Karte ${index + 1}: ${card.title}`);
    lines.push(...card.description.split(/\r?\n/));
  });
  lines.push(`Route: ${proposal.columnIds.join(' → ')}`);
  return lines.map((text, index) => ({ number: index + 1, text }));
}

/** Plain text deliberately copied by the user; no automatic agent or network send. */
export function planFeedback(plan: ReviewedPlan, comments: PlanComment[]): string {
  const current = comments.filter((item) => item.fingerprint === plan.fingerprint);
  return [`Feedback zum Workflow-Vorschlag „${plan.proposal.title}“:`, ...current.map((item) => `Zeile ${item.line} (${item.text}): ${item.body}`)].join('\n');
}
