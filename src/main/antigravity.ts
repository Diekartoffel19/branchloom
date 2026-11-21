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
  if (model && (model.length > 200 || !/^[^\s\x00-\x1f\x7f-][^\s\x00-\x1f\x7f]*$/.test(model))) {
    throw new Error('Antigravity-Modell muss eine einzelne Modellkennung ohne Leer-/Steuerzeichen sein und darf nicht mit - beginnen.');
  }
  if (effort === 'ultra') throw new Error('Antigravity CLI unterstützt maximal Effort „max“.');
  if (effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) throw new Error('Ungültiger Antigravity-Effort.');
  const args = [...profileArgs];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  if (prompt) args.push(mode === 'one-shot' ? '-p' : '-i', prompt);
  return args;
}
