import { useEffect, useState } from 'react';
import { Clipboard, RefreshCw } from 'lucide-react';
import type { ChangelogCommit, ChangelogPeriod, ProjectChangelog } from '../../shared/changelog';
import './changelog.css';

function displayTime(value: string): string {
  return new Date(value).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

function markdownText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('\\', '\\\\').replace(/([*_[\]`~])/g, '\\$1');
}

export function changelogMarkdown(changelog: ProjectChangelog): string {
  const period = changelog.period === 'day' ? 'Letzte 24 Stunden' : 'Letzte 7 Tage';
  const lines = [
    `# Changelog · ${period}`,
    '',
    `Zeitraum: ${changelog.since} bis ${changelog.until}`,
    `Quelle: Git-Historie bis HEAD ${changelog.head ?? 'nicht vorhanden'}`,
    '',
  ];
  if (changelog.state === 'no-repository') lines.push('Der Projektordner ist kein Git-Repository.');
  else if (changelog.state === 'no-commits') lines.push('Dieses Git-Repository hat noch keinen Commit.');
  else if (!changelog.commits.length) lines.push('In diesem Zeitraum ist kein Commit in HEAD erreichbar.');
  else for (const commit of changelog.commits) lines.push(`- ${markdownText(commit.subject)} (${commit.hash}, ${commit.committedAt})`);
  if (changelog.moreAvailable) lines.push('', 'Weitere Commits sind vorhanden; die Ansicht zeigt höchstens 100.');
  lines.push('', 'Tests und Reviews sind hier noch nicht einem Commit zugeordnet.');
  return lines.join('\n') + '\n';
}

function byLocalDay(commits: ChangelogCommit[]): Array<{ day: string; commits: ChangelogCommit[] }> {
  const groups: Array<{ day: string; commits: ChangelogCommit[] }> = [];
  for (const commit of commits) {
    const day = new Date(commit.committedAt).toLocaleDateString('de-DE', { dateStyle: 'full' });
    const last = groups.at(-1);
    if (last?.day === day) last.commits.push(commit);
    else groups.push({ day, commits: [commit] });
  }
  return groups;
}

export function ChangelogView({ projectId }: { projectId: string }) {
  const [period, setPeriod] = useState<ChangelogPeriod>('week');
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<ProjectChangelog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true); setError(''); setCopied(false); setResult(null);
    void window.studio.projectChangelog({ projectId, period })
      .then((value) => { if (live) setResult(value); })
      .catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [projectId, period, refresh]);

  async function copy() {
    if (!result || loading) return;
    try { await navigator.clipboard.writeText(changelogMarkdown(result)); setCopied(true); setError(''); }
    catch { setError('Changelog konnte nicht in die Zwischenablage kopiert werden.'); }
  }

  return <section className="standard-page changelog-page" aria-label="Changelog">
    <div className="view-header"><div><h2>Changelog</h2><p>Commits aus dem aktuellen Git-HEAD des Projektordners. Betreff, Zeitpunkt und Hash stammen direkt aus Git.</p></div></div>
    <div className="changelog-controls">
      <label>Zeitraum<select value={period} onChange={(event) => setPeriod(event.target.value as ChangelogPeriod)}><option value="day">Letzte 24 Stunden</option><option value="week">Letzte 7 Tage</option></select></label>
      <button type="button" className="secondary-button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}><RefreshCw size={15} aria-hidden="true" /> Aktualisieren</button>
      <button type="button" className="secondary-button" onClick={() => void copy()} disabled={!result || loading}><Clipboard size={15} aria-hidden="true" /> {copied ? 'Markdown kopiert' : 'Markdown kopieren'}</button>
    </div>
    {loading ? <p role="status">Git-Historie wird gelesen…</p> : error ? <p className="changelog-error" role="alert">{error}</p> : result ? <>
      <div className="changelog-source"><span>Erfasst: <time dateTime={result.checkedAt}>{displayTime(result.checkedAt)}</time></span><span>Git HEAD: <code>{result.head?.slice(0, 12) ?? 'nicht vorhanden'}</code></span><span>{result.commits.length} {result.commits.length === 1 ? 'Commit' : 'Commits'} im Zeitraum{result.moreAvailable ? ' (mindestens)' : ''}</span></div>
      {result.state === 'no-repository' ? <p className="changelog-empty">Der Projektordner ist kein Git-Repository.</p>
        : result.state === 'no-commits' ? <p className="changelog-empty">Dieses Git-Repository hat noch keinen Commit.</p>
        : result.commits.length === 0 ? <p className="changelog-empty">In diesem Zeitraum ist kein Commit in HEAD erreichbar.</p>
        : <div className="changelog-groups">{byLocalDay(result.commits).map((group, index) => <section key={`${group.day}:${index}`} aria-label={group.day}><h3>{group.day}</h3><ol>{group.commits.map((commit) => <li key={commit.hash}><div className="changelog-subject">{commit.subject}</div><div className="changelog-commit-meta"><time dateTime={commit.committedAt}>{displayTime(commit.committedAt)}</time><code title={commit.hash}>{commit.hash}</code></div></li>)}</ol></section>)}</div>}
      {result.moreAvailable ? <p className="changelog-limit">Weitere Commits sind vorhanden. Die Ansicht zeigt höchstens 100.</p> : null}
      <p className="changelog-scope">Tests und Reviews sind hier noch nicht einem Commit zugeordnet. Unversionierte Änderungen und andere Branches sind nicht enthalten.</p>
    </> : null}
  </section>;
}
