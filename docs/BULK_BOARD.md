# Sammelaktionen im Board

Im Board lassen sich aktive Karten einzeln oder über **Sichtbare aktive Karten auswählen** markieren. Die Auswahl umfasst nur das aktuell gefilterte Ergebnis. Bei einer Änderung von Suche, Spalte, Archivstatus, Priorität, Label oder Projekt wird sie aufgehoben. Pro Aktion sind höchstens 100 Karten möglich; bei mehr sichtbaren Karten zuerst filtern.

Für **Ausgewählte verschieben** eine Zielspalte wählen und die Aktion auslösen. Karten, die bereits dort liegen, bleiben an ihrer Position; die übrigen werden in der sichtbaren Board-Reihenfolge ans Ende der Zielspalte gesetzt. Diese Sammelaktion startet **keinen** Spaltenagenten, selbst wenn Autostart an der Zielspalte eingeschaltet ist. Das einzelne Verschieben verhält sich weiterhin nach der Spalteneinstellung.

**Ausgewählte archivieren** zeigt zuerst eine Bestätigung. Die Karten bleiben im Archiv mit ihrem Verlauf erhalten und lassen sich einzeln wiederherstellen. Datenbankänderungen einer Sammelaktion werden zusammen bestätigt oder vollständig zurückgerollt.

Eine laufende Projekt-Warteschlange muss vor einer Sammelaktion pausiert werden. Karten mit laufender Agentensitzung oder einem laufenden beziehungsweise pausierten Workflow können nicht gesammelt verschoben oder archiviert werden. Die Prüfung gilt auch für direkte IPC-Aufrufe und verhindert gemischte Projekte, archivierte Karten sowie eine Zielspalte aus einem anderen Projekt. Nach Wiederaufnahme einer pausierten Queue liest sie den dann gespeicherten Board-Zustand. Ein Bulk-Verschieben startet weder einen Spaltenagenten noch die Queue unmittelbar.

Grenze: Die Auswahl und Archivbestätigung sind bisher automatisiert anhand der gerenderten Oberfläche und der Datenbank geprüft; ein sichtbarer Klickdurchlauf im Electron-Fenster steht noch aus.
