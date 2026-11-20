# Jarvis Studio: Arbeitsregeln

Jarvis Studio ist eine eigenständige lokale Agenten-App. Kangentic dient als Referenz für gewünschte Abläufe; Quellcode daraus wird nicht übernommen. Die bisherige Jarvis-App pausiert während dieses Aufbaus.

- Reale CLI-Agenten, gespeicherte Daten und tatsächliche UI-Abläufe sind wichtiger als Demo-Zustände. Eine Funktion erst als fertig bezeichnen, wenn sie überprüft wurde.
- Das öffentliche Repository enthält nur allgemeine Software, synthetische Tests und Dokumentation. Schlüssel, persönliche Inhalte, Board-Daten, Agentenprotokolle und lokale Profile liegen außerhalb des Repositories.
- Ein Agent darf für schreibende oder externe Aktionen nicht allein wegen einer Modellantwort zusätzliche Berechtigungen erhalten. Automatischer Start ist eine bewusste Projekt-/Spalteneinstellung; Stop/Pause muss zuverlässig sein.
- Änderungen an Karten und Workflows müssen nach einem App-Neustart erhalten bleiben. Fehler und Grenzen bleiben in `docs/STATUS.md` sichtbar.
- Vor einem öffentlichen Push: Diff, `npm audit`, Tests, Typprüfung und Build prüfen. Keine personenbezogenen Pfade oder Secrets committen.

Aktuelle Nutzerpriorität: erst eine eigene App mit Kangentic-artiger Funktionsbreite (Board, CLI-Agenten, Workflows, Sprache, Memory), dann Jarvis weiterentwickeln. Das Produkt soll später über Kangentic hinausgehen. Neue Verhaltenswünsche des Nutzers gehen vor dieser Datei.
