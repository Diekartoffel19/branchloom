import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const checks = [];
const nodeMajor = Number(process.versions.node.split('.')[0]);
checks.push({ label: 'Node.js 24+', ok: nodeMajor >= 24, required: true });

try {
  const executable = require('electron');
  checks.push({ label: 'Electron-Binary', ok: typeof executable === 'string' && existsSync(executable), required: true });
} catch {
  checks.push({ label: 'Electron-Binary', ok: false, required: true });
}

try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const ok = db.prepare('SELECT 1 AS value').get().value === 1;
  db.close();
  checks.push({ label: 'SQLite-Modul', ok, required: true });
} catch {
  checks.push({ label: 'SQLite-Modul', ok: false, required: true });
}

try {
  const pty = require('node-pty');
  checks.push({ label: 'PTY-Modul', ok: typeof pty.spawn === 'function', required: true });
} catch {
  checks.push({ label: 'PTY-Modul', ok: false, required: true });
}

for (const name of ['codex', 'claude', 'gemini']) {
  const probe = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], {
    timeout: 3_000, encoding: 'utf8', windowsHide: true,
  });
  checks.push({ label: `${name} CLI`, ok: probe.status === 0, required: false });
}

const voicePython = process.env.JARVIS_STUDIO_PYTHON || join(process.cwd(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const voiceProbe = existsSync(voicePython)
  ? spawnSync(voicePython, ['-c', 'import faster_whisper, av'], { timeout: 8_000, windowsHide: true })
  : null;
checks.push({ label: 'Lokale Spracheingabe (optional)', ok: voiceProbe?.status === 0, required: false });

for (const check of checks) console.log(`${check.ok ? 'OK' : check.required ? 'FEHLT' : 'optional'}  ${check.label}`);
if (checks.some((check) => check.required && !check.ok)) {
  console.error('Pflichtkomponente fehlt. npm ci ausführen und README prüfen.');
  process.exitCode = 1;
}
