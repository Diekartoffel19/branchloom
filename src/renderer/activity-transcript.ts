import type { Session } from '../shared/types';

export function readableSessionOutput(output: string): string {
  return output
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

export function serializeSessionTranscript(session: Session, cardTitle: string, agentName: string): string {
  const lines = [
    'Jarvis Studio · Agentenlauf',
    `Karte: ${cardTitle}`,
    `Agent: ${agentName}`,
    `Sitzung: ${session.id}`,
    `Status: ${session.state}`,
    `Beginn: ${session.startedAt}`,
    `Ende: ${session.endedAt ?? 'offen'}`,
    `Exit-Code: ${session.exitCode ?? 'nicht erfasst'}`,
    '',
    readableSessionOutput(session.output),
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}

/** A deliberate Memory copy keeps source metadata and marks any shortened output. */
export function sessionMemoryDraft(session: Session, cardTitle: string, agentName: string) {
  const title = `Agentenlauf: ${cardTitle}`.slice(0, 200);
  const full = serializeSessionTranscript(session, cardTitle, agentName);
  if (full.length <= 200_000) return { title, body: full, tags: ['agentenlauf'], links: [] };
  const header = serializeSessionTranscript({ ...session, output: '' }, cardTitle, agentName);
  const output = readableSessionOutput(session.output);
  const tail = output.slice(-190_000);
  const omitted = output.length - tail.length;
  const body = `${header}[Memory-Ausschnitt: ${omitted} Zeichen am Anfang ausgelassen. Vollständigen Verlauf in Aktivität als Text speichern.]\n\n${tail}`;
  return { title, body, tags: ['agentenlauf'], links: [] };
}

export function sessionTranscriptFileName(sessionId: string): string {
  return `jarvis-lauf-${sessionId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36) || 'unbekannt'}.txt`;
}
