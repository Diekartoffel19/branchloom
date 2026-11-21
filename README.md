# Jarvis Studio

Eigenständige lokale Windows-App für Projekte, Kanban-Boards, CLI-Agenten, Workflows, Browser und verknüpfte Notizen. Das Ziel ist zunächst Funktionsparität mit Kangentic und danach der Ausbau von Jarvis. Der Quellcode dieser App ist neu geschrieben; [die Paritätsliste](docs/PARITY.md) zeigt die noch offenen Funktionen.

## Starten

Voraussetzungen: Windows 11, Node.js 24, Git. Für Agenten muss die jeweilige CLI separat installiert und angemeldet sein; **Codex CLI** ist auf dem Entwicklungslaptop geprüft. Spracheingabe ist optional und benötigt Python 3.13 und ein lokales Whisper-Modell.

```powershell
git clone https://github.com/mschr703CODEX/jarvis-studio.git
Set-Location jarvis-studio
npm ci
npm run doctor
npm run dev
```

`npm run doctor` meldet fehlende Pflichtkomponenten; nicht installierte Agenten-CLIs und Spracheingabe sind optional. `npm run dev` kompiliert den Electron-Hauptprozess, startet Vite nur auf `127.0.0.1:5181` und öffnet die Desktop-App. Zum Beenden im Startterminal `Ctrl+C` drücken. Ein Produktionsbuild aus dem Quellcode lässt sich mit `npm run build` erstellen und anschließend mit `npm start` öffnen. Über die Sonne/Mond-Schaltfläche in der Kopfzeile wird das lokal gespeicherte helle oder dunkle Design gewählt. Ein portables Windows-ZIP wird mit `npm run make:win` gebaut; Voraussetzungen und Grenzen stehen in [RELEASE.md](docs/RELEASE.md). Ein Installer ist noch nicht vorhanden.

## Erste Arbeitsschritte

1. **Projekt hinzufügen** und einen existierenden absoluten Ordner auswählen. App-Daten liegen im Electron-`userData`-Ordner außerhalb des Repositorys.
2. Im **Board** eine Karte anlegen. Karten lassen sich ziehen oder per **M** und Zielspaltenauswahl mit der Tastatur zwischen Spalten verschieben. Mit den Auf/Ab-Schaltflächen unter einer aktiven Karte lässt sich ihre Reihenfolge in derselben Spalte ändern; die To-Do-Warteschlange übernimmt diese gespeicherte Reihenfolge beim nächsten freien Kartenstart. Auch bei aktiven Such- oder Label-Filtern beziehen sich die Schaltflächen auf die vollständige Spalte. Karten lassen sich suchen und nach Spalte, Archivstatus, [Priorität und Label](docs/BOARD_METADATA.md) filtern. Für mehrere aktive Karten gibt es [bewusste Sammelaktionen](docs/BULK_BOARD.md) zum Verschieben und Archivieren; die Queue muss dafür pausiert sein, und Spaltenagenten starten dabei nicht. Priorität und Labels werden in der Karte bearbeitet; [lokale Dateien](docs/ATTACHMENTS.md) lassen sich bewusst verknüpfen. Archivierte Karten bleiben mit ihrem Verlauf erhalten und können wiederhergestellt werden. Unter jeder Spalte lassen sich [Agent, Modell und Effort](docs/COLUMN_SETTINGS.md) einstellen; Autostart ist zunächst aus.
3. Unter **Agenten** die [lokale CLI-Erkennung](docs/AGENT_DIAGNOSTICS.md) prüfen. Sie trennt gefundene Programme, erfolgreiche Versionsprüfung und Fehler; eine Anmeldung prüft sie nicht. Eine Karte öffnen, Agent wählen und den Lauf starten. Optional kann für diese Sitzung ein [isolierter Git-Worktree](docs/WORKTREES.md) gewählt werden. In der Karte lassen sich sein Git-Stand prüfen und bereits committete Änderungen nach ausdrücklicher Bestätigung per Fast-Forward übernehmen. Das interaktive Terminal zeigt Live-Ausgabe und erlaubt Tastatur, Eingabe und Stop. Nach einem beendeten Codex-Lauf kann das passende [gespeicherte Gespräch bewusst ausgewählt](docs/SESSION_RESUME.md) werden. Die CLI verwendet ihre eigene Anmeldung; Jarvis Studio speichert keinen API-Schlüssel.
   Für eigene Befehle ohne Karte gibt es den separaten Bereich **Terminal** mit bewusstem [PowerShell-/cmd-Start](docs/COMMAND_TERMINAL.md), Eingabe, Stop und lokalem Verlauf.
