# Changelog aus Git

Wähle in Branchloom ein Projekt mit Git-Repository und öffne **Changelog**. Die Ansicht liest bei jedem Öffnen den aktuellen `HEAD` des Projektordners. **Zeitraum** wechselt zwischen den letzten 24 Stunden und den letzten sieben Tagen. **Aktualisieren** liest Git erneut; **Markdown kopieren** übernimmt genau den angezeigten, mit vollständigen Hashes belegten Stand in die Zwischenablage.

Branchloom zeigt höchstens 100 Commits je Abfrage und markiert weitere Commits ausdrücklich. Jede Zeile enthält den echten Git-Betreff, den Commit-Zeitpunkt und den vollständigen Hash. Die Zeitfenster sind rollend vom angezeigten Prüfzeitpunkt; die Tagesgruppen folgen der lokalen Zeitzone des Computers. Nur von `HEAD` erreichbare Commits werden gelesen. Ein anderer Branch, unversionierte Dateien, reine Kartenänderungen und noch nicht committete Worktree-Arbeit erscheinen hier nicht.

Für Ordner ohne Git und Repositories ohne ersten Commit gibt es eigene Leermeldungen. Git-Aufrufe laufen ohne Shell, mit festem Zeit- und Ausgabelimit und ohne Netzwerkzugriff. Die Funktion schreibt weder Projektdateien noch Branchloom-Daten und startet keinen Agenten.

Dies ist die erste, quellgebundene Stufe des Changelogs. Tests und Reviews sind noch nicht sicher einem Commit zugeordnet; der Bericht behauptet deshalb keine Testergebnisse oder Review-Freigaben. Automatische Tages-/Wochenberichte und eine Zuordnung zu Karten, Tests und Reviews bleiben offen.
