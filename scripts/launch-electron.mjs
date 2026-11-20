import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(process.argv.includes('--dev') ? { JARVIS_STUDIO_DEV_SERVER: '1' } : {}),
  },
});

child.on('error', (error) => {
  console.error('Electron konnte nicht gestartet werden:', error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
