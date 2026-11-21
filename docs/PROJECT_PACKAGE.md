# Projektpaket: sichern und importieren

Über **Projekt sichern** im linken Workspace-Bereich wird das aktive Projekt als neue `.json`-Datei gespeichert. Die App überschreibt keine vorhandene Datei. Der Export enthält Spalten, Karten mit Beschreibungen, Prioritäten, Labels und Archivstatus, Memory-Notizen und die Struktur der Workflows. Er ist ein **Projektpaket**, keine vollständige Kopie der App-Datenbank.

Die Datei ist **unverschlüsselt** und kann persönliche Karten und Notizen enthalten. Bewahre sie entsprechend auf. Sie enthält keine Agentenprofile oder Zugangsdaten, keine Sitzungsprotokolle, keinen Queue-Fortschritt, keine Browserdaten, keine Trello-Importhistorie, keine Git-Worktrees, keine Kartenanhänge oder Dateiverweise und keine Dateien aus dem Projektordner. Der absolute Projektpfad wird nicht gespeichert.

Über **Projekt importieren** wählst du eine Datei. Vor dem Import zeigt die App den Namen und die Anzahl von Spalten, Karten, Notizen und Workflows. Gib einen neuen Projektnamen und einen bereits vorhandenen absoluten Ordner an. Ein Ordner, der bereits als Projekt registriert ist, wird abgelehnt. Der Import ändert weder den Ordnerinhalt noch ein vorhandenes Projekt. Das Paketformat wird begrenzt und geprüft; unbekannte Versionen, ungültige Referenzen und Dateien über 8 MiB werden abgelehnt.

Der Import vergibt neue IDs. Alle Spalten starten ohne Agenten, Modell, Effort und Autostart. Alle importierten Workflows starten als Entwurf, mit Freigabe vor jedem Schritt. Die Warteschlange bleibt aus. Vor einem Agentenlauf musst du die Agentenzuordnung und Route neu prüfen. Archivierte Karten bleiben archiviert. Die App startet beim Import keinen Agenten.
