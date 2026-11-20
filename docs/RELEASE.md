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

Die App verwendet `better-sqlite3` und `node-pty` als native Module. Für einen regulären lokalen Paketbau braucht Windows daher die Visual-Studio-C++-Build-Tools für `node-gyp`; Forge baut diese Module passend zur Electron-Laufzeit neu. Ohne diese Toolchain endet `npm run make:win` mit einem klaren `Could not find any Visual Studio installation to use`. Die Windows-CI erzeugt nach bestandenem `main`-Push ein portables ZIP als Workflow-Artefakt. Ein lokales Diagnosepaket mit `JARVIS_STUDIO_SKIP_NATIVE_REBUILD=1` ist **kein** veröffentlichbarer Build; es dient nur dazu, bereits auf dem Entwicklungslaptop in Electron funktionierende Module ohne erneute Kompilierung zu prüfen.

Spracheingabe braucht zusätzlich Python 3.13, die Pakete und ein lokales Modell. Nach dem Entpacken im App-Ordner `scripts/setup-voice.ps1` nach [VOICE.md](VOICE.md) ausführen. Dieses optionale Modell gehört nicht ins ZIP oder Git. Der Browser nutzt eine eigene lokale Session; er übernimmt keine Chrome-Logins. Ein CLI-Agent muss sich über seine eigene CLI-Anmeldung authentifizieren.

## Vor einer Veröffentlichung

`npm run typecheck`, `npm test`, `npm run build`, `npm audit --audit-level=critical` und `node scripts/check-public.mjs` ausführen. Der Public-Check prüft gestagte Dateien sowie die erreichbare Git-Historie auf typische Schlüssel, private Dateipfade und Datenbanken. Danach den geplanten Diff und den ZIP-Inhalt prüfen. Ein grüner Quellbuild beweist weder eine erfolgreiche native Paketierung noch, dass fremde Dienste einen Login im eingebetteten Browser erlauben.

Technischer Hintergrund: [Electron-Paketierung](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [native Module](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules/) und [Forge-Konfiguration](https://www.electronforge.io/config/configuration).
