# Charakter-Netz – Projektstand (Version 2)

Diese Datei beschreibt den aktuellen Stand, damit die Arbeit in einem neuen Chat nahtlos weitergehen kann.
**Hier stehen keine Passwörter oder geheimen Schlüssel – und das soll so bleiben (das Repo ist öffentlich).**

## Links
| Was | Link |
|---|---|
| Live-App | https://timgohricke-cpu.github.io/Charakter_Netz/ |
| GitHub-Repo | https://github.com/timgohricke-cpu/Charakter_Netz (Branch `main` wird veröffentlicht) |
| Datenbank-Skript | https://github.com/timgohricke-cpu/Charakter_Netz/blob/main/supabase/schema.sql |
| Skript zum Kopieren (roh) | https://raw.githubusercontent.com/timgohricke-cpu/Charakter_Netz/main/supabase/schema.sql |
| Supabase-Projekt | https://supabase.com/dashboard/project/cecddgekcowcxripwxzi |
| SQL Editor | https://supabase.com/dashboard/project/cecddgekcowcxripwxzi/sql/new |
| Anmelde-Einstellungen | https://supabase.com/dashboard/project/cecddgekcowcxripwxzi/auth/providers |
| Nutzer verwalten | https://supabase.com/dashboard/project/cecddgekcowcxripwxzi/auth/users |
| Bilder (Storage) | https://supabase.com/dashboard/project/cecddgekcowcxripwxzi/storage/buckets |
| GitHub-Pages-Einstellung | https://github.com/timgohricke-cpu/Charakter_Netz/settings/pages |

## Aufbau
Statische PWA ohne Build-Schritt und ohne externe Bibliotheken zur Laufzeit, gehostet auf GitHub Pages (Branch `main`, Ordner `/`).

| Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst, **Content-Security-Policy** (erlaubt nur die eigene Seite + `https://cecddgekcowcxripwxzi.supabase.co`) |
| `config.js` | Supabase-URL, öffentlicher *publishable key*, `EMAIL_DOMAIN` |
| `app.js` | Gesamte App (ca. 1600 Zeilen, ein IIFE, kein Framework) |
| `style.css` | Design inkl. Hell-/Dunkelmodus über CSS-Variablen (`:root` / `:root[data-theme=light]`) |
| `sw.js` | Service Worker, Cache-Name **`charakter-netz-v4`** – bei jeder Änderung an App-Dateien hochzählen (zusammen mit `APP_VERSION` in `app.js`, aktuell 2.4) |
| `vendor/supabase.js` | `@supabase/supabase-js` 2.119.2, lokal mit esbuild gebündelt (IIFE, global `supabase`) |
| `supabase/schema.sql` | Komplettes Datenbank-Skript; **idempotent** (kann jederzeit erneut ausgeführt werden) |
| `manifest.webmanifest`, Icons | Installation als App |

Bundle neu bauen (falls nötig):
```
npm i @supabase/supabase-js@<version> esbuild
echo "export { createClient } from '@supabase/supabase-js';" > entry.js
npx esbuild entry.js --bundle --minify --format=iife --global-name=supabase --target=es2020 --platform=browser --outfile=vendor/supabase.js
```

### Datenbank (Supabase / Postgres)
- `profiles` (id = auth.users.id, `username`, eindeutig über `lower(username)`), wird per Trigger beim Registrieren angelegt
- `boards` (owner_id, name, map_path/map_w/map_h, **share_token** – nur über Funktion lesbar)
- `characters` (name, short, info, place, image_path, x, y, map_x, map_y, **dead**)
- `links` (a, b, short, long) – beide Charaktere müssen zum selben Board gehören
- `factions` (name, color `#rrggbb`) und `character_factions` (Zuordnung, mehrere je Charakter, `position` = Reihenfolge)
- `board_visits` (wer hat welches geteilte Board besucht → „Mit mir geteilt“)
- Funktionen (API): `open_shared_board(board, token)`, `get_share_token`, `reset_share_link(board, remove_visitors)`, `delete_my_account` – prüfen selbst, wer angemeldet ist. Der Supabase Security Advisor meldet für diese 4 „Signed-In Users Can Execute SECURITY DEFINER Function“: **gewollt**, die App ruft sie auf.
- Hilfsfunktionen für die Rechte-Regeln liegen im Schema **`private`** (nicht über die API erreichbar): `private.is_board_owner`, `can_read_board`, `can_see_profile`, `board_id_from_path`, `board_image_quota_ok`
- Storage-Bucket `board-images` (privat), Pfad `<board-id>/<datei>.jpg`, Auslieferung über signierte URLs (1 h)
- Grenzen: 200 Boards/Konto, 2000 Charaktere, 10 000 Verbindungen, 50 Fraktionen je Board, 10 Fraktionen je Charakter, 3000 Bilder je Board (`board_image_quota_ok`)
- Ändern ist nur bei Inhaltsspalten erlaubt (spaltenweise `grant update`); ID, Board und Zeitstempel sind fest
- Trigger `cn_protect_email` auf `auth.users`: Die Anmelde-Adresse kann nachträglich nicht geändert werden

