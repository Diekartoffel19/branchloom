# Decision Inbox

Die Ansicht **Entscheidungen** zeigt offene Prüfungen aus dem aktiven Projekt. Pausen und Unterbrechungen stammen aus gespeicherten Zuständen im Projekt-Snapshot:

- pausierte Workflows mit Grund **Freigabe**, **manueller Schritt**, **Review** oder **vom Nutzer pausiert**;
- eine pausierte To-Do-Warteschlange mit ihrem gespeicherten Pausengrund und, falls vorhanden, dem aktiven Workflow.
- beim App-Neustart unterbrochene Karten-Agentensitzungen mit gespeicherter Ausgabe und noch offener Prüfung.

Zusätzlich liest die Ansicht gespeicherte Planzeilen- und Diff-Kommentare aus der lokalen Datenbank. Sie zeigt nur Kommentare zu einem **offenen** Plan oder einer **nicht archivierten** Karte des aktiven Projekts, solange sie in der Inbox nicht ausdrücklich als geprüft markiert wurden. Jeder Eintrag nennt Kommentar, Quelle und Zeit. **Plan öffnen** wählt den gespeicherten Plan unter Workflows aus und setzt den Tastaturfokus auf ihn. **Kommentar öffnen** führt zur betroffenen Karte, öffnet den Diff-Review-Bereich und fokussiert den gewählten Kommentar. Gespeicherte Kommentare bleiben auch ohne verfügbaren Worktree in der Review-Historie lesbar. Ein Diff-Kommentar kann sich auf einen älteren Stand beziehen.

Die Inbox lädt jeweils höchstens 100 passende Kommentare, zeigt weitere Treffer an und lädt ältere auf Klick nach. Die Suche fragt die gespeicherte Quelle über alle noch offenen Review-Kommentare des aktiven Projekts ab, nicht nur über die erste Seite. Nach einer Quittierung beginnt die Liste wieder bei der ersten Seite; ältere Einträge bleiben über **Ältere Kommentare laden** erreichbar. Pausen und Unterbrechungen werden weiterhin aus dem begrenzten Projekt-Snapshot gefiltert.

**Als geprüft markieren** speichert nur eine lokale Inbox-Quittierung. Der Originalkommentar bleibt erhalten; es wird kein Feedback an einen Agenten gesendet, kein Plan angenommen, kein Workflow freigegeben und keine Karte verschoben. Ein ersetzter oder übernommener Plan sowie eine archivierte Karte verlassen die offene Inbox automatisch. Ein erneutes Öffnen des ursprünglichen Plans oder Reviews zeigt dessen Kommentare weiterhin. Noch keine beantworteten Agentenfragen, automatische Übernahme von QA-Berichten oder projektübergreifende Inbox.

Bewusst übersprungene Queue-Workflows erscheinen nicht mehr als offene Freigabe. Laufende, fertige und ungestartete Workflows erzeugen ebenfalls keinen Inbox-Eintrag. Die Anzeige aktualisiert sich mit dem Projekt-Snapshot, auch nach einem Neustart.

**Zum Workflow** öffnet die betroffene Workflow-Karte; **Zur Warteschlange** führt zur Queue auf der Workflow-Seite. Die Inbox selbst startet keinen Agenten und erteilt keine Freigabe. Vor einem Neustart nach Review zeigt die Workflow-Seite den Verlauf; ein erneuter Start kann externe Aktionen wiederholen. Die vorhandenen Bestätigungs- und Queue-Grenzen bleiben maßgeblich.

Bei einer unterbrochenen Sitzung führen **Verlauf prüfen** und **Karte und Dateien öffnen** zu den vorhandenen Quellen. **Prüfung abgeschlossen** erfordert eine ausdrückliche Bestätigung und quittiert nur diesen Hinweis. Die Sitzung bleibt fehlgeschlagen, ihr Verlauf bleibt erhalten und ein pausierter Workflow oder eine Queue bleibt pausiert. Die Datenbank liefert bis zu 100 offene Unterbrechungen je Projekt; weitere werden nach Quittierung der jüngeren sichtbar. Andere Fehler ohne App-Neustart erzeugen keinen Unterbrechungseintrag. [Genauer Ablauf](SESSION_RESUME.md).

Jeder Eintrag nennt jetzt den gespeicherten Pausgrund, den betroffenen Schritt, die Spalte, den zugewiesenen Agenten und bis zu drei betroffene Karten, soweit diese Daten noch vorhanden sind. Ein Hinweis beschreibt den nächsten Prüfschritt; der Zeitstempel zeigt **die letzte gespeicherte Aktualisierung**, nicht den sicheren Beginn der Pause. Bei einer pausierten Queue mit aktivem Workflow gibt es neben dem Queue-Ziel einen Link zu diesem Workflow. Ab fünf Einträgen erscheinen eine Suche und ein Filter nach Pausart. Suche und Filter verändern keine gespeicherten Entscheidungen; bei weniger Einträgen bleiben sie sichtbar, solange eine Auswahl aktiv ist.

Freigaben und Fragen aus anderen Projekten werden noch nicht aggregiert.

Prüfung am 23.11.2026: In einem isolierten Electron-Profil mit fünf synthetisch pausierten Workflows und einer angehaltenen Queue wurden sechs Einträge angezeigt. Der Filter **Prüfung**, eine Kartennamensuche, der Zustand ohne Treffer sowie die Navigation zum korrekten Workflow, zur Queue und von der Queue zum aktiven Workflow wurden sichtbar geprüft. Dabei wurde keine Freigabe und kein Agentenlauf ausgelöst. Der allgemeine View-Wechsel behält derzeit gelegentlich die vorige Scrollposition; die Inbox setzt diese Position noch nicht selbst zurück.
