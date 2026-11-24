import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { loadMilestoneImagePair, MilestoneImageCompare, MilestoneImagePairView } from '../../src/renderer/components/milestone-image-compare';
import type { ProjectMilestone } from '../../src/shared/milestones';

const item = (id: string, overrides: Partial<ProjectMilestone> = {}): ProjectMilestone => ({
  id, projectId: 'project', label: `Aufnahme ${id}`, repository: 'synthetic', branch: 'main', commit: id.repeat(40).slice(0, 40),
  createdAt: '2026-11-24T06:00:00.000Z', previewAvailable: true, previewSource: 'http://127.0.0.1:5173/',
  previewCapturedAt: '2026-11-24T06:00:00.000Z', ...overrides,
});

describe('milestone image comparison', () => {
  it('shows the number of available images and requires explicit selection', () => {
    const empty = renderToStaticMarkup(createElement(MilestoneImageCompare, { projectId: 'project', milestones: [] }));
    expect(empty).toContain('Bisher verfügbar: 0');
    expect(empty).not.toContain('<img');
    const one = renderToStaticMarkup(createElement(MilestoneImageCompare, { projectId: 'project', milestones: [item('a'), item('other', { projectId: 'other' })] }));
    expect(one).toContain('Bisher verfügbar: 1');
    const two = renderToStaticMarkup(createElement(MilestoneImageCompare, { projectId: 'project', milestones: [item('a'), item('b'), item('c', { previewAvailable: false })] }));
    expect(two).toContain('Vorher');
    expect(two).toContain('Nachher');
    expect(two).toContain('Bilder vergleichen');
    expect(two).toContain('disabled');
    expect(two).not.toContain('<img');
    expect(two).not.toContain('Aufnahme c');
  });

  it('loads only two distinct images in the chosen order and project', async () => {
    const getImage = vi.fn(async ({ milestoneId }: { projectId: string; milestoneId: string }) => `data:image/png;base64,${milestoneId === 'a' ? 'AA==' : 'AQ=='}`);
    const pair = await loadMilestoneImagePair('project', [item('a'), item('b')], 'b', 'a', getImage);
    expect(pair.before.milestone.id).toBe('b');
    expect(pair.after.milestone.id).toBe('a');
    expect(pair.before.image).toContain('AQ==');
    expect(getImage.mock.calls).toEqual([[{ projectId: 'project', milestoneId: 'b' }], [{ projectId: 'project', milestoneId: 'a' }]]);
    const html = renderToStaticMarkup(createElement(MilestoneImagePairView, { pair, onImageError: () => undefined }));
    expect(html).toContain('Vorher · Aufnahme b');
    expect(html).toContain('Nachher · Aufnahme a');
    expect(html).toContain('alt="Vorher: lokale Vorschauaufnahme Aufnahme b"');
    expect(html).toContain('alt="Nachher: lokale Vorschauaufnahme Aufnahme a"');
    expect((html.match(/<img/g) ?? []).length).toBe(2);
  });

  it('rejects missing, duplicate, cross-project and image-free selections before IPC', async () => {
    const getImage = vi.fn(async () => 'data:image/png;base64,AA==');
    const milestones = [item('a'), item('b', { projectId: 'other' }), item('c', { previewAvailable: false })];
    for (const [before, after] of [['', 'a'], ['a', 'a'], ['a', 'missing'], ['a', 'b'], ['a', 'c']]) {
      await expect(loadMilestoneImagePair('project', milestones, before!, after!, getImage)).rejects.toThrow();
    }
    expect(getImage).not.toHaveBeenCalled();
  });

  it('surfaces IPC failures and rejects an invalid image payload', async () => {
    await expect(loadMilestoneImagePair('project', [item('a'), item('b')], 'a', 'b', async () => { throw new Error('Bild fehlt'); })).rejects.toThrow('Bild fehlt');
    await expect(loadMilestoneImagePair('project', [item('a'), item('b')], 'a', 'b', async () => 'not a png')).rejects.toThrow('PNG');
  });
});
