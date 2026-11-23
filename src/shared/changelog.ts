export type ChangelogPeriod = 'day' | 'week';

export interface ChangelogCommit {
  hash: string;
  committedAt: string;
  subject: string;
}

export interface ProjectChangelog {
  projectId: string;
  period: ChangelogPeriod;
  since: string;
  until: string;
  checkedAt: string;
  state: 'ready' | 'no-repository' | 'no-commits';
  head: string | null;
  commits: ChangelogCommit[];
  moreAvailable: boolean;
}
