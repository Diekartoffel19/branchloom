import { mkdtemp, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryNote, MemoryVaultExportResult } from '../shared/types';
import { planMemoryVaultFiles } from '../shared/memory-file';

/** Always creates a fresh subfolder; never overwrites a file in the chosen destination. */
export async function exportMemoryVaultToDirectory(notes: MemoryNote[], chosenDirectory: string, projectName: string): Promise<MemoryVaultExportResult> {
  if (!notes.length) throw new Error('Dieses Projekt hat noch keine Memory-Notizen.');
  if (notes.length > 5_000) throw new Error('Mehr als 5.000 Notizen bitte in mehreren Projekten exportieren.');
  if (typeof chosenDirectory !== 'string' || !chosenDirectory.trim()) throw new Error('Bitte einen Exportordner auswählen.');
  const selected = await realpath(chosenDirectory);
  if (!(await stat(selected)).isDirectory()) throw new Error('Das Exportziel ist kein Ordner.');
  const files = planMemoryVaultFiles(notes);
  const totalBytes = files.reduce((sum, item) => sum + Buffer.byteLength(item.contents, 'utf8'), 0);
  if (totalBytes > 64 * 1024 * 1024) throw new Error('Der Memory-Export überschreitet 64 MiB.');
  const label = projectName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 40).replace(/[. ]+$/g, '') || 'Projekt';
  const directory = await mkdtemp(join(selected, `Jarvis-Memory-${label}-`));
  try {
    for (const file of files) await writeFile(join(directory, file.name), file.contents, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    // Preserve the generated partial export so a failed write cannot delete
    // anything the user or another process might have placed there meanwhile.
    throw new Error(`Der Memory-Export ist unvollständig. Bitte den Ordner ${directory} prüfen. ${error instanceof Error ? error.message : String(error)}`);
  }
  return { count: files.length, directory };
}
