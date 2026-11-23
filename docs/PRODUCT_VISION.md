# Branchloom · Produktvision und Ausbaufolge

Stand: 23.11.2026. Diese Datei hält die neue Nutzerentscheidung fest und ist **kein** Fertigstellungsnachweis. Der technische Iststand steht in [STATUS.md](STATUS.md); Kangentic-Parität und Grenzen stehen in [PARITY.md](PARITY.md).

## Was Branchloom werden soll

Branchloom ist eine lokale Entwicklungszentrale: Ideen besprechen, als überprüfbare Aufgaben formulieren, Architektur nachvollziehen, mehrere CLI-Agenten in getrennten Git-Worktrees koordinieren, die laufende App visuell bearbeiten, Änderungen prüfen und Qualität vor dem Merge nachweisen. Board, Whiteboard, Design, Code und Review teilen Projektkontext und verweisen auf dieselben Aufgaben und Quellen. Ein Agentenlauf zählt nur als abgeschlossen, wenn sein Ergebnis und die vorgesehenen Prüfungen belegbar sind.

Die App wird öffentlich und allgemein nutzbar. Persönlicher Jarvis-Assistent, private Module, Schlüssel, Browserprofile, Nutzerprojekte und Agentenprotokolle gehören nicht in dieses Repository. Das öffentliche Repository `mschr703/branchloom` gehört `mschr703`; `mschr703CODEX` erstellt die Entwicklungs-Commits und pusht sie. Bestehende lokale Daten aus dem früheren Jarvis Studio bleiben beim Namenswechsel zugänglich.

## Designrichtung

Ruhige, präzise Werkstatt statt generischem AI-Dashboard: warme Papier- und Steintöne, ein dunkles neutralgraues Gegenstück, wenige funktionale Akzente, klare Typografie und dichte, gut bedienbare Arbeitsflächen. Keine dunkelblauen Hintergründe, Neonfarben, Glows, dekorativen Verläufe, Sparkle-Motive, Fake-Kennzahlen oder identischen Marketing-Karten. Vor UI-Änderungen den `anti-slop-design`-Skill lesen, echte Zustände und Tastaturpfade prüfen und die Oberfläche sichtbar kontrollieren. Der Skill ist ein Qualitätsmaßstab, kein Ersatz für Nutzerfeedback.

## Funktionskarte

