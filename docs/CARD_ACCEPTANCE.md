# Abnahmekriterien an Karten

Öffne eine Karte im Board. Unter **Abnahmekriterien** kannst du bis zu 30 konkrete Ergebnisse formulieren, ändern oder entfernen. Die Kriterien stehen im lokalen Branchloom-Datenordner und bleiben nach einem App-Neustart erhalten. Archivierte Karten zeigen sie weiterhin, lassen aber keine Änderung zu.

Ein Kriterium zeigt **Prüfverweis fehlt**, bis du eine gespeicherte Quelle derselben Karte zuordnest. Erstelle dazu bei Bedarf unter **Lokale Browser-QA** einen Bericht oder unter **Diff und Kommentare** einen Review-Kommentar. Klicke danach bei den Kriterien **Quellen aktualisieren**, öffne **Kriterium und Verweise bearbeiten**, wähle die Quelle und beschreibe, welcher Teil des Ergebnisses dort geprüft oder besprochen wurde. Ein Kriterium kann bis zu zehn Verweise haben. Die Übersicht zählt Kriterien ohne noch verfügbare Prüfquelle.

Die Zuordnung ist bewusst manuell. Ein QA-Bericht mit dem Status „ohne erfasste Fehler“ prüft nur seinen Seitenaufruf und die begrenzten DOM-Hinweise; er bestätigt keine beliebige Interaktion. Ein Diff-Kommentar ist eine Review-Notiz, keine Testbestätigung. Branchloom markiert deshalb **kein** Kriterium allein wegen eines Verweises als erfüllt und gibt keinen Agentenlauf oder Merge frei. Fehlgeschlagene QA-Berichte bleiben als solche sichtbar. Wird ein älterer Bericht durch die begrenzte Berichtshistorie entfernt, zeigt die Karte den Verweis als fehlende Quelle und zählt das Kriterium wieder als Lücke.

Änderst du die Formulierung eines Kriteriums, bleiben frühere Verweise lesbar, zählen aber nicht mehr für die aktuelle Formulierung. Du kannst sie lösen und eine Quelle bewusst erneut zuordnen.

Die Hauptprozessprüfung akzeptiert nur vorhandene QA-Berichte und Review-Kommentare derselben Karte. Textlängen, Anzahl, Archivstatus und doppelte Verweise werden geprüft. Der [Projektpaket-Export](PROJECT_PACKAGE.md) übernimmt die Kriterientexte; beim Import erhalten sie neue IDs und stehen wieder ohne Prüfverweise da, weil QA-Berichte und Review-Kommentare nicht im Paket liegen. Es gibt noch keine automatische Kriterienerkennung aus Agententext, keine Zuordnung zu Testbefehlen und keine Abnahmeentscheidung.
