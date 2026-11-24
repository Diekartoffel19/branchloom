import { useEffect, useRef, useState } from 'react';
import type { WireframeArtboard, WireframeElement } from '../../shared/card-wireframe';
import { WIREFRAME_ARTBOARDS } from '../../shared/card-wireframe';
import type { WireframeComponent } from '../../shared/wireframe-components';
import './wireframe-components.css';

interface Props {
  projectId: string;
  cardId: string;
  artboard: WireframeArtboard;
  selection: WireframeElement[];
  availableSlots: number;
  disabled: boolean;
  onInsert: (component: WireframeComponent) => void;
}

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

export function WireframeComponentLibrary({ projectId, cardId, artboard, selection, availableSlots, disabled, onInsert }: Props) {
  const [components, setComponents] = useState<WireframeComponent[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setComponents([]); setError(''); setNotice(''); setRemoveId(null); setBusy(false);
    void window.studio.listWireframeComponents(projectId).then((result) => {
      if (generation.current === current) setComponents(result);
    }).catch((reason) => { if (generation.current === current) setError(messageOf(reason)); });
    return () => { generation.current++; };
  }, [projectId, cardId]);

  async function save() {
    if (busy || disabled || !selection.length || !name.trim()) return;
    const current = generation.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await window.studio.saveWireframeComponent({ projectId, cardId, name, sourceArtboard: artboard, elements: selection });
      if (generation.current !== current) return;
      setComponents((items) => [result, ...items]); setName('');
      setNotice(`„${result.name}“ ist im Projekt gespeichert. Eingefügte Kopien bleiben unabhängig.`);
    } catch (reason) { if (generation.current === current) setError(messageOf(reason)); }
    finally { if (generation.current === current) setBusy(false); }
  }

  async function remove(id: string) {
    if (busy || disabled || removeId !== id) return;
    const current = generation.current;
    setBusy(true); setError(''); setNotice('');
    try {
      await window.studio.removeWireframeComponent({ projectId, id });
      if (generation.current !== current) return;
      setComponents((items) => items.filter((item) => item.id !== id)); setRemoveId(null);
      setNotice('Baustein aus der Projektbibliothek entfernt. Bereits eingefügte Kopien bleiben erhalten.');
    } catch (reason) { if (generation.current === current) setError(messageOf(reason)); }
    finally { if (generation.current === current) setBusy(false); }
  }

  return <details className="task-wireframe-components">
    <summary>Bausteine <span>{components.length}</span></summary>
    <div className="task-wireframe-components-body">
      <p>Speichere eine Auswahl für andere Karten und Zeichenflächen dieses Projekts. Eingefügte Elemente sind unabhängige Kopien.</p>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>Name<input aria-label="Name des Designbausteins" maxLength={80} value={name} disabled={busy || disabled} onChange={(event) => setName(event.target.value)} placeholder="z. B. Navigationskopf" /></label>
        <button type="submit" className="secondary-button small" disabled={busy || disabled || !selection.length || !name.trim()}>Auswahl speichern</button>
      </form>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {components.length ? <ul>{components.map((component) => <li key={component.id}>
        <div><strong>{component.name}</strong><small>{component.elements.length} {component.elements.length === 1 ? 'Element' : 'Elemente'} · {WIREFRAME_ARTBOARDS[component.sourceArtboard].label} · {component.width} × {component.height}</small></div>
        <div className="task-wireframe-component-actions">
          <button type="button" className="secondary-button small" disabled={busy || disabled || component.elements.length > availableSlots} onClick={() => onInsert(component)}>Einfügen</button>
          {removeId === component.id ? <><button type="button" className="secondary-button small" disabled={busy || disabled} onClick={() => void remove(component.id)}>Entfernen bestätigen</button><button type="button" className="secondary-button small" disabled={busy} onClick={() => setRemoveId(null)}>Abbrechen</button></> : <button type="button" className="secondary-button small" disabled={busy || disabled} onClick={() => setRemoveId(component.id)}>Entfernen</button>}
        </div>
      </li>)}</ul> : <p>Noch keine Bausteine in diesem Projekt.</p>}
    </div>
  </details>;
}
