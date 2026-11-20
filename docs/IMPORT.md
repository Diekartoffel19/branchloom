# Trello-Backlog lokal importieren

Jarvis Studio liest den **JSON-Export eines einzelnen Trello-Boards**. In Trello: Boardmenü → **Drucken, Exportieren und Teilen** → JSON exportieren. [Atlassian beschreibt den Board-Export hier](https://support.atlassian.com/trello/docs/exporting-data-from-trello/). Workspace-ZIP, CSV und Live-Synchronisierung werden derzeit nicht unterstützt.

Der Import hat zwei Schritte. `previewTrelloImport({projectId, json})` zeigt Boardname, Trello-Listenname, Archivstatus und jede Karten-ID. `acceptTrelloImport({projectId, columnId, json, fingerprint, sourceIds})` übernimmt ausschließlich die ausdrücklich gewählten Karten in genau diese Projektspalte. Die Vorschau speichert nichts. Wenn sich die Datei zwischen Vorschau und Übernahme ändert, muss sie erneut geprüft werden.

Importiert werden nur Kartentitel und Beschreibung. Kommentare, Mitglieder, Anhänge, Checklisten, Labels und Aktionen werden weder gelesen noch gespeichert. Eine archivierte Karte ist in der Vorschau erkennbar und kann ausdrücklich ausgewählt werden. Karten mit leerem oder zu langem Titel oder zu langer Beschreibung sind nicht auswählbar. Die Grenze liegt bei 8 MiB und 5000 Karten je Export.

Für jede übernommene Karte speichert die lokale SQLite-Datenbank die stabile Trello-Karten-ID und die neue Jarvis-Karten-ID. Ein erneuter, auch anders sortierter oder um neue Inhalte ergänzter Export zeigt bereits importierte Karten als Duplikate und legt sie nicht erneut an. Lokale Änderungen an einer importierten Karte werden bei einem Reimport nicht überschrieben. Die Zuordnung gilt pro Jarvis-Projekt.

**Sicherheitsgrenze:** Selbst in einer Spalte mit aktiviertem Auto-Start werden beim Import keine Agentensitzungen gestartet. Die Karten können danach bewusst bearbeitet oder bewegt werden. Der Roh-Export bleibt nur während Vorschau und Übernahme im Speicher; Jarvis Studio speichert ihn nicht und schreibt ihn nicht ins Repository. Der Nutzer sollte die Exportdatei außerhalb des Git-Repositories aufbewahren, weil Trello-JSON personenbezogene Daten enthalten kann.

Die Importansicht im Board liest die gewählte Datei lokal, zeigt alle Karten mit Status und Zielspalte und übernimmt nur angehakte Karten nach einem zweiten Klick. Standardmäßig sind nur neue, gültige und nicht archivierte Karten angehakt. Archivierte Karten können bewusst ausgewählt werden. Die Ansicht selbst schreibt die Exportdatei nicht auf die Platte.
