import { describe, expect, it } from 'vitest';
import { checkedWireframeElements } from '../../src/main/card-wireframe';
import { appendWireframeComponent, instantiateWireframeComponent, type WireframeComponent } from '../../src/shared/wireframe-components';

const component: WireframeComponent = {
  id: 'template', projectId: 'project', name: 'Header', sourceArtboard: 'desktop', width: 600, height: 90,
  elements: [
    { id: 'first', kind: 'text', x: 0, y: 0, width: 300, height: 42, text: 'Titel', tone: 'plain', groupId: 'group' },
    { id: 'second', kind: 'button', x: 460, y: 40, width: 140, height: 50, text: 'Öffnen', tone: 'accent', groupId: 'group' },
  ], createdAt: '2026-01-01T00:00:00.000Z',
};

describe('detached design-component insertion', () => {
  it('fits into a mobile artboard and gives copies fresh element and group identities', () => {
    let serial = 0;
    const nextId = (kind: 'item' | 'group') => `${kind}-${++serial}`;
    const first = instantiateWireframeComponent(component, 390, 844, nextId);
    const second = instantiateWireframeComponent(component, 390, 844, nextId);
    expect(first).toHaveLength(2);
    expect(checkedWireframeElements(first, 390, 844)).toEqual(first);
    expect(first.map((item) => item.id)).not.toEqual(second.map((item) => item.id));
    expect(first[0]!.groupId).toBe(first[1]!.groupId);
    expect(first[0]!.groupId).not.toBe(component.elements[0]!.groupId);
    expect(second[0]!.groupId).not.toBe(first[0]!.groupId);
    expect(first[0]!.text).toBe('Titel');
    first[0]!.text = 'Bearbeitet';
    expect(component.elements[0]!.text).toBe('Titel');
  });

  it('returns no elements when canvas geometry is impossible', () => {
    expect(instantiateWireframeComponent(component, 10, 10, () => 'id')).toEqual([]);
  });

  it('rejects an insertion above 40 elements without changing the existing artboard or generating IDs', () => {
    const existing = Array.from({ length: 39 }, (_, index) => ({ ...component.elements[0]!, id: `existing-${index}` }));
    const before = structuredClone(existing);
    let calls = 0;
    expect(appendWireframeComponent(existing, component, 390, 844, () => { calls++; return `copy-${calls}`; })).toBeNull();
    expect(existing).toEqual(before);
    expect(calls).toBe(0);
  });
});
