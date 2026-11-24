import { afterEach, describe, expect, it, vi } from 'vitest';
import { inboxFirstPageChanged, INBOX_REFRESH_MS, scheduleVisibleInboxRefresh } from '../../src/renderer/inbox-refresh';

afterEach(() => vi.useRealTimers());

describe('inbox live refresh', () => {
  it('refreshes only while the document is visible and stops after leaving the view', () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = 'hidden';
    let onVisibilityChange: (() => void) | null = null;
    const visibility = {
      get visibilityState() { return visibilityState; },
      addEventListener: (_name: string, listener: () => void) => { onVisibilityChange = listener; },
      removeEventListener: (_name: string, listener: () => void) => { if (onVisibilityChange === listener) onVisibilityChange = null; },
    } as unknown as Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
    const every = { setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval } as unknown as Pick<Window, 'setInterval' | 'clearInterval'>;
    const refresh = vi.fn();
    const stop = scheduleVisibleInboxRefresh(refresh, visibility, every);
    vi.advanceTimersByTime(INBOX_REFRESH_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
    visibilityState = 'visible';
    onVisibilityChange?.();
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(INBOX_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(INBOX_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(onVisibilityChange).toBeNull();
  });

  it('detects changes in the first page without discarding older loaded rows', () => {
    const loaded = Array.from({ length: 101 }, (_, index) => ({ id: String(index), title: `Eintrag ${index}` }));
    expect(inboxFirstPageChanged(loaded, loaded.slice(0, 100))).toBe(false);
    expect(inboxFirstPageChanged(loaded, [{ ...loaded[0], title: 'Aktualisiert' }, ...loaded.slice(1, 100)])).toBe(true);
    expect(inboxFirstPageChanged(loaded, loaded.slice(1, 101))).toBe(true);
  });
});
