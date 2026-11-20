import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const packaged = process.argv.includes('--package');
const executable = packaged
  ? join(process.cwd(), 'out', 'Jarvis Studio-win32-x64', 'Jarvis Studio.exe')
  : require('electron');
if (!existsSync(executable)) throw new Error(`Electron-Binary fehlt: ${executable}`);
const args = packaged ? ['--studio-smoke'] : ['.', '--studio-smoke'];
const child = spawn(executable, args, {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, JARVIS_STUDIO_DEV_SERVER: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(-10000); });
child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-10000); });
const timeout = setTimeout(() => child.kill(), 45_000);
child.on('error', (error) => {
  clearTimeout(timeout);
  console.error(`Electron-Start fehlgeschlagen: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearTimeout(timeout);
  if (code === 0 && stdout.includes('STUDIO_SMOKE_OK')) {
    console.log(`${packaged ? 'Paket' : 'Quellbuild'}: Electron, native Module und Renderer starteten.`);
  } else {
    console.error(`Electron-Smoke fehlgeschlagen (Exit ${code ?? 'unbekannt'}).`);
    console.error(stderr.slice(-2000) || stdout.slice(-2000));
    process.exitCode = 1;
  }
});
