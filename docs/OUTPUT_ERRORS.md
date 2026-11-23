# Fehler aus gespeicherter Ausgabe übernehmen

1. Eine Board-Karte mit beendetem Agentenlauf öffnen oder im Bereich **Terminal** ein beendetes Befehlsterminal auswählen.
2. Unter **Fehler aus Ausgabe übernehmen** eine angezeigte Fehlerzeile wählen. Branchloom liest dafür die lokal gespeicherte Ausgabe des konkreten Laufs im aktiven Projekt. Die Auswahl wird vor dem Speichern noch einmal gegen die gespeicherte Ausgabe geprüft.
3. Reproduktionsschritte ergänzen, eine Zielspalte wählen und **Als Karte anlegen** klicken. Die neue Karte enthält die ausgewählte Zeile, den Quelllauf, Abschlusszeit und die Notiz. Sie wird im Board geöffnet. Wiederholtes Übernehmen derselben Zeile desselben Laufs öffnet dieselbe Karte.

Diese Aktion startet keinen Agenten und gibt ihm keine neuen Rechte. Eine laufende To-do-Warteschlange sperrt neue Karten in **To Do**, weil sie dort sofort einen Lauf beginnen könnte. Eine andere Spalte bleibt auswählbar. Spätere Agentenstarts an der neuen Karte sind getrennte, bewusste Aktionen.

Die Erkennung ist bewusst eng: Sie berücksichtigt nur erkennbare Fehlerzeilen wie `Error:`, `Fatal:`, `Exception:` oder `Failed:` in den letzten 50.000 Zeichen der gespeicherten Ausgabe, höchstens 20 Treffer und höchstens 400 Zeichen pro Zeile. Kontrollzeichen werden entfernt. Andere Fehlerformate können fehlen; dann kann eine normale Board-Karte manuell angelegt werden. Der Zeilenbezug gilt für diesen begrenzten Ausgabeauszug. Reproduktionsnotizen sind auf 2.000 Zeichen begrenzt. Terminalausgaben werden von Branchloom bereits begrenzt gespeichert; diese Ansicht erfasst keine fremden Prozesse oder Live-Konsolen.

Die Ausgabe und die erzeugte Karte liegen zunächst in der lokalen SQLite-Datenbank. Eine Fehlerzeile oder Notiz kann Geheimnisse oder persönliche Inhalte enthalten. Vor dem Übernehmen prüfen; die Karte kann bei einem später ausdrücklich gestarteten Agentenlauf zum Prompt gehören und bei einem bewussten Projektpaket-Export im Pakettext landen. Es gibt keine automatische Geheimniserkennung, Reproduktion, Ursachenanalyse oder Fixprüfung.
