export type DiffSide = 'old' | 'new';
export type DiffLineKind = 'meta' | 'hunk' | 'context' | 'added' | 'removed';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffFile {
  path: string;
  lines: DiffLine[];
}

export interface CardDiffPreview {
  cardId: string;
  sourceHead: string;
  targetHead: string;
  baseHead: string;
  fingerprint: string;
  files: DiffFile[];
  warnings: string[];
}

export interface ReviewComment {
  id: string;
  cardId: string;
  fingerprint: string;
  filePath: string;
  side: DiffSide;
  line: number;
  body: string;
  createdAt: string;
}

export interface CreateReviewComment {
  cardId: string;
  fingerprint: string;
  filePath: string;
  side: DiffSide;
  line: number;
  body: string;
}
