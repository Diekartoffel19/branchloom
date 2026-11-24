import type { CardRunGate } from '../shared/parallel-runs';

export function parallelStartWarning(gate: CardRunGate | null, useWorktree: boolean): string | null {
  if (!gate || gate.runningCount === 0) return null;
  if (gate.running.some((run) => !run.worktreePath)) {
    return 'Ein laufender Agent nutzt noch den Projektordner. Ein zweiter Lauf ist erst nach dessen Ende möglich.';
  }
  if (!useWorktree) return 'Für einen weiteren gleichzeitigen Lauf den isolierten Git-Worktree aktivieren.';
  return null;
}
