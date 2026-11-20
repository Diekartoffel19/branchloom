# Status

Stand: 20.11.2026, 22:38 Uhr (Europe/Berlin). Dieses Dokument beschreibt den geprüften Entwicklungsstand, keine vollständige Kangentic-Parität.

## Bereits umgesetzt

- Eigenständige Electron/React/SQLite-App mit mehreren lokalen Projekten, Board-Spalten, Karten, Verschieben und gespeicherten Einstellungen. App-Daten liegen außerhalb des Quell-Repositorys im Electron-`userData`-Ordner.
- Echte CLI-Sitzungen über PTY: Codex, Claude, Gemini und ein anpassbarer Prozess können konfiguriert werden. Live-Ausgabe, Eingabe und Stop sind verfügbar. Ein lokaler Codex-One-Shot mit synthetischem Projekt hat in 19,6 Sekunden erfolgreich geantwortet. Eine native UI-Probe hat Projekt, Karte, Memory-Notiz und manuellen Workflow gespeichert.
- Einfache Workflow-Ausführung mit persistiertem Fortschritt, Abschlussmarker und Pause bei Fehler oder App-Neustart. Freigaben stehen vor einem Schritt, agentenlose Schritte warten auf ausdrückliche Bestätigung. Der globale Workflow-Agent hat eigene Einstellungen für Agent, Modell und Effort sowie eine Vorschau mit expliziter Übernahme. Ein echter, schreibgeschützter Codex-Aufruf erzeugte in rund 13 Sekunden einen gültigen Vorschlag ohne Datei- oder Kartenänderung.
- Manuelle Memory-Notizen mit `[[Verknüpfungen]]`, Rückverweisen und Graph.
- Globale Suche im aktiven Projekt (Karten, Workflows und Memory-Notizen) mit Strg/⌘+K, Tastaturauswahl und Rücksprung. Eingebetteter Browser mit isolierter Session, URL-Policy, Vor/Zurück/Neu laden und abgewiesenen Pop-ups, Downloads und Browser-Berechtigungen. Ein echter Webseitenaufruf im Fenster ist noch nicht visuell geprüft.
- Trello-Board-JSON-Import mit lokaler Vorschau, expliziter Kartenauswahl, stabiler ID-Duplikaterkennung auch nach Neustart und ohne Agenten-Autostart. Persönliche Exportdaten werden nicht gespeichert; Tests verwenden synthetische Exporte.
- Offline-Spracheingabe nach Aufnahmeende über Faster-Whisper. Das lokale Whisper-Base-Modell und die Node/Python-Brücke wurden mit einem synthetischen deutschen Windows-SAPI-Clip geprüft; beide gaben denselben Transkripttext zurück. Die Mikrofonoberfläche selbst wurde noch nicht durchgeklickt.
- Öffentliche Sicherheitsgrundlage: ignorierte lokale Daten, Secret-/Pfadprüfung vor Push, Windows-CI mit Build und Tests.

## Prüfungen

`npm run typecheck`, `npm test` (49 bestanden, 2 bewusst übersprungene Live-Tests), `npm run build` und `npm audit --audit-level=critical` (0 Funde) bestanden auf dem Entwicklungslaptop. Beide optionalen Codex-Live-Tests wurden separat erfolgreich ausgeführt: PTY-Endantwort mit Abschlussmarker und schreibgeschützter strukturierter Workflow-Plan. `npm run smoke:source` startete den gebauten Electron-Hauptprozess, native Module und Renderer ohne Vite. Die Live-Tests hängen von angemeldeten CLIs ab und sind nicht Teil des normalen CI-Laufs. Der native UI-Durchlauf wurde auf Wunsch des Nutzers beendet; es gab danach keine weitere Rechnersteuerung. Responsive Darstellung bei 390 px, Mikrofonklick und Browser-Seitenansicht sind deshalb noch visuell offen.

Ein lokaler regulärer Forge-Paketbau scheiterte an fehlenden Visual-Studio-C++-Build-Tools beim Neuaufbau von `better-sqlite3`. Ein ausdrücklich als Diagnose markierter Paketbau mit den schon im lokalen Electron funktionierenden Binärmodulen gelang; dieser Build ist kein allgemein getestetes Release. Die Windows-CI soll native Module regulär neu bauen und ein portables ZIP bereitstellen. Noch kein Installer oder signiertes Release.

## Nächste konkrete Arbeit

1. Öffentlichen Diff prüfen, Secret-Scan ausführen, einen getesteten Stand committen und im neuen öffentlichen Repository veröffentlichen; Windows-CI und Paketbau prüfen.
2. Lokalen Trello-Import und Workflow-Route in einem echten UI-Durchlauf prüfen, sobald die Nutzersteuerung wieder erlaubt ist.
3. Weitere Kangentic-Parität: Worktrees, Warteschlange/Recovery und zusätzliche CLI-/Importadapter mit getrennten Abnahmen.

Jarvis' bisheriger Kangentic-Workflow ist pausiert. Jarvis selbst bleibt während des Aufbaus dieser App unverändert. Die Paritätsliste in [PARITY.md](PARITY.md) nennt offene Funktionen und Abnahmekriterien.
