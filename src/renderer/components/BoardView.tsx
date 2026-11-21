import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowRight, ArrowUp, Bot, FileJson2, GripVertical, Plus, Search, Terminal, X } from 'lucide-react';
import type { Card, CardPriority, Column, ColumnEffort, ProjectSnapshot } from '../../shared/types';
import { CARD_PRIORITIES } from '../../shared/card-metadata';
import { COLUMN_EFFORTS } from '../../shared/column-settings';
import type { Mutate } from './shared';
import { CardPanel } from './CardPanel';
import { TrelloImportPanel } from './TrelloImportPanel';
import { filterBoardCards, type BoardVisibility } from '../board-filters';
import '../board-metadata.css';
import '../board-order.css';
import '../column-settings.css';

interface Props { snapshot: ProjectSnapshot; mutate: Mutate; openCard?: { id: string; token: number } | null }

export function isMoveShortcut(event: Pick<React.KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): boolean {
  return event.key.toLocaleLowerCase() === 'm' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

export function moveDestinations(columns: Column[], card: Card): Column[] {
  return card.archivedAt ? [] : columns.filter((column) => column.id !== card.columnId);
}

export function BoardView({ snapshot, mutate, openCard }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [newColumn, setNewColumn] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [query, setQuery] = useState('');
  const [filterColumnId, setFilterColumnId] = useState('');
  const [visibility, setVisibility] = useState<BoardVisibility>('active');
  const [filterPriority, setFilterPriority] = useState<CardPriority | ''>('');
  const [filterLabel, setFilterLabel] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [focusMoved, setFocusMoved] = useState<{ cardId: string; columnId: string } | null>(null);
  const columns = useMemo(() => [...snapshot.columns].sort((a, b) => a.position - b.position), [snapshot.columns]);
  const visibleCards = useMemo(() => filterBoardCards(snapshot.cards, { query, columnId: filterColumnId, visibility, priority: filterPriority, label: filterLabel }), [snapshot.cards, query, filterColumnId, visibility, filterPriority, filterLabel]);
  const labels = useMemo(() => {
    const unique = new Map<string, string>();
    for (const card of snapshot.cards) for (const label of card.labels) {
      const key = label.toLocaleLowerCase('de-DE');
      if (!unique.has(key)) unique.set(key, label);
    }
    return [...unique.values()].sort((a, b) => a.localeCompare(b, 'de-DE'));
  }, [snapshot.cards]);
  const visibleColumns = filterColumnId ? columns.filter((column) => column.id === filterColumnId) : columns;
  const archivedCount = snapshot.cards.filter((card) => card.archivedAt).length;
  const selected = snapshot.cards.find((card) => card.id === selectedId) ?? null;

  useEffect(() => { if (filterLabel && !labels.some((label) => label.toLocaleLowerCase('de-DE') === filterLabel.toLocaleLowerCase('de-DE'))) setFilterLabel(''); }, [labels, filterLabel]);
  useEffect(() => { if (openCard && snapshot.cards.some((card) => card.id === openCard.id)) setSelectedId(openCard.id); }, [openCard?.id, openCard?.token, snapshot.project.id]);
  useEffect(() => {
    if (!focusMoved || snapshot.cards.find((card) => card.id === focusMoved.cardId)?.columnId !== focusMoved.columnId) return;
    const button = document.getElementById(`board-card-${focusMoved.cardId}`);
    if (button) { button.focus(); setFocusMoved(null); }
  }, [focusMoved, snapshot.cards, visibleCards, filterColumnId]);

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

  async function moveCard(card: Card, columnId: string): Promise<boolean> {
    if (card.archivedAt || card.columnId === columnId) return false;
    const destination = columns.find((column) => column.id === columnId);
    if (!destination) return false;
    const moved = await mutate(() => window.studio.moveCard({ id: card.id, columnId }));
    if (!moved) { setAnnouncement(`„${card.title}“ konnte nicht verschoben werden.`); return false; }
    setAnnouncement(`„${card.title}“ wurde nach „${destination.name}“ verschoben.${destination.autoStart && destination.agentId ? ' Der Spaltenagent wurde automatisch gestartet.' : ''}`);
    if (filterColumnId && filterColumnId !== columnId) setFilterColumnId('');
    setFocusMoved({ cardId: card.id, columnId });
    return true;
  }

  async function reorderCard(card: Card, direction: 'up' | 'down'): Promise<void> {
    if (card.archivedAt) return;
    const changed = await mutate(() => window.studio.reorderCard({ id: card.id, direction }));
    setAnnouncement(changed
      ? `„${card.title}“ wurde in „${columns.find((item) => item.id === card.columnId)?.name ?? 'der Spalte'}“ ${direction === 'up' ? 'nach oben' : 'nach unten'} gesetzt.`
      : `Die Reihenfolge von „${card.title}“ konnte nicht geändert werden.`);
  }

  function onDrop(event: React.DragEvent<HTMLElement>, columnId: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/card-id');
    const card = snapshot.cards.find((item) => item.id === id);
    if (card && !card.archivedAt && card.columnId !== columnId) void moveCard(card, columnId);
  }

  return <div className="board-page">
    <div className="view-header"><div><div className="eyebrow">DEIN ARBEITSFLUSS</div><h2>Alle Aufgaben auf einen Blick</h2><p>Ziehe Karten zwischen Spalten oder öffne eine Karte für Agenten und Details.</p></div><div className="board-header-actions"><button className="secondary-button" type="button" onClick={() => setShowImport(true)}><FileJson2 size={16} /> Trello-JSON importieren</button><div className="header-stat"><strong>{snapshot.cards.length - archivedCount}</strong><span>Aktive Karten</span></div></div></div>
    <div className="board-filters" role="search" aria-label="Board-Filter">
      <label className="board-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Karten suchen…" aria-label="Karten suchen" aria-describedby="board-filter-help" /></label>
      <label><span className="sr-only">Spalte filtern</span><select value={filterColumnId} onChange={(event) => setFilterColumnId(event.target.value)} aria-label="Spalte filtern"><option value="">Alle Spalten</option>{columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}</select></label>
      <label><span className="sr-only">Archivstatus filtern</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as BoardVisibility)} aria-label="Archivstatus filtern"><option value="active">Aktive Karten</option><option value="archived">Archiv ({archivedCount})</option><option value="all">Alle Karten</option></select></label>
      <label><span className="sr-only">Priorität filtern</span><select value={filterPriority} onChange={(event) => setFilterPriority(event.target.value as CardPriority | '')} aria-label="Priorität filtern"><option value="">Alle Prioritäten</option>{CARD_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label><span className="sr-only">Label filtern</span><select value={filterLabel} onChange={(event) => setFilterLabel(event.target.value)} aria-label="Label filtern"><option value="">Alle Labels</option>{labels.map((label) => <option key={label} value={label}>{label}</option>)}</select></label>
      <span className="board-filter-count" role="status" aria-live="polite">{visibleCards.length} Treffer</span>
      <span id="board-filter-help" className="sr-only">Karten mit Tab erreichen. Enter öffnet Details, M öffnet die Verschiebeauswahl. Pfeiltasten-Schaltflächen ändern die Reihenfolge innerhalb der vollständigen Spalte, auch wenn Karten ausgefiltert sind. Archivierte Karten bleiben an ihrem Platz.</span>
    </div>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    <div className="board-scroll"><div className="board-columns">
      {visibleColumns.map((column) => <BoardColumn key={column.id} column={column} columns={columns} cards={visibleCards.filter((card) => card.columnId === column.id).sort(compareCardOrder)} snapshot={snapshot} onSelect={setSelectedId} onMove={moveCard} onReorder={reorderCard} onDrop={onDrop} onCreate={() => { setCreatingIn(column.id); setTitle(''); }} canCreate={visibility !== 'archived'} mutate={mutate}>
        {creatingIn === column.id && visibility !== 'archived' ? <form className="new-card-form" onSubmit={(event) => void addCard(event, column.id)}><input autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Aufgabe benennen…" aria-label="Neue Karte" /><div className="inline-actions"><button className="primary-button small" type="submit">Hinzufügen</button><button className="icon-button" type="button" onClick={() => setCreatingIn(null)} aria-label="Abbrechen"><X size={15} /></button></div></form> : null}
      </BoardColumn>)}
      {visibility !== 'archived' && !filterColumnId ? <form className="new-column-form" onSubmit={(event) => void addColumn(event)}><span><Plus size={17} /> Spalte hinzufügen</span><input value={newColumn} onChange={(event) => setNewColumn(event.target.value)} placeholder="Spaltenname" aria-label="Neue Spalte" maxLength={80} required /><button className="secondary-button small" type="submit">Erstellen</button></form> : null}
    </div></div>
    {selected ? <CardPanel card={selected} snapshot={snapshot} mutate={mutate} onClose={() => setSelectedId(null)} /> : null}
    {showImport ? <TrelloImportPanel projectId={snapshot.project.id} columns={columns} mutate={mutate} onClose={() => setShowImport(false)} /> : null}
  </div>;
}

function compareCardOrder(a: Card, b: Card): number {
  return a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function BoardColumn({ column, columns, cards, snapshot, onSelect, onMove, onReorder, onDrop, onCreate, canCreate, mutate, children }: {
  column: Column; columns: Column[]; cards: Card[]; snapshot: ProjectSnapshot; onSelect: (id: string) => void;
  onMove: (card: Card, columnId: string) => Promise<boolean>;
  onReorder: (card: Card, direction: 'up' | 'down') => Promise<void>;
  onDrop: (event: React.DragEvent<HTMLElement>, columnId: string) => void;
  onCreate: () => void; canCreate: boolean; mutate: Mutate; children: React.ReactNode;
}) {
  const agent = snapshot.agents.find((item) => item.id === column.agentId);
  const activeOrder = snapshot.cards.filter((card) => card.columnId === column.id && !card.archivedAt).sort(compareCardOrder);
  return <section className="board-column" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, column.id)} aria-label={`Spalte ${column.name}`}>
    <header className="column-header"><div className="column-title"><span className="column-indicator" /><h3>{column.name}</h3><span className="count-pill">{cards.length}</span></div>{canCreate ? <button className="icon-button" type="button" aria-label={`Karte in ${column.name} hinzufügen`} onClick={onCreate}><Plus size={17} /></button> : null}</header>
    <div className="column-body">
      {agent ? <div className="column-agent"><Bot size={13} /><span>{column.autoStart ? 'Auto' : 'Manuell'} · {agent.name}{column.model ? ` · ${column.model}` : ''}{column.effort ? ` · ${column.effort}` : ''}</span></div> : null}
      {cards.map((card) => {
        const index = activeOrder.findIndex((item) => item.id === card.id);
        return <BoardCard key={card.id} card={card} column={column} columns={columns} snapshot={snapshot} onSelect={onSelect} onMove={onMove} onReorder={onReorder} previousTitle={index > 0 ? activeOrder[index - 1]?.title : undefined} nextTitle={index >= 0 ? activeOrder[index + 1]?.title : undefined} />;
      })}
      {children}
      {cards.length === 0 && !children ? <p className="empty-column">Karten hierher ziehen</p> : null}
    </div>
    <footer className="column-footer"><ColumnAgentSettings column={column} agents={snapshot.agents} mutate={mutate} /><label><input type="checkbox" checked={column.autoStart} disabled={!column.agentId} onChange={(event) => void mutate(() => window.studio.updateColumn({ id: column.id, autoStart: event.target.checked }))} /> Agent automatisch starten</label></footer>
  </section>;
}

