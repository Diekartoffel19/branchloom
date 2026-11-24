export type CardCriterionEvidenceKind = 'qa' | 'review';

export interface CardCriterionEvidence {
  id: string;
  kind: CardCriterionEvidenceKind;
  sourceId: string;
  note: string;
  linkedAt: string;
  sourceAvailable: boolean;
  currentForCriterion: boolean;
  sourceLabel: string;
  sourceStatus: 'passed' | 'failed' | 'error' | 'review' | 'missing';
}

export interface CardCriterion {
  id: string;
  cardId: string;
  text: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  evidence: CardCriterionEvidence[];
}
