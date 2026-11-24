export interface ProjectMilestone {
  id: string;
  projectId: string;
  label: string;
  repository: string;
  branch: string | null;
  commit: string;
  createdAt: string;
  previewAvailable: boolean;
  previewSource: string | null;
  previewCapturedAt: string | null;
}

export interface MilestoneComparison {
  milestone: ProjectMilestone;
  currentCommit: string;
  currentBranch: string | null;
  workingTreeClean: boolean;
  isAncestor: boolean;
  changedFiles: Array<{ path: string; status: string }>;
  truncated: boolean;
}

export interface MilestoneCheckout {
  path: string;
  commit: string;
  reused: boolean;
  workingTreeClean: boolean;
}
