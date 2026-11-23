export type ReviewRuleSource = 'plan' | 'diff';

export interface ReviewRule {
  id: string;
  projectId: string;
  body: string;
  enabled: boolean;
  sourceKind: ReviewRuleSource;
  sourceId: string;
  sourceLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReviewRuleFromComment {
  projectId: string;
  sourceKind: ReviewRuleSource;
  sourceId: string;
}

export interface UpdateReviewRule {
  projectId: string;
  id: string;
  body?: string;
  enabled?: boolean;
}
