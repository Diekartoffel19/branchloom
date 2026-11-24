# Antigravity CLI in Branchloom

Branchloom erkennt `agy` als eigenen CLI-Typ. Unter Windows wird zuerst `PATH` und anschließend der offizielle Installationsort `%LOCALAPPDATA%\agy\bin\agy.exe` geprüft. Die Erkennung führt nur `agy --version` aus; **Erreichbar** bestätigt weder Anmeldung noch Modellzugang. Die Versionsprüfung darf für `agy` bis zu 20 Sekunden dauern.

## Einrichten

1. [Antigravity CLI nach Googles Anleitung installieren](https://antigravity.google/docs/getting-started?tab=cli) und in einem normalen Terminal `agy --version` ausführen.
2. `agy` einmal interaktiv öffnen und die Anmeldung sowie die Workspace-Vertrauensfrage selbst abschließen. Branchloom liest keine Anmeldedaten und startet für die Diagnose keinen Modellaufruf.
3. In Branchloom unter **Agenten** auf **Erkennung erneut starten** klicken. Beim Eintrag **Antigravity CLI** **Einrichten** wählen. Falls der CLI-Pfad abweicht, im Profil den absoluten Pfad zu `agy.exe` eintragen.
4. Im Board für die gewünschte Spalte dieses Profil, optional einen Modell-Slug und den Effort wählen. Die verfügbaren Modelle mit `agy models` und eventuelle benannte Agenten mit `agy agents` im Terminal nachsehen. Ein benannter Antigravity-Agent kann im Profil über zwei Argumentzeilen `--agent` und den Namen gewählt werden.
5. Eine Karte bewusst starten oder eine ausdrücklich aktivierte Workflow-Route verwenden. Interaktive Läufe starten mit `agy -i <Prompt>` und bleiben im Terminal offen. Workflow-Schritte starten mit `agy -p <Prompt>` und enden nach einer Antwort. Modell und Effort werden als getrennte Argumente `--model <Slug>` und `--effort <Stufe>` an die CLI übergeben.

Die erlaubten Spalten-Efforts sind `low`, `medium`, `high`, `xhigh` und `max`. Das konkrete Modell kann weniger Stufen unterstützen; dann meldet `agy` einen Fehler. `ultra` ist kein Antigravity-Effort. Ein nicht erkanntes Modell fällt im Headless-Modus laut Google nicht still auf ein anderes Modell zurück.

## Grenzen

- Ein begrenzter echter `agy`-Headless-Aufruf (lokal Version 1.5.13, synthetisches Git-Projekt, `gemini-3.8-flash-medium`) lieferte Exit-Code 0 und den angeforderten Abschlussmarker. Ein anschließender echter Branchloom-Workflow-Lauf im synthetischen Projekt lieferte ebenfalls Exit-Code 0; die PTY-Ausgabe setzte den Marker mit `CSI 4;1H` auf eine eigene sichtbare Zeile. Die bisherige Markerprüfung übersah diese Zeilengrenze und pausierte den Schritt nach SQLite-Neustart als `needs_review`. Die Prüfung erkennt nun einen expliziten Zeilenanfang durch `CSI <Zeile>;1H` oder `f`; ein synthetischer Workflow-Test prüft Abschluss und SQLite-Neustart. Der echte Modelllauf wurde nach dieser Korrektur nicht wiederholt; ein sichtbarer UI-Durchlauf steht aus.
- Branchloom erfasst noch keine Antigravity-Gesprächs-ID und bietet keinen Resume-Dialog für diesen CLI-Typ. Nach App-Neustart wird ein unterbrochener Schritt zur Prüfung pausiert, ohne Aktionen erneut auszuführen.
- Die CLI verwendet ihre eigenen Anmeldedaten, Berechtigungen und Ausführungsmodi. Für unbeaufsichtigte Antigravity-Workflows blockiert Studio `--dangerously-skip-permissions` in Profilargumenten. Andere durch den Nutzer konfigurierte `agy`-Berechtigungen bleiben wirksam. Headless-Aktionen, für die die CLI eine nicht verfügbare Zustimmung bräuchte, kann sie laut Google verweigern, obwohl der Prozess erfolgreich endet; deshalb verlangt Studio für den Abschluss zusätzlich den Workflow-Marker `[JARVIS_STEP_DONE]`.
- Der Abschlussmarker gilt nur bei Exit-Code 0 und als letzte Textzeile der bereinigten Ausgabe. Eine Prompt-Wiederholung mit weiterer Ausgabe oder spätere Textausgabe genügt nicht. Die begrenzte VT-Bereinigung bildet keinen vollständigen Terminalbildschirm ab und beweist keine fachliche Qualität oder tatsächlich ausgeführte externe Aktion.

CLI-Vertrag: [Google CLI-Referenz](https://antigravity.google/docs/cli/reference), [Headless-Modus](https://antigravity.google/docs/cli/headless/), [Effort](https://antigravity.google/docs/cli/commands/effort).
