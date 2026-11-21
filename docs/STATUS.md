# Status

Stand: 21.11.2026, 01:40 Uhr (Europe/Berlin). Dies ist ein Entwicklungsstand, keine vollständige Kangentic-Parität.

## Umgesetzt

- Eigenständige Electron/React/SQLite-App mit mehreren lokalen Projekten, konfigurierbaren Board-Spalten, Karten, Drag-and-drop, Tastaturverschiebung per M, Suche, kombinierbaren Spalten-/Archiv-/Prioritäts-/Label-Filtern und persistentem Archiv. Priorität und Labels bleiben nach Neustart erhalten; ältere Karten erhalten sichere Standardwerte. Archivierte Karten bleiben lesbar und wiederherstellbar; sie starten keine Agenten. Daten liegen außerhalb des Quell-Repositorys im Electron-`userData`-Ordner.
- Echte PTY-Sitzungen für Codex, Claude, Gemini und anpassbare CLI-Prozesse mit Live-Ausgabe, Eingabe, Stop und begrenztem Terminal-Resize. Nach App-Neustart werden vorher laufende Sitzungen mit erhaltener Ausgabe als fehlgeschlagen markiert, ohne Replay. Codex CLI wurde mit einem synthetischen Projekt live geprüft; Claude und Gemini sind auf diesem Laptop nicht installiert.
- Persistente einfache Workflow-Route mit Abschlussmarker, Freigabe vor Schritten, manuellen Schritten, Pause bei Fehler oder Neustart. Globaler Workflow-Agent mit eigener Agent-/Modell-/Effort-Einstellung und schreibgeschütztem Codex-Planer; ein echter Codex-Aufruf lieferte einen gültigen Vorschlag. Die Vorschau braucht eine explizite Übernahme.
- Explizit aktivierbare To-Do-Warteschlange pro Projekt mit gewählter Workflow-Route, maximal einem Agentenlauf pro Projekt und sichtbarem Pause-/Resume-Status. Nach Fehler oder Neustart bleibt sie zur Prüfung pausiert; unsichere Schritte werden nicht automatisch wiederholt. Fünf gezielte synthetische Queue-Integrationstests bestanden. WLAN-Ausfälle werden nur über den Zustand des laufenden CLI-Prozesses erkannt.
- Manuelle Memory-Notizen mit `[[Verknüpfungen]]`, Rückverweisen, Graph, globaler Suche, sicherer Markdown-Vorschau und bewusstem Import/Export einzelner `.md`-Dateien. Ein expliziter Projektordner-Export legt für alle Notizen einen neuen Markdown-Unterordner an und überschreibt keine vorhandenen Dateien. Noch kein Vault-Import, Live-Abgleich oder automatische Indizierung von Agentengesprächen.
- Projektweite Suche mit Strg/⌘+K, Aktivitätsansicht für Agentenläufe, Workflows und Karten ohne Lauf. Gespeicherte Agentenausgabe lässt sich pro Sitzung ansehen und explizit als Text exportieren. Der eingebettete Browser hat isolierte Session, mehrere Tabs, eigenen Verlauf, URL-Policy, explizites Link-Kontextmenü und blockiert automatische Pop-ups, Downloads und Browser-Berechtigungen. Tab-Adressen werden lokal gespeichert und beim Neustart angezeigt; Webseiten laden erst beim Öffnen. Ein sichtbarer Tab lässt sich nach Klick als Screenshot in die Zwischenablage kopieren oder im Standardbrowser öffnen. Ein echter Webseitenlauf im sichtbaren Fenster bleibt ungeprüft.
- Trello-Board-JSON-Import mit lokaler Vorschau, gezielter Auswahl, ID-Duplikaterkennung und Archivübernahme. Kein Agenten-Autostart beim Import; Tests nutzen synthetische Daten.
- Optionale Git-Worktrees pro Karte bei expliziten Agentensitzungen: eigener Branch/Ordner außerhalb des Projekt-Checkouts, Wiederverwendung nach Neustart, Status-/Diff-Vorschau und bestätigte Fast-Forward-Übernahme nach Prüfung beider Checkouts. Kein automatisches Löschen, Reset, Konflikt-Merge oder Cleanup-Dialog.
- Offline-Spracheingabe nach Aufnahmeende mit Faster-Whisper. Python-Brücke und lokales Whisper-Base-Modell lieferten für einen synthetischen deutschen Windows-SAPI-Clip das gleiche Transkript. Der Mikrofonklick in der UI ist noch nicht visuell geprüft.
- Persistenter Hell/Dunkel-Schalter mit Systemvorgabe sowie Kontrast- und Bewegungspräferenzen. Öffentlicher Secret-/Pfad-Scan vor Push, ignorierte lokale Daten, Windows-CI mit Tests und nativem Paketbau.

