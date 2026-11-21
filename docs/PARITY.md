# Funktionsparität: Kangentic → Jarvis Studio

Stand: 20.11.2026. Diese Liste ist eine **Arbeits- und Abnahmeliste**, keine Behauptung, dass alle Funktionen bereits existieren. Die Referenz ist der lokal geprüfte Kangentic-Stand 0.60.0 (Quellstand `292413b8a`), vor allem dessen [Produktübersicht](https://github.com/Kangentic/kangentic/blob/292413b8a/docs/user-guide/overview.md), [Board-Anleitung](https://github.com/Kangentic/kangentic/blob/292413b8a/docs/user-guide/board-basics.md), [Workflow-Dokumentation](https://github.com/Kangentic/kangentic/blob/292413b8a/docs/architecture/workflows/index.md) und [Diktat-Architektur](https://github.com/Kangentic/kangentic/blob/292413b8a/docs/architecture/dictation.md). Jarvis Studio wird unabhängig implementiert; diese Liste beschreibt beobachtete Produktfunktionen und übernimmt keinen Kangentic-Code.

| Bereich | Kangentic-Funktion als Referenz | Erste Jarvis-Studio-Stufe | Abnahme für echte Parität |
|---|---|---|---|
| Projekte und Board | Mehrere Projekte, konfigurierbare Spalten, Karten, Drag-and-drop, Filter, Themes | Projekte, Spalten, Karten, Verschieben per Maus/Tastatur, Suche, kombinierte Spalten-/Archiv-/Prioritäts-/Label-Filter, persistentes Kartenarchiv und Hell/Dunkel-Schalter implementiert | Zustandswechsel, Bulk-Aktionen, Labels und Themes visuell vollständig geprüft |
| Backlog und Import | Backlog, Prioritäten, Labels, Anhänge, Bulk-Operationen; Import aus GitHub, Trello, Jira, Linear, Asana, Azure DevOps, GitLab | Lokale Karten mit Priorität und Labels; Trello-Board-JSON mit Vorschau, gezielter Übernahme, ID-Duplikaten, benannten Labels und Archivstatus; [Grenzen](IMPORT.md) | Weitere Quellen, Listen-Zuordnung, Anhänge und Fehlerfälle je Quelle geprüft |
| Agenten | Viele CLI-Adapter, Projekt-/Spaltenwahl, Modell und Effort, Konten | Codex, Claude, Gemini und frei konfigurierbare CLI als erste echte Prozesse | Installationserkennung, Login-Hinweis, sichere Argumente, Session-Resume pro Adapter, Kontowechsel |
| Terminal und Sitzungen | PTY mit Live-Scrollback, Hooks, Status, Pausieren, Wiederaufnahme, Warteschlange | PTY mit xterm.js-ANSI-Darstellung, Tastatur, Stop, Resize und Ansicht/Export historischer Läufe; [bewusstes Codex-Resume](SESSION_RESUME.md) über den CLI-Picker nach Abbruch; Crash markiert die Studio-Sitzung fehlgeschlagen und pausiert Workflows | CLI-Abbruch, Ausfall, Limits, verlässliche Zuordnung zur exakten Codex-Gesprächs-ID und keine doppelte Aktion nach Recovery |
| Workflows | Globaler Workflow-Agent, Planen, Ausführen, Review, Testen und Merge mit Abhängigkeiten, Kapazität, automatischen Übergängen und Recovery | Globaler Codex-Planer mit Agent/Modell/Effort und Vorschau; einfache persistente Route, Gates, Freigaben, Pause/Resume und explizite [To-Do-Warteschlange](QUEUE.md) mit einem Agentenlauf pro Projekt | Weitere Planer-Adapter, Kapazitätsregeln, verifizierte Übergänge, Retry/Backoff und Wiederaufnahme derselben CLI-Sitzung nach WLAN-Ausfall |
| Spaltenaktionen | On-enter/exit-Automationen, Skripte, Webhooks, Übergangsvorlagen | Noch offen | Wirkung und Wiederholungsschutz mit echten lokalen/externen Testzielen |
| Git | Worktrees und Branches pro Aufgabe, PR-Verknüpfung und Kontextübergabe zwischen Agenten | Optionale [Karten-Worktrees](WORKTREES.md) für explizite Sitzungen mit Wiederverwendung, Status-/Diff-Vorschau und bestätigtem Fast-Forward-Merge | Konflikt-Review, Aufräumen, Kontextübergabe und PR-Verknüpfung; Secret-Scan vor jedem öffentlichen Push |
| Memory | Knowledge Graph aus Aufgaben, Gesprächen, Commits, semantische Suche und Antwortansicht | Manuell verlinkte Notizen, Rückverweise, Graph, sichere Markdown-Vorschau, einzelne .md-Importe/Exporte, expliziter Projektordner-Export und Stichwortsuche in gespeicherten Agentenverläufen | Automatische Zusammenfassung/Verknüpfung von Quellen, Commit-Bezug, vollständiger Vault-Import und Live-Abgleich, semantische Suche und Neuaufbau |
| Sprache | Lokales Live-Diktat, Presets, Push-to-talk, Zielauswahl, optionales Cloud-Refinement | Lokales Whisper-Transkript nach Aufnahmeende; [Einrichtung](VOICE.md) | Live-Streaming, Hotkey, Browser-/Terminal-Ziel, Datenschutz, Latenz und Abbruch |
| Browser | Eingebettetes Fenster und kontrollierte Agent-Browserwerkzeuge | Eingebetteter isolierter WebContentsView mit Tabs, Adressleiste, Navigation, lokal wiederhergestellten Tab-Adressen, explizitem Link-Kontextmenü sowie nutzerseitigem Screenshot und Öffnen im Standardbrowser; [Grenzen](BROWSER.md) | Echter sichtbarer Webseitenlauf, Profil-/Tab-Isolation, Freigaben und kontrollierte Agent-Klickpfade |
| Remote und Mobil | WSL/SSH-Ausführung, mobile Bridge, Wiederverbindung | Noch offen | Session-Handoff bei Netzwerkverlust und getrennte Geräteberechtigungen |
| Einstellungen | App/Projekt/Spalten-Kaskade, Suchfeld, Themes, Accounts und Verbrauch | Agent-Konfiguration als Start | Export/Import, Priorität der Einstellungen, Geheimnisspeicher und Kostenbelege |
| Erweiterbarkeit | MCP-Tools, Board-Adapter und Integrationen | Vertrag für spätere Module geplant | Installieren, Aktivieren, Entfernen und Versionierung ohne Eingriff in den Kern |

Die Referenz unterstützt konkret Claude Code, Codex CLI, Gemini CLI, Antigravity CLI, Qwen Code, Kimi Code, OpenCode, Droid/Factory, Cursor CLI, GitHub Copilot CLI, Aider, Oz/Warp, Ollama, Grok Build und Goose CLI. Die erste Stufe deckt davon nur Codex, Claude und Gemini sowie einen frei konfigurierbaren Prozess ab. Jeder weitere Adapter benötigt einen eigenen Start-, Eingabe-, Wiederaufnahme- und Fehlertest; ein generischer Befehlseintrag allein zählt nicht als vollständiger Adapter.

Weitere sichtbare Referenzflächen: Markdown- und Dateianhänge in Karten, Command Terminal, Aktivitätsmonitor mit Kosten/Token, zwölf Themes, mehrere Konten pro Agent, gemeinsame Board-Konfiguration, Benachrichtigungen und mobile Begleitung. Eine einfache globale Suchpalette und eine lokale Aktivitätsübersicht sind vorhanden; Token und Kosten werden noch nicht erhoben. Für die nächste Planung werden die übrigen Funktionen als getrennte, testbare Arbeitspakete geführt, statt pauschal als „Kangentic-Parität“ markiert zu werden.

## Erste überprüfbare Strecke

1. Ein Projekt mit einem echten lokalen Repository anlegen.
2. Eine Karte erstellen und in eine Agent-Spalte verschieben.
3. Einen installierten CLI-Agenten auswählen; dessen PTY-Ausgabe live ansehen, Eingabe senden und den Lauf stoppen.
4. Eine kleine Workflow-Route anlegen, starten, pausieren und nach App-Neustart wiederfinden.
5. Eine Memory-Notiz speichern, verlinken und im Graphen öffnen.
6. Eine kurze Aufnahme lokal transkribieren und den Text vor dem Senden ändern.

Die sechs Punkte sind **erst nach Tests und einem echten UI-Durchlauf** als fertig zu markieren. Insbesondere ein gestarteter CLI-Prozess beweist noch keine stabile Wiederaufnahme; ein sichtbarer Graph beweist noch keine automatische Wissensindizierung. Die weiteren Zeilen bleiben offen, bis ihre jeweilige Abnahme belegt ist.

## Umsetzung in Etappen

1. Desktop-Kern: Datenmodell, IPC, PTY, Board, Agentenwahl, erste Route, manuelle Notizen, lokales Transkript.
2. Zuverlässigkeit: Warteschlange, Dauerzustand, Resume je CLI, Testgates, Retry/Backoff, Undo und Abbruch.
3. Parität der Arbeitsmittel: Backlog/Import, Git-Worktrees, Automationen, Browser, Suche, Quellen, Einstellungen und Konten.
4. Jarvis-Ausbau: allgemeines Gespräch, freigegebene persönliche Module und Obsidian-artiges Langzeitgedächtnis mit belegbaren Quellen.

Persönliche Zugangsdaten und Modulzustände gehören in einen lokalen Datenordner oder private Pakete. Das öffentliche Repository enthält nur allgemeine Implementierung und synthetische Testdaten.
