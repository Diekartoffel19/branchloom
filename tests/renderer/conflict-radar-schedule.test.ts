import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFLICT_RADAR_REFRESH_MS, startConflictRadarRefresh } from '../../src/renderer/conflict-radar-schedule';

afterEach(() => vi.useRealTimers());

describe('open-card conflict polling', () => {
  it('runs immediately, no more than once per interval, and stops on drawer cleanup', () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const stop = startConflictRadarRefresh(true, check);
    expect(check).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CONFLICT_RADAR_REFRESH_MS - 1);
    expect(check).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(CONFLICT_RADAR_REFRESH_MS * 2);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('does not start checks for a stopped or absent session', () => {
    vi.useFakeTimers();
    const check = vi.fn();
    startConflictRadarRefresh(false, check)();
    vi.advanceTimersByTime(CONFLICT_RADAR_REFRESH_MS * 2);
    expect(check).not.toHaveBeenCalled();
  });
});
