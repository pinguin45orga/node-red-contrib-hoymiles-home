# Changelog – node-red-contrib-hoymiles-home

---

## ✅ Stable v0.1.10 (12.06.2026)

### Fehlerbehebungen
- Automatischer Re-Login, wenn die Hoymiles-API mit „token verify error" antwortet — bisher wurde der Fehler nur wiederholt, ohne den Token zu erneuern

---

## ✅ Stable v0.1.9 (11.06.2026)

### Fehlerbehebungen
- Interne Verbesserungen bei der Fehlerprotokollierung für leichterere Diagnose von URI-Problemen (kein Einfluss auf das Verhalten im Normalbetrieb)

---

## ✅ Stable v0.1.8 (09.06.2026)

### Fehlerbehebungen
- Bessere Fehlermeldungen wenn keine Live-URI vom Server zurückkommt, um Verbindungsprobleme schneller zu erkennen

---

## ✅ Stable v0.1.7 (07.06.2026)

### Neue Funktionen
- Vollständige API-Antworten werden bei Fehlern im Log ausgegeben — erleichtert die Fehlersuche erheblich

### Fehlerbehebungen
- URI-Wiederverbindung läuft jetzt intern stabil durch, anstatt den gesamten Polling-Zyklus neu zu starten

---

## ✅ Stable v0.1.6 (04.06.2026)

### Technische Änderungen
- Repository-URL in `package.json` ergänzt (kein Einfluss auf Funktionalität)

---

## ✅ Stable v0.1.5 (04.06.2026)

### Fehlerbehebungen
- Tägliches Login-Limit der Hoymiles-API wird jetzt korrekt erkannt und der Node wartet automatisch bis Mitternacht

---

## ✅ Stable v0.1.4 (04.06.2026)

### Neue Funktionen
- Automatische Login-Wiederholung bei vorübergehenden Verbindungsproblemen mit festem 30-Sekunden-Intervall
- Bei Erreichen des täglichen Login-Limits wartet der Node automatisch bis Mitternacht und versucht es dann erneut

### Fehlerbehebungen
- Falsche Fehlermeldung bei ungültigen Zugangsdaten korrigiert
- Login-Wiederholungsintervall auf stabiles 30-Sekunden-Intervall vereinheitlicht

---

## ✅ Stable v0.1.3 (03.06.2026)

### Fehlerbehebungen
- Re-Authentifizierung wird nur noch bei echten Auth-Fehlern (HTTP 401) ausgelöst — andere Fehler werden nun korrekt als Verbindungsprobleme behandelt und wiederholt

---

## ✅ Stable v0.1.2 (02.06.2026)

### Fehlerbehebungen
- Token-Ablauf während der laufenden Überwachung wird jetzt erkannt und der Login automatisch erneuert

---

## ✅ Stable v0.1.1 (31.05.2026)

### Neue Funktionen
- Erster Release: `hoymiles-watch` und `hoymiles-config` Nodes für Node-RED
- Live-Leistungsdaten von Hoymiles-Wechselrichtern direkt in Node-RED empfangen
- Automatische Authentifizierung mit E-Mail und Passwort
- Unterstützung für EU- und Global-Server

---

## Release-Prozess

```
🔮 In Entwicklung  →  ✅ Stable
     (Ausblick)        (Alle Nutzer)
```

| Phase | Zielgruppe | Beschreibung |
|-------|------------|--------------|
| 🔮 **In Entwicklung** | Entwickler | Ausblick auf kommende Features. Noch in keinem Release enthalten. |
| ✅ **Stable** | Alle Nutzer | Produktionsreife Version. Features sind vollständig getestet und freigegeben. |
