import { spawnSync } from 'node:child_process';
import type { CardQaReport, PrDraftPreview } from '../shared/types';
import type { StudioStore } from './store';
import { cardQaReports } from './card-qa';
import { reviewCardWorktree } from './git-worktree';
import { diagnosticSource } from './browser-policy';

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024, windowsHide: true,
    shell: false, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error || result.status !== 0) throw new Error(`PR-Entwurf: Git-Daten nicht lesbar: ${String(result.stderr || result.error?.message || 'Git-Fehler').trim().slice(0, 240)}`);
  return result.stdout;
}

function oneLine(value: string): string {
  return value.replace(/[\r\n\t\x00-\x1f]/g, ' ').trim().slice(0, 500);
}

function code(value: string): string {
  return `\`${oneLine(value).replaceAll('`', '\\`')}\``;
}

function qaCheckoutNote(report: CardQaReport, sourceHead: string): string {
  const evidence = report.gitEvidence;
  if (!evidence) return ' · Checkout-Gitstand nicht erfasst';
  if (evidence.state === 'unavailable') return ' · Checkout-Gitstand nicht prüfbar';
  if (evidence.state === 'changed') return ' · Checkout-HEAD wechselte während der QA';
  if (evidence.state === 'dirty') return ' · Checkout mit nicht committeten Änderungen';
  if (evidence.scope === 'card-worktree' && evidence.startHead === sourceHead && evidence.endHead === sourceHead) {
    return ` · Karten-Worktree bei ${code(sourceHead.slice(0, 12))} sauber beobachtet`;
  }
  return ' · QA-Checkout stimmt nicht mit dem PR-Quell-HEAD überein';
}

/** A read-only, editable starting point. QA observations are deliberately not attributed to a Git commit. */
export function previewPrDraft(store: StudioStore, cardId: string): PrDraftPreview | null {
  const card = store.card(cardId);
  const review = reviewCardWorktree(store, cardId);
  if (!review) return null;
  if (review.ahead < 1) throw new Error('Im Karten-Worktree gibt es noch keinen neuen Commit für einen PR-Entwurf.');
  const commits = git(review.path, ['log', '--format=%h%x09%s', '-n', '20', `${review.targetHead}..${review.sourceHead}`])
    .split(/\r?\n/).filter(Boolean).map((line) => {
      const tab = line.indexOf('\t');
      return tab < 0 ? oneLine(line) : `${code(line.slice(0, tab))} ${oneLine(line.slice(tab + 1))}`;
    });
  const paths = git(review.path, ['diff', '--no-renames', '--name-only', '-z', `${review.targetHead}...${review.sourceHead}`, '--'])
    .split('\0').filter(Boolean);
  const reports = cardQaReports(store, cardId).slice(0, 5);
  const lines = [
    `# ${oneLine(card.title) || 'Änderung'}`,
    '', '## Ausgangspunkt',
    `- Karte: ${code(card.id)}`,
    `- Quelle: ${code(review.branch)} bei ${code(review.sourceHead.slice(0, 12))}`,
    `- Ziel: ${code(review.targetBranch ?? '(detached)')} bei ${code(review.targetHead.slice(0, 12))}`,
    `- ${review.ahead} Commit(s) voraus${review.behind ? `, ${review.behind} zurück; Branches sind divergiert` : ''}.`,
    '', '## Kartenauftrag',
    ...((card.description.trim() || 'Kein Kartenauftrag hinterlegt.').slice(0, 2_000).split(/\r?\n/).map((line) => `> ${line}`)),
    '', '## Commits',
    ...commits.map((line) => `- ${line}`),
    ...(review.ahead > commits.length ? [`- … ${review.ahead - commits.length} weitere Commit(s) nicht aufgeführt.`] : []),
    '', '## Geänderte Dateien',
    ...paths.slice(0, 60).map((path) => `- ${code(path)}`),
    ...(paths.length > 60 ? [`- … ${paths.length - 60} weitere Datei(en) nicht aufgeführt.`] : []),
    ...(paths.length === 0 ? ['- Keine Datei im Vergleich ermittelt.'] : []),
    '', '## Prüfungen',
    '- Automatisierte Tests: noch nicht für diesen PR-Entwurf nachgewiesen.',
    '- Code-Review: noch nicht für diesen PR-Entwurf nachgewiesen.',
    ...(reports.length ? [
      '- Lokale Browser-QA an dieser Karte (Dev-Server-Auslieferung **nicht an diesen Commit gebunden**):',
      ...reports.map((report) => `  - ${oneLine(report.endedAt)} · ${report.status} · ${report.viewportWidth || '?'} × ${report.viewportHeight || '?'} · ${code(diagnosticSource(report.requestedUrl) ?? 'URL nicht lesbar')}${qaCheckoutNote(report, review.sourceHead)}${report.screenshotAvailable ? ' · Screenshot nur lokal in Branchloom' : ''}`),
    ] : ['- Lokale Browser-QA: kein gespeicherter Bericht an dieser Karte.']),
    ...(review.sourceStatus.length ? ['', '> Hinweis: Der Worktree hat nicht committete Änderungen. Sie sind nicht Teil dieses Entwurfs.'] : []),
    ...(review.blockers.length ? ['', `> Merge-Status: ${review.blockers.map(oneLine).join(' ')}`] : []),
  ];
  return { cardId, sourceHead: review.sourceHead, targetHead: review.targetHead, text: lines.join('\n'), reportCount: reports.length };
}
