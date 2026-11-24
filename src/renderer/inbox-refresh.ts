import { useEffect, useRef } from 'react';

export const INBOX_REFRESH_MS = 15_000;

/** Refresh only while this view is mounted and the app document is visible. */
export function scheduleVisibleInboxRefresh(
  onRefresh: () => void,
  visibility: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document,
  every: Pick<Window, 'setInterval' | 'clearInterval'> = window,
): () => void {
  const tick = () => { if (visibility.visibilityState === 'visible') onRefresh(); };
  const timer = every.setInterval(tick, INBOX_REFRESH_MS);
  visibility.addEventListener('visibilitychange', tick);
  return () => { every.clearInterval(timer); visibility.removeEventListener('visibilitychange', tick); };
}

/** Preserve older loaded pages until the user explicitly chooses to reload. */
export function inboxFirstPageChanged<T extends { id: string }>(loaded: T[], firstPage: T[]): boolean {
  const previousFirstPage = loaded.slice(0, 100);
  return previousFirstPage.length !== firstPage.length ||
    previousFirstPage.some((item, index) => JSON.stringify(item) !== JSON.stringify(firstPage[index]));
}

export function useVisibleInboxRefresh(onRefresh: () => void): void {
  const latest = useRef(onRefresh);
  latest.current = onRefresh;
  useEffect(() => scheduleVisibleInboxRefresh(() => latest.current()), []);
}
