export interface QaFixCardPreview {
  reportId: string;
  sourceCardId: string;
  token: string;
  title: string;
  description: string;
}

export interface CreateQaFixCard {
  projectId: string;
  sourceCardId: string;
  reportId: string;
  token: string;
  columnId: string;
  title: string;
  description: string;
}
