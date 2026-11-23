import type { DraftTurn } from './task-draft';

export type IdeaCategory = 'idea' | 'backlog' | 'roadmap';

export interface Idea {
  id: string;
  projectId: string;
  title: string;
  body: string;
  category: IdeaCategory;
  turns: DraftTurn[];
  cardId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdeaReply {
  reply: string;
  suggestedTitle: string;
  suggestedBody: string;
  suggestedCategory: IdeaCategory | null;
}
