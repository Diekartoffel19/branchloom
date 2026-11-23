# Decision Inbox

Die Ansicht **Entscheidungen** zeigt offene Prüfungen aus dem aktiven Projekt. Aktuell nutzt sie ausschließlich gespeicherte Zustände aus dem Projekt-Snapshot:

- pausierte Workflows mit Grund **Freigabe**, **manueller Schritt**, **Review** oder **vom Nutzer pausiert**;
- eine pausierte To-Do-Warteschlange mit ihrem gespeicherten Pausengrund und, falls vorhanden, dem aktiven Workflow.

Bewusst übersprungene Queue-Workflows erscheinen nicht mehr als offene Freigabe. Laufende, fertige und ungestartete Workflows erzeugen ebenfalls keinen Inbox-Eintrag. Die Anzeige aktualisiert sich mit dem Projekt-Snapshot, auch nach einem Neustart.

**Zum Workflow** öffnet die betroffene Workflow-Karte; **Zur Warteschlange** führt zur Queue auf der Workflow-Seite. Die Inbox selbst startet keinen Agenten und erteilt keine Freigabe. Vor einem Neustart nach Review zeigt die Workflow-Seite den Verlauf; ein erneuter Start kann externe Aktionen wiederholen. Die vorhandenen Bestätigungs- und Queue-Grenzen bleiben maßgeblich.

Agentenfragen, Plan- und Diff-Kommentare sowie Freigaben aus anderen Projekten werden noch nicht aggregiert. Es gibt dafür bisher keine gespeicherte Quelle; die Inbox stellt keine solchen Ereignisse dar.
