import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WIREFRAME_ARTBOARDS, type WireframeArtboard } from '../../src/shared/card-wireframe';
import { checkedWireframePng, wireframeExportFilename, writeWireframePngExclusive } from '../../src/main/wireframe-export';

const png = (artboard: WireframeArtboard): string => {
  const header = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(WIREFRAME_ARTBOARDS[artboard].width, 16);
  header.writeUInt32BE(WIREFRAME_ARTBOARDS[artboard].height, 20);
  return `data:image/png;base64,${header.toString('base64')}`;
};

describe('wireframe PNG export boundary', () => {
  it.each(['desktop', 'tablet', 'mobile'] as const)('accepts only the %s artboard dimensions', (artboard) => {
    const input = { projectId: 'p', cardId: 'c', artboard, dataUrl: png(artboard) };
    expect(checkedWireframePng(input)).toHaveLength(33);
    expect(() => checkedWireframePng({ ...input, dataUrl: png(artboard === 'mobile' ? 'desktop' : 'mobile') })).toThrow(/größe/i);
  });

  it('rejects non-PNG and oversized input before saving', () => {
    const input = { projectId: 'p', cardId: 'c', artboard: 'desktop' as const, dataUrl: png('desktop') };
    expect(() => checkedWireframePng({ ...input, dataUrl: 'data:image/svg+xml;base64,AAAA' })).toThrow('PNG');
    expect(() => checkedWireframePng({ ...input, dataUrl: `data:image/png;base64,${'A'.repeat(24 * 1024 * 1024)}` })).toThrow('PNG');
    expect(() => checkedWireframePng({ ...input, dataUrl: 'data:image/png;base64,AAAA' })).toThrow(/größe/i);
  });

  it('sanitizes filenames and never overwrites an existing image', () => {
    expect(wireframeExportFilename('A: B / C?', 'tablet')).toBe('A B C-tablet.png');
    const directory = mkdtempSync(join(tmpdir(), 'branchloom-wireframe-export-'));
    const file = join(directory, 'artboard.png');
    try {
      writeWireframePngExclusive(file, Buffer.from('first'));
      expect(() => writeWireframePngExclusive(file, Buffer.from('second'))).toThrow('existiert bereits');
      expect(readFileSync(file, 'utf8')).toBe('first');
    } finally { unlinkSync(file); rmdirSync(directory); }
  });
});
