import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { WireframeElement, WireframeInteraction } from '../../shared/card-wireframe';
import './wireframe-interaction.css';

const initial = (button: WireframeElement, panel: WireframeElement): WireframeInteraction => ({
  triggerElementId: button.id, panelElementId: panel.id, trigger: 'click', action: 'toggle-panel',
  durationMs: 240, enterOffsetPx: 24, closedOpacity: 0, reducedMotionDurationMs: 0,
  focusOnOpen: 'panel', focusOnClose: 'trigger',
});

export function WireframeInteractionEditor({ elements, interaction, disabled, onChange }: {
  elements: WireframeElement[]; interaction: WireframeInteraction | null; disabled: boolean;
  onChange: (next: WireframeInteraction | null) => void;
}) {
  const buttons = elements.filter((element) => element.kind === 'button');
  const panels = elements.filter((element) => element.kind === 'panel');
  const [open, setOpen] = useState(false);
  const [reduced, setReduced] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedButton = buttons.find((element) => element.id === interaction?.triggerElementId);
  const selectedPanel = panels.find((element) => element.id === interaction?.panelElementId);

  useEffect(() => { setOpen(false); }, [interaction?.triggerElementId, interaction?.panelElementId]);
  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);
  function close() { setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()); }
  const duration = reduced ? 0 : interaction?.durationMs ?? 0;
  const style = { '--interaction-duration': `${duration}ms`, '--interaction-offset': `${interaction?.enterOffsetPx ?? 0}px`, '--interaction-opacity': interaction?.closedOpacity ?? 0 } as CSSProperties;
  return <section className="wireframe-interaction" aria-label="Interaktion">
    <div className="wireframe-interaction-heading"><h3>Interaktion</h3><span>Entwurf · Desktop</span></div>
    <p>Ein Klick auf einen Knopf öffnet oder schließt eine Fläche. Die Auswahl und der Fokusablauf gehören zur nächsten Entwurfsversion.</p>
    {!interaction ? <button type="button" className="secondary-button small" disabled={disabled || !buttons.length || !panels.length} onClick={() => onChange(initial(buttons[0]!, panels[0]!))}>Klick → Fläche anlegen</button> : <>
      <div className="wireframe-interaction-fields">
        <label>Auslöser<select aria-label="Interaktion Auslöser" disabled={disabled} value={interaction.triggerElementId} onChange={(event) => onChange({ ...interaction, triggerElementId: event.target.value })}>{buttons.map((item) => <option key={item.id} value={item.id}>{item.text || 'Knopf'} · {item.id}</option>)}</select></label>
        <label>Zielfläche<select aria-label="Interaktion Zielfläche" disabled={disabled} value={interaction.panelElementId} onChange={(event) => onChange({ ...interaction, panelElementId: event.target.value })}>{panels.map((item) => <option key={item.id} value={item.id}>{item.text || 'Fläche'} · {item.id}</option>)}</select></label>
        <label>Dauer <output>{interaction.durationMs} ms</output><input aria-label="Interaktion Dauer" type="range" min={100} max={1000} step={20} disabled={disabled} value={interaction.durationMs} onChange={(event) => onChange({ ...interaction, durationMs: Number(event.target.value) })} /></label>
        <label>Versatz <output>{interaction.enterOffsetPx} px</output><input aria-label="Interaktion Versatz" type="range" min={0} max={80} step={4} disabled={disabled} value={interaction.enterOffsetPx} onChange={(event) => onChange({ ...interaction, enterOffsetPx: Number(event.target.value) })} /></label>
        <label>Startdeckkraft <output>{Math.round(interaction.closedOpacity * 100)} %</output><input aria-label="Interaktion Startdeckkraft" type="range" min={0} max={0.5} step={0.05} disabled={disabled} value={interaction.closedOpacity} onChange={(event) => onChange({ ...interaction, closedOpacity: Number(event.target.value) })} /></label>
      </div>
      <div className="wireframe-interaction-timing" aria-label="Zeitlicher Ablauf"><span>0 ms · Klick</span><span>{interaction.durationMs} ms · Fläche sichtbar</span></div>
      <p className="wireframe-interaction-focus">Fokusvorgabe: Beim Öffnen auf die Fläche; beim Schließen und mit Escape zurück auf den Auslöser. Reduzierte Bewegung: 0 ms.</p>
      <label className="wireframe-interaction-reduced"><input type="checkbox" checked={reduced} onChange={(event) => setReduced(event.target.checked)} />Reduzierte Bewegung vorschauen</label>
      <div className="wireframe-interaction-preview" style={style} aria-label="Interaktionsvorschau">
        <button ref={triggerRef} type="button" className="secondary-button small" aria-controls={panelId} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>{selectedButton?.text || 'Fläche umschalten'}</button>
        <div className={`wireframe-interaction-backdrop${open ? ' is-open' : ''}`} aria-hidden="true" />
        <div ref={panelRef} id={panelId} className={`wireframe-interaction-panel${open ? ' is-open' : ''}`} tabIndex={open ? -1 : undefined} role="region" aria-label={selectedPanel?.text || 'Geöffnete Fläche'} aria-hidden={!open} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
          <strong>{selectedPanel?.text || 'Fläche'}</strong><button type="button" className="secondary-button small" tabIndex={open ? 0 : -1} onClick={close}>Schließen</button>
        </div>
      </div>
      <button type="button" className="text-button" disabled={disabled} onClick={() => { close(); onChange(null); }}>Interaktion entfernen</button>
    </>}
    {!buttons.length || !panels.length ? <p className="wireframe-interaction-hint">Für eine Interaktion brauchst du im Desktop-Entwurf einen Knopf und eine Fläche.</p> : null}
  </section>;
}
