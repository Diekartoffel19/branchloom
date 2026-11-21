import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/shared/types';
import { readableSessionOutput, serializeSessionTranscript, sessionMemoryDraft, sessionTranscriptFileName } from '../../src/renderer/activity-transcript';

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

  it('marks a shortened Memory copy and preserves the exact session source', () => {
    const draft = sessionMemoryDraft({ ...session, output: '\x1b[32m' + 'x'.repeat(200_000) + 'END' }, 'Aufgabe', 'Codex');
    expect(draft.title).toBe('Agentenlauf: Aufgabe');
    expect(draft.tags).toEqual(['agentenlauf']);
    expect(draft.body.length).toBeLessThanOrEqual(200_000);
    expect(draft.body).toContain('Sitzung: abc-123');
    expect(draft.body).toContain('Zeichen am Anfang ausgelassen');
    expect(draft.body).toContain('END');
    expect(draft.body).not.toContain('\x1b');
  });
});
