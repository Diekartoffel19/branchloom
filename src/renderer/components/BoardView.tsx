import { useEffect, useMemo, useState } from 'react';
import { Archive, ArrowRight, Bot, FileJson2, GripVertical, Plus, Search, Terminal, X } from 'lucide-react';
import type { Card, Column, ProjectSnapshot } from '../../shared/types';
import type { Mutate } from './shared';
import { CardPanel } from './CardPanel';
import { TrelloImportPanel } from './TrelloImportPanel';
import { filterBoardCards, type BoardVisibility } from '../board-filters';

interface Props { snapshot: ProjectSnapshot; mutate: Mutate; openCard?: { id: string; token: number } | null }

export function BoardView({ snapshot, mutate, openCard }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [newColumn, setNewColumn] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [query, setQuery] = useState('');
  const [filterColumnId, setFilterColumnId] = useState('');
  const [visibility, setVisibility] = useState<BoardVisibility>('active');
  const columns = useMemo(() => [...snapshot.columns].sort((a, b) => a.position - b.position), [snapshot.columns]);
  const visibleCards = useMemo(() => filterBoardCards(snapshot.cards, { query, columnId: filterColumnId, visibility }), [snapshot.cards, query, filterColumnId, visibility]);
  const visibleColumns = filterColumnId ? columns.filter((column) => column.id === filterColumnId) : columns;
  const archivedCount = snapshot.cards.filter((card) => card.archivedAt).length;
  const selected = snapshot.cards.find((card) => card.id === selectedId) ?? null;

  useEffect(() => { if (openCard && snapshot.cards.some((card) => card.id === openCard.id)) setSelectedId(openCard.id); }, [openCard?.id, openCard?.token, snapshot.project.id]);

  async function addCard(event: React.FormEvent<HTMLFormElement>, columnId: string) {
    event.preventDefault();
    const created = await mutate(() => window.studio.createCard({ projectId: snapshot.project.id, columnId, title: title.trim() }));
    if (created) { setCreatingIn(null); setTitle(''); setSelectedId(created.id); }
  }

  async function addColumn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await mutate(() => window.studio.createColumn({ projectId: snapshot.project.id, name: newColumn.trim() }));
    if (created) setNewColumn('');
  }

  function onDrop(event: React.DragEvent<HTMLElement>, columnId: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/card-id');
    const card = snapshot.cards.find((item) => item.id === id);
    if (card && !card.archivedAt && card.columnId !== columnId) void mutate(() => window.studio.moveCard({ id, columnId }));
  }

  return <div className="board-page">
    <div className="view-header"><div><div className="eyebrow">DEIN ARBEITSFLUSS</div><h2>Alle Aufgaben auf einen Blick</h2><p>Ziehe Karten zwischen Spalten oder öffne eine Karte für Agenten und Details.</p></div><div className="board-header-actions"><button className="secondary-button" type="button" onClick={() => setShowImport(true)}><FileJson2 size={16} /> Trello-JSON importieren</button><div className="header-stat"><strong>{snapshot.cards.length - archivedCount}</strong><span>Aktive Karten</span></div></div></div>
    <div className="board-filters"><label className="board-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Karten suchen…" aria-label="Karten suchen" /></label><label><span className="sr-only">Spalte filtern</span><select value={filterColumnId} onChange={(event) => setFilterColumnId(event.target.value)} aria-label="Spalte filtern"><option value="">Alle Spalten</option>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label><label><span className="sr-only">Archivstatus filtern</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as BoardVisibility)} aria-label="Archivstatus filtern"><option value="active">Aktive Karten</option><option value="archived">Archiv ({archivedCount})</option><option value="all">Alle Karten</option></select></label><span className="board-filter-count">{visibleCards.length} Treffer</span></div>
    <div className="board-scroll"><div className="board-columns">
      {visibleColumns.map((column) => <BoardColumn key={column.id} column={column} cards={visibleCards.filter((card) => card.columnId === column.id).sort((a, b) => a.position - b.position)} snapshot={snapshot} onSelect={setSelectedId} onDrop={onDrop} onCreate={() => { setCreatingIn(column.id); setTitle(''); }} canCreate={visibility !== 'archived'} mutate={mutate}>
        {creatingIn === column.id && visibility !== 'archived' ? <form className="new-card-form" onSubmit={(event) => void addCard(event, column.id)}><input autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Aufgabe benennen…" aria-label="Neue Karte" /><div className="inline-actions"><button className="primary-button small" type="submit">Hinzufügen</button><button className="icon-button" type="button" onClick={() => setCreatingIn(null)} aria-label="Abbrechen"><X size={15} /></button></div></form> : null}
      </BoardColumn>)}
      {visibility !== 'archived' && !filterColumnId ? <form className="new-column-form" onSubmit={(event) => void addColumn(event)}><span><Plus size={17} /> Spalte hinzufügen</span><input value={newColumn} onChange={(event) => setNewColumn(event.target.value)} placeholder="Spaltenname" aria-label="Neue Spalte" maxLength={80} required /><button className="secondary-button small" type="submit">Erstellen</button></form> : null}
    </div></div>
    {selected ? <CardPanel card={selected} snapshot={snapshot} mutate={mutate} onClose={() => setSelectedId(null)} /> : null}
    {showImport ? <TrelloImportPanel projectId={snapshot.project.id} columns={columns} mutate={mutate} onClose={() => setShowImport(false)} /> : null}
  </div>;
}

