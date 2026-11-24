import type { CardWireframe, WireframeArtboard, WireframeElement } from '../../shared/card-wireframe';
import { WIREFRAME_ARTBOARDS, wireframeColorCss } from '../../shared/card-wireframe';
import { wireframePreviewFontSize } from './wireframe-editing';

interface Props {
  elements: CardWireframe['elements'];
  artboards: CardWireframe['artboards'];
  active: WireframeArtboard;
  disabled: boolean;
  onSelect: (artboard: WireframeArtboard) => void;
}

/** A read-only overview. Editing still happens on the selected artboard below. */
export function WireframeArtboardOverview({ elements, artboards, active, disabled, onSelect }: Props) {
  return <div className="task-wireframe-overview" role="group" aria-label="Zeichenflächen im Überblick">
    {(Object.keys(WIREFRAME_ARTBOARDS) as WireframeArtboard[]).map((name) => {
      const canvas = WIREFRAME_ARTBOARDS[name];
      const items: WireframeElement[] | undefined = name === 'desktop' ? elements : artboards[name];
      const present = items !== undefined;
      const countLabel = present ? `${items.length} ${items.length === 1 ? 'Element' : 'Elemente'}` : 'fehlt';
      return <button
        key={name}
        type="button"
        className={`task-wireframe-overview-card${active === name ? ' active' : ''}`}
        aria-pressed={active === name}
        aria-label={`${canvas.label}, ${canvas.width} × ${canvas.height}, ${countLabel}, öffnen`}
        disabled={disabled}
        onClick={() => onSelect(name)}
      >
        <span className="task-wireframe-overview-title"><strong>{canvas.label}</strong><small>{canvas.width} × {canvas.height}</small></span>
        <span className={`task-wireframe-overview-surface${present ? '' : ' is-missing'}`} style={{ width: `${Math.round(72 * canvas.width / canvas.height)}px`, aspectRatio: `${canvas.width} / ${canvas.height}` }} aria-hidden="true">
          {items?.map((item) => <span key={item.id} className={`task-wireframe-overview-element kind-${item.kind} tone-${item.tone}`} style={{ left: `${item.x / canvas.width * 100}%`, top: `${item.y / canvas.height * 100}%`, width: `${item.width / canvas.width * 100}%`, height: `${item.height / canvas.height * 100}%`, backgroundColor: wireframeColorCss(item, 'fill'), borderColor: wireframeColorCss(item, 'stroke'), color: wireframeColorCss(item, 'textColor'), borderRadius: item.style?.radius, fontSize: wireframePreviewFontSize(item.style?.fontSize, canvas.width), fontWeight: item.style?.fontWeight }}>{item.text}</span>)}
        </span>
        <span className="task-wireframe-overview-status">{present ? countLabel : 'Noch kein Entwurf'}</span>
      </button>;
    })}
  </div>;
}
