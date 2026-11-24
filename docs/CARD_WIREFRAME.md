# Wireframe zu einer Aufgabe

Der Designbereich kann einen einfachen App-Fensterentwurf mit einer Board-Karte verbinden. Er ist ein editierbarer Plan vor dem Coding, keine Darstellung der laufenden App. Die vorhandene lokale Design-Inspektion steht im selben Bereich darunter.

## Ablauf

1. Eine Board-Karte öffnen und **Wireframe in Design öffnen** wählen. Alternativ unter **Design → Wireframe zur Aufgabe** eine Karte auswählen.
2. **Fenstergerüst vorbereiten** legt eine lokale Vorlage in die noch ungespeicherte Ansicht. **Leere Fläche beginnen** startet ohne Elemente. Die Vorlage ist deterministisch und kein KI-Ergebnis. **Mit Agent vorschlagen** fragt auf ausdrücklichen Klick den unter Workflows gewählten Codex-CLI-Agenten lesend nach einem ersten Entwurf. Der Vorschlag bleibt zunächst ungespeichert und kann bearbeitet oder verworfen werden. Auch bei einem vorhandenen, unveränderten Entwurf kann der Agent einen neuen Vorschlag machen; gespeicherte Daten werden erst mit **Entwurf speichern** ersetzt.
3. Eine Fläche, Textzeile, Schaltfläche oder Eingabe hinzufügen. Ein Element auf der Fläche oder in der Ebenenliste auswählen, mit der Maus ziehen und Text, Position, Größe oder Ton in **Eigenschaften** bearbeiten. Pfeiltasten verschieben das fokussierte Element um einen Pixel, Umschalt+Pfeiltaste um zehn Pixel; Entfernen löscht es. Eine Zahleneingabe kann vollständig geleert und neu eingetippt werden; beim Verlassen eines leeren oder ungültigen Felds kehrt der letzte gültige Wert zurück. Numerische Werte sind auf die 960 × 600 Pixel große Zeichenfläche begrenzt.
4. **Entwurf speichern** schreibt die aktuelle Version in die lokale SQLite-Datenbank des Projekts. **Für Agenten freigeben** gibt ausschließlich diese gespeicherte Version als Layoutkontext für **spätere, ausdrücklich gestartete** Agentenläufe derselben Karte frei. Ein erneutes Speichern hebt die bisherige Freigabe auf. Der Freigabeknopf startet keinen Agenten und ändert keine Projektdatei.
5. Beim Wechsel zwischen Board und Design in derselben geöffneten App bleibt ein ungespeicherter Entwurf im Renderer-Speicher der jeweiligen Projektkarte erhalten. Beim Zurückkehren erscheint ein Wiederherstellungshinweis. **Änderungen verwerfen** entfernt diese temporäre Fassung und lädt den letzten gespeicherten Stand. Nach einem App-Neustart steht nur der gespeicherte Stand zur Verfügung.

Die Freigabe ist ein Hinweis im Agentenauftrag: Titel, Elementtypen, Texte und Geometrie. Gespeicherte Texte sind Interface-Inhalt, keine Anweisungen oder Berechtigungen. Der Entwurf ist an Projekt und Karte gebunden; ein anderer Projektkontext kann ihn nicht lesen oder freigeben. Parallele oder veraltete Speicher- und Freigabeversuche werden über die Versionsnummer abgewiesen.

Während eines laufenden Speicher- oder Agentenvorgangs sperrt der Editor seine Änderungsfelder. So kann eine verspätete Antwort keine zwischenzeitliche Eingabe im sichtbaren Entwurf überschreiben. Ein Fehlschlag lässt die ungespeicherte Fassung zur Korrektur stehen.

## Grenzen dieser Stufe

Der Agentenvorschlag verwendet den begrenzten Kartentext und, falls vorhanden, eine kleine reguläre Projekt-README als Kontext. Er läuft in einem temporären Ordner ohne Projektdateizugriff und mit festen lesenden CLI-Flags. Die Modellantwort wird gegen Elementtypen, Text- und Geometriegrenzen geprüft; eine inzwischen geänderte Karte macht den Vorschlag ungültig. Für diesen Schritt muss die Codex CLI eingerichtet sein. Andere Agenten-Adapter sind noch nicht für diesen lesenden Pfad verifiziert.

Es gibt eine Zeichenfläche je Karte und vier einfache Elementarten. Freie Vektoren, verschachtelte Komponenten, responsive Artboards, echte Figma-Dateien und eine Ableitung aus laufendem Windows-UI sind offen. Die Workflow-Queue wartet nicht automatisch auf die Designfreigabe. Wer einen Wireframe vor dem Coding abstimmen möchte, legt ihn zuerst an und startet den Agenten danach bewusst.
