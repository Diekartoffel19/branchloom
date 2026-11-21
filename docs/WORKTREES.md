# Isolierte Git-Worktrees für Karten

In der Kartenansicht lässt sich vor **Agent starten** die Option „Isolierten Git-Worktree für diese Sitzung verwenden“ einschalten. Sie ist standardmäßig aus. Ohne Auswahl läuft der Agent wie bisher im registrierten Projektordner. Automatische Workflow-Sitzungen ändern dieses Verhalten nicht.

Bei der ersten Auswahl legt Jarvis Studio außerhalb des Projekt-Repositories im lokalen App-Datenordner `worktrees/<Projekt-ID>/<Karten-ID>` einen Git-Worktree mit Branch `jarvis/card-<Karten-ID>` an. Weitere ausgewählte Sitzungen derselben Karte benutzen diesen Branch und Ordner wieder. Die App zeigt den Pfad in der Sitzung an und speichert die Zuordnung in ihrer lokalen SQLite-Datenbank. Vor Wiederverwendung prüft sie Repository, Pfad und Branch. Ein nicht initialisiertes Git-Projekt, fehlender Commit oder beschädigter/ausgetauschter Worktree führen zu einer Fehlermeldung; ein Agent wird dann nicht gestartet.

Der Worktree startet beim aktuellen `HEAD` des registrierten Projekts. Nicht commitete Änderungen des Haupt-Checkouts werden nicht kopiert. Änderungen im Worktree bleiben nach Stop, Absturz und App-Neustart erhalten. Jarvis Studio löscht oder setzt Worktrees und Branches nicht automatisch zurück. Der Git-Aufruf erfolgt mit Argumentliste ohne Shell, ohne `--force` und ohne Branch-Reset.

## Prüfen und übernehmen

Auf der Kartenansicht zeigt **Git-Stand prüfen** den Karten-Branch und beide Pfade, nicht committete Änderungen, Diff-Stat und die Anzahl der Commits vor beziehungsweise hinter dem Ziel. Diese Vorschau legt keinen Worktree an. Sie zeigt bei einer Karte ohne Worktree einen entsprechenden Hinweis.

Der Merge-Knopf wird nur angeboten, wenn der Karten-Worktree und das registrierte Ziel sauber sind, kein Agent oder Git-Vorgang läuft, beide Branches zusammengehören und der Ziel-Commit ein Vorfahr des Worktree-Commits ist. Er übernimmt ausschließlich **bereits committete** Änderungen mit `git merge --ff-only` nach einer zweiten Bestätigung. Die App prüft direkt davor beide Commits und den Ziel-Branch erneut. Bei divergierten Branches, Konfliktrisiko oder veralteter Vorschau bricht sie ohne Reset, Force oder Löschen ab. Worktree und Branch bleiben nach Erfolg erhalten. Für komplexe Merges ist weiterhin ein bewusstes manuelles Git-Review erforderlich.

Für genau diesen app-initiierten Merge verwendet Jarvis Studio einen temporären leeren Git-Hook-Ordner, damit Repository-Hooks keinen zusätzlichen Prozess ausführen. Diese Einstellung gilt nur für den einen Merge-Befehl. Ein späterer Push läuft wieder mit der normalen Git-Konfiguration und dem öffentlichen Pre-Push-Guard; Jarvis Studio pusht selbst nicht. Repository-konfigurierte Checkout-Filter sind keine Sandbox und können bei Git-Operationen weiterhin wirken.

Die Worktree-Ordner können große Dateien enthalten. Der Speicherort im App-Datenordner darf nicht manuell verschoben werden, solange er mit der Karte verknüpft ist. Ein Worktree ist eine organisatorische Trennung von Git-Änderungen, keine Sicherheits-Sandbox: der Agent hat weiterhin die Dateirechte des angemeldeten Benutzers.

[Git-Dokumentation zu Worktrees](https://git-scm.com/docs/git-worktree)

Gezielte synthetische Prüfung: `npx vitest run tests/main/git-worktree-merge.test.ts`.
