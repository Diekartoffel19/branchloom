# Lokale Spracheingabe

Branchloom nimmt im Fenster einen kurzen Audioclip auf und gibt ihn über Electron IPC an einen lokalen Python-Prozess. Dieser liest die Bytes aus `stdin`, transkribiert mit Faster-Whisper auf der CPU und gibt nur den Text zurück. Die Aufnahme wird von diesem Pfad nicht als Datei gespeichert. Modell und Bibliothek müssen einmalig eingerichtet werden; ein laufender Modellaufruf lädt nichts aus dem Netz (`local_files_only=True`).

## Einrichtung unter Windows

PowerShell im Repository-Ordner öffnen:

```powershell
.\scripts\setup-voice.ps1
npm run dev
```

Das Skript verlangt Python 3.13, erstellt bei Bedarf `.venv`, installiert die gepinnten Versionen `faster-whisper==1.2.1` und `av==18.1.0` und prüft das Whisper-base-Modell zunächst vollständig offline. Nur wenn es fehlt, lädt es das Modell nach. Ein erneuter Lauf verwendet die vorhandene Installation. Der einmalige Download braucht Internet; danach funktionieren Transkriptionen offline. Das Modell liegt unter `%LOCALAPPDATA%\JarvisStudio\voice-models`, außerhalb des Git-Repositories. Eine vorhandene `.venv` mit falscher Python-Version wird nicht automatisch gelöscht.

Für eine andere Python-Installation oder einen anderen Modellordner:

```powershell
.\scripts\setup-voice.ps1 -Python 'C:\Pfad\zu\python.exe' -ModelDirectory 'D:\MeineModelle\JarvisStudio'
```

Der Modellpfad muss absolut und außerhalb des Repositories liegen. Das Skript setzt `JARVIS_STUDIO_PYTHON` und `JARVIS_STUDIO_WHISPER_MODEL_DIR` für die aktuelle PowerShell und gibt die beiden Befehle für ein späteres Terminal aus. Es liest und speichert keine API-Schlüssel.

Im Fenster Mikrofonzugriff erlauben, Aufnahme starten, sprechen und Aufnahme beenden. Der erkannte Text erscheint zur Prüfung im Eingabefeld. Ein leerer oder unverständlicher Clip führt zu einem sichtbaren Fehler. Clips über 8 MiB oder 60 Sekunden werden abgelehnt; der Python-Prozess hat ein Zeitlimit von zwei Minuten.

Unter **Design** kannst du nach der Auswahl eines gespeicherten lokalen Elements **Wunsch als Karte vorbereiten** öffnen. Die Aufnahme startet erst mit **Wunsch aufnehmen**. Nach **Aufnahme beenden** erscheint die lokale Transkription in einem bearbeitbaren Feld; alternativ kannst du den Wunsch direkt eintippen. Erst der Klick auf **Karte mit Beleg speichern** speichert eine Board-Karte und den zuvor geprüften Design-Beleg. Mikrofonablehnung, leere Aufnahme und fehlendes Modell zeigen einen Fehler; ein ungespeicherter Entwurf kann verworfen werden. Das Aufnehmen allein startet keinen Agenten.

## Grenzen

- Diese erste Fassung transkribiert nach Ende der Aufnahme. Fortlaufende Live-Diktation, globales Push-to-talk, Unterbrechen der Wiedergabe und Sprachausgabe sind eigene nächste Schritte.
- Sie verwendet bewusst kein Cloud-Transkriptionsangebot und sendet keine Aufnahme an einen API-Anbieter. Die allgemeine Agent-CLI kann eigene Netzkommunikation ausführen; das ist von diesem Sprachpfad getrennt.
- Für einen verteilbaren Installer muss die Python-Laufzeit samt Modell-Einrichtung noch als optionales Paket integriert werden. Der Quellcode-Start funktioniert mit obigen Schritten.

Tests: `npm test -- tests/voice/transcribe.test.ts tests/voice/setup-script.test.ts` prüft Eingabegrenzen, Prozessargumente ohne Shell, Offline-Modellmodus, fehlendes Modell sowie PowerShell-Syntax und frühe Setup-Fehler. Ein echter Mikrofon-zu-Text-Test auf einem frischen Laptop ist zusätzlich nötig.