4. Unter **Workflows** den globalen Workflow-Agenten mit **Agent, Modell und Effort** einstellen, ein Ziel beschreiben und den Vorschlag prüfen. Erst **Vorschlag übernehmen** legt Karten und einen Entwurf an; **Starten** beginnt die Ausführung. Der Planer unterstützt derzeit nur Codex CLI in einem schreibgeschützten Aufruf. Alternativ Karten und Spaltenroute manuell wählen. Ein Agentenschritt gilt nur dann als abgeschlossen, wenn der Prozess erfolgreich endet **und** die letzte bereinigte Ausgabezeile `[JARVIS_STEP_DONE]` ist. Ein fehlender Marker oder Fehler pausiert den Ablauf zur Prüfung. Eine [To-Do-Warteschlange](docs/QUEUE.md) kann mit einer bestehenden Workflow-Route ausdrücklich aktiviert werden und Karten nacheinander bearbeiten.
5. Unter **Memory** Notizen speichern und als sichere Markdown-Vorschau ansehen. `[[Titel einer Notiz]]` erzeugt eine anklickbare Verbindung; Rückverweise und ein Graph zeigen den Zusammenhang. Einzelne `.md`-Dateien lassen sich bewusst importieren oder exportieren. **Vault-Ordner importieren** zeigt vor dem selektiven Import neue und doppelte Notizen; **Alle Notizen exportieren** schreibt nach Ordnerwahl einen neuen Markdown-Unterordner für das aktive Projekt; [Anleitung](docs/MEMORY.md). Diese Memory-Stufe indexiert noch keine Agentengespräche automatisch.
6. Mit **Strg+K** Karten, Workflows, Memory-Notizen und gespeicherte Agentenverläufe im aktiven Projekt suchen. Unter **Aktivität** gespeicherte Läufe, pausierte Workflows und Karten ohne Lauf ansehen; konkrete [Agentenverläufe](docs/ACTIVITY.md) lassen sich öffnen und als Text speichern. Der **Browser** öffnet Webadressen in isolierten Tabs, stellt die Tab-Adressen nach einem Neustart wieder her und öffnet einen angeklickten Link nach Rechtsklick nur auf ausdrückliche Auswahl in einem neuen Tab; [Berechtigungen und Grenzen](docs/BROWSER.md) sind beschrieben.
7. Einen Trello-Board-Export über **Board → Importieren** zunächst ansehen und ausgewählte Karten bewusst übernehmen. Benannte Trello-Labels werden angezeigt und mitgenommen; Duplikate werden anhand der Trello-ID erkannt. [Importanleitung](docs/IMPORT.md).
8. Für Spracheingabe [die lokale Voice-Einrichtung](docs/VOICE.md) ausführen. Ein kurzer Clip wird offline transkribiert und erscheint vor dem Senden als editierbarer Text.
9. Im linken Workspace-Bereich das aktive Projekt über **Projekt sichern** als lokales JSON-[Projektpaket](docs/PROJECT_PACKAGE.md) exportieren. **Projekt importieren** zeigt vor dem Anlegen eines neuen Projekts eine Vorschau. Die Datei ist nicht verschlüsselt und enthält nur Board, Karten, Notizen und Workflow-Struktur; Agenten und automatische Läufe bleiben beim Import aus.

Workflows und Karten werden in SQLite gespeichert. Wenn die App während eines laufenden Agenten endet, werden dessen Sitzung und der Workflow beim nächsten Start zur Prüfung markiert; Aktionen werden nicht blind erneut ausgeführt. Codex-Gespräche können über den CLI-Picker manuell wieder geöffnet werden; automatische Wiederverbindung und die sichere Fortsetzung einer unterbrochenen Workflow-Aktion gehören noch zur [Zuverlässigkeitsstufe](docs/PARITY.md).

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
