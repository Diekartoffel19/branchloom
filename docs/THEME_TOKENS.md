# Projekt-Tokens und flüchtige Theme-Vorschau

Die Quellinventur sucht nach CSS-Custom-Property-Definitionen (`--name: wert`) in **versionierten `.css`-Dateien** des gewählten Projekts. Der Projektpfad muss der Git-Wurzelordner sein. Die Suche wird ausdrücklich per Klick gestartet und führt keinen Projektcode aus. Erst ein eigener, bestätigter Übernahmeschritt schreibt eine Quelldefinition. Im Designbereich zeigt das Panel Fundstellen an.

Jede Fundstelle enthält Namen, begrenzt angezeigten Quellwert, relativen Pfad, Zeile und SHA-256-Fingerabdruck der gelesenen Datei. Mehrere Definitionen desselben Namens bleiben getrennt. Die Oberfläche bietet Suche und bewusstes Kopieren von `Pfad:Zeile`.

## Vorschau ausprobieren

1. Starte deinen lokalen Dev-Server und öffne unter **Design** seine Loopback-URL mit **Vorschau öffnen**.
2. Klicke **Tokens suchen** und bei einer Fundstelle **Testen**.
3. Gib einen Hex-Farbwert (`#abc`, `#aabbcc`, `#aabbccdd`) oder einen Radius von `0px` bis `99.99px` ein. **Vorschau anwenden** setzt genau diese Variable inline am Dokumentwurzelelement der geöffneten Vorschau. Der Hauptprozess prüft Fundstelle und Datei-Fingerabdruck unmittelbar vorher erneut.
4. **Zurücksetzen** stellt den vorherigen Inline-Wert wieder her. Beim Schließen oder Wechseln der Vorschau verfällt die Änderung. Nur ein Token kann gleichzeitig aktiv sein.

Die Vorschau ist eine bewusste Änderung der flüchtigen Browseransicht. Sie schreibt keine Projektdatei und keinen SQLite-Eintrag. Die separate Browser-Sitzung blockiert Anfragen an andere Origins, Navigation, Pop-ups, Downloads und Berechtigungen. Werte wie `url(...)`, `var(...)`, `@import`, beliebiges CSS und Stylesheet-Fragmente werden nicht angewendet. Wenn die Seite den Inline-Wert nachträglich selbst ändert, überschreibt **Zurücksetzen** ihn nicht.

## Einen geprüften Wert in CSS übernehmen

1. Nach **Vorschau anwenden** auf **Dateiänderung prüfen** klicken. Branchloom zeigt die genaue Quelldatei und eine Vorher/Nachher-Deklaration. Bis hier wird nichts geschrieben.
2. **In CSS übernehmen** bestätigt genau diese Änderung. Der Hauptprozess prüft Git-Datei, echten Projektpfad, ganzen Dateifingerabdruck, eindeutige Fundstelle und den zuvor angezeigten Prüfbeleg erneut. Fremde oder zwischenzeitlich geänderte Dateien werden abgewiesen. Die Datei wird über eine temporäre Datei im selben Ordner ersetzt; andere Definitionen und Zeilenenden bleiben erhalten. Die Änderung bleibt ein normaler, uncommitteter Git-Diff des Nutzerprojekts.
3. **Rücknahme prüfen** zeigt die Gegenänderung. **Rücknahme bestätigen** schreibt den alten Wert nur dann zurück, wenn der gerade geschriebene Dateifingerabdruck noch stimmt. Nach App-Neustart oder einer weiteren Änderung lässt sich der Diff mit den üblichen Git-Werkzeugen prüfen und gezielt zurücknehmen.

Die Übernahme unterstützt nur einfache, unveränderte Hex-Farben und Pixel-Radien auf einer Zeile. Eine Farbdefinition kann nur durch eine andere Farbe, ein Radius nur durch einen anderen Radius ersetzt werden. Die Vorschau und die Rücknahme schreiben keine SQLite-Daten und starten keinen Agenten. Der Dev-Server kann nach einem CSS-Schreibzugriff neu laden. Prüfe danach das Ergebnis in der laufenden Seite.

## Grenzen

- Maximal 500 Git-Dateinamen, 128 KiB je Datei, 4 MiB insgesamt, 300 Definitionen und rund drei Sekunden Dateisuche; zusätzlich haben beide Git-Abfragen eigene Zeit- und Ausgabelimits. Auslassungen stehen als **unvollständig** mit Grund im Ergebnis.
- Symlinks und Pfade außerhalb des Projektordners werden ausgelassen. Unversionierte Dateien und Nicht-CSS-Dateien erscheinen nicht.
- Die Syntaxerkennung ist bewusst konservativ: Kommentare und Zeichenketten erzeugen keine Fundstellen, einfache Definitionen innerhalb geschweifter CSS-Blöcke schon. Sie löst weder `var(...)` noch Kaskade, Theme-Zustände, CSS-Imports, Sass/Less, Tailwind-JavaScript-Konfiguration oder dynamisch erzeugte Styles auf. Der angezeigte Wert ist ein Quellausschnitt, kein berechneter Browserwert.
- Ein Testwert am Dokumentwurzelelement muss wegen CSS-Kaskade, Selektorbereich, `!important` oder unbenutzter Variable keinen sichtbaren Effekt haben. Die Funktion löst keine Zuordnung zwischen DOM-Element und Quelldefinition. Schriftwerte und andere CSS-Eigenschaften sind nicht freigeschaltet. Die Dateierneuerung kann auf Dateisystemen mit besonderen ACLs, Sperren oder parallelen externen Schreibzugriffen scheitern; in diesem Fall bleibt der Nutzer-Git-Diff maßgeblich.

## Prüfung

`npm test -- tests/main/theme-tokens.test.ts tests/main/theme-token-edit.test.ts tests/main/design-inspection.test.ts tests/main/design-inspector-browser.test.ts` prüft Git-Selektion, veraltete Quellen, Projektgrenzen, enge Eingabewerte, Diff-Prüfung, Dateiänderung und Rücknahme. `npm run smoke:source` wendet einen Token in echter Electron-Ansicht an, liest den berechneten Stil, setzt zurück, prüft die vor Bestätigung unveränderte Datei und danach die ausdrückliche Übernahme und Rücknahme.
