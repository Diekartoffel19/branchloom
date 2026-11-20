# Memory-Notizen

Memory speichert Notizen pro Projekt in der lokalen SQLite-Datenbank der App. Der Projektordner bekommt keine Memory-Dateien. Notizen lassen sich mit `[[Notiztitel]]` verbinden; Klicks in der Vorschau und im Graph öffnen die verknüpfte Notiz.

## Schreiben und ansehen

1. Unter **Memory → Neue Notiz** Titel, Text und optionale Tags eingeben.
2. **Notiz speichern** wählen. Beim Öffnen einer gespeicherten Notiz erscheint die Vorschau.
3. **Bearbeiten** und **Vorschau** wechseln zwischen Editor und Ansicht. Die Vorschau unterstützt Überschriften, Listen, Zitate, Codeblöcke, Inline-Code, Fettdruck und Wiki-Links. Rohes HTML wird nur als Text angezeigt.
4. Die Pfeile über einer Notiz springen durch den zuletzt besuchten Notizverlauf. Tags über der Liste filtern Notizen; die Suche berücksichtigt Titel, Text und Tags.

## Markdown austauschen

- **Markdown importieren** öffnet eine einzelne `.md`-Datei bis 500 KB als neuen, noch ungespeicherten Entwurf. Titel und Tags aus einem von Jarvis Studio erzeugten Export werden erkannt. Der Import überschreibt keine vorhandene Notiz; erst **Notiz speichern** schreibt in die Datenbank.
- **.md** bei einer gespeicherten Notiz lädt sie als Markdown-Datei herunter. Der Dateiname wird für Windows bereinigt. Tags stehen als YAML-Frontmatter; der Titel ist die erste Überschrift. Die Datei kann in einem Markdown-Vault geöffnet werden.
- Links auf Notiztitel bleiben im Markdown als `[[Titel]]` erhalten. Das erste Import-/Export-Format überträgt eine Notiz pro Datei, keinen gesamten Vault oder Anhänge.

Das Modell indexiert Agentengespräche und Repository-Dateien derzeit nicht automatisch. Die semantische Suche und Quellenbelege stehen auf der [Paritätsliste](PARITY.md).
