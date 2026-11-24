# Agenten-CLI prüfen

Unter **Agenten** zeigt Branchloom für Codex, Claude Code, Gemini CLI und [Antigravity CLI](ANTIGRAVITY_CLI.md), ob das Programm lokal gefunden wird und `--version` erfolgreich antwortet. Das Zeitlimit beträgt acht Sekunden, bei Antigravity 20 Sekunden. Gespeicherte Agentenprofile werden ebenfalls geprüft. Bei einem eigenen CLI-Programm wird nur der Programmpfad aufgelöst; Studio startet dieses Programm für die Prüfung nicht. **Erkennung erneut starten** aktualisiert den Stand nach einer Installation oder einer Profiländerung.

**Erreichbar** bedeutet nur, dass die Versionsprüfung gelang. **Gefunden** bedeutet, dass der Programmpfad vorhanden ist, ohne das Programm auszuführen. **Fehlt**, **Zeitlimit** und **Fehler** unterscheiden fehlende Dateien von einer hängenden oder gescheiterten Versionsprüfung. Bei einem fehlenden Programm dessen CLI separat installieren oder im Profil einen gültigen absoluten Programmpfad eintragen; danach die Erkennung wiederholen.

Unter Windows wird ein unterstützter `codex.cmd`-Verweis der offiziellen WinGet-Installation vor der Prüfung eng auf die native Codex-EXE aufgelöst. Branchloom führt die Batch-Datei dabei nicht aus; abweichende oder manipulierte Batch-Inhalte bleiben gesperrt.

Diese Prüfung meldet sich nicht bei einem Konto an, testet keinen Modellzugang und beweist keinen erfolgreichen Agentenlauf. Ein wirklicher Lauf beginnt erst, wenn eine Karte oder ein Workflow ausdrücklich gestartet wird. Die UI zeigt keine ungefilterte Fehlerausgabe des geprüften Programms.

## Fähigkeitsbelege aus echten Sitzungen

Unter **Agenten → Fähigkeitsbelege** wählst du ein gespeichertes Profil. Branchloom zeigt für vier einzelne Schritte den letzten lokal gespeicherten Beleg oder **Offen**:

- **Start:** Ein Karten-Agent wurde als lokaler PTY-Prozess gestartet. Das bestätigt weder Anmeldung noch eine erfolgreiche Antwort.
- **Eingabe:** Eine manuelle Eingabe wurde an das laufende PTY geschrieben. Ob die CLI sie verstanden oder ans Modell gesendet hat, bleibt offen.
- **Stopp:** Nach einem ausdrücklichen Stopp wurde das Ende des PTY-Prozesses beobachtet. Ein bloßer Stoppklick ohne Prozessende wird nicht als Beleg gezeigt.
- **Resume:** Ein ausdrücklich gewählter Codex-Resume-Aufruf wurde als neuer PTY-Prozess gestartet. Ob das richtige Gespräch in der CLI erfolgreich geladen wurde, muss im Terminal geprüft werden. Andere Adapter haben derzeit keinen implementierten Resume-Pfad.

Die Tabelle führt nur Zeitpunkt und Sitzungskennung, keine Eingabetexte oder Terminalausgaben. Alte Sitzungen werden nicht rückwirkend als Beweis gedeutet. Ein geänderter Agententyp, Programmpfad, Modellwert oder Startargumente löschen die bisherigen Belege dieses Profils; während eines Laufs sind solche Änderungen gesperrt. Eine bloße Umbenennung erhält sie. **Erkennung erneut starten** liest die Belege neu. Diese Ansicht startet selbst keinen Agenten und erzeugt keine zusätzliche Modellanfrage. Für einen echten Modell-/Resume-Test ist weiterhin ein bewusst gestarteter Kartenlauf nötig.
