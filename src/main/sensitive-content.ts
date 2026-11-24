/** Small, deliberately conservative check at the point where local text leaves for an agent. */
export interface ModelContextField { field: string; text: string }
export interface SensitiveFinding { field: string; line: number; category: string }

const patterns = [
  { category: 'Privatschlüssel', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { category: 'API-Schlüssel', pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g },
  { category: 'API-Schlüssel-Zuweisung', pattern: /\b(?:OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*[:=]\s*["']?[^\s"'#]{16,}/gi },
  { category: 'privater Benutzerpfad', pattern: /(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/)[^\\/\s]+[\\/]/g },
] as const;

export function scanModelContext(fields: readonly ModelContextField[]): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  for (const { field, text } of fields) {
    for (const { category, pattern } of patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        findings.push({ field, line: 1 + (text.slice(0, match.index).match(/\n/g)?.length ?? 0), category });
        if (findings.length >= 20) return findings;
      }
    }
  }
  return findings.sort((a, b) => a.field.localeCompare(b.field) || a.line - b.line);
}

/** Never include matched text in errors, logs, or renderer data. */
export function assertSafeModelContext(fields: readonly ModelContextField[]): void {
  const findings = scanModelContext(fields);
  if (!findings.length) return;
  const places = findings.map(({ field, line, category }) => `${field}, Zeile ${line} (${category})`).join('; ');
  throw new Error(`Modellübergabe gesperrt: ${places}. Inhalt prüfen oder bereinigen und erneut starten.`);
}

/** A preview may be shown before the stored source is cleaned. Never return the match. */
export function redactSensitiveText(text: string): { text: string; redacted: boolean } {
  let safe = text;
  let redacted = false;
  for (const { category, pattern } of patterns) {
    pattern.lastIndex = 0;
    safe = safe.replace(pattern, () => { redacted = true; return `[ausgeblendet: ${category}]`; });
  }
  return { text: safe, redacted };
}
