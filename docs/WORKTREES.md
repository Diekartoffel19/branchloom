# Isolierte Git-Worktrees für Karten

In der Kartenansicht lässt sich vor **Agent starten** die Option „Isolierten Git-Worktree für diese Sitzung verwenden“ einschalten. Sie ist standardmäßig aus. Ohne Auswahl läuft der Agent wie bisher im registrierten Projektordner. Automatische Workflow-Sitzungen ändern dieses Verhalten nicht.

Bei der ersten Auswahl legt Branchloom außerhalb des Projekt-Repositories im lokalen App-Datenordner `worktrees/<Projekt-ID>/<Karten-ID>` einen Git-Worktree mit Branch `jarvis/card-<Karten-ID>` an. Weitere ausgewählte Sitzungen derselben Karte benutzen diesen Branch und Ordner wieder. Die App zeigt den Pfad in der Sitzung an und speichert die Zuordnung in ihrer lokalen SQLite-Datenbank. Vor Wiederverwendung prüft sie Repository, Pfad und Branch. Ein nicht initialisiertes Git-Projekt, fehlender Commit oder beschädigter/ausgetauschter Worktree führen zu einer Fehlermeldung; ein Agent wird dann nicht gestartet.

Der Worktree startet beim aktuellen `HEAD` des registrierten Projekts. Nicht commitete Änderungen des Haupt-Checkouts werden nicht kopiert. Änderungen im Worktree bleiben nach Stop, Absturz und App-Neustart erhalten. Branchloom löscht oder setzt Worktrees und Branches nicht automatisch zurück. Der Git-Aufruf erfolgt mit Argumentliste ohne Shell, ohne `--force` und ohne Branch-Reset.

## Prüfen und übernehmen

Auf der Kartenansicht zeigt **Git-Stand prüfen** den Karten-Branch und beide Pfade, nicht committete Änderungen, Diff-Stat und die Anzahl der Commits vor beziehungsweise hinter dem Ziel. Diese Vorschau legt keinen Worktree an. Sie zeigt bei einer Karte ohne Worktree einen entsprechenden Hinweis.

**Diff und Kommentare** zeigt zusätzlich einen begrenzten lokalen Text-Diff und speichert bewusst eingegebene Zeilenkommentare mit dem geprüften Git-Stand. Die Kommentare werden nicht automatisch an einen Agenten oder GitHub gesendet; ältere Diff-Stände bleiben getrennt sichtbar. [Bedienung und Grenzen](DIFF_REVIEW.md).

Der Merge-Knopf wird nur angeboten, wenn der Karten-Worktree und das registrierte Ziel sauber sind, kein Agent oder Git-Vorgang läuft, beide Branches zusammengehören und der Ziel-Commit ein Vorfahr des Worktree-Commits ist. Er übernimmt ausschließlich **bereits committete** Änderungen mit `git merge --ff-only` nach einer zweiten Bestätigung. Die App prüft direkt davor beide Commits und den Ziel-Branch erneut. Bei divergierten Branches, Konfliktrisiko oder veralteter Vorschau bricht sie ohne Reset, Force oder Löschen ab. Worktree und Branch bleiben nach Erfolg erhalten. Für komplexe Merges ist weiterhin ein bewusstes manuelles Git-Review erforderlich.

**Aufräumbarkeit prüfen** zeigt für einen gespeicherten Karten-Worktree eine neue, lesende Momentaufnahme: den zugeordneten Repository- und Worktree-Pfad, Branches und beide HEADs, den Zustand beider Arbeitsbäume, ignorierte Dateien, laufende Agenten und ob der Worktree-Commit ein Vorfahr des Ziel-Commits ist. Ausgetauschte Pfade, ein fremdes Repository oder ein falscher Branch werden abgewiesen. Nicht committete, unversionierte oder ignorierte Dateien und nicht übernommene Commits erscheinen als Blocker. Diese Prüfung entfernt **keine** Dateien, Worktrees, Branches oder Datenbankeinträge und erteilt keine Löschfreigabe. Selbst eine momentane Anzeige ohne Blocker wäre unmittelbar danach veraltet; eine bestätigte, erneut geprüfte und fehlerfest koordinierte Entfernung ist noch nicht implementiert.

Für genau diesen app-initiierten Merge verwendet Branchloom einen temporären leeren Git-Hook-Ordner, damit Repository-Hooks keinen zusätzlichen Prozess ausführen. Diese Einstellung gilt nur für den einen Merge-Befehl. Ein späterer Push läuft wieder mit der normalen Git-Konfiguration und dem öffentlichen Pre-Push-Guard; Branchloom pusht selbst nicht. Repository-konfigurierte Checkout-Filter sind keine Sandbox und können bei Git-Operationen weiterhin wirken.

Die Worktree-Ordner können große Dateien enthalten. Der Speicherort im App-Datenordner darf nicht manuell verschoben werden, solange er mit der Karte verknüpft ist. Ein Worktree ist eine organisatorische Trennung von Git-Änderungen, keine Sicherheits-Sandbox: der Agent hat weiterhin die Dateirechte des angemeldeten Benutzers.

[Git-Dokumentation zu Worktrees](https://git-scm.com/docs/git-worktree)

Gezielte synthetische Prüfung: `npx vitest run tests/main/git-worktree-merge.test.ts tests/main/worktree-cleanup.test.ts`.
