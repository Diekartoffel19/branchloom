import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/shared/types';
import { readableSessionOutput, serializeSessionTranscript, sessionTranscriptFileName } from '../../src/renderer/activity-transcript';

const session: Session = {
  id: 'abc-123', projectId: 'p', cardId: 'c', agentId: 'a', state: 'exited',
  startedAt: '2026-11-20T10:00:00Z', endedAt: '2026-11-20T10:00:05Z',
  exitCode: 0, output: '\x1b[32mFertig\x1b[0m\r\nErgebnis\x1b]0;Titel\x07',
};

describe('historical activity transcripts', () => {
  it('renders stored output as readable plain text without terminal control sequences', () => {
    expect(readableSessionOutput(session.output)).toBe('Fertig\nErgebnis');
    const text = serializeSessionTranscript(session, 'Aufgabe', 'Codex');
    expect(text).toContain('Karte: Aufgabe\nAgent: Codex');
    expect(text).toContain('Status: exited');
    expect(text).toContain('Fertig\nErgebnis');
    expect(text).not.toContain('\x1b');
  });

  it('uses a safe file name even for an invalid stored identifier', () => {
    expect(sessionTranscriptFileName('../abc-123')).toBe('jarvis-lauf-abc-123.txt');
  });
});
