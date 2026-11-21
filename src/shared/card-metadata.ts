import type { CardPriority } from './types';

export const CARD_PRIORITIES: ReadonlyArray<{ value: CardPriority; label: string }> = [
  { value: 'none', label: 'Keine' },
  { value: 'low', label: 'Niedrig' },
  { value: 'medium', label: 'Mittel' },
  { value: 'high', label: 'Hoch' },
  { value: 'urgent', label: 'Dringend' },
];

export function cardPriority(value: unknown): CardPriority {
  if (CARD_PRIORITIES.some((item) => item.value === value)) return value as CardPriority;
  throw new Error('Ungültige Kartenpriorität.');
}

export function cardLabels(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 12) throw new Error('Höchstens 12 Labels pro Karte.');
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('Labels müssen Text sein.');
    const label = item.trim();
    if (!label || label.length > 32 || /[\x00-\x1f\x7f,]/.test(label)) throw new Error('Labels müssen 1–32 Zeichen ohne Komma oder Steuerzeichen haben.');
    const key = label.toLocaleLowerCase('de-DE');
    if (!seen.has(key)) { seen.add(key); labels.push(label); }
  }
  return labels;
}
