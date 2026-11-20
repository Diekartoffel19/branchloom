# Eingebetteter Browser

Der Bereich **Browser** öffnet HTTP- und HTTPS-Seiten direkt im Studio-Fenster. Die Adressleiste akzeptiert vollständige URLs oder ergänzt bei einem Hostnamen automatisch `https://`. Zurück, Vorwärts und Neuladen bedienen den Verlauf des eingebetteten Fensters. Der Browser ist auch ohne angelegtes Projekt erreichbar.

## Technische Grenze

Fremde Seiten laufen in einem eigenen `WebContentsView` mit separater, dauerhaft gespeicherter Electron-Session (`persist:jarvis-studio-browser`). Der Renderer hat kein Node.js, kein Preload und keinen Zugriff auf `window.studio`. Context Isolation, Sandbox und Web Security sind aktiv. Datei-, `javascript:`- und `data:`-URLs sowie URLs mit eingebetteten Zugangsdaten werden abgelehnt. Pop-up-Fenster, Downloads und Browser-Berechtigungen (etwa Kamera, Mikrofon, Geolocation und Benachrichtigungen) sind in dieser ersten Stufe gesperrt. Der normale Studio-Renderer akzeptiert IPC nur aus seinem Hauptframe.

Cookies und Logins dieser Browsersession werden im Electron-Benutzerdatenordner gehalten, nicht im Git-Repository. Die App liest sie nicht für Agenten aus. Der Browser besitzt noch keine Automationsschnittstelle für CLI-Agenten, keine Tabverwaltung, Downloads oder explizite Berechtigungsdialoge. Manche Dienste, darunter Google-Anmeldungen, können eingebettete Browser grundsätzlich ablehnen oder Pop-ups verlangen; dafür ist die erste Stufe nicht als garantierter Login-Pfad vorgesehen.

## Prüfen

`npx vitest run tests/main/browser.test.ts tests/renderer/browser-view.test.tsx` prüft URL- und Größenregeln, die isolierten Electron-Einstellungen, Berechtigungsablehnung, Redirect-Sperre sowie die Bedienoberfläche. Ein echter Netzwerk-Navigationslauf muss zusätzlich im Desktop-Fenster geprüft werden. Die vom Nutzer gestoppte Computersteuerung wird dafür derzeit nicht wieder aufgenommen.

Sicherheitskonfiguration nach den [Electron-Empfehlungen](https://www.electronjs.org/docs/latest/tutorial/security) und der [WebContentsView-API](https://www.electronjs.org/docs/latest/api/web-contents-view).
