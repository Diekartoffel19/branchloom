import type { ColumnEffort } from '../shared/types';

/** Google Antigravity CLI 1.5.x accepts one prompt argument after -i or -p. */
export function buildAntigravityArgs(
  profileArgs: string[],
  prompt: string,
  mode: 'interactive' | 'one-shot',
  model: string | null,
  effort: ColumnEffort | null,
): string[] {
  if (mode === 'one-shot') {
    if (!prompt) throw new Error('Antigravity-Workflows benötigen einen Prompt.');
    if (profileArgs.some((arg) => /^--dangerously-skip-permissions(?:=|$)/.test(arg))) {
      throw new Error('Unbeaufsichtigte Antigravity-Workflows erlauben keinen Permission-Bypass.');
    }
  }
  if (effort === 'ultra') throw new Error('Antigravity CLI unterstützt maximal Effort „max“.');
  const args = [...profileArgs];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (prompt) args.push(mode === 'one-shot' ? '-p' : '-i', prompt);
  return args;
}
