import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { Session } from '../../shared/types';
import '@xterm/xterm/css/xterm.css';
import '../session-terminal.css';

interface Props { session: Session }

/** A real VT terminal is needed for interactive CLIs and Codex's resume picker. */
export function SessionTerminal({ session }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const writtenRef = useRef('');
  const runningRef = useRef(session.state === 'running');
  const [inputError, setInputError] = useState('');

  useEffect(() => { runningRef.current = session.state === 'running'; }, [session.state]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const terminal = new Terminal({
      cols: 100,
      rows: 30,
      cursorBlink: true,
      scrollback: 5000,
      screenReaderMode: true,
      fontSize: 12,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      theme: { background: '#111b27', foreground: '#dceaf4', cursor: '#70d9c9', selectionBackground: '#315d66' },
      // Agent output may contain OSC 8 links. Never open a target supplied by
      // terminal output through the renderer's default browser handler.
      linkHandler: { activate: () => undefined },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminal.focus();
    terminalRef.current = terminal;
    writtenRef.current = '';
    const fitAndResize = () => {
      if (!container.isConnected || container.clientWidth === 0 || container.clientHeight === 0) return;
      fit.fit();
      const cols = Math.max(20, Math.min(300, terminal.cols));
      const rows = Math.max(5, Math.min(100, terminal.rows));
      if (cols !== terminal.cols || rows !== terminal.rows) terminal.resize(cols, rows);
      if (runningRef.current) void window.studio.resizeSession({ sessionId: session.id, cols: terminal.cols, rows: terminal.rows }).catch(() => { /* The process may have exited. */ });
    };
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(container);
    fitAndResize();
    const input = terminal.onData((data) => {
      if (!runningRef.current) return;
      void window.studio.writeSessionInput({ sessionId: session.id, data }).catch((reason: unknown) => setInputError(reason instanceof Error ? reason.message : String(reason)));
    });
    return () => {
      input.dispose();
      observer.disconnect();
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [session.id]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const previous = writtenRef.current;
    if (session.output.startsWith(previous)) terminal.write(session.output.slice(previous.length));
    else { terminal.reset(); terminal.write(session.output); }
    writtenRef.current = session.output;
  }, [session.id, session.output]);

  return <>
    <div className="session-terminal" ref={containerRef} aria-label="Interaktives Agententerminal" />
    {inputError ? <p className="inline-error" role="alert">Terminaleingabe fehlgeschlagen: {inputError}</p> : null}
  </>;
}
