import type { CardQaViewport } from './types';

export interface QaCoverageCell {
  viewport: CardQaViewport;
  state: 'missing' | 'current' | 'stale';
  report: { id: string; cardId: string; status: 'passed' | 'failed' | 'error'; endedAt: string; pageCheck: 'not-run' | 'complete' | 'partial' | 'unavailable'; observationCount: number } | null;
}

export interface QaCoverageRoute {
  id: string;
  projectId: string;
  cardId: string;
  url: string;
  viewports: CardQaViewport[];
  createdAt: string;
  cells: QaCoverageCell[];
}

export interface SaveQaCoverageRoute {
  projectId: string;
  cardId: string;
  url: string;
  viewports: CardQaViewport[];
}
