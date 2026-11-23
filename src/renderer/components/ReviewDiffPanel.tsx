import { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, RefreshCw } from 'lucide-react';
import type { CardDiffPreview, DiffLine, DiffSide, ReviewComment } from '../../shared/diff-review';
import './review-diff.css';

type Anchor = { filePath: string; side: DiffSide; line: number };
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const anchorOf = (filePath: string, line: DiffLine): Anchor | null => line.kind === 'removed' && line.oldLine !== null
  ? { filePath, side: 'old', line: line.oldLine }
  : (line.kind === 'added' || line.kind === 'context') && line.newLine !== null
    ? { filePath, side: 'new', line: line.newLine } : null;

export function ReviewDiffPanel({ cardId }: { cardId: string }) {
  const [preview, setPreview] = useState<CardDiffPreview | null | undefined>(undefined);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [selected, setSelected] = useState<Anchor | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [changed, setChanged] = useState(false);
  const request = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = ++request.current;
    void load(id);
    return () => { request.current += 1; };
  }, [cardId]);

  async function load(id = ++request.current) {
    setBusy(true); setError('');
    try {
      const [next, saved] = await Promise.all([window.studio.previewCardDiff(cardId), window.studio.listReviewComments(cardId)]);
      if (id !== request.current) return;
      setChanged((before) => before || Boolean(preview && next && preview.fingerprint !== next.fingerprint));
      if (preview?.fingerprint !== next?.fingerprint) setSelected(null);
      setPreview(next); setComments(saved);
    } catch (reason) { if (id === request.current) setError(errorText(reason)); }
    finally { if (id === request.current) setBusy(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !preview || !selected || !body.trim()) return;
    setBusy(true); setError('');
    try {
      await window.studio.createReviewComment({ cardId, fingerprint: preview.fingerprint, filePath: selected.filePath,
        side: selected.side, line: selected.line, body: body.trim() });
      setComments(await window.studio.listReviewComments(cardId));
      setSelected(null); setBody('');
    } catch (reason) {
      const message = errorText(reason);
      setError(message);
      if (message.includes('seit der Vorschau geändert')) setChanged(true);
    } finally { setBusy(false); }
  }

  const current = preview ? comments.filter((item) => item.fingerprint === preview.fingerprint) : [];
  const older = preview ? comments.filter((item) => item.fingerprint !== preview.fingerprint) : comments;

  return <section className="review-diff" aria-label="Diff und Review-Kommentare">
    <div className="review-diff-head"><div><h4>Diff und Kommentare</h4><p>Committete und verfolgte Änderungen seit dem gemeinsamen Git-Ausgangspunkt. Kommentare bleiben lokal und gelten nur für diesen Diff-Stand.</p></div>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void load()}><RefreshCw size={14} /> Aktualisieren</button></div>
    {busy && preview === undefined ? <p role="status">Diff wird gelesen…</p> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {changed ? <p className="review-diff-warning" role="status">Der Git-Stand hat sich geändert. Ältere Kommentare bleiben separat sichtbar; bitte prüfe die aktuelle Vorschau erneut.</p> : null}
    {preview === null ? <p className="inline-note">Für diese Karte gibt es noch keinen Git-Worktree.</p> : null}
    {preview ? <>
      <p className="review-diff-meta">{preview.files.length} Dateien · Quelle {preview.sourceHead.slice(0, 8)} · Ziel {preview.targetHead.slice(0, 8)}</p>
      {preview.warnings.map((warning) => <p key={warning} className="review-diff-warning">{warning}</p>)}
      {preview.files.length === 0 ? <p className="inline-note">Noch keine verfolgten Änderungen im Worktree.</p> : preview.files.map((file) => <details className="review-diff-file" key={file.path} open>
        <summary>{file.path}</summary><div className="review-diff-lines">{file.lines.map((line, index) => {
          const anchor = anchorOf(file.path, line);
          const attached = anchor ? current.filter((item) => item.filePath === anchor.filePath && item.side === anchor.side && item.line === anchor.line) : [];
          return <div className="review-diff-entry" key={`${file.path}:${index}`}>
            {anchor ? <button type="button" className={`review-diff-line ${line.kind}`} aria-label={`Kommentar zu ${file.path}, ${anchor.side === 'new' ? 'neuer' : 'alter'} Zeile ${anchor.line}`}
              aria-pressed={selected?.filePath === anchor.filePath && selected.side === anchor.side && selected.line === anchor.line}
              onClick={() => { setSelected(anchor); requestAnimationFrame(() => input.current?.focus()); }}>
              <span className="review-diff-number">{line.oldLine ?? ''}</span><span className="review-diff-number">{line.newLine ?? ''}</span><code>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}{line.text}</code><MessageSquarePlus size={13} aria-hidden="true" />
            </button> : <div className={`review-diff-line ${line.kind}`}><span className="review-diff-number" /><span className="review-diff-number" /><code>{line.text}</code></div>}
            {attached.map((item) => <div className="review-diff-comment" key={item.id}><span>{new Date(item.createdAt).toLocaleString('de-DE')}</span><p>{item.body}</p></div>)}
          </div>;
        })}</div>
      </details>)}
      {selected ? <form className="review-diff-form" onSubmit={(event) => void submit(event)}><label>Kommentar zu {selected.filePath}, {selected.side === 'new' ? 'neuer' : 'alter'} Zeile {selected.line}
        <textarea ref={input} rows={3} maxLength={2_000} value={body} disabled={busy} onChange={(event) => setBody(event.target.value)} placeholder="Konkrete Frage oder Änderung…" /></label>
        <div><button className="secondary-button" type="button" disabled={busy} onClick={() => { setSelected(null); setBody(''); }}>Abbrechen</button><button className="primary-button" type="submit" disabled={busy || !body.trim()}>Kommentar speichern</button></div></form> : null}
      {older.length ? <details className="review-diff-history"><summary>{older.length} Kommentar{older.length === 1 ? '' : 'e'} zu älteren Diff-Ständen</summary>
        {older.map((item) => <div className="review-diff-comment" key={item.id}><span>{item.filePath} · {item.side === 'new' ? 'neu' : 'alt'} {item.line} · {new Date(item.createdAt).toLocaleString('de-DE')}</span><p>{item.body}</p></div>)}</details> : null}
    </> : null}
  </section>;
}
