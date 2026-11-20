# Status

Stand: 21.11.2026, 00:05 Uhr (Europe/Berlin). Dies ist der geprüfte Entwicklungsstand, keine vollständige Kangentic-Parität.

## Umgesetzt

- Eigenständige Electron/React/SQLite-App mit mehreren lokalen Projekten, konfigurierbaren Board-Spalten, Karten, Drag-and-drop, Suche, Spaltenfilter und persistentem Archiv. Archivierte Karten bleiben lesbar und wiederherstellbar; sie starten keine Agenten. Daten liegen außerhalb des Quell-Repositorys im Electron-`userData`-Ordner.
- Echte PTY-Sitzungen für Codex, Claude, Gemini und anpassbare CLI-Prozesse mit Live-Ausgabe, Eingabe, Stop und begrenztem Terminal-Resize. Nach App-Neustart werden vorher laufende Sitzungen mit erhaltener Ausgabe als fehlgeschlagen markiert, ohne Replay. Codex CLI wurde mit einem synthetischen Projekt live geprüft; Claude und Gemini sind auf diesem Laptop nicht installiert.
- Persistente einfache Workflow-Route mit Abschlussmarker, Freigabe vor Schritten, manuellen Schritten, Pause bei Fehler oder Neustart. Globaler Workflow-Agent mit eigener Agent-/Modell-/Effort-Einstellung und schreibgeschütztem Codex-Planer; ein echter Codex-Aufruf lieferte einen gültigen Vorschlag. Die Vorschau braucht eine explizite Übernahme.
- Manuelle Memory-Notizen mit `[[Verknüpfungen]]`, Rückverweisen, Graph, globaler Suche und sicherer Markdown-Vorschau mit anklickbaren bekannten Notizen. Noch keine automatische Indizierung von Agentengesprächen.
- Projektweite Suche mit Strg/⌘+K, Aktivitätsansicht für Agentenläufe, Workflows und Karten ohne Lauf. Der eingebettete Browser hat isolierte Session, mehrere Tabs, eigenen Verlauf, URL-Policy und blockiert Pop-ups, Downloads und Browser-Berechtigungen. Tab-Adressen werden lokal gespeichert und beim Neustart angezeigt; Webseiten laden erst beim Öffnen. Ein echter Webseitenlauf im sichtbaren Fenster bleibt ungeprüft.
- Trello-Board-JSON-Import mit lokaler Vorschau, gezielter Auswahl, ID-Duplikaterkennung und Archivübernahme. Kein Agenten-Autostart beim Import; Tests nutzen synthetische Daten.
- Optionale Git-Worktrees pro Karte bei expliziten Agentensitzungen: eigener Branch/Ordner außerhalb des Projekt-Checkouts, Wiederverwendung nach Neustart, kein automatisches Löschen. Noch kein Merge- oder Cleanup-Dialog.
- Offline-Spracheingabe nach Aufnahmeende mit Faster-Whisper. Python-Brücke und lokales Whisper-Base-Modell lieferten für einen synthetischen deutschen Windows-SAPI-Clip das gleiche Transkript. Der Mikrofonklick in der UI ist noch nicht visuell geprüft.
- Öffentlicher Secret-/Pfad-Scan vor Push, ignorierte lokale Daten, Windows-CI mit Tests und nativem Paketbau.

## Prüfungen

Auf dem Entwicklungslaptop bestanden `npm run typecheck`, `npm test` (70 bestanden, 2 optionale Live-Tests übersprungen), `npm run build`, `npm run smoke:source` und `npm audit --audit-level=critical` (0 Funde). Die beiden Codex-Live-Tests wurden separat erfolgreich ausgeführt. Ein früher nativer UI-Durchlauf speicherte Projekt, Karte, Notiz und manuellen Workflow. Danach wurde Rechnersteuerung auf Nutzerwunsch beendet; Responsive-Darstellung, Mikrofonoberfläche und Browser-Seite wurden nicht weiter visuell geprüft.

Der reguläre lokale Forge-Paketbau braucht Visual-Studio-C++-Build-Tools, die hier fehlen. [Windows-CI 44823350598](https://github.com/mschr703CODEX/jarvis-studio/actions/runs/44823350598) baute native Module regulär und erzeugte ein portables ZIP. Dieses ZIP startete im verdeckten Electron-Smoke-Test auf dem Entwicklungslaptop; ZIP-Namen enthielten keine `.env`, Datenbank oder Browserprofile. Noch kein Installer oder signiertes Release. Die folgenden CI-Läufe für neue Worktrees deckten Windows-Kurzpfad-Probleme auf. Der zweite Fix bestand lokal 4/4 Worktree-Tests; die Bestätigung durch einen neuen CI-Lauf steht aus.

## Nächster Schritt

1. Den aktuellen Worktree-Fix und die neuen Features nach Public-Scan committen und pushen; den Windows-CI-Lauf bis zum Ergebnis prüfen.
2. Lokalen Trello-Import und Workflow-Route in einem echten UI-Durchlauf prüfen, sobald Rechnersteuerung wieder erlaubt ist.
3. Danach weitere Paritätsbausteine: Warteschlange/Recovery, Worktree-Merge/Verwaltung, zusätzliche CLI- und Importadapter.

Der bisherige Jarvis-Kern bleibt während des Aufbaus dieser App pausiert. [PARITY.md](PARITY.md) nennt die offenen Funktionen und Abnahmekriterien.
