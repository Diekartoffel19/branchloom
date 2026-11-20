import type { Column, WorkflowProposal } from '../shared/types';

const exactKeys = (value: Record<string, unknown>, names: string[]): boolean =>
  Object.keys(value).sort().join('\0') === [...names].sort().join('\0');

/** Validate both model output and a renderer-submitted proposal at the trust boundary. */
export function validateWorkflowProposal(raw: unknown, columns: readonly Column[]): WorkflowProposal {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !exactKeys(raw as Record<string, unknown>, ['title', 'explanation', 'cards', 'columnIds'])) {
    throw new Error('Workflow proposal has invalid fields');
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160) throw new Error('Workflow title is invalid');
  if (typeof value.explanation !== 'string' || value.explanation.length > 4000) throw new Error('Workflow explanation is invalid');
  if (!Array.isArray(value.cards) || value.cards.length < 1 || value.cards.length > 20) throw new Error('Workflow needs 1-20 cards');
  if (!Array.isArray(value.columnIds) || value.columnIds.length < 1 || value.columnIds.length > 15) throw new Error('Workflow needs 1-15 columns');
  const columnIds = value.columnIds as unknown[];
  const allowed = new Set(columns.map((column) => column.id));
  if (columnIds.some((id) => typeof id !== 'string' || !allowed.has(id)) || new Set(columnIds).size !== columnIds.length) throw new Error('Workflow route has an unknown or duplicate column');
  const cards = value.cards.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || !exactKeys(candidate as Record<string, unknown>, ['title', 'description'])) throw new Error('Workflow card has invalid fields');
    const card = candidate as Record<string, unknown>;
    if (typeof card.title !== 'string' || !card.title.trim() || card.title.length > 200) throw new Error('Workflow card title is invalid');
    if (typeof card.description !== 'string' || card.description.length > 10000) throw new Error('Workflow card description is invalid');
    return { title: card.title.trim(), description: card.description.trim() };
  });
  return { title: value.title.trim(), explanation: value.explanation.trim(), cards, columnIds: columnIds as string[] };
}
