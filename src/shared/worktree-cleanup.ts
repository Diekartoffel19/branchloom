/** Read-only snapshot. It does not authorize removal of any checkout or branch. */
export interface WorktreeCleanupPreview {
  cardId: string;
  path: string;
  branch: string;
  targetPath: string;
  targetBranch: string | null;
  sourceHead: string;
  targetHead: string;
  sourceClean: boolean;
  targetClean: boolean;
  ignoredFilesPresent: boolean;
  mergedIntoTarget: boolean;
  activeSession: boolean;
  blockers: string[];
  checkedAt: string;
}
