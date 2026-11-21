# Jarvis Studio

Eigenständige lokale Windows-App für Projekte, Kanban-Boards, CLI-Agenten, Workflows, Browser und verknüpfte Notizen. Das Ziel ist zunächst Funktionsparität mit Kangentic und danach der Ausbau von Jarvis. Der Quellcode dieser App ist neu geschrieben; [die Paritätsliste](docs/PARITY.md) zeigt die noch offenen Funktionen.

## Starten

Voraussetzungen: Windows 11, Node.js 24, Git. Für Agenten muss die jeweilige CLI separat installiert und angemeldet sein; **Codex CLI** ist auf dem Entwicklungslaptop geprüft. Spracheingabe ist optional und benötigt Python 3.13 und ein lokales Whisper-Modell.

```powershell
npm ci
npm run dev
```

`npm run dev` kompiliert den Electron-Hauptprozess, startet Vite nur auf `127.0.0.1:5181` und öffnet die Desktop-App. Zum Beenden im Startterminal `Ctrl+C` drücken. Ein Produktionsbuild aus dem Quellcode lässt sich mit `npm run build` erstellen und anschließend mit `npm start` öffnen. Über die Sonne/Mond-Schaltfläche in der Kopfzeile wird das lokal gespeicherte helle oder dunkle Design gewählt. Ein portables Windows-ZIP wird mit `npm run make:win` gebaut; Voraussetzungen und Grenzen stehen in [RELEASE.md](docs/RELEASE.md). Ein Installer ist noch nicht vorhanden.

## Erste Arbeitsschritte

1. **Projekt hinzufügen** und einen existierenden absoluten Ordner auswählen. App-Daten liegen im Electron-`userData`-Ordner außerhalb des Repositorys.
2. Im **Board** eine Karte anlegen. Karten lassen sich ziehen oder per **M** und Zielspaltenauswahl mit der Tastatur verschieben, suchen und nach Spalte oder Archivstatus filtern. Archivierte Karten bleiben mit ihrem Verlauf erhalten und können wiederhergestellt werden. Spalten können einen Agenten und optionalen Autostart bekommen; Autostart ist zunächst aus.
3. Unter **Agenten** die installierten CLIs prüfen. Eine Karte öffnen, Agent wählen und den Lauf starten. Optional kann für diese Sitzung ein [isolierter Git-Worktree](docs/WORKTREES.md) gewählt werden. In der Karte lassen sich sein Git-Stand prüfen und bereits committete Änderungen nach ausdrücklicher Bestätigung per Fast-Forward übernehmen. Das Terminal zeigt Live-Ausgabe und erlaubt Eingabe und Stop. Die CLI verwendet ihre eigene Anmeldung; Jarvis Studio speichert keinen API-Schlüssel.
4. Unter **Workflows** den globalen Workflow-Agenten mit **Agent, Modell und Effort** einstellen, ein Ziel beschreiben und den Vorschlag prüfen. Erst **Vorschlag übernehmen** legt Karten und einen Entwurf an; **Starten** beginnt die Ausführung. Der Planer unterstützt derzeit nur Codex CLI in einem schreibgeschützten Aufruf. Alternativ Karten und Spaltenroute manuell wählen. Ein Agentenschritt gilt nur dann als abgeschlossen, wenn der Prozess erfolgreich endet **und** die letzte bereinigte Ausgabezeile `[JARVIS_STEP_DONE]` ist. Ein fehlender Marker oder Fehler pausiert den Ablauf zur Prüfung. Eine [To-Do-Warteschlange](docs/QUEUE.md) kann mit einer bestehenden Workflow-Route ausdrücklich aktiviert werden und Karten nacheinander bearbeiten.
5. Unter **Memory** Notizen speichern und als sichere Markdown-Vorschau ansehen. `[[Titel einer Notiz]]` erzeugt eine anklickbare Verbindung; Rückverweise und ein Graph zeigen den Zusammenhang. Einzelne `.md`-Dateien lassen sich bewusst importieren und exportieren; [Anleitung](docs/MEMORY.md). Diese erste Memory-Stufe indexiert noch keine Agentengespräche automatisch.
6. Mit **Strg+K** Karten, Workflows und Memory-Notizen im aktiven Projekt suchen. Unter **Aktivität** gespeicherte Läufe, pausierte Workflows und Karten ohne Lauf ansehen; konkrete [Agentenverläufe](docs/ACTIVITY.md) lassen sich öffnen und als Text speichern. Der **Browser** öffnet Webadressen in isolierten Tabs, stellt die Tab-Adressen nach einem Neustart wieder her und öffnet einen angeklickten Link nach Rechtsklick nur auf ausdrückliche Auswahl in einem neuen Tab; [Berechtigungen und Grenzen](docs/BROWSER.md) sind beschrieben.
7. Einen Trello-Board-Export über **Board → Importieren** zunächst ansehen und ausgewählte Karten bewusst übernehmen. Duplikate werden anhand der Trello-ID erkannt. [Importanleitung](docs/IMPORT.md).
8. Für Spracheingabe [die lokale Voice-Einrichtung](docs/VOICE.md) ausführen. Ein kurzer Clip wird offline transkribiert und erscheint vor dem Senden als editierbarer Text.

Workflows und Karten werden in SQLite gespeichert. Wenn die App während eines laufenden Agenten endet, werden dessen Sitzung und der Workflow beim nächsten Start zur Prüfung markiert; Aktionen werden nicht blind erneut ausgeführt. Eine echte Wiederaufnahme desselben CLI-Gesprächs nach WLAN-Ausfall gehört noch zur [Zuverlässigkeitsstufe](docs/PARITY.md).

## Prüfen

```powershell
npm run typecheck
npm test
npm run build
npm audit --audit-level=critical
```

Vor einer öffentlichen Veröffentlichung zusätzlich `node scripts/check-public.mjs` auf den gestagten Dateien ausführen. Das Skript sperrt typische Schlüssel, persönliche Benutzerpfade und lokale Datenordner, ohne gefundene Werte auszugeben. Öffentliche Beispiele verwenden synthetische Daten.

## Stand und Grenzen

[STATUS.md](docs/STATUS.md) nennt den tatsächlich geprüften Stand. Die App ist eine frühe Entwicklungsfassung. Kangentic-Funktionen wie weitere Importquellen, Konflikt-Merge und Worktree-Aufräumen, weitere CLI-Adapter, Live-Diktat, kontrollierte Browsersteuerung durch Agenten, Remote-Mobilzugriff und automatische Knowledge-Graph-Indizierung stehen noch auf der [Paritätsliste](docs/PARITY.md). Die bisherige Jarvis-Implementierung bleibt während dieses Aufbaus pausiert.
