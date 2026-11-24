export type ChangelogPeriod = 'day' | 'week';
export type ChangelogScope = 'head' | 'saved-worktrees';

export interface ChangelogSource {
  kind: 'project-head' | 'card-worktree';
  cardId?: string;
  cardTitle?: string;
  branch?: string;
}

export interface ChangelogCommit {
  hash: string;
  committedAt: string;
  subject: string;
  sources?: ChangelogSource[];
}

export interface ChangelogIssue { cardId: string | null; cardTitle: string | null; reason: string }

export interface ProjectChangelog {
  projectId: string;
  period: ChangelogPeriod;
  since: string;
  until: string;
  checkedAt: string;
  scope: ChangelogScope;
  state: 'ready' | 'no-repository' | 'no-commits';
  head: string | null;
  commits: ChangelogCommit[];
  moreAvailable: boolean;
  issues: ChangelogIssue[];
  checkedWorktrees: number;
}
