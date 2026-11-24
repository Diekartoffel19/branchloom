import { useState } from 'react';
import { GitMerge, RefreshCw } from 'lucide-react';
import type { IdeaMatchCandidate, IdeaMatchKind, IdeaMatchPreview } from '../../shared/idea-matches';
import './idea-matches.css';

const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const keyOf = (item: Pick<IdeaMatchCandidate, 'kind' | 'id'>) => `${item.kind}:${item.id}`;

export function IdeaMatchPanel({ projectId, ideaId, dirty, onOpenIdea, onOpenCard, onLinksChanged }: {
  projectId: string; ideaId: string; dirty: boolean; onOpenIdea: (id: string) => void; onOpenCard: (id: string) => void; onLinksChanged: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<IdeaMatchPreview | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const candidate = preview?.candidates.find((item) => keyOf(item) === selected);

  async function refresh() {
    if (!ideaId || dirty || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await window.studio.previewIdeaMatches({ projectId, ideaId });
      setPreview(next);
      setSelected((old) => next.candidates.some((item) => keyOf(item) === old) ? old : keyOf(next.candidates[0] ?? { kind: 'idea', id: '' }));
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function link() {
    if (!candidate || busy || dirty) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = await window.studio.linkIdeaMatch({ projectId, ideaId, kind: candidate.kind, sourceId: candidate.id, expectedSignature: candidate.signature });
      setPreview(next); setSelected(''); await onLinksChanged(); setNotice('Quelle bewusst mit dieser Idee verknüpft. Beide Originaleinträge bleiben erhalten.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function unlink(kind: IdeaMatchKind, sourceId: string) {
    if (busy || dirty) return;
    setBusy(true); setError(''); setNotice('');
    try {
      setPreview(await window.studio.unlinkIdeaMatch({ projectId, ideaId, kind, sourceId }));
      await onLinksChanged();
      setNotice('Verknüpfung gelöst.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  return <section className="idea-match-panel" aria-label="Ähnliche Einträge prüfen">
    <div className="ideas-panel-heading"><div><span className="ideas-kicker">Lokaler Vergleich</span><h3>Ähnliche Einträge</h3></div><button type="button" className="secondary-button" disabled={!ideaId || dirty || busy} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true" /> {preview ? 'Erneut prüfen' : 'Vorschläge prüfen'}</button></div>
    <p className="ideas-disclosure">Branchloom vergleicht Titelbegriffe aus gespeicherten Ideen und Board-Karten dieses Projekts. Trello-Quellen erscheinen nach dem Import. Es werden keine Daten an ein Modell gesendet und nichts automatisch zusammengeführt.</p>
    {!ideaId ? <p className="ideas-muted">Speichere zuerst eine Idee.</p> : dirty ? <p className="ideas-muted">Speichere die Änderungen vor dem Vergleich.</p> : null}
    {preview ? <>
      {preview.limited ? <p className="inline-note">Es werden höchstens 2.000 Ideen und 2.000 Karten geprüft. Weitere Einträge sind in dieser Vorschau nicht enthalten.</p> : null}
      {preview.links.length ? <div className="idea-match-links"><strong>Bereits verbunden</strong><ul>{preview.links.map((link) => <li key={`${link.kind}:${link.id}`}><span><b>{link.title}</b><small>{link.origin} · {new Date(link.linkedAt).toLocaleString('de-DE')}</small></span><div>{link.available ? <button className="text-button" type="button" onClick={() => link.kind === 'idea' ? onOpenIdea(link.id) : onOpenCard(link.id)}>Öffnen</button> : null}<button className="text-button" type="button" disabled={busy || dirty} onClick={() => void unlink(link.kind, link.id)}>Lösen</button></div></li>)}</ul></div> : null}
      {preview.candidates.length ? <div className="idea-match-layout"><div className="idea-match-results" aria-label="Mögliche Duplikate">{preview.candidates.map((item) => <button type="button" key={keyOf(item)} className={selected === keyOf(item) ? 'idea-match-result selected' : 'idea-match-result'} aria-current={selected === keyOf(item) ? 'true' : undefined} onClick={() => setSelected(keyOf(item))}><span>{item.origin}{item.archived ? ' · archiviert' : ''}</span><strong>{item.title}</strong><small>{item.reason}</small></button>)}</div>
        {candidate ? <div className="idea-match-review"><div className="idea-match-pair"><article><small>Aktuelle Idee</small><strong>{preview.idea.title}</strong><p>{preview.idea.body || 'Keine Notizen'}</p></article><article><small>{candidate.origin}{candidate.archived ? ' · archiviert' : ''}</small><strong>{candidate.title}</strong><p>{candidate.body || 'Keine Notizen'}</p></article></div><div className="idea-match-actions"><p>Verknüpfen ordnet die Quelle dieser Idee zu. Es ändert weder Texte noch Board-Karten und startet keinen Agenten.</p><button type="button" className="secondary-button" disabled={busy || dirty} onClick={() => void link()}><GitMerge size={15} aria-hidden="true" /> Als dieselbe Idee verknüpfen</button></div></div> : null}</div> : !preview.idea.mergedIntoIdeaId ? <p className="ideas-muted">Keine ähnlichen Titel gefunden. Das ist eine Wortprüfung, keine semantische Vollständigkeitsprüfung.</p> : null}
      {preview.idea.mergedIntoIdeaId ? <p className="ideas-muted">Diese Idee ist bereits einer Hauptidee zugeordnet. Öffne sie unten, um dort weitere Quellen zu prüfen.</p> : null}
    </> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice ? <p className="inline-note" role="status">{notice}</p> : null}
  </section>;
}
