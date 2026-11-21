import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, Bot, BrainCircuit, Columns3, Download, GitBranch, Globe2, Moon, Plus, RefreshCw, Search, Settings2, Sparkles, Sun, TerminalSquare, Upload } from 'lucide-react';
import type { Project, ProjectPackagePreview, ProjectSnapshot, Session } from '../shared/types';
import { BoardView } from './components/BoardView';
import { WorkflowView } from './components/WorkflowView';
import { MemoryView } from './components/MemoryView';
import { AgentView } from './components/AgentView';
import { CommandTerminalView } from './components/CommandTerminalView';
import { BrowserView } from './components/BrowserView';
import { SearchPalette } from './components/SearchPalette';
import { ActivityView } from './components/ActivityView';
import { ProjectPackageDialog } from './components/ProjectPackageDialog';
import { sessionMemoryDraft } from './activity-transcript';
import { viewForSearchKind, type ProjectSearchResult, type SearchKind } from './project-search';
import { currentTheme, persistTheme, themeToggleLabel, type ThemePreference } from './theme';
import './theme.css';

type View = 'board' | 'activity' | 'workflows' | 'memory' | 'agents' | 'terminal' | 'browser';
type NavigationTarget = { kind: SearchKind; id: string; token: number };

const views: { id: View; name: string; icon: typeof Columns3 }[] = [
  { id: 'board', name: 'Board', icon: Columns3 },
  { id: 'activity', name: 'Aktivität', icon: Activity },
  { id: 'workflows', name: 'Workflows', icon: GitBranch },
  { id: 'memory', name: 'Memory', icon: BrainCircuit },
  { id: 'agents', name: 'Agenten', icon: Bot },
  { id: 'terminal', name: 'Terminal', icon: TerminalSquare },
  { id: 'browser', name: 'Browser', icon: Globe2 },
];

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [view, setView] = useState<View>('board');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', path: '' });
  const [importPreview, setImportPreview] = useState<ProjectPackagePreview | null>(null);
  const [importTarget, setImportTarget] = useState({ name: '', path: '' });
  const [notice, setNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<NavigationTarget | null>(null);
  const [theme, setTheme] = useState<ThemePreference>(currentTheme);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const focusBeforeSearch = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    persistTheme(theme);
  }, [theme]);

  const loadProjects = useCallback(async () => {
    if (!window.studio) throw new Error('Die Desktop-Verbindung ist nicht verfügbar. Bitte Jarvis Studio als App starten.');
    const items = await window.studio.projects();
    setProjects(items);
    setProjectId((previous) => previous && items.some((item) => item.id === previous) ? previous : items[0]?.id ?? null);
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId || !window.studio) return;
    setSnapshot(await window.studio.snapshot(projectId));
  }, [projectId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadProjects().catch((reason: unknown) => {
      if (active) setError(messageOf(reason));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadProjects]);

  useEffect(() => {
    setSnapshot(null);
    setSearchOpen(false);
    setNavigationTarget(null);
    if (!projectId) return;
    let active = true;
    window.studio.snapshot(projectId).then((data) => {
      if (active) setSnapshot(data);
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (snapshot?.project.id === projectId && !creatingProject) openSearch();
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [snapshot, projectId, creatingProject]);

  useEffect(() => window.studio.onBrowserSearchShortcut(() => {
    if (snapshot?.project.id === projectId && !creatingProject) {
      focusBeforeSearch.current = searchButtonRef.current;
      setSearchOpen(true);
    }
  }), [snapshot?.project.id, projectId, creatingProject]);

  function openSearch() {
    if (!searchOpen) focusBeforeSearch.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSearchOpen(true);
  }

  function closeSearch() {
    setSearchOpen(false);
    const previous = focusBeforeSearch.current;
    requestAnimationFrame(() => (previous?.isConnected ? previous : searchButtonRef.current)?.focus());
  }

  function navigateToEntity(kind: SearchKind, id: string) {
    setNavigationTarget((old) => ({ kind, id, token: (old?.token ?? 0) + 1 }));
    setView(viewForSearchKind(kind));
  }

  function navigateToResult(result: ProjectSearchResult) {
    navigateToEntity(result.kind, result.id);
    closeSearch();
  }

  async function saveSessionAsNote(session: Session) {
    if (!snapshot || session.projectId !== snapshot.project.id || session.state === 'running') return;
    const existing = snapshot.notes.find((note) => note.tags.includes('agentenlauf') && note.body.includes(`Sitzung: ${session.id}\n`));
    if (existing) { navigateToEntity('note', existing.id); return; }
    const cardTitle = snapshot.cards.find((card) => card.id === session.cardId)?.title ?? 'Entfernte Karte';
    const agentName = snapshot.agents.find((agent) => agent.id === session.agentId)?.name ?? 'Entfernter Agent';
    const saved = await mutate(() => window.studio.saveNote({ projectId: snapshot.project.id, ...sessionMemoryDraft(session, cardTitle, agentName) }));
    if (saved) navigateToEntity('note', saved.id);
  }

  useEffect(() => {
    if (!projectId || !window.studio) return;
    const unsubscribe = window.studio.onSessionEvent((event) => {
      if (event.type === 'output') {
        setSnapshot((old) => old ? {
          ...old,
          sessions: old.sessions.map((session) => session.id === event.sessionId
            ? { ...session, output: (session.output + event.data).slice(-100_000) } : session),
        } : old);
      } else {
        void refresh().catch((reason: unknown) => setError(messageOf(reason)));
      }
    });
    const timer = window.setInterval(() => { void refresh().catch(() => undefined); }, 15_000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [projectId, refresh]);

  async function mutate<T>(action: () => Promise<T>): Promise<T | null> {
    try {
      setError('');
      const result = await action();
      await refresh();
      return result;
    } catch (reason) {
      setError(messageOf(reason));
      return null;
    }
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await mutate(() => window.studio.createProject(newProject));
    if (!created) return;
    await loadProjects();
    setProjectId(created.id);
    setCreatingProject(false);
    setNewProject({ name: '', path: '' });
  }

  async function exportProjectPackage() {
    if (!projectId) return;
    try {
      setError('');
      const result = await window.studio.exportProjectPackage(projectId);
      if (result) setNotice(`Projektpaket gespeichert: ${result.file}`);
    } catch (reason) { setError(messageOf(reason)); }
  }

  async function previewProjectPackage() {
    try {
      setError('');
      const preview = await window.studio.previewProjectPackage();
      if (!preview) return;
      setImportPreview(preview);
      setImportTarget({ name: `${preview.name} (Import)`, path: '' });
    } catch (reason) { setError(messageOf(reason)); }
  }

  async function importProjectPackage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!importPreview) return;
    const created = await mutate(() => window.studio.importProjectPackage({ fingerprint: importPreview.fingerprint, ...importTarget }));
    if (!created) return;
    await loadProjects();
    setProjectId(created.id);
    setImportPreview(null);
    setNotice(`Projekt „${created.name}“ wurde importiert. Agenten und Warteschlange bleiben ausgeschaltet.`);
  }

  const activeView = views.find((item) => item.id === view)!;
  const ViewIcon = activeView.icon;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Sparkles size={19} strokeWidth={2.4} /></span><span><strong>JARVIS</strong><small>STUDIO</small></span></div>
      <div className="side-section-title">WORKSPACE</div>
      <label className="sr-only" htmlFor="project-select">Projekt auswählen</label>
      <select id="project-select" className="project-select" value={projectId ?? ''} onChange={(event) => setProjectId(event.target.value || null)}>
        {projects.length === 0 ? <option value="">Kein Projekt</option> : null}
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <button className="sidebar-add" type="button" onClick={() => setCreatingProject(true)}><Plus size={15} /> Projekt hinzufügen</button>
      <button className="sidebar-add sidebar-package" type="button" onClick={() => void previewProjectPackage()}><Upload size={15} /> Projekt importieren</button>
      <button className="sidebar-add sidebar-package" type="button" disabled={!projectId} onClick={() => void exportProjectPackage()}><Download size={15} /> Projekt sichern</button>
      <div className="side-section-title navigation-title">BEREICHE</div>
      <nav className="side-nav" aria-label="Hauptnavigation">
        {views.map(({ id, name, icon: Icon }) => <button key={id} type="button" className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}><Icon size={18} /> {name}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="status-dot" /><span>Lokaler Workspace</span><Settings2 size={16} /></div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div className="topbar-title"><span className="topbar-icon"><ViewIcon size={21} /></span><div><small>{snapshot?.project.name ?? 'JARVIS STUDIO'}</small><h1>{activeView.name}</h1></div></div>
        <div className="topbar-actions"><span className="topbar-meta">{snapshot ? `${snapshot.cards.length} Karten · ${snapshot.sessions.filter((session) => session.state === 'running').length} aktiv` : 'Bereit'}</span><button ref={searchButtonRef} className="search-trigger" type="button" title="Projekt durchsuchen (Strg/⌘ K)" aria-label="Projekt durchsuchen" disabled={!snapshot || snapshot.project.id !== projectId} onClick={openSearch}><Search size={16} /><span>Suche</span><kbd>⌘ K</kbd></button><button className="icon-button theme-toggle" type="button" title={themeToggleLabel(theme)} aria-label={themeToggleLabel(theme)} onClick={() => setTheme((previous) => previous === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}</button><button className="icon-button" type="button" title="Aktualisieren" aria-label="Aktualisieren" onClick={() => void refresh()}><RefreshCw size={17} /></button></div>
      </header>
      <div className="mobile-workspace">
        <label className="sr-only" htmlFor="mobile-project-select">Projekt auswählen</label>
        <select id="mobile-project-select" value={projectId ?? ''} onChange={(event) => setProjectId(event.target.value || null)}>
          {projects.length === 0 ? <option value="">Kein Projekt</option> : null}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button className="icon-button" type="button" onClick={() => setCreatingProject(true)} aria-label="Projekt hinzufügen" title="Projekt hinzufügen"><Plus size={18} /></button>
        <button className="icon-button" type="button" onClick={() => void previewProjectPackage()} aria-label="Projekt importieren" title="Projekt importieren"><Upload size={18} /></button>
        <button className="icon-button" type="button" disabled={!projectId} onClick={() => void exportProjectPackage()} aria-label="Projekt sichern" title="Projekt sichern"><Download size={18} /></button>
      </div>

      {error ? <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Fehler schließen">×</button></div> : null}
      {notice ? <div className="package-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Hinweis schließen">×</button></div> : null}
      {loading ? <div className="content-message">Projekte werden geladen…</div> : view === 'browser' ? <div className="view-area"><BrowserView active={!creatingProject && !searchOpen} /></div> : !projectId ? <div className="empty-intro"><div className="intro-icon"><Sparkles size={30} /></div><h2>Dein Agenten-Workspace beginnt hier.</h2><p>Lege ein Projekt mit dem Ordner an, in dem deine Agenten arbeiten sollen. Danach kannst du Aufgaben auf dem Board planen, CLI-Agenten starten und Wissen verknüpfen.</p><button className="primary-button" type="button" onClick={() => setCreatingProject(true)}><Plus size={17} /> Erstes Projekt anlegen</button></div> : !snapshot ? <div className="content-message">Workspace wird geladen…</div> : <div className="view-area">
        {view === 'board' ? <BoardView snapshot={snapshot} mutate={mutate} openCard={navigationTarget?.kind === 'card' ? navigationTarget : null} /> : null}
        {view === 'activity' ? <ActivityView snapshot={snapshot} openSession={navigationTarget?.kind === 'session' ? navigationTarget : null} onSessionClosed={() => setNavigationTarget((old) => old?.kind === 'session' ? null : old)} onOpenCard={(id) => navigateToEntity('card', id)} onOpenWorkflow={(id) => navigateToEntity('workflow', id)} onSaveSessionAsNote={saveSessionAsNote} /> : null}
        {view === 'workflows' ? <WorkflowView snapshot={snapshot} mutate={mutate} openWorkflow={navigationTarget?.kind === 'workflow' ? navigationTarget : null} /> : null}
        {view === 'memory' ? <MemoryView snapshot={snapshot} mutate={mutate} openNote={navigationTarget?.kind === 'note' ? navigationTarget : null} /> : null}
        {view === 'agents' ? <AgentView snapshot={snapshot} mutate={mutate} /> : null}
        {view === 'terminal' ? <CommandTerminalView projectId={snapshot.project.id} /> : null}
      </div>}
    </main>

    {creatingProject ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreatingProject(false); }}><form className="dialog" onSubmit={(event) => void createProject(event)}><div className="dialog-heading"><div><small>WORKSPACE</small><h2>Projekt hinzufügen</h2></div><button type="button" className="icon-button" onClick={() => setCreatingProject(false)} aria-label="Schließen">×</button></div><label>Name<input autoFocus required maxLength={80} value={newProject.name} onChange={(event) => setNewProject((old) => ({ ...old, name: event.target.value }))} placeholder="Mein Projekt" /></label><label>Absoluter Projektordner<input required value={newProject.path} onChange={(event) => setNewProject((old) => ({ ...old, path: event.target.value }))} placeholder="C:\\Projekte\\mein-projekt" /></label><p className="field-help">CLI-Agenten laufen in diesem Ordner und können Dateien verändern.</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setCreatingProject(false)}>Abbrechen</button><button type="submit" className="primary-button">Projekt anlegen</button></div></form></div> : null}
    {importPreview ? <ProjectPackageDialog preview={importPreview} target={importTarget} onTarget={setImportTarget} onClose={() => setImportPreview(null)} onImport={(event) => void importProjectPackage(event)} /> : null}
    {searchOpen && snapshot?.project.id === projectId ? <SearchPalette snapshot={snapshot} onClose={closeSearch} onNavigate={navigateToResult} /> : null}
  </div>;
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
