# Prioritäten und Labels auf Karten

Öffne eine Karte im Board. Im Formular lassen sich **Priorität** (Keine, Niedrig, Mittel, Hoch, Dringend) und bis zu zwölf frei benannte **Labels** speichern. Labels werden durch Kommas getrennt; jedes darf höchstens 32 Zeichen haben. Gleich geschriebene Labels werden ohne Beachtung der Groß- und Kleinschreibung einmal gespeichert. Titel, Beschreibung, Priorität und Labels werden gemeinsam mit „Karte speichern“ übernommen. Archivierte Karten bleiben lesbar, aber nicht bearbeitbar.

Die geöffnete Karte ist ein Tastaturdialog: Der Fokus beginnt auf **Karte schließen**, Tab bleibt innerhalb des Dialogs, Escape schließt ihn und setzt den Fokus auf den Auslöser zurück, sofern er noch vorhanden ist. Fehlt der Auslöser nach dem Anlegen oder Archivieren, führt der Fokus zur Karte im Board oder zur Kartensuche.

Auf der Karte werden Priorität und bis zu drei Labels angezeigt; bei weiteren Labels erscheint eine Anzahl. Über die Auswahlfelder oberhalb des Boards lassen sich Priorität und ein Label mit Textsuche, Spalte und Archivstatus kombinieren. Die Textsuche berücksichtigt auch Labelnamen. Filter ändern keine gespeicherten Karten.

Die Metadaten liegen in der lokalen SQLite-Datenbank im App-Datenordner. Bestehende Karten erhalten beim Öffnen einer älteren Datenbank automatisch „Keine“ und eine leere Labelliste; Titel, Beschreibung, Position und Archivstatus bleiben erhalten. Die To-Do-Warteschlange verarbeitet Karten weiterhin nach Board-Position, nicht nach Priorität. Der [Trello-JSON-Import](IMPORT.md) übernimmt benannte Labels nach Vorschau; aus Trello-Farben wird keine Priorität abgeleitet.

Für mehrere aktive Karten kann die Priorität über die [Board-Sammelaktion](BULK_BOARD.md) nach Vorschau und Bestätigung zusammen geändert werden. Auch diese Änderung sortiert die To-Do-Warteschlange nicht neu und startet keinen Agenten.

Gezielte synthetische Prüfung: `npx vitest run tests/main/card-metadata.test.ts tests/renderer/board-filters.test.tsx tests/renderer/memory-board.test.tsx`.
