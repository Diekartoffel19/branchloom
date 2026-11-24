# Lokale Kartenanhänge

In einer Karte unter **Dateien → Datei verknüpfen** wählst du eine oder mehrere vorhandene Dateien. Studio speichert bis zu 20 Dateiverweise mit Name und Größe in seiner lokalen Datenbank. Es kopiert keine Inhalte und legt keine Datei im Projekt-Repository ab. Entfernen löscht nur die Verknüpfung; die Originaldatei bleibt erhalten.

**Öffnen** startet die Datei bewusst im Standardprogramm des Betriebssystems. Dieser Knopf ist nur für übliche Dokument-, Bild- und Textformate verfügbar. Ausführbare und unbekannte Formate können verknüpft werden, werden aber nicht über Studio geöffnet. Fehlt eine Datei oder führt ihr gespeicherter Pfad inzwischen woanders hin, wird der Anhang als nicht verfügbar angezeigt und Öffnen gesperrt. Nach einem Umzug verknüpfe die Datei erneut.

Anhänge werden nicht automatisch gelesen, in Agentenprompts eingefügt oder mit Workflows verarbeitet. Die Dateiverweise bleiben lokal auf diesem Gerät; das JSON-[Projektpaket](PROJECT_PACKAGE.md) und das öffentliche Repository enthalten sie nicht. Ein Agent mit Zugriff auf den Projektordner kann Dateien dort unabhängig von dieser Anhangsfunktion lesen.

Liegt ein Anhang innerhalb des Kartenprojekts, kannst du seinen Namen in **Kontextbezüge** ziehen oder **Als Kontext vorbereiten** wählen. Das füllt nach erneuter Pfadprüfung nur den [Kontextentwurf](CARD_CONTEXT.md); gespeichert wird er mit **Bezug hinzufügen**. Außerhalb liegende Anhänge bleiben normale Anhänge.
