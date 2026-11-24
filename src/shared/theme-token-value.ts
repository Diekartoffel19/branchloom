/** Literal values safe for both the isolated preview and a single source edit. */
export function normalizeThemeTokenValue(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32) throw new Error('Nutze einen Hex-Farbwert oder einen Radius von 0 bis 99 px.');
  const trimmed = value.trim();
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return trimmed;
  if (/^(?:0|[1-9][0-9]?)(?:\.[0-9]{1,2})?px$/.test(trimmed)) return trimmed;
  throw new Error('Nutze einen Hex-Farbwert oder einen Radius von 0 bis 99 px.');
}
