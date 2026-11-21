import { lazy, Suspense, useEffect, useState } from 'react';
import { CircleStop, Play, TerminalSquare } from 'lucide-react';
import type { CommandShell, CommandTerminal } from '../../shared/types';
import '../command-terminal.css';

const TerminalDisplay = lazy(async () => ({ default: (await import('./SessionTerminal')).SessionTerminal }));

const shellName = (shell: CommandShell) => shell === 'powershell' ? 'PowerShell' : 'Eingabeaufforderung';

export function CommandTerminalView({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<CommandTerminal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shell, setShell] = useState<CommandShell>('powershell');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = rows.find((item) => item.id === selectedId) ?? null;
  const active = rows.find((item) => item.state === 'running') ?? null;

  useEffect(() => {
    let live = true;
    setRows([]);
    setSelectedId(null);
    setError('');
    void window.studio.commandTerminals(projectId).then((items) => {
      if (!live) return;
      setRows(items);
      setSelectedId(items.find((item) => item.state === 'running')?.id ?? items[0]?.id ?? null);
    }).catch((reason: unknown) => { if (live) setError(String(reason)); });
    const unsubscribe = window.studio.onCommandTerminalEvent((event) => {
      if (!live || event.projectId !== projectId) return;
      setRows((old) => old.map((item) => item.id === event.terminalId
        ? event.type === 'output' ? { ...item, output: (item.output + event.data).slice(-100_000) }
          : { ...item, state: event.state ?? item.state, endedAt: event.state === 'running' ? null : new Date().toISOString() }
        : item));
      if (event.type === 'state') void window.studio.commandTerminals(projectId).then((items) => { if (live) setRows(items); }).catch(() => undefined);
    });
    return () => { live = false; unsubscribe(); };
  }, [projectId]);

  async function start() {
    if (busy || active) return;
    setBusy(true); setError('');
    try {
      const created = await window.studio.startCommandTerminal({ projectId, shell });
      const items = await window.studio.commandTerminals(projectId);
      setRows(items);
      setSelectedId(created.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function stop() {
    if (!selected || selected.state !== 'running' || busy) return;
    setBusy(true); setError('');
    try {
      await window.studio.stopCommandTerminal(selected.id);
      setRows(await window.studio.commandTerminals(projectId));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return <div className="standard-page command-terminal-page">
    <div className="view-header"><div><div className="eyebrow">PROJEKTWERKZEUG</div><h2>Befehlsterminal</h2><p>Startet eine lokale Shell im Ordner des aktiven Projekts. Befehle werden erst durch deine Eingabe ausgeführt.</p></div></div>
    <div className="command-terminal-start panel">
      <label>Shell<select aria-label="Shell auswählen" value={shell} disabled={busy || Boolean(active)} onChange={(event) => setShell(event.target.value as CommandShell)}><option value="powershell">Windows PowerShell</option><option value="cmd">Eingabeaufforderung (cmd)</option></select></label>
      <button className="primary-button" type="button" disabled={busy || Boolean(active)} onClick={() => void start()}><Play size={15} /> Terminal starten</button>
      <p>Höchstens ein laufendes Befehlsterminal pro Projekt. Nach einem App-Neustart wird ein unterbrochener Lauf als fehlgeschlagen markiert; er startet nicht von selbst erneut.</p>
    </div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    <div className="command-terminal-layout">
      <section className="panel command-terminal-history" aria-label="Terminalverlauf"><h3>Letzte Terminals</h3>{rows.length ? rows.map((item) => <button className={item.id === selectedId ? 'command-terminal-history-item selected' : 'command-terminal-history-item'} key={item.id} type="button" onClick={() => setSelectedId(item.id)} aria-current={item.id === selectedId ? 'true' : undefined}><TerminalSquare size={16} /><span><strong>{shellName(item.shell)}</strong><small>{new Date(item.startedAt).toLocaleString('de-DE')} · {item.state}</small></span></button>) : <p>Noch kein Terminal gestartet.</p>}</section>
      <section className="panel command-terminal-screen" aria-label="Befehlsterminal">
        {selected ? <><div className="command-terminal-screen-header"><div><strong>{shellName(selected.shell)}</strong><span>{selected.state === 'running' ? 'Läuft' : `Beendet: ${selected.state}${selected.exitCode !== null ? ` (${selected.exitCode})` : ''}`}</span></div>{selected.state === 'running' ? <button className="secondary-button small" type="button" disabled={busy} onClick={() => void stop()}><CircleStop size={15} /> Stoppen</button> : null}</div><Suspense fallback={<p>Terminal wird geladen…</p>}><TerminalDisplay session={selected} ariaLabel="Interaktives Befehlsterminal" onInput={(id, data) => window.studio.writeCommandTerminal({ terminalId: id, data })} onResize={(id, cols, rows) => window.studio.resizeCommandTerminal({ terminalId: id, cols, rows })} /></Suspense></> : <div className="feature-empty"><TerminalSquare size={28} /><h3>Terminal bereit</h3><p>Wähle PowerShell oder cmd und starte es bewusst. Die Ausgabe bleibt lokal gespeichert.</p></div>}
      </section>
    </div>
  </div>;
}
