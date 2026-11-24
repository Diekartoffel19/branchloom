# Trello-Boards importieren

Unter **Board → Importieren** ist **Trello verbinden** die erste Wahl. Nach der einmaligen Verbindung zeigt Branchloom offene Boards des Kontos. Wähle ein Board und klicke **Board prüfen**. Die Vorschau zeigt Listenname, Archivstatus, benannte Labels, ungültige Karten und bereits importierte Trello-IDs. Erst **Karten importieren** legt die ausdrücklich ausgewählten Karten in der gewählten Branchloom-Spalte an. Ohne diesen Klick wird nichts gespeichert. Ein Import in eine Spalte mit Autostart startet keinen Agenten.

## Einmalige Verbindung

1. Erstelle in [Trellos App-Verwaltung](https://trello.com/apps/admin) eine eigene App bzw. Power-Up und dort im Bereich **Trello Auth** einen API-Key. Der Key ist laut Atlassian öffentlich verwendbar; ein Token bleibt geheim.
2. Füge den Key in Branchloom ein und klicke **Lesefreigabe im Browser öffnen**. Branchloom öffnet die offizielle Trello-Freigabe mit `scope=read` und 30 Tagen Laufzeit.
3. Erteile die Freigabe in Trello und kopiere den dort gezeigten Token in Branchloom. Klicke **Verbindung prüfen und speichern**. Branchloom prüft den Token über `/members/me` und speichert Key und Token verschlüsselt über die Windows-Speicherung von Electron im lokalen App-Profil. Der Token gelangt nicht in SQLite, das Projektpaket oder das Repository.
4. Wähle das Board, prüfe die Karten und importiere die Auswahl. Mit **Verbindung trennen** wird die lokale Zugangskopie gelöscht. Eine Freigabe kannst du zusätzlich in den [Trello-Kontoeinstellungen](https://trello.com/) widerrufen.

Branchloom besitzt derzeit **keinen eigenen mitgelieferten Trello-API-Key**. Deshalb ist der eigene Key einmalig nötig; ein vollständig automatischer Ein-Klick-Login ist noch offen. Ein abgelaufener oder widerrufener Token führt zu einer sichtbaren Fehlermeldung und muss neu verbunden werden. Branchloom ruft Trello nur auf ausdrückliche Bedienung hin ab; es synchronisiert spätere Änderungen nicht automatisch. Die Verbindung braucht Internet. Grundlage sind Atlassians [Autorisierungsanleitung](https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/) und [REST-API-Einstieg](https://developer.atlassian.com/cloud/trello/guides/rest-api/api-introduction/).

## Offline-Alternative: JSON-Datei

Unter **JSON-Datei** kannst du weiterhin den Export eines einzelnen Trello-Boards wählen. In Trello: Boardmenü → **Drucken, Exportieren und Teilen** → JSON exportieren. [Atlassian beschreibt den Export hier](https://support.atlassian.com/trello/docs/exporting-data-from-trello/). Die Datei wird nur im Arbeitsspeicher gelesen; sie sollte außerhalb eines öffentlichen Git-Repositories liegen.

Die Verbindung und die JSON-Datei verwenden dieselbe Vorschau und dieselbe lokale ID-Duplikaterkennung. Der Live-Import lädt das Board vor der Übernahme erneut. Wenn Trello-Inhalte seit der Vorschau geändert wurden, fordert Branchloom eine neue Prüfung, statt still alte Karten zu übernehmen. Lokale Änderungen an bereits importierten Karten werden bei einem erneuten Import nicht überschrieben.

Importiert werden Titel, Beschreibung und benannte Labels. Farb-Labels ohne Namen werden ausgelassen und in der Vorschau gezählt. Kommentare, Mitglieder, Anhänge, Checklisten und Aktionen werden weder importiert noch in Branchloom gespeichert. Archivierte Karten sind zunächst abgewählt und bleiben bei ausdrücklichem Import archiviert. Karten mit ungültigem Titel, zu langer Beschreibung oder ungültigen Labels sind nicht auswählbar. Ein Import ist auf 8 MiB und 5.000 Karten begrenzt; für sehr große Boards oder unvollständige API-Antworten bleibt der JSON-Export als Alternative. Alle Karten eines Imports kommen in eine gewählte Projektspalte; eine Zuordnung einzelner Trello-Listen zu Branchloom-Spalten ist noch offen.
