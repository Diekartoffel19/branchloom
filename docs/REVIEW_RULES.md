# Projektregeln aus Reviews

1. Einen Planvorschlag oder eine Karte mit Code-Diff öffnen und einen konkreten Kommentar speichern.
2. Am Kommentar **Als Projektregel übernehmen** klicken. Branchloom übernimmt den gespeicherten Kommentartext mit Planzeile beziehungsweise Dateipfad und Diff-Zeile als Quelle. Der Klick startet keinen Agenten.
3. Unter **Workflows → Projektregeln aus Reviews** die Regel lesen, bearbeiten, für künftige Planung deaktivieren oder nach zweitem Klick entfernen. Die Regeln liegen je Projekt in der lokalen SQLite-Datenbank und bleiben nach einem Neustart erhalten.
4. Bei einer neuen **Ablauf vorschlagen**-Anfrage erhält der lesende Codex-Planer nur aktivierte Regeln dieses Projekts. Höchstens zehn Regeln und insgesamt 4.000 Zeichen werden in Reihenfolge der letzten Bearbeitung mit Quellen-IDs übergeben. Im Formular wird dieser Datenzugriff angezeigt.

Regeln sind durch den Nutzer bestätigter Projektkontext. Sie ändern keine CLI-Berechtigungen und werden nicht an bereits laufende Agenten gesendet. Ein Kommentar aus einem anderen Projekt lässt sich nicht übernehmen. Der Kommentar bleibt unverändert, wenn die Regel später bearbeitet oder entfernt wird. Diff- oder Plan-Kommentare werden nicht automatisch zu Regeln.

Diese erste Stufe bindet Regeln nur in die **Codex-Workflow-Planung** ein. Automatische Wiederholungserkennung, Code-Review-Agenten und andere Promptwege sind offen. Die Regeln sind nicht Teil des reduzierten Projektpakets; für eine vollständige Sicherung muss der lokale Branchloom-Datenordner gesichert werden.
