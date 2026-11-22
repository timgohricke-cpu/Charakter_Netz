# Tests für Charakter-Netz

**Ein Befehl für alles:** `bash tests/run_all.sh` → am Ende muss **„ALLE TESTS BESTANDEN“** stehen.

| Teil | Datei | Was wird geprüft |
|---|---|---|
| Statisch | `tests/test_static.py` | Syntax, kein `innerHTML`/`eval`, strenge CSP, kein CDN, Clickjacking-Schutz, kein geheimer Schlüssel, Manifest-ID unverändert, Versionen in `PROJEKT-STAND.md`, **Doppel-Regeln App ↔ Datenbank** (Benutzernamen, Pseudo-E-Mail, Domain), `schema.sql` mehrfach ausführbar |
| Datenbank | `tests/db/test_db.py` (+ `mock_supabase.sql`) | `supabase/schema.sql` frisch, **zweimal hintereinander** und als **Upgrade von jedem früheren Stand** (`UPGRADE_FROM`): Rechte für Fremde/Besucher/Ersteller/nicht Angemeldete, geschützte Spalten, Anmeldename fest, Bild-Obergrenze, japanische Namen + Normalisierung, Konto löschen, Advisor (nur 4 API-Funktionen) |
| Oberfläche | `tests/ui/test_ui.py` (+ `mock-supabase.js`) | Echte App-Dateien in Chrome (headless) mit nachgebautem Supabase: Netz (Ziehen, Tastatur, Zoom, Erstellen, Verbinden), Tabelle, Karte, Bildadressen, Konto, Clickjacking, Japanisch (IME, Suche, Anmelde-Adressen), Einladungsablauf, Teilen (Desktop + Handy), Handy-Ansichten 375 px, Update-Hinweis, **Verstorbene verblasst mit Fraktionsfarbe**, **Auswahl im Netz** (Legende, Infokarte, Auswahl-Fenster, Verbundene an/aus, Lebende/Verstorbene/Beide, Hervorhebung, Handy), langsames Speichern schließt keinen neuen Dialog, lange Namen in der Kartenliste gekürzt, **Übersicht** (gebogene/gefärbte Linien, Beschriftungen ohne Überlappung, Hover, Detailstufen, Fraktionsinseln inkl. Teilinseln + Schalter, „✨ Anordnen“ + „↶ Rückgängig“, Anordnen mit 400 Charakteren). Screenshots in `tests/ui/out/` |

Voraussetzungen: `python3`, PostgreSQL ≥ 15 (`initdb`, `psql`), `pip install playwright` und Chrome/Chromium (sonst `python3 -m playwright install chromium`), optional `node`.
Der Datenbank-Test startet selbst einen temporären Postgres-Server (auch als root) und braucht das **vollständig geklonte Repo** (Git-Historie für die Upgrade-Tests).

## Regeln bei Änderungen
1. Jede neue Funktion und jeder behobene Fehler bekommt eine Prüfung (Oberfläche und/oder Datenbank).
2. Nach jeder Änderung `bash tests/run_all.sh` – alles muss bestehen. Tests nur anpassen, wenn sich ein Verhalten **gewollt** geändert hat (im Commit/Chat begründen).
3. Neue Version von `supabase/schema.sql` veröffentlicht → den Commit des **vorigen** veröffentlichten Stands in `UPGRADE_FROM` (`tests/db/test_db.py`) ergänzen.
4. Testdaten im Nachbau ändern sich → Zahlen in `test_ui.py` (z. B. „31 Kreise“) mitziehen.

## Live-Prüfung (von Hand bzw. im Browser-Fenster der Claude-Desktop-App)
Die automatischen Tests sprechen Supabase **nicht** an. Nach dem Veröffentlichen zusätzlich live prüfen:
- Seite lädt neue Version (`APP_VERSION` im Konto-Dialog), keine Fehler in der Konsole
- Als Besucher per API ändern/löschen/hochladen → alles abgelehnt; als Fremder nichts sichtbar
- `rpc/is_board_owner` → 404 (Hilfen nicht über die API erreichbar)
- Supabase Security Advisor: nur die 4 gewollten Warnungen (`open_shared_board`, `get_share_token`, `reset_share_link`, `delete_my_account`)
- Einladung Ende-zu-Ende: Link teilen → im privaten Fenster/Handy öffnen → mit japanischem Namen registrieren → Board erscheint unter „Mit mir geteilt“ (Konto und Passwort legt **der Mensch** an, nicht Claude)
- Handy (375 px): Startseite, Netz, Tabelle, Karte, Teilen-Dialog, Einladungsseite, Auswahl-Fenster
- Auswahl im Netz (großes Board, z. B. „Harry Potter – Alle Charaktere“ im Konto test_ersteller): Fraktion in der Legende anklicken → nur Mitglieder; Infokarte „🔍 Im Netz hervorheben“; „🔍 Auswahl“ → Fraktionen/Charaktere/Verbundene/Status; „✕ Auswahl aufheben“; als Besucher ebenfalls nutzbar
- Verstorbene: Fraktionsfarbe bleibt, Kreis halbdurchsichtig (Netz, Karte, Tabelle)
- Übersicht (HP-Board): herauszoomen (Detailstufen, Namen lesbar), Maus über Harry (Hover), 🏝 Inseln aus/an, „✨ Anordnen“ → ansehen → „↶ Rückgängig“ (danach Anordnung wie vorher)

Vollständige Liste der Funktionen: siehe `PROJEKT-STAND.md`.
