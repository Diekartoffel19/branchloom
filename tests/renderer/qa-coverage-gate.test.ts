import { describe, expect, it } from 'vitest';
import { QaCoverageProjectGate } from '../../src/renderer/qa-coverage-gate';

describe('QA coverage project response gate', () => {
  it('discards a late project A response after the UI selects project B', async () => {
    const gate = new QaCoverageProjectGate('project-a');
    const ticketA = gate.begin();
    let resolveA!: (value: string) => void;
    const delayedA = new Promise<string>((resolve) => { resolveA = resolve; });
    gate.enter('project-b');
    const ticketB = gate.begin();
    resolveA('private project A route');
    const visible: string[] = [];
    const oldResult = await delayedA;
    if (gate.isCurrent(ticketA)) visible.push(oldResult);
    if (gate.isCurrent(ticketB)) visible.push('project B route');
    expect(visible).toEqual(['project B route']);
    gate.enter('project-a');
    expect(gate.isCurrent(ticketA)).toBe(false);
  });

  it('discards an older reload after a save in the same project', async () => {
    const gate = new QaCoverageProjectGate('project-a');
    const reload = gate.begin();
    const save = gate.begin();
    expect(gate.isCurrent(reload)).toBe(false);
    expect(gate.isCurrent(save)).toBe(true);
  });
});
