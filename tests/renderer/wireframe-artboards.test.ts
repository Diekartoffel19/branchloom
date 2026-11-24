import { describe, expect, it } from 'vitest';
import { copyDesktopToArtboard } from '../../src/renderer/components/wireframe-artboards';
import type { WireframeElement } from '../../src/shared/card-wireframe';

const edge: WireframeElement = { id: 'edge', kind: 'button', x: 880, y: 550, width: 80, height: 50, text: 'Weiter', tone: 'plain' };

describe('starting copies for smaller artboards', () => {
  it('fits horizontal geometry while preserving height, identity and source', () => {
    const source = [edge];
    const tablet = copyDesktopToArtboard(source, 'tablet');
    const mobile = copyDesktopToArtboard(source, 'mobile');
    expect(tablet[0]).toMatchObject({ id: 'edge', x: 704, y: 550, width: 64, height: 50 });
    expect(mobile[0]).toMatchObject({ id: 'edge', x: 358, y: 550, width: 32, height: 50 });
    expect(source).toEqual([edge]);
    expect(tablet[0]).not.toBe(edge);
  });
});
