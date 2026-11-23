# Lokale Browser-QA einer Karte

In einer offenen Board-Karte unter **Lokale Browser-QA** eine laufende Vorschau-Adresse eingeben, etwa `http://127.0.0.1:5173/`, und **Lokale Seite prüfen** klicken. Branchloom startet keinen Dev-Server und keinen Agenten. Der Server muss bereits laufen. Der Klick öffnet genau diese Route in einem verborgenen Electron-Browser mit frischer, nicht persistenter Sitzung, wartet kurz auf Konsolen- und Ladefehler und speichert den Bericht an der Karte. Der letzte Bericht ist aufgeklappt; bis zu 20 Berichte bleiben lokal gespeichert.

Zulässig sind nur HTTP(S)-Adressen auf `localhost`, `127.0.0.1` oder `[::1]`, ohne eingebettete Zugangsdaten. Anfragen und Navigation zu anderen Origins, Pop-ups, Downloads und Browser-Berechtigungen werden blockiert. Die QA-Sitzung teilt keine Cookies mit den normalen Browser-Tabs. Jede Prüfung ist ausdrücklich anzustoßen und läuft höchstens einmal gleichzeitig pro Karte. Eine archivierte Karte ist schreibgeschützt.

**Bestanden** heißt nur, dass beim einen Seitenaufruf im kurzen Prüfzeitraum keine erfassten Fehler auftraten. **Fehlgeschlagen** nennt konkrete Console-Error-Meldungen, Hauptframe-Ladefehler oder blockierte Fremdanfragen. **Nicht abgeschlossen** zeigt einen Ladefehler oder Zeitablauf. Gespeicherte URLs verlieren Query und Fragment; Konsolenmeldungen und Fehlertexte können weiterhin Inhalte aus der lokalen App enthalten und bleiben deshalb nur im lokalen SQLite-Profil.

Die Prüfung beweist kein korrektes Layout, keine Interaktionen, weitere Routen oder Barrierefreiheit. Sie verschiebt keine Karte, startet keinen Fix-Agenten, gibt keinen Review frei und merged keinen Code. Für eine vollständige QA sind diese Schritte weiterhin separat nötig.

Die geladene lokale Seite führt ihr eigenes JavaScript aus und kann Anfragen an dieselbe lokale Origin senden. Prüfe deshalb eine Dev-Server-Route, die für diesen Test geeignet ist; Branchloom behauptet keine Nebenwirkungsfreiheit der besuchten Anwendung.
