import type { MemoryNote } from './types';

/** A single-note filename for downloads and vault exports. */
export function memoryMarkdownFileName(title: string): string {
  const safe = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 100).replace(/[. ]+$/g, '');
  const base = safe && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(safe) ? safe : 'Notiz';
  return `${base}.md`;
}

export function serializeMemoryNote(note: MemoryNote): string {
  const tags = note.tags.length ? `---\ntags: ${JSON.stringify(note.tags)}\n---\n` : '';
  return `${tags}# ${note.title}\n\n${note.body.trimEnd()}\n`;
}

export function parseMemoryMarkdownFile(name: string, source: string): { title: string; body: string; tags: string[] } {
  const normalized = source.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  let text = normalized;
  let tags: string[] = [];
  const frontmatter = text.match(/^---\n(tags: (\[[^\n]*\]))\n---\n/);
  if (frontmatter) {
    try {
      const parsed: unknown = JSON.parse(frontmatter[2]!);
      if (Array.isArray(parsed) && parsed.length <= 50 && parsed.every((tag) => typeof tag === 'string' && tag.length <= 80)) {
        tags = parsed;
        text = text.slice(frontmatter[0].length);
      }
    } catch { /* Other frontmatter stays in the editable body. */ }
  }
  const heading = text.match(/^# ([^\n]+)(?:\n\n?|$)/);
  const fallback = name.replace(/\.md$/i, '').trim() || 'Importierte Notiz';
  const title = (heading?.[1]?.trim() || fallback).slice(0, 120);
  const body = heading ? text.slice(heading[0].length).replace(/\n$/, '') : text;
  if (body.length > 200_000) throw new Error('Die Markdown-Datei ist für eine Memory-Notiz zu groß.');
  return { title, body, tags };
}

/** Stable, Windows-safe names; duplicate or case-equivalent titles get a suffix. */
export function planMemoryVaultFiles(notes: MemoryNote[]): Array<{ name: string; contents: string }> {
  const used = new Set<string>();
  return [...notes].sort((a, b) => a.title.localeCompare(b.title, 'de-DE') || a.id.localeCompare(b.id)).map((note) => {
    const base = memoryMarkdownFileName(note.title).slice(0, -3);
    let name = `${base}.md`;
    for (let suffix = 2; used.has(name.toLowerCase()); suffix += 1) {
      name = `${base.slice(0, 90)} (${suffix}).md`;
    }
    used.add(name.toLowerCase());
    return { name, contents: serializeMemoryNote(note) };
  });
}
