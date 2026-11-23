# Agenten-CLI prüfen

Unter **Agenten** zeigt Branchloom für Codex, Claude Code, Gemini CLI und [Antigravity CLI](ANTIGRAVITY_CLI.md), ob das Programm lokal gefunden wird und `--version` erfolgreich antwortet. Das Zeitlimit beträgt acht Sekunden, bei Antigravity 20 Sekunden. Gespeicherte Agentenprofile werden ebenfalls geprüft. Bei einem eigenen CLI-Programm wird nur der Programmpfad aufgelöst; Studio startet dieses Programm für die Prüfung nicht. **Erkennung erneut starten** aktualisiert den Stand nach einer Installation oder einer Profiländerung.

**Erreichbar** bedeutet nur, dass die Versionsprüfung gelang. **Gefunden** bedeutet, dass der Programmpfad vorhanden ist, ohne das Programm auszuführen. **Fehlt**, **Zeitlimit** und **Fehler** unterscheiden fehlende Dateien von einer hängenden oder gescheiterten Versionsprüfung. Bei einem fehlenden Programm dessen CLI separat installieren oder im Profil einen gültigen absoluten Programmpfad eintragen; danach die Erkennung wiederholen.

Unter Windows wird ein unterstützter `codex.cmd`-Verweis der offiziellen WinGet-Installation vor der Prüfung eng auf die native Codex-EXE aufgelöst. Branchloom führt die Batch-Datei dabei nicht aus; abweichende oder manipulierte Batch-Inhalte bleiben gesperrt.

Diese Prüfung meldet sich nicht bei einem Konto an, testet keinen Modellzugang und beweist keinen erfolgreichen Agentenlauf. Ein wirklicher Lauf beginnt erst, wenn eine Karte oder ein Workflow ausdrücklich gestartet wird. Die UI zeigt keine ungefilterte Fehlerausgabe des geprüften Programms.