function BoardColumn({ column, cards, snapshot, onSelect, onDrop, onCreate, canCreate, mutate, children }: {
  column: Column; cards: Card[]; snapshot: ProjectSnapshot; onSelect: (id: string) => void;
  onDrop: (event: React.DragEvent<HTMLElement>, columnId: string) => void;
  onCreate: () => void; canCreate: boolean; mutate: Mutate; children: React.ReactNode;
}) {
  const agent = snapshot.agents.find((item) => item.id === column.agentId);
  return <section className="board-column" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, column.id)} aria-label={`Spalte ${column.name}`}>
    <header className="column-header"><div className="column-title"><span className="column-indicator" /><h3>{column.name}</h3><span className="count-pill">{cards.length}</span></div>{canCreate ? <button className="icon-button" type="button" aria-label={`Karte in ${column.name} hinzufügen`} onClick={onCreate}><Plus size={17} /></button> : null}</header>
    <div className="column-body">
      {column.autoStart ? <div className="column-agent"><Bot size={13} /><span>Auto · {agent?.name ?? 'Kein Agent'}</span></div> : null}
      {cards.map((card) => {
        const sessions = snapshot.sessions.filter((session) => session.cardId === card.id);
        const active = sessions.some((session) => session.state === 'running');
        return <button key={card.id} type="button" draggable={!card.archivedAt} onDragStart={(event) => { if (!card.archivedAt) event.dataTransfer.setData('text/card-id', card.id); }} className={card.archivedAt ? 'task-card archived' : 'task-card'} onClick={() => onSelect(card.id)}><span className="task-card-grip">{card.archivedAt ? <Archive size={15} /> : <GripVertical size={15} />}</span><strong>{card.title}</strong>{card.archivedAt ? <span className="task-card-archive-label">Archiviert</span> : null}{card.description ? <span className="task-card-description">{card.description}</span> : null}<span className="task-card-footer"><span>{active ? <><span className="live-dot" /> Agent läuft</> : sessions.length > 0 ? <><Terminal size={13} /> {sessions.length} Lauf{sessions.length === 1 ? '' : 'e'}</> : 'Noch kein Lauf'}</span><ArrowRight size={14} /></span></button>;
      })}
      {children}
      {cards.length === 0 && !children ? <p className="empty-column">Karten hierher ziehen</p> : null}
    </div>
    <footer className="column-footer"><label><input type="checkbox" checked={column.autoStart} onChange={(event) => void mutate(() => window.studio.updateColumn({ id: column.id, autoStart: event.target.checked }))} /> Agent automatisch starten</label>{column.autoStart ? <select aria-label={`Agent für ${column.name}`} value={column.agentId ?? ''} onChange={(event) => void mutate(() => window.studio.updateColumn({ id: column.id, agentId: event.target.value || null }))}><option value="">Agent wählen</option>{snapshot.agents.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}</footer>
  </section>;
}
