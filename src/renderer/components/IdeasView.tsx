import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Lightbulb, Plus, Save, Send } from 'lucide-react';
import type { DraftTurn } from '../../shared/task-draft';
import type { Idea, IdeaCategory, IdeaReply } from '../../shared/ideas';
import type { ProjectSnapshot } from '../../shared/types';
import type { Mutate } from './shared';
import { TrelloImportPanel } from './TrelloImportPanel';
import { IdeaMatchPanel } from './IdeaMatchPanel';
import './ideas.css';

type Draft = Pick<Idea, 'id' | 'title' | 'body' | 'category' | 'turns' | 'cardId'>;
const emptyDraft = (): Draft => ({ id: '', title: '', body: '', category: 'idea', turns: [], cardId: null });
const labels: Record<IdeaCategory, string> = { idea: 'Idee', backlog: 'Backlog', roadmap: 'Roadmap' };
const categories: IdeaCategory[] = ['idea', 'backlog', 'roadmap'];
const signature = (value: Draft): string => JSON.stringify(value);
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

interface Props { snapshot: ProjectSnapshot; mutate: Mutate; onOpenCard: (id: string) => void }

export function IdeasView({ snapshot, mutate, onOpenCard }: Props) {
  const projectId = snapshot.project.id;
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [baseline, setBaseline] = useState(signature(emptyDraft()));
  const [filter, setFilter] = useState<IdeaCategory | 'all'>('all');
  const [message, setMessage] = useState('');
  const [suggestion, setSuggestion] = useState<IdeaReply | null>(null);
  const [columnId, setColumnId] = useState(snapshot.columns.find((item) => item.name.toLocaleLowerCase('de-DE') === 'to do')?.id ?? snapshot.columns[0]?.id ?? '');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showTrelloImport, setShowTrelloImport] = useState(false);
  const dirty = signature(draft) !== baseline;
  const mergedIntoIdeaId = ideas.find((item) => item.id === draft.id)?.mergedIntoIdeaId ?? null;
  const visible = useMemo(() => filter === 'all' ? ideas : ideas.filter((item) => item.category === filter), [ideas, filter]);

  useEffect(() => {
    let active = true;
    window.studio.ideas(projectId).then((items) => { if (active) setIdeas(items); })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  function switchTo(item?: Idea) {
    if (busy) return;
    if (dirty && !window.confirm('Nicht gespeicherte Änderungen an dieser Idee verwerfen?')) return;
    const next = item ? { id: item.id, title: item.title, body: item.body, category: item.category, turns: item.turns, cardId: item.cardId } : emptyDraft();
    setDraft(next);
    setBaseline(signature(next));
    setSuggestion(null);
    setMessage('');
    setError('');
    setNotice('');
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft.title.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await window.studio.saveIdea({ projectId, id: draft.id || undefined, title: draft.title, body: draft.body, category: draft.category, turns: draft.turns });
      const next: Draft = { id: saved.id, title: saved.title, body: saved.body, category: saved.category, turns: saved.turns, cardId: saved.cardId };
      setDraft(next); setBaseline(signature(next)); setNotice('Idee lokal gespeichert.');
      setIdeas(await window.studio.ideas(projectId));
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function ask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !message.trim()) return;
    const next: DraftTurn[] = [...draft.turns.slice(-10), { role: 'user', text: message.trim() }];
    while (next.length > 1 && next.reduce((size, turn) => size + turn.text.length, 0) > 16_000) next.shift();
    setBusy(true); setError(''); setNotice('');
    try {
      const answer = await window.studio.discussIdea({ projectId, turns: next, title: draft.title, body: draft.body, category: draft.category });
      setDraft((old) => ({ ...old, turns: [...next, { role: 'assistant', text: answer.reply }] }));
      setSuggestion(answer);
      setMessage('');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function convert() {
    if (busy || !draft.id || dirty || draft.cardId || !columnId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const card = await mutate(() => window.studio.convertIdeaToCard({ projectId, ideaId: draft.id, columnId }));
      if (!card) { setError('Die Karte konnte nicht angelegt werden.'); return; }
      const refreshed = await window.studio.ideas(projectId);
      setIdeas(refreshed);
      const selected = refreshed.find((item) => item.id === draft.id);
      if (selected) {
        const next = { id: selected.id, title: selected.title, body: selected.body, category: selected.category, turns: selected.turns, cardId: selected.cardId };
        setDraft(next); setBaseline(signature(next));
      }
      setNotice('Karte angelegt. Ein Agent wurde dadurch nicht gestartet.');
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  return <section className="ideas-page" aria-label="Ideenraum">
    <header className="ideas-heading"><div><span className="ideas-kicker"><Lightbulb size={15} /> Offene Gedanken</span><h2>Ideenraum</h2><p>Besprich eine Idee, halte sie fest und entscheide später, ob daraus eine Board-Karte wird.</p></div><div className="ideas-heading-actions"><button className="secondary-button" type="button" onClick={() => setShowTrelloImport(true)} disabled={busy || dirty} title={dirty ? 'Speichere die aktuelle Idee vor dem Trello-Abgleich.' : undefined}>Aus Trello vormerken</button><button className="secondary-button" type="button" onClick={() => switchTo()} disabled={busy}><Plus size={16} /> Neue Idee</button></div></header>
    <div className="ideas-layout">
      <aside className="ideas-list" aria-label="Gespeicherte Ideen"><div className="ideas-list-heading"><strong>Sammlung</strong><span>{ideas.length}</span></div>
        <label className="ideas-filter">Anzeigen<select value={filter} onChange={(event) => setFilter(event.target.value as IdeaCategory | 'all')}><option value="all">Alle Bereiche</option>{categories.map((category) => <option key={category} value={category}>{labels[category]}</option>)}</select></label>
        {loading ? <p className="ideas-muted">Ideen werden geladen…</p> : visible.length === 0 ? <p className="ideas-muted">Hier ist noch Platz für den ersten Gedanken.</p> : <div className="ideas-list-items">{visible.map((item) => <button className={`ideas-list-item ${item.id === draft.id ? 'selected' : ''}`} aria-current={item.id === draft.id ? 'true' : undefined} type="button" disabled={busy} key={item.id} onClick={() => switchTo(item)}><span className="ideas-category">{labels[item.category]}</span><strong>{item.title}</strong><small>{item.cardId ? 'Board-Karte angelegt' : item.mergedIntoIdeaId ? 'Mit anderer Idee verbunden' : 'Noch keine Board-Karte'}</small></button>)}</div>}
      </aside>
      <div className="ideas-workspace">
        <form className="ideas-editor" onSubmit={(event) => void save(event)}><div className="ideas-panel-heading"><div><span className="ideas-kicker">{draft.id ? 'Gespeicherte Idee' : 'Neuer Entwurf'}</span><h3>Gedanken festhalten</h3></div><span className="ideas-dirty">{dirty ? 'Ungespeichert' : draft.id ? 'Gespeichert' : 'Noch leer'}</span></div>
          <label>Titel<input required maxLength={160} value={draft.title} disabled={busy} onChange={(event) => setDraft((old) => ({ ...old, title: event.target.value }))} placeholder="Worum geht es?" /></label>
          <label>Notizen<textarea rows={8} maxLength={8_000} value={draft.body} disabled={busy} onChange={(event) => setDraft((old) => ({ ...old, body: event.target.value }))} placeholder="Problem, Idee, offene Fragen …" /></label>
          <label>Bereich<select value={draft.category} disabled={busy} onChange={(event) => setDraft((old) => ({ ...old, category: event.target.value as IdeaCategory }))}>{categories.map((category) => <option key={category} value={category}>{labels[category]}</option>)}</select></label>
          {suggestion && (suggestion.suggestedTitle || suggestion.suggestedBody) ? <div className="ideas-suggestion"><strong>Vorschlag des Agenten</strong>{suggestion.suggestedTitle ? <p>{suggestion.suggestedTitle}</p> : null}{suggestion.suggestedBody ? <small>{suggestion.suggestedBody}</small> : null}<button className="secondary-button" type="button" disabled={busy} onClick={() => { setDraft((old) => ({ ...old, title: suggestion.suggestedTitle || old.title, body: suggestion.suggestedBody || old.body, category: suggestion.suggestedCategory ?? old.category })); setSuggestion(null); }}>Vorschlag übernehmen</button></div> : null}
          <div className="ideas-actions"><button className="primary-button" type="submit" disabled={busy || !draft.title.trim()}><Save size={16} /> Idee speichern</button></div>
        </form>
        {draft.id ? <IdeaMatchPanel key={`matches-${draft.id}-${ideas.find((item) => item.id === draft.id)?.updatedAt ?? ''}`} projectId={projectId} ideaId={draft.id} dirty={dirty} onOpenIdea={(id) => { const item = ideas.find((entry) => entry.id === id); if (item) switchTo(item); }} onOpenCard={onOpenCard} onLinksChanged={async () => setIdeas(await window.studio.ideas(projectId))} /> : null}
        <section className="ideas-conversation" aria-label="Idee besprechen"><div className="ideas-panel-heading"><div><span className="ideas-kicker">Codex · nur auf Klick</span><h3>Weiterdenken</h3></div></div>
          <p className="ideas-disclosure">„Besprechen“ sendet Gespräch, editierbaren Titel, Notizen, Bereich, Projektname und das reguläre Projekt-README (maximal 12 KB) an den unter Workflows eingestellten Codex-Agenten. Andere Projektdateien werden hier nicht mitgegeben. Antworten ändern nichts automatisch.</p>
          <div className="ideas-turns" aria-live="polite">{draft.turns.length ? draft.turns.map((turn, index) => <div className={`ideas-turn ${turn.role}`} key={`${index}-${turn.role}`}><strong>{turn.role === 'user' ? 'Du' : 'Codex'}</strong><p>{turn.text}</p></div>) : <p className="ideas-muted">Was wäre, wenn? Beschreibe den Gedanken in deinen Worten.</p>}</div>
          <form className="ideas-ask" onSubmit={(event) => void ask(event)}><label>Nachricht<textarea rows={3} maxLength={4_000} value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)} placeholder="Lass uns diese Idee durchdenken …" /></label><button className="secondary-button" type="submit" disabled={busy || !message.trim()}><Send size={16} /> {busy ? 'Bitte warten…' : 'Besprechen'}</button></form>
        </section>
      </div>
    </div>
    <section className="ideas-convert" aria-label="Ins Board übernehmen"><div><span className="ideas-kicker">Nächster Schritt</span><h3>Aus Idee wird Aufgabe</h3><p>Erst dein Klick legt eine Karte an. Danach entscheidest du im Board über den Agentenlauf.</p></div>{draft.cardId ? <button className="secondary-button" type="button" onClick={() => onOpenCard(draft.cardId!)}>Karte öffnen <ArrowRight size={16} /></button> : mergedIntoIdeaId ? <button className="secondary-button" type="button" onClick={() => switchTo(ideas.find((item) => item.id === mergedIntoIdeaId))}>Hauptidee öffnen <ArrowRight size={16} /></button> : <div className="ideas-convert-controls"><label>Spalte<select value={columnId} disabled={busy || !draft.id || dirty} onChange={(event) => setColumnId(event.target.value)}>{snapshot.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><button className="secondary-button" type="button" onClick={() => void convert()} disabled={busy || !draft.id || dirty || !columnId}>Karte anlegen <ArrowRight size={16} /></button>{dirty ? <small>Speichere die Idee vor dem Übernehmen.</small> : null}</div>}</section>
    {error ? <p role="alert" className="ideas-feedback error">{error}</p> : null}
    {notice ? <p role="status" className="ideas-feedback">{notice}</p> : null}
    {showTrelloImport ? <TrelloImportPanel key={`ideas-${projectId}`} projectId={projectId} columns={snapshot.columns} mutate={mutate} destination="ideas" onIdeasImported={async () => {
      const refreshed = await window.studio.ideas(projectId);
      setIdeas(refreshed);
      const selected = refreshed.find((item) => item.id === draft.id);
      if (selected && !dirty) {
        const next: Draft = { id: selected.id, title: selected.title, body: selected.body, category: selected.category, turns: selected.turns, cardId: selected.cardId };
        setDraft(next); setBaseline(signature(next));
      }
    }} onClose={() => setShowTrelloImport(false)} /> : null}
  </section>;
}
