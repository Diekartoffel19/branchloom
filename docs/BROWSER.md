# Eingebetteter Browser

Der Bereich **Browser** öffnet HTTP- und HTTPS-Seiten direkt im Studio-Fenster. Die Adressleiste akzeptiert vollständige URLs oder ergänzt bei einem Hostnamen automatisch `https://`. Über **Neuer Tab** lassen sich weitere Seiten öffnen; ein Klick wechselt den Tab, **×** schließt ihn. Jeder Tab hat eine eigene Seitenansicht und einen unabhängigen Zurück-/Vorwärts-Verlauf. Der Browser ist auch ohne angelegtes Projekt erreichbar.

## Technische Grenze

Fremde Seiten laufen in einem eigenen `WebContentsView` mit separater, dauerhaft gespeicherter Electron-Session (`persist:jarvis-studio-browser`). Der Renderer hat kein Node.js, kein Preload und keinen Zugriff auf `window.studio`. Context Isolation, Sandbox und Web Security sind aktiv. Datei-, `javascript:`- und `data:`-URLs sowie URLs mit eingebetteten Zugangsdaten werden abgelehnt. Pop-up-Fenster, Downloads und Browser-Berechtigungen (etwa Kamera, Mikrofon, Geolocation und Benachrichtigungen) sind in dieser ersten Stufe gesperrt. Der normale Studio-Renderer akzeptiert IPC nur aus seinem Hauptframe.

Cookies und Logins dieser Browsersession werden im Electron-Benutzerdatenordner gehalten, nicht im Git-Repository. Die App liest sie nicht für Agenten aus. Alle Tabs nutzen dieselbe isolierte Browsersession, behalten aber eigene Seiten und Verläufe. Die Tab-Liste und der zuletzt aktive Tab werden zusätzlich in `browser-session.json` unter Electron `userData` gespeichert. Der Dateiname ist fest, das Format ist versioniert und auf 24 Tabs sowie gültige HTTP(S)-Adressen begrenzt. Geschrieben wird über eine temporäre Datei mit anschließendem Umbenennen. Eine manipulierte oder defekte Datei wird ignoriert beziehungsweise auf sichere Einträge reduziert; Datei-URLs und andere lokale Protokolle werden nie wiederhergestellt.

Beim App-Start werden die gespeicherten Tabs zunächst nur als Adressen angezeigt. Erst wenn du den Browserbereich öffnest, lädt der aktive Tab seine Seite; weitere Tabs laden beim Auswählen. So startet kein versteckter Webseitenaufruf allein durch den App-Neustart. Der Verlauf innerhalb eines Tabs wird dabei nicht wiederhergestellt, nur seine letzte URL. Die JSON-Datei kann Adressen mit Suchparametern enthalten und sollte deshalb wie private lokale Browserdaten behandelt werden. Browser-Berechtigungen bleiben auch nach einem Neustart gesperrt. Der Browser besitzt noch keine Automationsschnittstelle für CLI-Agenten, Downloads oder explizite Berechtigungsdialoge. Manche Dienste, darunter Google-Anmeldungen, können eingebettete Browser grundsätzlich ablehnen oder Pop-ups verlangen; dafür ist diese Stufe nicht als garantierter Login-Pfad vorgesehen.

## Prüfen

`npx vitest run tests/main/browser.test.ts tests/main/browser-persistence.test.ts tests/renderer/browser-view.test.tsx` prüft URL- und Größenregeln, die isolierten Electron-Einstellungen, Berechtigungsablehnung, Redirect-Sperre, Tabwechsel, unabhängige Verläufe, Persistenz und verzögertes Laden sowie die Bedienoberfläche. Ein echter Netzwerk-Navigationslauf muss zusätzlich im Desktop-Fenster geprüft werden. Die vom Nutzer gestoppte Computersteuerung wird dafür derzeit nicht wieder aufgenommen.

Sicherheitskonfiguration nach den [Electron-Empfehlungen](https://www.electronjs.org/docs/latest/tutorial/security) und der [WebContentsView-API](https://www.electronjs.org/docs/latest/api/web-contents-view).
