import { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Columns3, GitBranch, Search, X } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import { projectSearchResults, type ProjectSearchResult } from '../project-search';

interface Props {
  snapshot: ProjectSnapshot;
  onClose: () => void;
  onNavigate: (result: ProjectSearchResult) => void;
}

const iconFor = { card: Columns3, note: BrainCircuit, workflow: GitBranch };

export function SearchPalette({ snapshot, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => projectSearchResults(snapshot, query), [snapshot, query]);
  const activeIndex = Math.min(selectedIndex, Math.max(0, results.length - 1));

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { document.getElementById(`search-result-${activeIndex}`)?.scrollIntoView({ block: 'nearest' }); }, [activeIndex, results]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex((index) => results.length ? (index + 1) % results.length : 0); inputRef.current?.focus(); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex((index) => results.length ? (index - 1 + results.length) % results.length : 0); inputRef.current?.focus(); return; }
    if (event.key === 'Enter' && document.activeElement === inputRef.current && results[activeIndex]) { event.preventDefault(); onNavigate(results[activeIndex]); return; }
    if (event.key === 'Tab' && dialogRef.current) {
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])')];
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  return <div className="search-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="search-dialog" role="dialog" aria-modal="true" aria-labelledby="search-title" ref={dialogRef} onKeyDown={onKeyDown}>
      <div className="search-topline"><span id="search-title">Projekt durchsuchen</span><span>{snapshot.project.name}</span><button type="button" className="icon-button" onClick={onClose} aria-label="Suche schließen"><X size={17} /></button></div>
      <div className="search-input-wrap"><Search size={21} /><input ref={inputRef} role="combobox" aria-expanded="true" aria-controls="project-search-results" aria-activedescendant={results.length ? `search-result-${activeIndex}` : undefined} aria-autocomplete="list" aria-label="Suchbegriff" placeholder="Karten, Notizen und Workflows suchen…" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }} /></div>
      <div className="search-results" id="project-search-results" role="listbox" aria-label="Suchergebnisse">
        <div className="search-results-title">{query.trim() ? `${results.length} Treffer` : 'Zuletzt geändert'}</div>
        {results.map((result, index) => { const Icon = iconFor[result.kind]; return <button key={`${result.kind}:${result.id}`} id={`search-result-${index}`} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'search-result active' : 'search-result'} onMouseEnter={() => setSelectedIndex(index)} onClick={() => onNavigate(result)}><span className="search-result-icon"><Icon size={17} /></span><span className="search-result-copy"><strong>{result.title}</strong><small>{result.context}{result.snippet ? ` · ${result.snippet}` : ''}</small></span></button>; })}
        {results.length === 0 ? <div className="search-no-results">{query.trim() ? 'Keine Treffer in diesem Projekt.' : 'Noch keine Karten, Notizen oder Workflows.'}</div> : null}
      </div>
      <div className="search-footer"><span>↑ ↓ auswählen · Enter öffnen · Esc schließen</span><span>Strg/⌘ K</span></div>
    </div>
  </div>;
}
