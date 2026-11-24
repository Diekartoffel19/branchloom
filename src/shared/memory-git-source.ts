export interface MemoryGitCommit {
  hash: string;
  subject: string;
  committedAt: string;
}

export type MemoryGitSourceState = 'in-history' | 'outside-history' | 'missing' | 'repository-changed' | 'unavailable';

export interface MemoryGitSource extends MemoryGitCommit {
  noteId: string;
  attachedAt: string;
  state: MemoryGitSourceState;
}
