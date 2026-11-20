# Isolierte Git-Worktrees für Karten

In der Kartenansicht lässt sich vor **Agent starten** die Option „Isolierten Git-Worktree für diese Sitzung verwenden“ einschalten. Sie ist standardmäßig aus. Ohne Auswahl läuft der Agent wie bisher im registrierten Projektordner. Automatische Workflow-Sitzungen ändern dieses Verhalten nicht.

Bei der ersten Auswahl legt Jarvis Studio außerhalb des Projekt-Repositories im lokalen App-Datenordner `worktrees/<Projekt-ID>/<Karten-ID>` einen Git-Worktree mit Branch `jarvis/card-<Karten-ID>` an. Weitere ausgewählte Sitzungen derselben Karte benutzen diesen Branch und Ordner wieder. Die App zeigt den Pfad in der Sitzung an und speichert die Zuordnung in ihrer lokalen SQLite-Datenbank. Vor Wiederverwendung prüft sie Repository, Pfad und Branch. Ein nicht initialisiertes Git-Projekt, fehlender Commit oder beschädigter/ausgetauschter Worktree führen zu einer Fehlermeldung; ein Agent wird dann nicht gestartet.

Der Worktree startet beim aktuellen `HEAD` des registrierten Projekts. Nicht commitete Änderungen des Haupt-Checkouts werden nicht kopiert. Änderungen im Worktree bleiben nach Stop, Absturz und App-Neustart erhalten. Jarvis Studio löscht oder setzt Worktrees und Branches derzeit nicht automatisch zurück. Nach Abschluss der Arbeit müssen Änderungen bewusst geprüft und über Git übernommen werden; es gibt noch keinen Merge-Knopf in der App. Der Git-Aufruf erfolgt mit Argumentliste ohne Shell, ohne `--force` und ohne Branch-Reset.

Die Worktree-Ordner können große Dateien enthalten. Der Speicherort im App-Datenordner darf nicht manuell verschoben werden, solange er mit der Karte verknüpft ist. Ein Worktree ist eine organisatorische Trennung von Git-Änderungen, keine Sicherheits-Sandbox: der Agent hat weiterhin die Dateirechte des angemeldeten Benutzers.

[Git-Dokumentation zu Worktrees](https://git-scm.com/docs/git-worktree)
