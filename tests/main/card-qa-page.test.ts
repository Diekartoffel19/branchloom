import { describe, expect, it } from 'vitest';
import { normalizePageSnapshot, pageObservationScript } from '../../src/main/card-qa-page';

const clean = { hasTitle: true, scannedImages: 4, imagesWithoutAlt: 0, imagesTruncated: false, clientWidth: 390, overflowPixels: 0 };

describe('bounded page observations', () => {
  it('reports only concrete document facts and ignores subpixel noise', () => {
    expect(normalizePageSnapshot({ ...clean, overflowPixels: 7 })).toEqual({ observations: [], partial: false });
    expect(normalizePageSnapshot({ ...clean, hasTitle: false, imagesWithoutAlt: 2, overflowPixels: 8 })).toEqual({ observations: [
      { kind: 'missing-title' }, { kind: 'missing-image-alt', count: 2, scanned: 4 }, { kind: 'horizontal-overflow', pixels: 8, clientWidth: 390 },
    ], partial: false });
    expect(normalizePageSnapshot({ ...clean, scannedImages: 200, imagesTruncated: true })).toEqual({ observations: [], partial: true });
  });

  it('rejects untrusted page values outside the bounded schema', () => {
    for (const value of [null, {}, { ...clean, imagesWithoutAlt: 5 }, { ...clean, scannedImages: 201 }, { ...clean, imagesTruncated: true },
      { ...clean, clientWidth: 0 }, { ...clean, overflowPixels: 1e9 }, { ...clean, hasTitle: 'yes' }]) {
      expect(() => normalizePageSnapshot(value)).toThrow();
    }
  });

  it('does not request page text, attributes, or remote resources', () => {
    expect(pageObservationScript).toContain("hasAttribute('alt')");
    expect(pageObservationScript).not.toContain('textContent');
    expect(pageObservationScript).not.toContain('fetch(');
  });
});
