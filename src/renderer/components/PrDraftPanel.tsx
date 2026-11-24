import { useEffect, useState } from 'react';
import type { PrDraftPreview } from '../../shared/types';

export function PrDraftPanel({ cardId }: { cardId: string }) {
  const [preview, setPreview] = useState<PrDraftPreview | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { setPreview(null); setText(''); setError(''); setCopied(false); }, [cardId]);

  async function load() {
    setBusy(true); setError(''); setCopied(false);
    try {
      const next = await window.studio.previewPrDraft(cardId);
      setPreview(next); setText(next?.text ?? '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!preview || !text.trim()) return;
    setBusy(true); setError(''); setCopied(false);
    try {
      const current = await window.studio.previewPrDraft(cardId);
      if (!current || current.sourceHead !== preview.sourceHead || current.targetHead !== preview.targetHead) {
        throw new Error('Git-Stand hat sich geändert. Entwurf neu laden und Änderungen erneut prüfen.');
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return <section className="stacked-form" aria-label="PR-Entwurf">
    <div className="section-heading"><h3>PR-Entwurf</h3></div>
    <p className="section-copy">Liest Kartenauftrag, Git-Commits, Dateinamen und gespeicherte Browser-QA. Der Text ist editierbar. Er erstellt keinen Pull Request und belegt keine Tests oder Reviews.</p>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Lese Git-Stand…' : preview ? 'Entwurf neu laden' : 'Entwurf erstellen'}</button>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {preview ? <>
      <p className="run-meta">Quelle {preview.sourceHead.slice(0, 12)} · Ziel {preview.targetHead.slice(0, 12)} · {preview.reportCount} lokale QA-Berichte. Änderungen am Text bleiben bis zum erneuten Laden hier sichtbar.</p>
      <label className="field-label">Markdown-Entwurf<textarea rows={16} value={text} onChange={(event) => { setText(event.target.value); setCopied(false); }} /></label>
      <button className="secondary-button" type="button" disabled={busy || !text.trim()} onClick={() => void copy()}>{copied ? 'Markdown kopiert' : 'Markdown kopieren'}</button>
    </> : null}
  </section>;
}