| Bereich | Gewünschter Ablauf | Stand / Abhängigkeit |
| --- | --- | --- |
| Board und Agents | Kanban, getrennte Git-Worktrees und mehrere echte CLI-Agenten parallel; Agent, Modell und Effort pro Workflow-Schritt | Board, CLI-PTY, erste Worktrees und Schrittmodell/-Effort existieren. Mehrere manuelle Kartenläufe sind möglich; koordinierte parallele Workflows bleiben offen. |
| Aufgabenklärung | Mini-Chat mit Projektkontext vor einer Karte; aus Gespräch eine kleine, editierbare Spec machen | Lesende Codex-Aufgabenklärung mit begrenztem README-Kontext, editierbarem Kartenvorschlag und bewusster Übernahme lokal gebaut; synthetischer sichtbarer Ablauf bis zur Karte und echter README-Marker-Test bestanden. Mehrere Agent-Adapter und gespeicherte Gespräche offen. |
| Ideenraum | Lockeres Brainstorming mit Agent; Ideen als Entwurf in Kategorien, Backlog, Roadmap oder Whiteboard sortieren | Erste Stufe: bewusster lesender Codex-Chat mit begrenztem Projektkontext, lokale editierbare Ideen samt Gespräch und manuelle Umwandlung in eine Board-Karte. Whiteboard-Einordnung und weitere Agenten offen. Vorschläge starten keine Aufgabe. |
| Kontextübergabe | Whiteboard-Boxen, Doku-URLs und ausgewählte Design-Ausschnitte auf Karten ziehen | Erste Stufe: Projektdateien und HTTPS-Doku-Adressen werden ausdrücklich an einer Karte gespeichert; begrenzte Dateivorschau nach Klick. Drag-and-drop, Webinhalte, Design-Ausschnitte und Agentenfreigabe offen. |
| Architektur-Whiteboard | Knoten mit echten Ordnern/Tasks verknüpfen; Verbindung kann eine Kartenidee erzeugen; Repo-Struktur visualisieren | Persistenter Canvas mit Karten-/Ordner-/Dateilinks. Git-Index-Analyse mit belegter Vorschau, Auswahl und bewusster Übernahme lokal gebaut. Aus einer Verbindung lässt sich nach editierbarer Vorschau bewusst genau eine Board-Karte mit lesbarem Quellenbezug anlegen. Automatische Abhängigkeitsanalyse offen. |
| Änderungswirkung | Vor Umbauten betroffene Module anhand überprüfbarer Abhängigkeiten markieren | Offen. Heuristik mit Unsicherheit anzeigen, keine erfundene Sicherheit. |
| Visuelles Design | Element in Live-Vorschau auswählen und gezielt ändern; echte Projekt-Tokens verwenden; Desktop/Tablet/Mobile und UI-Zustände vergleichen | Offen. Benötigt isolierte Preview und klaren Schreib-/Übernahmeweg in Projektcode. |
| Komponenten-Canvas | UI-Komponenten finden und mit realen oder synthetischen Zuständen nebeneinander zeigen | Offen. Framework-Erkennung und Vorschau-Limits je Projekt nötig. |
| Theme-Playground | Farben, Schrift und Radien live testen; erst nach ausdrücklichem Übernehmen schreiben | Offen. Projekt-Tokens nicht blind ersetzen. |
| Visuelle Vorlage | Screenshot als Inspiration aufnehmen und auf vorhandene Tokens abbilden | Offen. Rechte, Quellen und Originalität beachten. |
| Performance/Barrierefreiheit | Preview markiert konkrete Kontrast-, Touch- und Ressourcenprobleme; Fix als überprüfbarer Diff | Offen. Messung vor Agentenaktion, erneute Messung danach. |
| Plan- und Code-Review | Anmerkungen an Planstellen und Diff-Zeilen; Antwort zurück an den zuständigen Agenten | Lokale Diff-Zeilenkommentare sind an Git-Commits und Diff-Fingerabdruck gebunden. Gespeicherte Planvorschläge erlauben zeilenbezogene Kommentare mit Fingerabdruck und bewusstem Feedback-Kopieren. Automatischer Rückkanal an Agenten und Review-Freigabe bleiben offen. |
| Visuelle Diffs | Vorher/Nachher für Desktop und Mobile direkt neben Codeänderung | Offen. Reproduzierbare URLs/Zustände und Screenshots nötig. |
| Review-Gedächtnis | Wiederkehrende Kritik als überprüfbare Projektregel übernehmen | Erste Stufe: ausdrückliche Übernahme von Plan-/Diff-Kommentaren als lokale Projektregel mit Quelle, Bearbeiten/Deaktivieren/Entfernen und begrenzter Einbindung in die Codex-Workflow-Planung. Automatische Wiederholungserkennung und andere Agenten bleiben offen. |
| Auto-QA | Isolierter Browser prüft Console-Fehler und Layout vor Review-Inbox; Fehler zurück an Coding-Agent | Erste Stufe: ausdrücklich gestarteter lokaler Seitenaufruf mit Console-/Ladefehlerbericht an einer Karte. Layout, Review-Inbox und Agenten-Rückkanal offen. Keine unkontrollierte Ausführung fremder Seiten oder automatischer Merge. |
| PR-Erzählung | Aus Diff, Tests und Screenshots eine überprüfbare PR-Beschreibung samt optionalem kurzem QA-Clip | Offen. Nur tatsächlich vorhandene Belege verwenden. |
| Decision Inbox | Freigaben, Rückfragen und Reviews aus allen Agentenläufen zentral anzeigen | Erste Ansicht bündelt gespeicherte Workflow-/Queue-Pausen im aktiven Projekt mit Kontext, Suche und Filtern. Agentenfragen, Plan-/Diff-Kommentare und projektübergreifende Inbox bleiben offen. |
| Sprache plus Kontext | Taste halten, UI-Element auswählen/markieren und Änderungswunsch sprechen | Offline-Transkript nach Aufnahmeende existiert; Live-Geste und Elementbezug offen. |
| Duell-Modus | Zwei Agenten in getrennten Worktrees an derselben Aufgabe; Previews vergleichen, Gewinner bewusst auswählen | Offen. Braucht parallele Läufe, Ressourcenlimits, Review und Merge-Konfliktbehandlung. |
| Konflikt-Radar | Früh warnen, wenn parallele Agenten dieselben Dateien oder Abhängigkeiten bearbeiten | Projektweite Git-Pfadwarnung erscheint auch ohne geöffneten Kartendrawer in allen Ansichten und verlinkt betroffene Karten. Zwei gleichzeitige synthetische CLI-Läufe wurden sichtbar geprüft. Abhängigkeitsanalyse zwischen verschiedenen Dateien bleibt offen. |
| Fehler-Catcher | Dev-Server-/Konsolenfehler als Kontext für einen bewusst gestarteten Fixlauf anbieten | Erste lokale Stufe erfasst Konsolenfehler und Hauptframe-Ladefehler in Loopback-Browser-Tabs mit Quelle. Der Nutzer ergänzt Reproduktionsschritte und erstellt ausdrücklich eine Board-Karte; kein Agentenstart. Terminal-/Dev-Server-PTY-Fehler, automatische Zuordnung und Fixlauf sind offen. |
| Modell-Routing | Schwere Planung, schnelle kleine Änderungen und Kostengrenzen bewusst konfigurieren | Offen. Keine verdeckte Modell-/Kostenentscheidung. |
| Loop- und Kostenbremse | Nutzungsdaten, wiederholte Fehler und Limits pro Task sichtbar machen und sicher pausieren | Erste begrenzte Stufe: drei gleiche strukturierte Fehlerzeilen aus aufeinanderfolgenden Queue-Sitzungen erzeugen eine dauerhafte Pausenwarnung. Die Queue pausiert bereits beim ersten Fehlschlag. Kosten und Token bleiben ohne verifizierte Anbietertelemetrie offen. |
| Zeitmaschine | Git-Stand plus Preview-Screenshot als benannte, wiederherstellbare Meilensteine | Erste lokale Stufe: manuell markierte saubere Git-Commits, gespeicherte lokale Ref, Commit-Vergleich und ausdrücklich angelegtes isoliertes Checkout. Screenshots, Slider und Übernahme in den Haupt-Checkout bleiben offen. |
| Worktree teilen | Temporäre Vorschau ausdrücklich teilen; externes Feedback in Inbox | Offen. Öffentliche Tunnel sind optional und brauchen sichtbare Freigaben. |
| Changelog | Täglich/wöchentlich aus echten Commits, Tests und Reviews zusammenfassen | Erste lesende Git-Stufe: 24 Stunden oder sieben Tage, Commit-Hash, Zeit und Betreff aus aktuellem HEAD; bewusste Markdown-Kopie. Test-/Review-Zuordnung und automatische Berichte offen. |

