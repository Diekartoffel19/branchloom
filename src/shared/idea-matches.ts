import type { Idea } from './ideas';

export type IdeaMatchKind = 'idea' | 'card';

export interface IdeaMatchCandidate {
  kind: IdeaMatchKind;
  id: string;
  title: string;
  body: string;
  origin: string;
  archived: boolean;
  reason: string;
  signature: string;
}

export interface IdeaMatchLink {
  kind: IdeaMatchKind;
  id: string;
  title: string;
  origin: string;
  linkedAt: string;
  available: boolean;
}

export interface IdeaMatchPreview {
  idea: Idea;
  candidates: IdeaMatchCandidate[];
  links: IdeaMatchLink[];
  limited: boolean;
}
