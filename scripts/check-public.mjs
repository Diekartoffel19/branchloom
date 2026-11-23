import { execFileSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '--cached', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);
const forbiddenPath = /(^|\/)(?:\.env(?:\..*)?|\.kangentic|\.claude|\.codex|data|browser-profile|transcripts?)(\/|$)|\.(?:sqlite(?:-wal|-shm)?|pem|p12|key|log)$/i;
const forbiddenText = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})\b/,
  /\b(?:OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*=\s*[^\s#]{8,}/i,
  /(?:[A-Za-z]:\\Users\\|\/Users\/)[^\\/\s]+[\\/]/i,
];

const failures = [];
function checkContent(label, content) {
  for (const pattern of forbiddenText) {
    if (pattern.test(content)) {
      failures.push(`${label}: sensitive content pattern`);
      return;
    }
  }
}

for (const file of files) {
  const normalized = file.replaceAll('\\', '/');
  if (forbiddenPath.test(normalized)) {
    failures.push(`${file}: forbidden path`);
    continue;
  }
  // Review the exact blob that would be committed. A clean working-tree copy
  // must not hide sensitive content already staged in Git's index.
  const content = execFileSync('git', ['show', `:${file}`], {
    encoding: 'utf8', maxBuffer: 11 * 1024 * 1024,
  });
  checkContent(file, content);
}

// A token committed and then deleted is still publishable through Git history.
// Read only reachable blobs from HEAD; never print their contents.
let objects = '';
try {
  objects = execFileSync('git', ['rev-list', '--objects', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  // A new repository has no HEAD yet. The staged-file check above still runs.
}
const entries = objects.split(/\r?\n/).filter(Boolean).map((line) => {
  const separator = line.indexOf(' ');
  return { hash: separator < 0 ? line : line.slice(0, separator), path: separator < 0 ? '' : line.slice(separator + 1) };
});
if (entries.length) {
  const batch = execFileSync('git', ['cat-file', '--batch'], {
    input: Buffer.from(entries.map((entry) => entry.hash).join('\n') + '\n'), maxBuffer: 200 * 1024 * 1024,
  });
  let offset = 0;
  for (const entry of entries) {
    const lineEnd = batch.indexOf(10, offset);
    if (lineEnd < 0) throw new Error('Incomplete Git object header');
    const header = batch.toString('ascii', offset, lineEnd);
    const match = header.match(/^[a-f0-9]+ (\w+) (\d+)$/);
    if (!match) throw new Error('Invalid Git object header');
    const size = Number(match[2]);
    offset = lineEnd + 1;
    if (match[1] === 'blob') {
      const label = entry.path || entry.hash.slice(0, 12);
      if (forbiddenPath.test(label.replaceAll('\\', '/'))) failures.push(`${label}: forbidden historical path`);
      if (size > 10 * 1024 * 1024) failures.push(`${label}: historical blob exceeds 10 MiB`);
      else checkContent(label, batch.toString('utf8', offset, offset + size));
    }
    offset += size + 1;
  }
}
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`Public check passed (${files.length} tracked files, ${entries.length} reachable objects).`);
}
