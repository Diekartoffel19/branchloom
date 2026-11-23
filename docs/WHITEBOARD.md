# Architektur-Whiteboard

Das projektbezogene Whiteboard speichert Boxen, Positionen und gerichtete Verbindungen lokal in Branchlooms SQLite-Datenbank. Es liegt außerhalb des Projekt-Repositories und startet keine Agenten oder Kartenläufe.

## Bedienung

1. Projekt öffnen und links **Whiteboard** wählen.
2. **Box hinzufügen** erstellt eine Box. Box anklicken, Titel und optionale Beschreibung bearbeiten und **Speichern**.
3. Unter **Verknüpfung** eine vorhandene Projektkarte oder einen relativen Ordner- oder Dateipfad wählen. Pfade müssen beim Speichern wirklich existieren und innerhalb des Projektordners liegen. Dateiverweise verlangen eine reguläre Datei; Symlinks nach außerhalb werden abgewiesen. **Karte öffnen** führt zur verknüpften Karte.
4. Boxen auf dem Canvas verschieben. Die Position wird nach dem Loslassen gespeichert. Zwei Boxen per Ziehen an den Griffen oder im rechten Bereich mit **Von**, **Nach**, **Verbinden** verknüpfen. Die Auswahlfelder ermöglichen denselben Ablauf per Tastatur.
5. Eine Verbindung anklicken. **Kartenentwurf aus Verbindung** füllt den Titel aus; Auftrag und Zielspalte bleiben editierbar. Erst **Karte anlegen** speichert sie. Die Karte enthält einen lesbaren Bezug mit den zu diesem Zeitpunkt verknüpften Karten-IDs oder relativen Projektpfaden. Ein erneuter Klick öffnet die vorhandene Karte, statt ein Duplikat anzulegen. Bei laufender Warteschlange ist die Anlage gesperrt. Die Anlage startet selbst keinen Agentenlauf.
   Die Verbindung kann auch in der Liste rechts unter **Verbindungen** ausgewählt werden.
6. Im Verbindungsbereich kann man die Linie entfernen. Beim Entfernen einer Box wird nach Bestätigung auch ihre Verbindung gelöscht; eine bereits angelegte Karte bleibt mit dem lesbaren Whiteboard-Bezug erhalten.
7. **Repo-Struktur vorschlagen** liest den Git-Index des aktiven Projekts und zeigt vorab Ordner, Paketordner, mögliche UI-Komponenten und ihre belegten „enthält“-Verbindungen. Einzelne Boxen abwählen oder ausdrücklich **Boxen übernehmen**. Eine geänderte Git-Struktur erfordert eine neue Vorschau. [Analyse und Grenzen](REPO_MAP.md).

Die Verknüpfungen nutzen stabile Karten-IDs beziehungsweise relative Ordner- und Dateipfade. Wird eine Karte gelöscht, entfällt ihr Whiteboard-Bezug. Ein später verschobener oder gelöschter Pfad wird beim Speichern eines neuen Bezugs erneut geprüft; vorhandene Boxen werden dadurch nicht automatisch gelöscht.

## Grenzen

- Der Repo-Import bildet nur versionierte Pfade, Paketmanifestnamen und UI-Dateinamen-Konventionen ab. Automatische Abhängigkeitsanalyse, Blast Radius und Drag-and-drop auf Karten sind noch offen. Die Kartenanlage aus einer Verbindung ist manuell; es gibt keine Modellformulierung und keine automatische Queue-Freigabe. Pfade in schon vorhandenen Boxen werden dabei nicht erneut gegen das Dateisystem geprüft.
- Whiteboard-Daten sind derzeit **nicht** Bestandteil des bewusst reduzierten Projektpaketexports. Sie bleiben beim App-Neustart in der lokalen SQLite-Datenbank erhalten. Eine vollständige Datensicherung muss den Branchloom-Datenordner sichern.
- Pro Projekt sind höchstens 500 Boxen und 1000 Verbindungen zugelassen. Größere, von außen veränderte Datenbestände werden mit einem Fehler angezeigt, statt ungebremst in den Canvas geladen.
- Canvas: [`@xyflow/react` 13.0.3](https://github.com/xyflow/xyflow/tree/main/packages/react), MIT-lizenziert. Der Attributionslink bleibt sichtbar. Branchlooms Datenmodell und Validierung sind eigene Implementierungen; kein fremder Quellcode wurde kopiert.
