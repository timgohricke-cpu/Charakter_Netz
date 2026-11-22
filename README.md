# Charakter-Netz

Boards mit **Charaktertabelle**, **Charakternetz** und **Weltkarte**. Läuft als Website und kann als App (PWA) mit Desktop-Symbol installiert werden.

## Funktionen (Version 1)
- Beliebig viele Boards anlegen, umbenennen, löschen, exportieren und importieren (JSON)
- **Charakternetz:** Kreise frei platzieren, mit Bild ausstatten, per Klick auf zwei Kreise verbinden. Auf den Linien steht eine Kurzbeschreibung, ein Klick darauf öffnet die lange Beschreibung
- **Erstellungskarten** für Charaktere (Name, Bild, Kurzbeschreibung, Infos, Standort-Beschreibung, Position auf der Weltkarte) und für Verbindungen
- **Weltkarte:** eigenes Kartenbild hochladen, Charaktere als Punkte platzieren, zoomen (Mausrad oder zwei Finger), Punkte anklicken
- **Tabelle** mit Suche und Sortierung
- Installierbar als App, funktioniert auch offline

## Datenspeicherung
In Version 1 werden alle Daten lokal im Browser (IndexedDB) gespeichert. Anmeldung, Freigabe-Links und Besucher-/Ersteller-Rechte kommen in Version 2 über ein Backend (Supabase).

## Sicherheit
- Kein externer Code, keine Tracker
- Strenge Content-Security-Policy
- Nutzertexte werden nie als HTML eingefügt
- Auslieferung ausschließlich über HTTPS (GitHub Pages)
