import { randomUUID, createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ThemeTokenDefinition, ThemeTokenEditPreview, ThemeTokenEditResult } from '../shared/theme-tokens';
import { normalizeThemeTokenValue } from '../shared/theme-token-value';
import type { StudioStore } from './store';
import { cssTokenSpans, readBounded, safeTrackedFile, scanThemeTokens } from './theme-tokens';

type Input = { projectId: string; token: ThemeTokenDefinition; value: string };
type Prepared = { preview: ThemeTokenEditPreview; file: string; original: Buffer; next: Buffer };
const editing = new Set<string>();
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

async function prepare(store: StudioStore, input: Input): Promise<Prepared> {
  const { projectId, token } = input ?? ({} as Input);
  const value = normalizeThemeTokenValue(input?.value);
  if (typeof projectId !== 'string' || !token || typeof token.path !== 'string' ||
    typeof token.name !== 'string' || !/^--[A-Za-z0-9_-]{1,98}$/.test(token.name) ||
    !Number.isSafeInteger(token.line) || token.line < 1 || token.valueTruncated !== false ||
    typeof token.value !== 'string' || typeof token.sourceFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token.sourceFingerprint)) throw new Error('Wähle eine unveränderte CSS-Fundstelle.');
  const oldValue = normalizeThemeTokenValue(token.value);
  if ((oldValue.startsWith('#')) !== (value.startsWith('#'))) throw new Error('Farbe und Radius können nicht gegeneinander getauscht werden.');
  if (oldValue === value) throw new Error('Der neue Wert ist mit der Quelle identisch.');

  const inventory = await scanThemeTokens(store, projectId);
  if (!inventory.definitions.some((item) => item.path === token.path && item.line === token.line && item.name === token.name && item.value === token.value && item.valueTruncated === false && item.sourceFingerprint === token.sourceFingerprint)) throw new Error('Die CSS-Fundstelle ist veraltet. Suche die Tokens erneut.');
  const root = await fs.realpath(store.project(projectId).path);
  const file = await safeTrackedFile(root, token.path);
  if (!file) throw new Error('Die CSS-Datei ist nicht mehr sicher erreichbar.');
  const original = await readBounded(root, file, 128 * 1024);
  if (!original || hash(original) !== token.sourceFingerprint) throw new Error('Die CSS-Datei wurde seit der Suche geändert.');
  const source = original.toString('utf8');
  if (!Buffer.from(source, 'utf8').equals(original) || source.includes('\0')) throw new Error('Nur gültige UTF-8-CSS-Dateien können bearbeitet werden.');
  const matches = cssTokenSpans(source).filter((item) => item.name === token.name && item.line === token.line && item.value === token.value && !item.valueTruncated);
  if (matches.length !== 1) throw new Error('Die CSS-Fundstelle ist nicht eindeutig.');
  const match = matches[0]!;
  const before = source.slice(match.valueStart, match.valueEnd);
  if (before !== oldValue || before.includes('\n') || before.includes('\r')) throw new Error('Nur einfache CSS-Werte in einer Zeile können übernommen werden.');
  const next = Buffer.from(source.slice(0, match.valueStart) + value + source.slice(match.valueEnd), 'utf8');
  if (next.length > 128 * 1024) throw new Error('Die CSS-Datei würde das Größenlimit überschreiten.');
  const reviewToken = hash(JSON.stringify([projectId, token.path, token.line, token.name, token.sourceFingerprint, oldValue, value, hash(next)]));
  return { preview: { projectId, token, value, before: `${token.name}: ${oldValue};`, after: `${token.name}: ${value};`, reviewToken }, file, original, next };
}

export async function previewThemeTokenEdit(store: StudioStore, input: Input): Promise<ThemeTokenEditPreview> {
  return (await prepare(store, input)).preview;
}

export async function applyThemeTokenEdit(store: StudioStore, input: Input & { reviewToken: string; confirm: boolean }): Promise<ThemeTokenEditResult> {
  if (input?.confirm !== true) throw new Error('Bestätige die geprüfte CSS-Änderung ausdrücklich.');
  if (typeof input.reviewToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.reviewToken)) throw new Error('Die Änderungsprüfung fehlt.');
  const key = `${input.projectId}\0${input.token?.path}`;
  if (editing.has(key)) throw new Error('Diese CSS-Datei wird bereits geändert.');
  editing.add(key);
  let temporary: string | null = null;
  try {
    const { preview, file, original, next } = await prepare(store, input);
    if (preview.reviewToken !== input.reviewToken) throw new Error('Die Änderungsprüfung ist veraltet. Bitte erneut prüfen.');
    const stat = await fs.lstat(file);
    if ((stat.mode & 0o200) === 0) throw new Error('Die CSS-Datei ist schreibgeschützt.');
    temporary = join(dirname(file), `.branchloom-token-${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { await handle.writeFile(next); await handle.sync(); } finally { await handle.close(); }
    await fs.chmod(temporary, stat.mode & 0o777);
    // The source is checked again immediately before atomic replacement. Never write through a link.
    const root = await fs.realpath(store.project(input.projectId).path);
    if (await safeTrackedFile(root, input.token.path) !== file) throw new Error('Die CSS-Datei wurde während der Änderung ersetzt.');
    const current = await readBounded(root, file, 128 * 1024);
    if (!current || !current.equals(original)) throw new Error('Die CSS-Datei wurde während der Änderung bearbeitet.');
    await fs.rename(temporary, file);
    temporary = null;
    const token = { ...input.token, value: preview.value, sourceFingerprint: hash(next) };
    return { projectId: input.projectId, before: preview.before, after: preview.after, token, previousValue: input.token.value };
  } finally {
    if (temporary) await fs.rm(temporary, { force: true });
    editing.delete(key);
  }
}
