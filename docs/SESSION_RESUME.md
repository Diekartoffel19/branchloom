# Codex-Gespräch bewusst fortsetzen

Wenn ein Codex-Lauf beendet wurde oder nach App-Neustart als fehlgeschlagen erscheint, öffne seine Karte und klicke **Codex-Gespräch auswählen**. Studio startet `codex resume --include-non-interactive` als neue, protokollierte PTY-Sitzung im selben Projektordner oder im gespeicherten Karten-Worktree. Der interaktive Codex-Picker erscheint im Terminal. Wähle dort das passende Gespräch mit der Tastatur und prüfe dessen Verlauf, bevor du eine neue Anweisung sendest.

Studio verwendet absichtlich weder `--last` noch einen automatisch wiederholten Prompt. Die lokale Codex-Gesprächs-ID ist derzeit nicht mit der Studio-Sitzungs-ID verknüpft; mehrere Codex-Gespräche im selben Ordner können im Picker erscheinen. Die Auswahl liegt beim Nutzer. Falls Codex den Verlauf lokal nicht mehr findet oder die Anmeldung abgelaufen ist, zeigt das Terminal die CLI-Meldung. Ein ausgetauschter oder fehlender Karten-Worktree sperrt die Fortsetzung. Die App legt dafür keinen neuen Worktree an, setzt keine Git-Dateien zurück und speichert keine Zugangsdaten.

Die neue Sitzung bleibt eine **manuelle Karten-Sitzung**. Ein pausierter Workflow oder eine Projektwarteschlange wird dadurch nicht automatisch abgeschlossen oder erneut gestartet. Bei aktiver Projektwarteschlange ist die manuelle Fortsetzung gesperrt, bis sie pausiert ist. Ein laufender Codex-Prozess kann bei einem kurzen WLAN-Ausfall selbst weiterlaufen; dieser Knopf greift erst nach dessen Ende. Studio verspricht keine automatische Wiederverbindung oder das Fortsetzen einer mitten im Tool-Aufruf unterbrochenen Runde.

Das Kartenterminal rendert jetzt ANSI-Steuersequenzen mit xterm.js und leitet echte Tastatureingaben an den PTY-Prozess weiter. Das separate Nachrichtenfeld bleibt für längere Texte. `Strg+C` im fokussierten Terminal geht an die CLI; **Stoppen** beendet die Studio-Sitzung. Gespeicherte Ausgabe bleibt in der Aktivitätsansicht einsehbar.

Grundlage: [offizielle OpenAI-Dokumentation zu `codex resume`](https://learn.chatgpt.com/docs/developer-commands?surface=cli#codex-resume) und [Codex CLI](https://learn.chatgpt.com/docs/codex/cli).
