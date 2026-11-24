# Wireframe zu einer Aufgabe

Der Designbereich kann einen einfachen App-Fensterentwurf mit einer Board-Karte verbinden. Er ist ein editierbarer Plan vor dem Coding, keine Darstellung der laufenden App. Die vorhandene lokale Design-Inspektion steht im selben Bereich darunter.

## Ablauf

1. Eine Board-Karte öffnen und **Wireframe in Design öffnen** wählen. Alternativ unter **Design → Wireframe zur Aufgabe** eine Karte auswählen.
2. **Fenstergerüst vorbereiten** legt eine lokale Vorlage in die noch ungespeicherte Ansicht. **Leere Fläche beginnen** startet ohne Elemente. Die Vorlage ist deterministisch und kein KI-Ergebnis.
3. Eine Fläche, Textzeile, Schaltfläche oder Eingabe hinzufügen. Ein Element auf der Fläche oder in der Ebenenliste auswählen, mit der Maus ziehen und Text, Position, Größe oder Ton in **Eigenschaften** bearbeiten. Pfeiltasten verschieben das fokussierte Element um einen Pixel, Umschalt+Pfeiltaste um zehn Pixel; Entfernen löscht es. Numerische Werte sind auf die 960 × 600 Pixel große Zeichenfläche begrenzt.
4. **Entwurf speichern** schreibt die aktuelle Version in die lokale SQLite-Datenbank des Projekts. **Für Agenten freigeben** gibt ausschließlich diese gespeicherte Version als Layoutkontext für **spätere, ausdrücklich gestartete** Agentenläufe derselben Karte frei. Ein erneutes Speichern hebt die bisherige Freigabe auf. Der Freigabeknopf startet keinen Agenten und ändert keine Projektdatei.
5. Nach einem Neustart dieselbe Karte im Designbereich wählen, um den letzten gespeicherten Entwurf wieder zu öffnen. Ungespeicherte Änderungen lassen sich mit **Änderungen verwerfen** zurücksetzen.

Die Freigabe ist ein Hinweis im Agentenauftrag: Titel, Elementtypen, Texte und Geometrie. Gespeicherte Texte sind Interface-Inhalt, keine Anweisungen oder Berechtigungen. Der Entwurf ist an Projekt und Karte gebunden; ein anderer Projektkontext kann ihn nicht lesen oder freigeben. Parallele oder veraltete Speicher- und Freigabeversuche werden über die Versionsnummer abgewiesen.

## Grenzen dieser Stufe

Es gibt eine Zeichenfläche je Karte und vier einfache Elementarten. Freie Vektoren, verschachtelte Komponenten, responsive Artboards, echte Figma-Dateien und eine Ableitung aus laufendem Windows-UI sind offen. Der erste Entwurf entsteht hier durch die Vorlage oder manuelle Eingabe; ein CLI-Agent erzeugt noch keinen Wireframevorschlag. Die Workflow-Queue wartet nicht automatisch auf die Designfreigabe. Wer einen Wireframe vor dem Coding abstimmen möchte, legt ihn zuerst an und startet den Agenten danach bewusst.
