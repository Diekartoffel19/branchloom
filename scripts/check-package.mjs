import { lstatSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const blockedDirectories = new Set(['.git', '.github', '.codex', '.venv', 'coverage', 'out', 'src', 'tests']);
const blockedFile = (name) => /^(?:\.env(?:\..*)?|.*\.sqlite(?:-wal|-shm)?|studio\.db|auth\.json|credentials\.json)$/i.test(name);

/** Scan the distributable app, not just Git's tracked files. Never log private names or contents. */
export function checkPackagedApp(appDirectory) {
  const root = resolve(appDirectory);
  let rootInfo;
  try { rootInfo = lstatSync(root); } catch { throw new Error('Der gepackte App-Ordner fehlt.'); }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Der gepackte App-Ordner fehlt.');
  const violations = new Set();
  let files = 0;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = entry.name.toLowerCase();
      if (entry.isSymbolicLink()) { violations.add('symbolic links'); continue; }
      if (entry.isDirectory()) {
        if (name === 'node_modules') continue; // Vendor package examples are outside our source bundle.
        if (blockedDirectories.has(name)) { violations.add('local/source directories'); continue; }
        walk(join(directory, entry.name));
      } else if (entry.isFile()) {
        files += 1;
        if (blockedFile(name)) violations.add('local configuration or database files');
      }
    }
  };
  walk(root);
  if (violations.size) throw new Error(`Paketprüfung fehlgeschlagen: ${[...violations].join(', ')}.`);
  if (files === 0) throw new Error('Der gepackte App-Ordner enthält keine App-Dateien.');
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const appDirectory = process.argv[2] ?? join(process.cwd(), 'out', 'Jarvis Studio-win32-x64', 'resources', 'app');
  try {
    const files = checkPackagedApp(appDirectory);
    console.log(`Paketprüfung bestanden (${files} App-Dateien ohne lokale Daten).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Paketprüfung fehlgeschlagen.');
    process.exitCode = 1;
  }
}
