# Planstellen kommentieren

Unter **Workflows** erzeugt **Ablauf vorschlagen** einen gespeicherten Planentwurf. Die Vorschläge liegen in der lokalen Branchloom-Datenbank außerhalb des Projekt-Repositories. Nach einem App-Neustart kann der aktuelle oder ein älterer Vorschlag über **Gespeicherte Planvorschläge** erneut geöffnet werden. Ein neuer Vorschlag markiert den bisherigen offenen Vorschlag als älter; seine Kommentare bleiben lesbar.

Im Bereich **Planstellen kommentieren** sind Titel, Begründung, Karten und Route als nummerierte Textzeilen dargestellt. Eine Zeile wählen, den Kommentar schreiben und **Kommentar speichern** klicken. Der Hauptprozess prüft Plan-ID, Fingerabdruck, offene Version und echte Zeilennummer erneut. Ein alter oder bereits übernommener Vorschlag kann nicht nachträglich kommentiert oder ein zweites Mal übernommen werden. Die Übernahme legt Karten und Workflow-Entwurf in einer SQLite-Transaktion an; sie startet keinen Agenten. Bei laufender To-Do-Warteschlange muss diese vor der Übernahme pausiert werden.

**Feedback kopieren** kopiert die Kommentare mit Zeilenbezug in die Zwischenablage. Für eine Überarbeitung kann man den Text bewusst in einen neuen Auftrag einfügen und erneut planen. Dieser Klick sendet nichts an einen Agenten oder externen Dienst. Ein automatischer Rückkanal und Inline-Antworten des Planers sind noch offen. Der Projektpaket-Export enthält keine Planvorschläge oder Kommentare.

Grenzen: maximal 500 Review-Zeilen, 100 Kommentare pro Vorschlag und 2.000 Zeichen pro Kommentar. Die Zeilen gehören nur zu genau diesem gespeicherten Vorschlag; es gibt keine semantische Zuordnung zwischen zwei verschiedenen Planversionen.

Gezielte Prüfungen: `npx vitest run tests/main/plan-review.test.ts tests/renderer/plan-review.test.tsx`. Sie prüfen Neustart-Persistenz, alte Fingerabdrücke, doppelte Übernahme, Transaktions-Rollback und escaped Modelltext.
