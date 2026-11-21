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

export function sessionTranscriptFileName(sessionId: string): string {
  return `jarvis-lauf-${sessionId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36) || 'unbekannt'}.txt`;
}
