# Aktivität und Agentenverläufe

Die Seite **Aktivität** zeigt den lokalen Stand des geöffneten Projekts: gespeicherte Agentenläufe, Workflows und Karten ohne Lauf. Art, Status und Suchbegriff filtern die Liste. **Zur Karte** und **Zum Workflow** öffnen die jeweilige Stelle.

Bei einem Agentenlauf öffnet **Verlauf ansehen** die gespeicherte Ausgabe dieser konkreten Sitzung, auch wenn die Karte inzwischen einen neueren Lauf hat. Die Ansicht zeigt Beginn, Ende, Dauer, Status und Exit-Code. Terminal-Steuerzeichen werden für die Lesbarkeit entfernt. **Als Text speichern** lädt genau diesen Verlauf nach einem Klick als `.txt`-Datei herunter.

Die Ansicht lädt derzeit höchstens die jüngsten 200 Sitzungen pro Projekt. Pro Sitzung bleiben die letzten 200.000 Zeichen Ausgabe erhalten. Token- und Kostenwerte werden erst angezeigt, wenn dafür verlässliche Daten vorliegen; die aktuelle UI markiert sie als „nicht erfasst“. Der Export erfolgt bewusst durch den Nutzer und wird nicht automatisch ins Projekt-Repository geschrieben.
