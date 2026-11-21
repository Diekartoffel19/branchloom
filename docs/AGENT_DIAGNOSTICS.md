# Agenten-CLI prüfen

Unter **Agenten** zeigt Jarvis Studio für Codex, Claude Code und Gemini CLI, ob das Programm lokal gefunden wird und `--version` innerhalb von acht Sekunden erfolgreich antwortet. Gespeicherte Agentenprofile werden ebenfalls geprüft. Bei einem eigenen CLI-Programm wird nur der Programmpfad aufgelöst; Studio startet dieses Programm für die Prüfung nicht. **Erkennung erneut starten** aktualisiert den Stand nach einer Installation oder einer Profiländerung.

**Erreichbar** bedeutet nur, dass die Versionsprüfung gelang. **Gefunden** bedeutet, dass der Programmpfad vorhanden ist, ohne das Programm auszuführen. **Fehlt**, **Zeitlimit** und **Fehler** unterscheiden fehlende Dateien von einer hängenden oder gescheiterten Versionsprüfung. Bei einem fehlenden Programm dessen CLI separat installieren oder im Profil einen gültigen absoluten Programmpfad eintragen; danach die Erkennung wiederholen.

Diese Prüfung meldet sich nicht bei einem Konto an, testet keinen Modellzugang und beweist keinen erfolgreichen Agentenlauf. Ein wirklicher Lauf beginnt erst, wenn eine Karte oder ein Workflow ausdrücklich gestartet wird. Die UI zeigt keine ungefilterte Fehlerausgabe des geprüften Programms.