### Anmeldung
Benutzername + Passwort über Supabase Auth mit Pseudo-E-Mail.
- Erlaubte Benutzernamen: 2–24 Zeichen, `A–Z a–z 0–9 . _ -` sowie **Japanisch** (Hiragana, Katakana, Kanji, ー, 々). Gespeichert wird die NFKC-Form (Halbbreiten-Katakana → normale Katakana, Vollbreiten-Buchstaben → ASCII). Regel doppelt: `USERNAME_RE` in `app.js` und `private.cn_username_ok()` in `schema.sql` – **immer beide gleich ändern**.
- Pseudo-E-Mail: reine ASCII-Namen `<name klein>@users.charakter-netz.app` (wie bisher); sonst `u+<erste 40 Hex-Zeichen von SHA-256(name klein)>@users.charakter-netz.app`. Doppelt: `emailFor()` in `app.js` und `private.cn_email_for()` – **müssen übereinstimmen**, sonst schlägt die Registrierung fehl.
In Supabase muss **„Confirm email“ ausgeschaltet** sein. Kein Passwort-Reset per E-Mail möglich (nur im Dashboard unter *Users*).

### Freigabe-Links
Format: `…/Charakter_Netz/#/s/<board-id>/<share-token>`. Nach dem Öffnen wird intern auf `#/b/<board-id>/netz` umgeleitet und der Besuch gespeichert.
Ohne gültiges Token kein Zugriff. „Neuen Link erzeugen“ macht den alten ungültig.

## Funktionen
**Konto:** Registrieren, Anmelden, „Angemeldet bleiben“ (an: localStorage, aus: sessionStorage), Abmelden, Passwort ändern (mit altem Passwort), Konto löschen (mit Benutzername + Passwort, löscht Bilder, Boards, alles).
**Startseite:** „Meine Boards“ (Teilen, Umbenennen, Exportieren, Löschen), „Mit mir geteilt“ (nur ansehen, aus Liste entfernen), Import, Banner zur Übernahme lokaler V1-Boards.
**Teilen:** Teilen-Menü des Handys, WhatsApp-Link, Kopieren; Besucherliste; Link erneuern (optional alle Besucher entfernen).
**Rechte:** Nur der Ersteller bearbeitet; Besucher sehen alles im Nur-Lesen-Modus (Hinweis „👁 Nur ansehen · von …“). Durchgesetzt per Row Level Security auf dem Server.
**Charakternetz:** Kreise frei setzen (Modus „＋ Charakter“), ziehen, verbinden (Modus „🔗 Verbinden“), Linienbeschriftung (Kurzbeschreibung) über den Kreisen, Klick → Infokarte bzw. lange Beschreibung; Zoom (Mausrad, Pinch), „Alles zeigen“.
**Fraktionen:** keine, eine oder mehrere je Charakter; Eingabe mit Vorschlägen und „+ Neue Fraktion anlegen“; Rand und Name in Farbabschnitten; ohne Fraktion neutral (dunkel: weiß); Verwaltung über „🎨 Fraktionen“ (Farbe, Name, Löschen); Legende oben rechts.
**Verstorben:** Rand + Name grau, „†“ hinter dem Namen, Bild schwarz-weiß.
**Wichtigkeit:** Kreisradius 32 + 4,5·√(Verbindungen), höchstens 52.
**Weltkarte:** Kartenbild hochladen, Charaktere platzieren (auch aus „Noch nicht auf der Karte“), Pins in Fraktionsfarben.
**Tabelle:** Suche (auch nach Fraktion / „verstorben“), Sortierung (auch per Tastatur), Fraktions-Spalte.
**Tastatur:** Kreise und Linienbeschriftungen im Netz sind per Tab erreichbar, Enter öffnet sie.
**Hell-/Dunkelmodus:** ☀️/🌙 in der Kopfleiste, wird gespeichert, Start nach Systemeinstellung.
**Import/Export:** JSON (Format-Version 2, inkl. Bilder als Data-URL, Fraktionen, Status); alte V1-Dateien werden weiter angenommen.
**Installation:** Abfrage „Desktop-Symbol erstellen?“ (einmal je Browser), Knopf „⬇ App installieren“, Anleitung für iPhone und für den WhatsApp-Browser („Im Browser öffnen“).
**Updates:** Nie neu installieren nötig. Der Service Worker lädt immer zuerst vom Server (`updateViaCache: 'none'`, Prüfung beim Zurückkehren in die App und alle 30 min). Läuft im offenen Fenster noch die alte Fassung, erscheint „Eine neue Version ist da – Jetzt aktualisieren“. **Nie ändern:** `id`, `start_url`, `scope` im Manifest und den Pfad `/Charakter_Netz/` – sonst sehen Browser es als neue App.
**Einladungen:** Freigabe-Link abgemeldet geöffnet → Einladung wird 2 Tage in `localStorage` (`cn-invite`) gemerkt (überlebt Installation, Browser und installierte App teilen sich den Speicher; auf dem iPhone nicht – dort zuerst Konto im Browser anlegen). Einladungsseite mit Schritten: 1. App installieren (Knopf, wenn der Browser es anbietet), 2. Konto erstellen (Reiter „Registrieren“ vorausgewählt) oder anmelden, 3. Board wird automatisch angehängt und geöffnet („… wurde zu ‚Mit mir geteilt‘ hinzugefügt“). Ist man beim Start schon angemeldet und eine Einladung wartet, wird sie sofort eingelöst. Manifest: `handle_links: preferred`, `launch_handler` + `launchQueue` öffnen Links in der laufenden App.
**Japanisch:** Alle Texte erlauben beliebige Zeichen. Suche ignoriert Groß/klein, Voll-/Halbbreite und Hiragana/Katakana; Sortierung mit `Intl.Collator(['de','ja'])`; Enter während der IME-Umwandlung löst nichts aus; Beschriftungsbreite rechnet breite Zeichen doppelt; japanische Schriften in der Font-Liste.

