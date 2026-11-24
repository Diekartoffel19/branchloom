import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Card } from '../../src/shared/types';
import { TaskWireframeEditor } from '../../src/renderer/components/TaskWireframeEditor';

const card = { id: 'card', title: 'Synthetischer Fensterentwurf' } as Card;

describe('wireframe focus entry', () => {
  it('keeps the exit control available while the preview is busy', () => {
    const enter = renderToStaticMarkup(<TaskWireframeEditor projectId="project" cards={[card]} startCardId="card" focusMode={false} canEnterFocus={false} onFocusModeChange={() => undefined} />);
    const exit = renderToStaticMarkup(<TaskWireframeEditor projectId="project" cards={[card]} startCardId="card" focusMode canEnterFocus={false} onFocusModeChange={() => undefined} />);
    expect(enter).toContain('Arbeitsfläche vergrößern');
    expect(enter).toContain('aria-pressed="false" disabled=""');
    expect(exit).toContain('Zur Design-Inspektion');
    expect(exit).toContain('aria-pressed="true"');
    expect(exit).not.toContain('aria-pressed="true" disabled=""');
  });

  it('keeps keyboard focus during an asynchronous transition while blocking repeated actions', () => {
    const html = renderToStaticMarkup(<TaskWireframeEditor projectId="project" cards={[card]} startCardId="card" focusMode focusPending canEnterFocus onFocusModeChange={() => undefined} />);
    expect(html).toContain('Zur Design-Inspektion');
    expect(html).toContain('aria-pressed="true" aria-disabled="true"');
    expect(html).not.toContain('aria-pressed="true" aria-disabled="true" disabled=""');
  });
});
