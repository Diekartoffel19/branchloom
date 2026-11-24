# Projekt-Tokens: lesende Quellinventur

Die erste Stufe für den späteren Theme-Playground sucht nach CSS-Custom-Property-Definitionen (`--name: wert`) in **versionierten `.css`-Dateien** des gewählten Projekts. Der Projektpfad muss der Git-Wurzelordner sein. Die Abfrage wird ausdrücklich per `window.studio.themeTokens(projectId)` gestartet; sie führt weder Projektcode aus noch schreibt sie Projektdateien oder SQLite-Daten. Ein wiederverwendbares `ThemeTokensPanel` zeigt Fundstellen und kann in die Design-Ansicht eingebunden werden.

Jede Fundstelle enthält Namen, begrenzt angezeigten Quellwert, relativen Pfad, Zeile und SHA-256-Fingerabdruck der gelesenen Datei. Mehrere Definitionen desselben Namens bleiben getrennt. Die Oberfläche bietet Suche und bewusstes Kopieren von `Pfad:Zeile`. Werte werden als Text angezeigt, nicht als CSS angewendet; insbesondere lädt die Anzeige keine URLs aus Projektwerten.

## Grenzen

- Maximal 500 Git-Dateinamen, 128 KiB je Datei, 4 MiB insgesamt, 300 Definitionen und rund drei Sekunden Dateisuche; zusätzlich haben beide Git-Abfragen eigene Zeit- und Ausgabelimits. Auslassungen stehen als **unvollständig** mit Grund im Ergebnis.
- Symlinks und Pfade außerhalb des Projektordners werden ausgelassen. Unversionierte Dateien und Nicht-CSS-Dateien erscheinen nicht.
- Die Syntaxerkennung ist bewusst konservativ: Kommentare und Zeichenketten erzeugen keine Fundstellen, einfache Definitionen innerhalb geschweifter CSS-Blöcke schon. Sie löst weder `var(...)` noch Kaskade, Theme-Zustände, CSS-Imports, Sass/Less, Tailwind-JavaScript-Konfiguration oder dynamisch erzeugte Styles auf. Der angezeigte Wert ist ein Quellausschnitt, kein berechneter Browserwert.
- Es gibt noch keine Vorschau-Änderung, Token-Übernahme in Dateien oder Zuordnung zwischen einem ausgewählten DOM-Element und einer Quelldefinition.

## Prüfung

`npm test -- tests/main/theme-tokens.test.ts` verwendet synthetische Git-Repositories und prüft echte Git-Selektion, Quelländerungen, Projektgrenzen, Symlink-/Größenauslassung und Lexer-Grenzen. `npm run typecheck`, `npm run build` und `npm run smoke:source` prüfen die gemeinsame App, sobald das Panel in die Design-Ansicht integriert ist.