## Prüfungen

Auf dem Entwicklungslaptop bestanden `npm run typecheck`, `npm test` (93 bestanden, 2 optionale Live-Tests übersprungen), `npm run build` und `npm run smoke:source` für `e4b96a6`. Der erste Gesamtlauf hatte bei 92 bestandenen Tests einen reinen 20-Sekunden-Timeout des bestehenden Worktree-/PTY-Tests; isoliert bestand er in 16 Sekunden, danach wurde sein Limit auf 60 Sekunden gesetzt und der vollständige Lauf bestand. Der danach ergänzte Test auf ignorierte Pfadkollision bei einer Git-Umbenennung bestand gezielt (1 Test; auf diesem Laptop 186 Sekunden unter paralleler Last). `npm audit --audit-level=critical` fand in der Windows-CI 0 kritische Funde. Die beiden Codex-Live-Tests wurden separat erfolgreich ausgeführt. Ein früher nativer UI-Durchlauf speicherte Projekt, Karte, Notiz und manuellen Workflow. Danach wurde Rechnersteuerung auf Nutzerwunsch beendet; Responsive-Darstellung, Mikrofonoberfläche und Browser-Seite wurden nicht weiter visuell geprüft.
Im isolierten Board-Zweig bestanden zusätzlich `npm run typecheck`, `npm test -- --maxWorkers=2` (85 bestanden, 2 optionale Live-Tests übersprungen), `npm run build` und `npm run smoke:source`. Der kombinierte Stand wird nach der Integration geprüft. Die neue Prioritäts-/Label-Auswahl wurde noch nicht visuell bedient.

Für den neuen Projektordner-Export bestanden zusätzlich sieben gezielte Memory-Tests mit synthetischen Notizen. Vollständige Suite und Windows-CI müssen nach Integration erneut laufen; ein echter Ordnerdialog wurde noch nicht visuell bedient.

Der reguläre lokale Forge-Paketbau braucht Visual-Studio-C++-Build-Tools, die hier fehlen. [Windows-CI 44842782495](https://github.com/mschr703CODEX/jarvis-studio/actions/runs/44842782495) für `e4b96a6` bestand vollständig: Audit, Doctor, Typprüfung, Tests, Build, Public-Scan und ein portables ZIP mit nativen Modulen. Ein früheres CI-ZIP startete im verdeckten Electron-Smoke-Test auf dem Entwicklungslaptop; ZIP-Namen enthielten keine `.env`, Datenbank oder Browserprofile. Noch kein Installer oder signiertes Release. Zwei zuvor entdeckte Windows-Kurzpfadfehler in Worktree-Tests sind in der grünen CI behoben.

## Nächster Schritt

1. Kombinierten Stand aus Board-Metadaten und Memory-Ordnerexport prüfen und öffentlich pushen; ausdrückliche Codex-Wiederaufnahme danach integrieren.
2. Lokalen Trello-Import und Workflow-Route in einem echten UI-Durchlauf prüfen, sobald Rechnersteuerung wieder erlaubt ist.
3. Danach weitere Paritätsbausteine: zusätzliche CLI- und Importadapter sowie verfeinerte Queue-Steuerung.

Der bisherige Jarvis-Kern bleibt während des Aufbaus dieser App pausiert. [PARITY.md](PARITY.md) nennt die offenen Funktionen und Abnahmekriterien.
