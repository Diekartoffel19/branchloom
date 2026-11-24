import type { Card } from './types';

export interface CardSplitDraftItem {
  title: string;
  description: string;
  dependsOnIndex: number | null;
}

export interface CardSplitInput {
  cardId: string;
  columnId: string;
  items: CardSplitDraftItem[];
}

export interface CardSplitPreview {
  parent: Pick<Card, 'id' | 'title'>;
  destination: { id: string; name: string };
  items: CardSplitDraftItem[];
  token: string;
}

export interface CardSplitLink {
  cardId: string;
  title: string;
  archivedAt: string | null;
  dependsOnCardId: string | null;
  dependsOnTitle: string | null;
  position: number;
}

export interface CardSplitLinks {
  parent: { cardId: string; title: string; dependsOnCardId: string | null; dependsOnTitle: string | null } | null;
  children: CardSplitLink[];
}

export interface CardSplitResult {
  parentCardId: string;
  cards: Card[];
  links: CardSplitLinks;
}
