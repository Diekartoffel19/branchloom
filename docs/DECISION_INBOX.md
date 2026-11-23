# Decision Inbox

Die Ansicht **Entscheidungen** zeigt offene Prüfungen aus dem aktiven Projekt. Aktuell nutzt sie ausschließlich gespeicherte Zustände aus dem Projekt-Snapshot:

- pausierte Workflows mit Grund **Freigabe**, **manueller Schritt**, **Review** oder **vom Nutzer pausiert**;
- eine pausierte To-Do-Warteschlange mit ihrem gespeicherten Pausengrund und, falls vorhanden, dem aktiven Workflow.
- beim App-Neustart unterbrochene Karten-Agentensitzungen mit gespeicherter Ausgabe und noch offener Prüfung.

Bewusst übersprungene Queue-Workflows erscheinen nicht mehr als offene Freigabe. Laufende, fertige und ungestartete Workflows erzeugen ebenfalls keinen Inbox-Eintrag. Die Anzeige aktualisiert sich mit dem Projekt-Snapshot, auch nach einem Neustart.

**Zum Workflow** öffnet die betroffene Workflow-Karte; **Zur Warteschlange** führt zur Queue auf der Workflow-Seite. Die Inbox selbst startet keinen Agenten und erteilt keine Freigabe. Vor einem Neustart nach Review zeigt die Workflow-Seite den Verlauf; ein erneuter Start kann externe Aktionen wiederholen. Die vorhandenen Bestätigungs- und Queue-Grenzen bleiben maßgeblich.

Bei einer unterbrochenen Sitzung führen **Verlauf prüfen** und **Karte und Dateien öffnen** zu den vorhandenen Quellen. **Prüfung abgeschlossen** erfordert eine ausdrückliche Bestätigung und quittiert nur diesen Hinweis. Die Sitzung bleibt fehlgeschlagen, ihr Verlauf bleibt erhalten und ein pausierter Workflow oder eine Queue bleibt pausiert. Die Datenbank liefert bis zu 100 offene Unterbrechungen je Projekt; weitere werden nach Quittierung der jüngeren sichtbar. Andere Fehler ohne App-Neustart erzeugen keinen Unterbrechungseintrag. [Genauer Ablauf](SESSION_RESUME.md).

Jeder Eintrag nennt jetzt den gespeicherten Pausgrund, den betroffenen Schritt, die Spalte, den zugewiesenen Agenten und bis zu drei betroffene Karten, soweit diese Daten noch vorhanden sind. Ein Hinweis beschreibt den nächsten Prüfschritt; der Zeitstempel zeigt **die letzte gespeicherte Aktualisierung**, nicht den sicheren Beginn der Pause. Bei einer pausierten Queue mit aktivem Workflow gibt es neben dem Queue-Ziel einen Link zu diesem Workflow. Ab fünf Einträgen erscheinen eine Suche und ein Filter nach Pausart. Suche und Filter verändern keine gespeicherten Entscheidungen; bei weniger Einträgen bleiben sie sichtbar, solange eine Auswahl aktiv ist.

Agentenfragen, Plan- und Diff-Kommentare sowie Freigaben aus anderen Projekten werden noch nicht aggregiert. Es gibt dafür bisher keine gespeicherte Quelle; die Inbox stellt keine solchen Ereignisse dar.

Prüfung am 23.11.2026: In einem isolierten Electron-Profil mit fünf synthetisch pausierten Workflows und einer angehaltenen Queue wurden sechs Einträge angezeigt. Der Filter **Prüfung**, eine Kartennamensuche, der Zustand ohne Treffer sowie die Navigation zum korrekten Workflow, zur Queue und von der Queue zum aktiven Workflow wurden sichtbar geprüft. Dabei wurde keine Freigabe und kein Agentenlauf ausgelöst. Der allgemeine View-Wechsel behält derzeit gelegentlich die vorige Scrollposition; die Inbox setzt diese Position noch nicht selbst zurück.
