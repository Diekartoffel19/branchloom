import type { ReactNode } from 'react';
import type { MemoryNote } from '../shared/types';
export { memoryMarkdownFileName, parseMemoryMarkdownFile, serializeMemoryNote } from '../shared/memory-file';

export type MemoryBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph' | 'quote'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; text: string };

/** A deliberately small Markdown subset. Raw HTML is always rendered as text. */
export function parseMemoryBlocks(body: string): MemoryBlock[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MemoryBlock[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!;
    if (!line.trim()) { index += 1; continue; }
    if (/^```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index]!)) code.push(lines[index++]!);
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { blocks.push({ kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! }); index += 1; continue; }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index]!)) items.push(lines[index++]!.replace(/^[-*]\s+/, ''));
      blocks.push({ kind: 'list', items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!)) quote.push(lines[index++]!.replace(/^>\s?/, ''));
      blocks.push({ kind: 'quote', text: quote.join('\n') });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() && !/^(?:```|#{1,3}\s|[-*]\s|>\s?)/.test(lines[index]!)) paragraph.push(lines[index++]!);
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

function inline(text: string, notes: MemoryNote[], onOpenNote: (id: string) => void): ReactNode[] {
  const result: ReactNode[] = [];
  const matcher = /\[\[([^\]\n]+)\]\]|`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let cursor = 0;
  for (const match of text.matchAll(matcher)) {
    const index = match.index ?? 0;
    if (index > cursor) result.push(text.slice(cursor, index));
    if (match[1]) {
      const title = match[1].trim();
      const target = notes.find((note) => note.title.toLocaleLowerCase() === title.toLocaleLowerCase());
      result.push(target
        ? <button className="memory-wikilink" type="button" key={index} onClick={() => onOpenNote(target.id)}>[[{title}]]</button>
        : <span className="memory-wikilink missing" key={index}>[[{title}]]</span>);
    } else if (match[2]) result.push(<code key={index}>{match[2]}</code>);
    else result.push(<strong key={index}>{match[3]}</strong>);
    cursor = index + match[0].length;
  }
  if (cursor < text.length) result.push(text.slice(cursor));
  return result;
}

export function MemoryMarkdown({ body, notes, onOpenNote }: { body: string; notes: MemoryNote[]; onOpenNote: (id: string) => void }) {
  const blocks = parseMemoryBlocks(body);
  if (blocks.length === 0) return <p className="memory-preview-empty">Diese Notiz hat noch keinen Text.</p>;
  return <div className="memory-markdown">{blocks.map((block, index) => {
    if (block.kind === 'code') return <pre key={index}><code>{block.text}</code></pre>;
    if (block.kind === 'heading') {
      const content = inline(block.text, notes, onOpenNote);
      if (block.level === 1) return <h1 key={index}>{content}</h1>;
      if (block.level === 2) return <h2 key={index}>{content}</h2>;
      return <h3 key={index}>{content}</h3>;
    }
    if (block.kind === 'list') return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item, notes, onOpenNote)}</li>)}</ul>;
    if (block.kind === 'quote') return <blockquote key={index}>{inline(block.text, notes, onOpenNote)}</blockquote>;
    return <p key={index}>{inline(block.text, notes, onOpenNote)}</p>;
  })}</div>;
}
