import type Database from 'better-sqlite3';
import type { AgentCapability, AgentCapabilityEvidence } from '../shared/types';

interface EvidenceRow { agent_id: string; capability: AgentCapability; session_id: string; observed_at: string }

/** Keep only the latest local operation per profile and capability. No terminal text or prompt is stored here. */
export function installAgentCapabilities(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_capability_evidence (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    capability TEXT NOT NULL CHECK (capability IN ('start', 'input', 'stop', 'resume')),
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    observed_at TEXT NOT NULL,
    PRIMARY KEY (agent_id, capability)
  )`);
}

export function recordAgentCapability(db: Database.Database, sessionId: string, capability: AgentCapability): void {
  if (!['start', 'input', 'stop', 'resume'].includes(capability)) throw new Error('Ungültiger Fähigkeitsbeleg.');
  const row = db.prepare('SELECT s.agent_id, s.state, a.kind FROM sessions s JOIN agents a ON a.id = s.agent_id WHERE s.id = ?').get(sessionId) as { agent_id: string; state: string; kind: string } | undefined;
  if (!row) throw new Error('Sitzung für Fähigkeitsbeleg nicht gefunden.');
  if (row.state !== (capability === 'stop' ? 'stopped' : 'running')) throw new Error('Fähigkeitsbeleg passt nicht zum Sitzungszustand.');
  if (capability === 'resume' && row.kind !== 'codex') throw new Error('Resume-Beleg gilt nur für Codex.');
  db.prepare(`INSERT INTO agent_capability_evidence (agent_id, capability, session_id, observed_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(agent_id, capability) DO UPDATE SET session_id = excluded.session_id, observed_at = excluded.observed_at`)
    .run(row.agent_id, capability, sessionId, new Date().toISOString());
}

export function listAgentCapabilityEvidence(db: Database.Database): AgentCapabilityEvidence[] {
  const rows = db.prepare(`SELECT e.agent_id, e.capability, e.session_id, e.observed_at
    FROM agent_capability_evidence e JOIN agents a ON a.id = e.agent_id
    ORDER BY a.name, e.capability`).all() as EvidenceRow[];
  return rows.map((row) => ({ agentId: row.agent_id, capability: row.capability, sessionId: row.session_id, observedAt: row.observed_at }));
}

export function clearAgentCapabilityEvidence(db: Database.Database, agentId: string): void {
  db.prepare('DELETE FROM agent_capability_evidence WHERE agent_id = ?').run(agentId);
}