## Umsetzungsfolge

1. **Stabiler Kern:** Branchloom-Umbenennung ohne Datenverlust; Designbasis; Modell und Effort je Workflow-Schritt; echte sichtbare CLI-/UI-Abnahme.
2. **Mehrere Agents:** parallele Worktrees, Konflikt-Radar, zentrale Decision Inbox, robuste Pause/Recovery und verifizierte Übergänge.
3. **Idee bis Architektur:** projektbezogener Mini-Chat, editierbare Mini-Spec, Ideenraum, Whiteboard mit stabilen Links und überprüfbarer Repo-Analyse.
4. **Visuelles Arbeiten:** isolierte Live-Preview, Elementauswahl, Tokens, Viewports, Zustände, Komponenten-Canvas und Theme-Playground.
5. **Review und QA:** Plan-/Diff-Kommentare, Browser-QA, visuelle Diffs, Review-Regeln, PR-Beschreibung und Changelog.
6. **Erweiterte Orchestrierung:** Duell, Modell-Routing, Kosten-/Loop-Limits, Snapshots, Voice-Kontext und ausdrücklich freigegebene Vorschau-Tunnel.

Jeder Punkt wird als vertikaler Ablauf implementiert: Datenmodell und Migration, Hauptprozess/API, UI, echter lokaler Prozess oder Preview, Fehlerfälle, Tests und ein sichtbarer Nutzerpfad. Ein Eintrag in dieser Tabelle allein macht keine Funktion fertig.

## Open-Source-Referenzen

Gewünschte Projekte zum Untersuchen: `Kangentic/kangentic`, `BloopAI/vibe-kanban`, `backnotprop/plannotator`, `xyflow/xyflow`, `tldraw/tldraw`, `onlook-dev/onlook`, `stagewise-io/stagewise`. Die [Lizenz- und Funktionsübersicht](OPEN_SOURCE_REFERENCES.md) hält den geprüften Stand fest. Vor jeder Codeübernahme konkrete Version, Lizenz, transitive Abhängigkeiten und nötige Attribution erneut prüfen. Bei unpassender Lizenz das Verhalten als Produktreferenz nutzen und unabhängig implementieren. Bestehende Branchloom-Formate und Sicherheitsgrenzen gelten auch für integrierte Komponenten.
