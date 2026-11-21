import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, ExternalLink, Globe2, Plus, RotateCw, X } from 'lucide-react';
import type { BrowserState } from '../../shared/types';

const EMPTY: BrowserState = { tabs: [], activeTabId: null, url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: null };
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

export function BrowserView({ active }: { active: boolean }) {
  const [state, setState] = useState<BrowserState>(EMPTY);
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
  }, [state.url, state.activeTabId]);

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
    setNotice('');
    try { setState(await window.studio.browserNavigate(address)); }
    catch (reason) { setError(messageOf(reason)); }
  }

  async function command(action: () => Promise<BrowserState>) {
    setError('');
    setNotice('');
    try { setState(await action()); }
    catch (reason) { setError(messageOf(reason)); }
  }

  async function capture() {
    setError('');
    setNotice('');
    try {
      const result = await window.studio.browserCapture();
      setNotice(`Screenshot (${result.width} × ${result.height}) in die Zwischenablage kopiert.`);
    } catch (reason) { setError(messageOf(reason)); }
  }

  async function openExternal() {
    setError('');
    setNotice('');
    try {
      await window.studio.browserOpenExternal();
      setNotice('Seite im Standardbrowser geöffnet.');
    } catch (reason) { setError(messageOf(reason)); }
  }

  return <section className="browser-page" aria-label="Browser">
    <div className="browser-tabbar" role="tablist" aria-label="Browser-Tabs">
      {state.tabs.map((tab, index) => <div className={tab.id === state.activeTabId ? 'browser-tab active' : 'browser-tab'} key={tab.id}>
        <button type="button" role="tab" aria-selected={tab.id === state.activeTabId} aria-label={`${tab.title || tab.url || `Neuer Tab ${index + 1}`} auswählen`} className="browser-tab-select" onClick={() => void command(() => window.studio.browserSelectTab(tab.id))}>
          <Globe2 size={14} aria-hidden="true" /><span>{tab.title || tab.url || 'Neuer Tab'}</span>{tab.loading ? <RotateCw size={12} className="spin" aria-label="Lädt" /> : null}
        </button>
        <button type="button" className="browser-tab-close" title="Tab schließen" aria-label={`${tab.title || tab.url || `Tab ${index + 1}`} schließen`} onClick={() => void command(() => window.studio.browserCloseTab(tab.id))}><X size={13} /></button>
      </div>)}
      <button type="button" className="browser-tab-add" aria-label="Neuer Tab" title="Neuer Tab" onClick={() => void command(() => window.studio.browserNewTab())}><Plus size={17} /></button>
    </div>
    <div className="browser-toolbar">
      <div className="browser-nav-buttons">
        <button type="button" className="icon-button" aria-label="Zurück" title="Zurück" disabled={!state.canGoBack} onClick={() => void command(() => window.studio.browserBack())}><ArrowLeft size={17} /></button>
        <button type="button" className="icon-button" aria-label="Vorwärts" title="Vorwärts" disabled={!state.canGoForward} onClick={() => void command(() => window.studio.browserForward())}><ArrowRight size={17} /></button>
        <button type="button" className="icon-button" aria-label="Neu laden" title="Neu laden" disabled={!state.url} onClick={() => void command(() => window.studio.browserReload())}><RotateCw size={17} className={state.loading ? 'spin' : undefined} /></button>
        <button type="button" className="icon-button" aria-label="Screenshot in Zwischenablage kopieren" title="Sichtbaren Tab als Screenshot kopieren" disabled={!active || !state.url || state.loading} onClick={() => void capture()}><Camera size={17} /></button>
        <button type="button" className="icon-button" aria-label="Im Standardbrowser öffnen" title="Seite im Standardbrowser öffnen" disabled={!active || !state.url || state.loading} onClick={() => void openExternal()}><ExternalLink size={17} /></button>
      </div>
      <form className="browser-address" onSubmit={(event) => void navigate(event)}>
        <Globe2 size={17} aria-hidden="true" />
        <label className="sr-only" htmlFor="browser-url">Webadresse</label>
        <input id="browser-url" type="text" inputMode="url" autoComplete="url" spellCheck={false} value={address} onChange={(event) => setAddress(event.target.value)} onFocus={() => { editing.current = true; }} onBlur={() => { editing.current = false; }} placeholder="https://example.com" />
        <button type="submit" className="secondary-button">Öffnen</button>
      </form>
    </div>
    {error || state.error ? <div className="browser-error" role="alert">{error || state.error}</div> : null}
    {notice ? <div className="browser-notice" role="status">{notice}</div> : null}
    <div className="browser-viewport" ref={viewport}>
      {!state.url ? <div className="browser-empty"><Globe2 size={30} /><h2>Browser</h2><p>Gib oben eine Webadresse ein. Webseiten laufen getrennt von den Rechten der App und der CLI-Agenten.</p></div> : null}
    </div>
  </section>;
}
