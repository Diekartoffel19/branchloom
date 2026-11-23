export type ReviewInboxSource = 'plan' | 'diff';

export interface ReviewInboxItem {
  id: string;
  kind: ReviewInboxSource;
  projectId: string;
  sourceId: string;
  sourceTitle: string;
  location: string;
  body: string;
  createdAt: string;
}

export interface ReviewInboxPage {
  items: ReviewInboxItem[];
  hasMore: boolean;
}

export interface AcknowledgeReviewInboxComment {
  projectId: string;
  kind: ReviewInboxSource;
  commentId: string;
}
