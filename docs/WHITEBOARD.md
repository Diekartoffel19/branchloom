# Architektur-Whiteboard

Das projektbezogene Whiteboard speichert Boxen, Positionen und gerichtete Verbindungen lokal in Branchlooms SQLite-Datenbank. Es liegt außerhalb des Projekt-Repositories und startet keine Agenten oder Kartenläufe.

## Bedienung

1. Projekt öffnen und links **Whiteboard** wählen.
2. **Box hinzufügen** erstellt eine Box. Box anklicken, Titel und optionale Beschreibung bearbeiten und **Speichern**.
3. Unter **Verknüpfung** eine vorhandene Projektkarte oder einen relativen Ordner- oder Dateipfad wählen. Pfade müssen beim Speichern wirklich existieren und innerhalb des Projektordners liegen. Dateiverweise verlangen eine reguläre Datei; Symlinks nach außerhalb werden abgewiesen. **Karte öffnen** führt zur verknüpften Karte.
4. Boxen auf dem Canvas verschieben. Die Position wird nach dem Loslassen gespeichert. Zwei Boxen per Ziehen an den Griffen oder im rechten Bereich mit **Von**, **Nach**, **Verbinden** verknüpfen. Die Auswahlfelder ermöglichen denselben Ablauf per Tastatur.
5. Eine Verbindung anklicken, um sie zu entfernen. Beim Entfernen einer Box wird nach Bestätigung auch ihre Verbindung gelöscht.
6. **Repo-Struktur vorschlagen** liest den Git-Index des aktiven Projekts und zeigt vorab Ordner, Paketordner, mögliche UI-Komponenten und ihre belegten „enthält“-Verbindungen. Einzelne Boxen abwählen oder ausdrücklich **Boxen übernehmen**. Eine geänderte Git-Struktur erfordert eine neue Vorschau. [Analyse und Grenzen](REPO_MAP.md).

Die Verknüpfungen nutzen stabile Karten-IDs beziehungsweise relative Ordner- und Dateipfade. Wird eine Karte gelöscht, entfällt ihr Whiteboard-Bezug. Ein später verschobener oder gelöschter Pfad wird beim Speichern eines neuen Bezugs erneut geprüft; vorhandene Boxen werden dadurch nicht automatisch gelöscht.

## Grenzen

- Der Repo-Import bildet nur versionierte Pfade, Paketmanifestnamen und UI-Dateinamen-Konventionen ab. Automatische Abhängigkeitsanalyse, Blast Radius, Aufgabenanlage aus einem Pfeil und Drag-and-drop auf Karten sind noch offen.
- Whiteboard-Daten sind derzeit **nicht** Bestandteil des bewusst reduzierten Projektpaketexports. Sie bleiben beim App-Neustart in der lokalen SQLite-Datenbank erhalten. Eine vollständige Datensicherung muss den Branchloom-Datenordner sichern.
- Pro Projekt sind höchstens 500 Boxen und 1000 Verbindungen zugelassen. Größere, von außen veränderte Datenbestände werden mit einem Fehler angezeigt, statt ungebremst in den Canvas geladen.
- Canvas: [`@xyflow/react` 13.0.3](https://github.com/xyflow/xyflow/tree/main/packages/react), MIT-lizenziert. Der Attributionslink bleibt sichtbar. Branchlooms Datenmodell und Validierung sind eigene Implementierungen; kein fremder Quellcode wurde kopiert.
