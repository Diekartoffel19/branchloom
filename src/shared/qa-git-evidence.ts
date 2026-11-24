/** Git metadata is a checkout observation, never proof of what a dev server served. */
export interface QaGitEvidence {
  scope: 'project' | 'card-worktree';
  startHead: string | null;
  endHead: string | null;
  dirtyAtStart: boolean | null;
  dirtyAtEnd: boolean | null;
  state: 'clean' | 'dirty' | 'changed' | 'unavailable';
}