export function ColumnAgentSettings({ column, agents, mutate }: { column: Column; agents: ProjectSnapshot['agents']; mutate: Mutate }) {
  const [agentId, setAgentId] = useState(column.agentId ?? '');
  const [model, setModel] = useState(column.model ?? '');
  const [effort, setEffort] = useState<ColumnEffort | ''>(column.effort ?? '');
  useEffect(() => { setAgentId(column.agentId ?? ''); setModel(column.model ?? ''); setEffort(column.effort ?? ''); }, [column.id, column.agentId, column.model, column.effort]);
  const selectedAgent = agents.find((item) => item.id === agentId);
  const modelSupported = selectedAgent && selectedAgent.kind !== 'custom';
  const effortSupported = selectedAgent?.kind === 'codex';
  const changed = agentId !== (column.agentId ?? '') || (modelSupported ? model : '') !== (column.model ?? '') || (effortSupported ? effort : '') !== (column.effort ?? '');

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await mutate(() => window.studio.updateColumn({ id: column.id, agentId: agentId || null, autoStart: agentId ? column.autoStart : false, model: modelSupported ? model.trim() || null : null, effort: effortSupported && effort ? effort : null }));
  }

  return <form className="column-settings" onSubmit={(event) => void save(event)}>
    <label>Agent<select aria-label={`Agent für ${column.name}`} value={agentId} onChange={(event) => { setAgentId(event.target.value); setModel(''); setEffort(''); }}><option value="">Manueller Schritt</option>{agents.filter((item) => item.enabled || item.id === agentId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Modell<input aria-label={`Modell für ${column.name}`} value={model} maxLength={200} disabled={!modelSupported} onChange={(event) => setModel(event.target.value)} placeholder={selectedAgent?.model || 'CLI-/Profilstandard'} /></label>
    <label>Effort<select aria-label={`Effort für ${column.name}`} value={effort} disabled={!effortSupported} onChange={(event) => setEffort(event.target.value as ColumnEffort | '')}><option value="">Modellstandard</option>{COLUMN_EFFORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <small>{!selectedAgent ? 'Wähle einen Agenten. Modell und Effort bleiben sonst leer.' : selectedAgent.kind === 'custom' ? 'Eigene CLI: Modellargumente im Agentenprofil setzen.' : selectedAgent.kind !== 'codex' ? 'Effort ist derzeit nur für Codex CLI verfügbar.' : 'Verfügbare Effort-Stufen hängen vom gewählten Codex-Modell ab.'} Ein Workflow-Schritt mit einem anderen Agenten nutzt dessen Profilwerte.</small>
    <button className="secondary-button small" type="submit" disabled={!changed}>Agent-Einstellungen speichern</button>
  </form>;
}

function BoardCard({ card, column, columns, snapshot, onSelect, onMove, onReorder, previousTitle, nextTitle }: {
  card: Card; column: Column; columns: Column[]; snapshot: ProjectSnapshot;
  onSelect: (id: string) => void; onMove: (card: Card, columnId: string) => Promise<boolean>;
  onReorder: (card: Card, direction: 'up' | 'down') => Promise<void>;
  previousTitle?: string; nextTitle?: string;
}) {
  const destinations = moveDestinations(columns, card);
  const [moveOpen, setMoveOpen] = useState(false);
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? '');
  const [moving, setMoving] = useState(false);
  const [reordering, setReordering] = useState(false);
  const cardButton = useRef<HTMLButtonElement>(null);
  const destinationSelect = useRef<HTMLSelectElement>(null);
  const sessions = snapshot.sessions.filter((session) => session.cardId === card.id);
  const active = sessions.some((session) => session.state === 'running');
  const destination = destinations.find((item) => item.id === destinationId);
  const destinationAgent = snapshot.agents.find((item) => item.id === destination?.agentId);
  const priority = CARD_PRIORITIES.find((item) => item.value === card.priority);

  useEffect(() => { if (moveOpen) destinationSelect.current?.focus(); }, [moveOpen]);
  useEffect(() => { if (destinations.length && !destinations.some((item) => item.id === destinationId)) setDestinationId(destinations[0]!.id); }, [columns, card.columnId, card.archivedAt, destinationId]);

  function closeMove() {
    setMoveOpen(false);
    requestAnimationFrame(() => cardButton.current?.focus());
  }

  async function submitMove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!destination || moving) return;
    setMoving(true);
    const moved = await onMove(card, destination.id);
    setMoving(false);
    if (moved) setMoveOpen(false);
  }

  async function submitReorder(direction: 'up' | 'down') {
    if (reordering || card.archivedAt) return;
    setReordering(true);
    try { await onReorder(card, direction); }
    finally { setReordering(false); }
  }

  return <div className="board-card-wrap">
    <button ref={cardButton} id={`board-card-${card.id}`} type="button" draggable={!card.archivedAt} onDragStart={(event) => { if (!card.archivedAt) event.dataTransfer.setData('text/card-id', card.id); }} className={card.archivedAt ? 'task-card archived' : 'task-card'} aria-label={`Karte „${card.title}“ in „${column.name}“ öffnen${card.archivedAt ? ', archiviert' : ''}${active ? ', Agent läuft' : ''}`} aria-describedby={card.description ? `board-card-description-${card.id}` : undefined} aria-keyshortcuts={destinations.length ? 'M' : undefined} onKeyDown={(event) => { if (destinations.length && isMoveShortcut(event)) { event.preventDefault(); setMoveOpen(true); } }} onClick={() => onSelect(card.id)}>
      <span className="task-card-grip" aria-hidden="true">{card.archivedAt ? <Archive size={15} /> : <GripVertical size={15} />}</span>
      <strong>{card.title}</strong>
      {card.archivedAt ? <span className="task-card-archive-label">Archiviert</span> : null}
      {card.priority !== 'none' || card.labels.length > 0 ? <span className="task-card-metadata">
        {card.priority !== 'none' ? <span className={`card-priority ${card.priority}`}>{priority?.label ?? card.priority}</span> : null}
        {card.labels.slice(0, 3).map((label) => <span className="card-label" key={label}>{label}</span>)}
        {card.labels.length > 3 ? <span className="card-label" title={card.labels.slice(3).join(', ')}>+{card.labels.length - 3}</span> : null}
      </span> : null}
      {card.description ? <span className="task-card-description" id={`board-card-description-${card.id}`}>{card.description}</span> : null}
      <span className="task-card-footer"><span>{active ? <><span className="live-dot" /> Agent läuft</> : sessions.length > 0 ? <><Terminal size={13} /> {sessions.length} Lauf{sessions.length === 1 ? '' : 'e'}</> : 'Noch kein Lauf'}</span><ArrowRight size={14} aria-hidden="true" /></span>
    </button>
    {!card.archivedAt ? <div className="card-order-actions">
      <button type="button" disabled={!previousTitle || reordering} aria-label={`„${card.title}“ in „${column.name}“ nach oben setzen${previousTitle ? `, vor „${previousTitle}“` : ''}`} title={previousTitle ? `Vor „${previousTitle}“ setzen` : 'Bereits oben'} onClick={() => void submitReorder('up')}><ArrowUp size={14} aria-hidden="true" /></button>
      <button type="button" disabled={!nextTitle || reordering} aria-label={`„${card.title}“ in „${column.name}“ nach unten setzen${nextTitle ? `, hinter „${nextTitle}“` : ''}`} title={nextTitle ? `Hinter „${nextTitle}“ setzen` : 'Bereits unten'} onClick={() => void submitReorder('down')}><ArrowDown size={14} aria-hidden="true" /></button>
      {destinations.length ? <button className="card-move-trigger" type="button" aria-expanded={moveOpen} aria-controls={moveOpen ? `board-move-${card.id}` : undefined} onClick={() => setMoveOpen((old) => !old)}>Verschieben <kbd>M</kbd></button> : null}
    </div> : null}
    {moveOpen && destination ? <form className="card-move-form" id={`board-move-${card.id}`} onSubmit={(event) => void submitMove(event)} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMove(); } }}><label htmlFor={`board-destination-${card.id}`}>Zielspalte für „{card.title}“</label><select ref={destinationSelect} id={`board-destination-${card.id}`} value={destinationId} disabled={moving} onChange={(event) => setDestinationId(event.target.value)}>{destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{destination.autoStart && destination.agentId ? <p className="card-move-warning" id={`board-move-warning-${card.id}`}>Beim Verschieben versucht Jarvis, {destinationAgent?.name ?? 'den Spaltenagenten'} automatisch zu starten.</p> : null}<div className="card-move-actions"><button className="primary-button small" type="submit" disabled={moving} aria-describedby={destination.autoStart && destination.agentId ? `board-move-warning-${card.id}` : undefined}>Nach „{destination.name}“ verschieben</button><button className="secondary-button small" type="button" onClick={closeMove} disabled={moving}>Abbrechen</button></div></form> : null}
  </div>;
}
