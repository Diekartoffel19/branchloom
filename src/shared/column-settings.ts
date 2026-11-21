import type { AgentPreset, ColumnEffort } from './types';

export const COLUMN_EFFORTS: ReadonlyArray<{ value: ColumnEffort; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
  { value: 'ultra', label: 'Ultra' },
];

/** Validates IPC input as well as data edited in the board UI. */
export function columnSettings(
  kind: AgentPreset['kind'] | null,
  rawModel: unknown,
  rawEffort: unknown,
): { model: string | null; effort: ColumnEffort | null } {
  if (rawModel !== null && rawModel !== undefined && typeof rawModel !== 'string') throw new Error('Spalten-Modell muss Text sein.');
  const model = typeof rawModel === 'string' ? rawModel.trim() || null : null;
  if (model && (model.length > 200 || !/^[^\s\x00-\x1f\x7f-][^\s\x00-\x1f\x7f]*$/.test(model))) {
    throw new Error('Spalten-Modell muss 1–200 Zeichen ohne Leer-/Steuerzeichen haben und darf nicht mit - beginnen.');
  }
  if (rawEffort !== null && rawEffort !== undefined && !COLUMN_EFFORTS.some((item) => item.value === rawEffort)) {
    throw new Error('Ungültiger Spalten-Effort.');
  }
  const effort = rawEffort == null ? null : rawEffort as ColumnEffort;
  if (!kind && (model || effort)) throw new Error('Für Modell oder Effort zuerst einen Spaltenagenten wählen.');
  if (kind === 'custom' && model) throw new Error('Ein eigener CLI-Agent benötigt Modellargumente im Agentenprofil.');
  if (kind !== 'codex' && effort) throw new Error('Spalten-Effort wird derzeit nur für Codex CLI unterstützt.');
  return { model, effort };
}
