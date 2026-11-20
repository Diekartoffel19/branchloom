import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Globe2, RotateCw } from 'lucide-react';
import type { BrowserState } from '../../shared/types';

const EMPTY: BrowserState = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: null };
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function BrowserView({ active }: { active: boolean }) {
  const [state, setState] = useState<BrowserState>(EMPTY);
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const editing = useRef(false);

  useEffect(() => {
    if (!window.studio) return;
    let mounted = true;
    const unsubscribe = window.studio.onBrowserState((next) => { if (mounted) setState(next); });
    void window.studio.browserState().then((next) => { if (mounted) setState(next); }).catch((reason: unknown) => {
      if (mounted) setError(messageOf(reason));
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!editing.current) setAddress(state.url);
  }, [state.url]);

  useEffect(() => {
    if (!window.studio) return;
    if (!active) {
      void window.studio.browserSetVisible(false).catch(() => undefined);
      return;
    }
    const element = viewport.current;
    if (!element) return;
    let scheduled = 0;
    const updateBounds = () => {
      cancelAnimationFrame(scheduled);
      scheduled = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        void window.studio.browserSetBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch((reason: unknown) => setError(messageOf(reason)));
      });
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(element);
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, true);
    updateBounds();
    void window.studio.browserSetVisible(true).catch((reason: unknown) => setError(messageOf(reason)));
    return () => {
      cancelAnimationFrame(scheduled);
      observer.disconnect();
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds, true);
      void window.studio.browserSetVisible(false).catch(() => undefined);
    };
  }, [active]);

  async function navigate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try { setState(await window.studio.browserNavigate(address)); }
    catch (reason) { setError(messageOf(reason)); }
  }

  async function command(action: () => Promise<BrowserState>) {
    setError('');
    try { setState(await action()); }
    catch (reason) { setError(messageOf(reason)); }
  }

  return <section className="browser-page" aria-label="Browser">
    <div className="browser-toolbar">
      <div className="browser-nav-buttons">
        <button type="button" className="icon-button" aria-label="Zurück" title="Zurück" disabled={!state.canGoBack} onClick={() => void command(() => window.studio.browserBack())}><ArrowLeft size={17} /></button>
        <button type="button" className="icon-button" aria-label="Vorwärts" title="Vorwärts" disabled={!state.canGoForward} onClick={() => void command(() => window.studio.browserForward())}><ArrowRight size={17} /></button>
        <button type="button" className="icon-button" aria-label="Neu laden" title="Neu laden" disabled={!state.url} onClick={() => void command(() => window.studio.browserReload())}><RotateCw size={17} className={state.loading ? 'spin' : undefined} /></button>
      </div>
      <form className="browser-address" onSubmit={(event) => void navigate(event)}>
        <Globe2 size={17} aria-hidden="true" />
        <label className="sr-only" htmlFor="browser-url">Webadresse</label>
        <input id="browser-url" type="text" inputMode="url" autoComplete="url" spellCheck={false} value={address} onChange={(event) => setAddress(event.target.value)} onFocus={() => { editing.current = true; }} onBlur={() => { editing.current = false; }} placeholder="https://example.com" />
        <button type="submit" className="secondary-button">Öffnen</button>
      </form>
    </div>
    {error || state.error ? <div className="browser-error" role="alert">{error || state.error}</div> : null}
    <div className="browser-viewport" ref={viewport}>
      {!state.url ? <div className="browser-empty"><Globe2 size={30} /><h2>Browser</h2><p>Gib oben eine Webadresse ein. Webseiten laufen getrennt von den Rechten der App und der CLI-Agenten.</p></div> : null}
    </div>
  </section>;
}
