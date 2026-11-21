# Befehlsterminal

Im Bereich **Terminal** wählst du **Windows PowerShell** oder **Eingabeaufforderung (cmd)** und klickst **Terminal starten**. Die Shell öffnet im Ordner des aktiven Projekts. Du gibst Befehle im interaktiven Terminal ein; die App führt beim Öffnen des Bereichs keinen Befehl aus. **Stoppen** beendet die laufende Shell. Pro Projekt kann höchstens ein Befehlsterminal gleichzeitig laufen. Während eine Projektwarteschlange läuft, musst du diese zuerst pausieren.

Die letzten 30 Terminals sind im Bereich auswählbar. Ihre Ausgabe wird im lokalen App-Datenordner in SQLite auf die letzten 100.000 Zeichen begrenzt. Ein App-Neustart markiert einen damals laufenden Terminalprozess als fehlgeschlagen und startet ihn nicht erneut. Für einen neuen Prozess musst du erneut **Terminal starten** wählen.

Die Shell läuft mit deinen Windows-Rechten. Sie kann daher Dateien ändern und Programme oder Netzverbindungen starten. PowerShell wird ohne Profil und mit einer festen Argumentliste geöffnet; Projektpfade werden als Arbeitsverzeichnis übergeben und nicht in eine Shell-Zeile eingesetzt. Terminalausgabe kann vertrauliche Daten enthalten und gehört nicht in öffentliche Git-Commits.

Dies ist eine lokale Windows-Stufe: keine SSH-/WSL-Sitzungen, keine automatische Wiederaufnahme eines Shell-Prozesses und keine gemeinsame Zusammenführung mit Agentenverläufen. Die History speichert Ausgabe und Status, aber keinen vollständigen Satz eingegebener Befehle als getrennte Datensätze.