## Sicherheit
- Row Level Security auf allen Tabellen und im Storage, anon-Rolle ohne Tabellenrechte
- Freigabe-Token nur für den Ersteller lesbar; Benutzernamen nur sichtbar, wenn man ein Board teilt
- Strenge CSP, kein CDN, kein `innerHTML` mit Nutzertexten, Import wird geprüft
- Clickjacking-Schutz: In einem fremden `<iframe>` startet die App nicht (GitHub Pages kann `frame-ancestors` nicht als Header setzen)
- Interne Trigger-Funktionen sind für `authenticated` nicht aufrufbar
- Signierte Bildadressen (1 h) werden bei lange offenen Boards automatisch erneuert; nach Entzug des Zugriffs bleiben bereits ausgegebene Adressen höchstens 1 h gültig
- Supabase-Einstellung: „Minimum password length“ = 8 (Auth → Providers → Email)
- Bilder werden neu kodiert (entfernt GPS/EXIF), privat gespeichert
- Der *publishable key* in `config.js` ist öffentlich gedacht. **Niemals** den `service_role`/secret key oder das Datenbank-Passwort ins Repo oder in einen Chat geben.

## Arbeitsweise / Hinweise für Claude
- Supabase ist aus der Cloud-Arbeitsumgebung von Claude **nicht erreichbar** (Proxy). Getestet wird im **Browser-Fenster der Claude-Desktop-App** auf der Live-Seite oder einer Testkopie (z. B. Unterordner `v2-test/` auf `main`, danach wieder löschen).
- Änderungen an `supabase/schema.sql` muss **Tim selbst** im SQL Editor ausführen (Skript komplett einfügen → Run). Vorher lokal mit Postgres + nachgebautem `auth`/`storage`-Schema testen (frische Installation **und** Upgrade).
- Nach Änderungen an App-Dateien den Cache-Namen in `sw.js` hochzählen. GitHub Pages cacht Dateien 10 Minuten; der Service Worker fragt mit `cache: 'no-cache'` nach.
- PostgREST-Einbettungen zwischen `boards` und `profiles` brauchen den Fremdschlüsselnamen (`profiles!boards_owner_id_fkey`), weil es zwei Wege gibt.
- `boards` hat spaltenweise Rechte: nie `select('*')` auf `boards` verwenden.
- Commit-Nachrichten auf Deutsch.
- Lokale Tests: `supabase/schema.sql` gegen Postgres 16 mit nachgebautem `auth`/`storage`-Schema (Rollen anon/authenticated, `auth.uid()` aus `request.jwt.claim.sub`); Oberfläche mit Playwright/Chrome und einem In-Memory-Nachbau des Supabase-Clients.
