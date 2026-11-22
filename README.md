# Charakter-Netz

Boards mit **Charaktertabelle**, **Charakternetz** und **Weltkarte**. Läuft als Website und kann als App (PWA) mit Desktop-Symbol installiert werden.

**Live:** https://timgohricke-cpu.github.io/Charakter_Netz/

## Funktionen
- **Konto:** Registrierung und Anmeldung mit eindeutigem Benutzernamen und Passwort, „Angemeldet bleiben“, Passwort ändern, Konto löschen
- **Startseite:** „Meine Boards“ (bearbeiten, umbenennen, teilen, exportieren, löschen) und „Mit mir geteilt“ (über einen Link besuchte Boards, nur ansehen)
- **Teilen:** „Link teilen“ erzeugt einen Freigabe-Link (Teilen-Menü des Handys, WhatsApp oder Kopieren). Wer den Link öffnet, meldet sich an und sieht das Board im Nur-Lesen-Modus. Der Ersteller sieht, wer Zugriff hat, und kann den Link jederzeit erneuern (der alte wird ungültig) und alle Besucher entfernen
- **Charakternetz:** Kreise frei platzieren, mit Bild ausstatten, verbinden; Kurzbeschreibung auf der Linie, Klick öffnet die lange Beschreibung
- **Weltkarte:** eigenes Kartenbild, Charaktere als Punkte, Zoom
- **Tabelle** mit Suche und Sortierung
- **Import/Export** als JSON (Sicherungskopie inkl. Bilder)
- **Übernahme:** Boards aus Version 1 (lokal im Browser) werden beim ersten Login zum Hochladen angeboten

## Einrichtung (Supabase)
1. Projekt auf https://supabase.com anlegen (Region Frankfurt).
2. **Authentication → Sign In / Providers → Email:** „Confirm email“ ausschalten.
3. **SQL Editor → New query:** Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen und **Run** klicken. (Kann gefahrlos erneut ausgeführt werden.)
4. In [`config.js`](config.js) und in der Content-Security-Policy in `index.html` die Project URL und den anon/publishable key eintragen.

## Sicherheit
- **Rechte auf dem Server (Row Level Security):** Nur der Ersteller darf ein Board, seine Charaktere, Verbindungen und Bilder ändern oder löschen. Lesen darf nur, wer das Board über einen gültigen Freigabe-Link geöffnet hat. Nicht angemeldete Besucher haben keinerlei Zugriff.
- **Freigabe-Links** enthalten einen geheimen Schlüssel, der nur dem Ersteller angezeigt wird und erneuert werden kann. Boards lassen sich nicht auflisten oder erraten.
- **Bilder** liegen in einem privaten Speicher und werden nur über zeitlich begrenzte Adressen ausgeliefert. Beim Hochladen werden sie neu kodiert, dabei werden Metadaten (z. B. GPS-Standort aus Handyfotos) entfernt.
- **Grenzen gegen Missbrauch:** höchstens 200 Boards je Konto, 2000 Charaktere und 10 000 Verbindungen je Board, Längen- und Werteprüfungen in der Datenbank.
- Strenge Content-Security-Policy, kein externer Code (die Supabase-Bibliothek liegt unter `vendor/`), keine Tracker, Nutzertexte werden nie als HTML eingefügt, Importe werden geprüft.
- Passwörter: mindestens 8 Zeichen, darf den Benutzernamen nicht enthalten; Änderung und Kontolöschung nur mit aktuellem Passwort.
- Der anon key in `config.js` ist absichtlich öffentlich. Den `service_role`-/secret key **niemals** ins Repository legen.
