# Windows-Paket und Start

## Aus Quellcode starten

Windows 11, Node.js 24 und Git installieren. Im Repository:

```powershell
npm ci
npm run doctor
npm run build
npm start
```

`npm start` lädt den gebauten Renderer direkt von der lokalen Datei; Vite muss dafür nicht laufen. Für die Entwicklung startet `npm run dev` Vite und Electron zusammen. Die gewählte CLI, beispielsweise Codex, muss separat installiert und angemeldet sein. Jarvis Studio speichert keinen API-Schlüssel.

## Portables ZIP erzeugen

```powershell
npm ci
npm run make:win
```

Forge erzeugt `out/make/zip/win32/x64/*.zip`. Das ZIP entpacken und `Jarvis Studio.exe` starten. Die App-Daten liegen im Electron-Benutzerdatenordner und sind nicht Bestandteil des ZIP. Das ZIP ist derzeit nicht signiert und wird nicht automatisch aktualisiert.

Für einen verdeckten Starttest des gebauten Quellstands `npm run smoke:source` ausführen. `npm run smoke:package` prüft ein lokales Forge-Paket; mit `node scripts/smoke-electron.mjs --executable 'C:\Pfad\zum\entpackten\Jarvis Studio.exe'` lässt sich auch das CI-ZIP prüfen. Der Test verwendet einen temporären, isolierten App-Datenordner, wartet auf die gerenderte Oberfläche und speichert ein Testprojekt und eine Karte über die Preload-/IPC-Schnittstelle in SQLite. Unter Windows startet er außerdem ein lokales cmd-Terminal, gibt einen synthetischen Text aus und stoppt es. Ein lokaler `cmd /C echo`-Agent muss ebenfalls über sein PTY erfolgreich beenden; kein Modell wird aufgerufen. Nach einem Reload müssen die gespeicherte Karte und die per IPC geänderte Spaltenreihenfolge und ein neuer Spaltenname im Board sichtbar sein. Unter Windows öffnet der Test anschließend den Agentenverlauf, speichert ihn ausdrücklich als Memory-Notiz und prüft SQLite und die Memory-Navigation und öffnet von der Notiz den Quellverlauf. Danach schließt die unsichtbare App. Das Testprojekt berührt keine vorhandenen App-Daten. `node scripts/check-package.mjs` kontrolliert vor dem Upload zusätzlich den gepackten App-Ordner auf lokale Daten, versteckte Quellordner und Symlinks; Vendordateien unter `node_modules` werden auf geheime Dateinamen geprüft; reine `.env.example`-/`.env.sample`-/`.env.template`-Vorlagen sind erlaubt.

Die App verwendet `better-sqlite3` und `node-pty` als native Module. Für einen regulären lokalen Paketbau braucht Windows daher die Visual-Studio-C++-Build-Tools für `node-gyp`; Forge baut diese Module passend zur Electron-Laufzeit neu. Ohne diese Toolchain endet `npm run make:win` mit einem klaren `Could not find any Visual Studio installation to use`. Die Windows-CI baut nach bestandenem `main`-Push das portable ZIP, startet das Paket verdeckt mit `npm run smoke:package`, prüft den gepackten App-Ordner und lädt es erst danach als Workflow-Artefakt hoch; [der erste erfolgreiche Lauf](https://github.com/mschr703CODEX/jarvis-studio/actions/runs/44823350598) wurde auf dem Entwicklungslaptop verdeckt gestartet. Ein lokales Diagnosepaket mit `JARVIS_STUDIO_SKIP_NATIVE_REBUILD=1` ist **kein** veröffentlichbarer Build; es dient nur dazu, bereits auf dem Entwicklungslaptop in Electron funktionierende Module ohne erneute Kompilierung zu prüfen.

Spracheingabe braucht zusätzlich Python 3.13, die Pakete und ein lokales Modell. Nach dem Entpacken im App-Ordner `scripts/setup-voice.ps1` nach [VOICE.md](VOICE.md) ausführen. Dieses optionale Modell gehört nicht ins ZIP oder Git. Der Browser nutzt eine eigene lokale Session; er übernimmt keine Chrome-Logins. Ein CLI-Agent muss sich über seine eigene CLI-Anmeldung authentifizieren.

## Vor einer Veröffentlichung

`npm run typecheck`, `npm test`, `npm run build`, `npm audit --audit-level=critical` und `node scripts/check-public.mjs` ausführen. Der Public-Check prüft gestagte Dateien sowie die erreichbare Git-Historie auf typische Schlüssel, private Dateipfade und Datenbanken. Danach den geplanten Diff und den ZIP-Inhalt prüfen. Ein grüner Quellbuild beweist weder eine erfolgreiche native Paketierung noch, dass fremde Dienste einen Login im eingebetteten Browser erlauben.

Technischer Hintergrund: [Electron-Paketierung](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [native Module](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules/) und [Forge-Konfiguration](https://www.electronforge.io/config/configuration).
