#!/usr/bin/env python3
"""
Datenbank-Tests für supabase/schema.sql (Rechte, Grenzen, Benutzernamen, Upgrade).

Läuft gegen ein lokales PostgreSQL (ab 15) mit nachgebautem Supabase (mock_supabase.sql).
Geprüft wird jeweils:
  * frische Installation
  * Upgrade von jedem früheren Stand (aus der Git-Historie, siehe UPGRADE_FROM)
  * Skript zweimal hintereinander (muss mehrfach ausführbar bleiben)

Aufruf:  python3 tests/db/test_db.py            (sucht psql/initdb selbst, startet bei Bedarf einen Test-Server)
Umgebung: PGHOST/PGPORT/PGUSER, falls schon ein Server läuft.
Ausgabe: je Prüfung eine Zeile OK/FAIL, am Ende die Summe; Exit-Code 1 bei Fehlern.
"""
import os, re, shutil, subprocess, sys, tempfile, time, glob

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCHEMA = os.path.join(ROOT, 'supabase', 'schema.sql')
MOCK = os.path.join(os.path.dirname(__file__), 'mock_supabase.sql')
# Frühere veröffentlichte Stände (Commits), von denen ein Upgrade funktionieren muss.
# Bei jeder Änderung an schema.sql den dann veröffentlichten Commit hier ergänzen.
UPGRADE_FROM = ['42f3612', 'b4d7683', '624212f', '6773063', 'e695fe0']

OWNER, VISITOR, STRANGER = ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
                            '33333333-3333-3333-3333-333333333333')
MEMBER2 = '55555555-5555-5555-5555-555555555555'  # zweites Mitglied (Bearbeitungsrechte, seit 2.11)
results = []


def check(name, cond, info=''):
    results.append((bool(cond), name, info))
    print(('OK   ' if cond else 'FAIL ') + name + ('' if cond or not info else f'  -> {info}'))


# ---------- Test-Server ----------
def find_bin(name):
    p = shutil.which(name)
    if p:
        return p
    c = sorted(glob.glob(f'/usr/lib/postgresql/*/bin/{name}'))
    return c[-1] if c else None


def start_server():
    if os.environ.get('PGHOST'):
        return None
    initdb, pg_ctl = find_bin('initdb'), find_bin('pg_ctl')
    if not initdb:
        sys.exit('PostgreSQL nicht gefunden (initdb). Bitte installieren, z. B. apt-get install postgresql')
    d = tempfile.mkdtemp(prefix='cn-pg-')
    run_as = []
    if os.geteuid() == 0:  # initdb läuft nicht als root
        subprocess.run(['chown', '-R', 'postgres', d], check=True)
        run_as = ['su', 'postgres', '-c']
    def sh(cmd):
        if run_as:
            return subprocess.run(run_as + [cmd], capture_output=True, text=True)
        return subprocess.run(cmd, shell=True, capture_output=True, text=True)
    r = sh(f'{initdb} -D {d}/data -A trust -E UTF8 --locale=C.UTF-8 -U postgres')
    if r.returncode:
        sys.exit('initdb fehlgeschlagen: ' + r.stderr)
    port = '54329'
    r = sh(f"{pg_ctl} -D {d}/data -o '-k {d} -p {port} -c listen_addresses=' -l {d}/log -w start")
    if r.returncode:
        sys.exit('PostgreSQL-Start fehlgeschlagen: ' + r.stderr + open(f'{d}/log').read())
    os.environ.update(PGHOST=d, PGPORT=port, PGUSER='postgres')
    return lambda: sh(f'{pg_ctl} -D {d}/data -m fast stop')


def psql(db, sql, user=None, role=None):
    """SQL ausführen; gibt (ok, ausgabe, fehler) zurück."""
    pre = ''
    if user is not None:
        pre += f"select set_config('request.jwt.claim.sub', '{user}', false);\n"
    if role:
        pre += f'set role {role};\n'
    r = subprocess.run(['psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db],
                       input=pre + sql, capture_output=True, text=True)
    out = '\n'.join(l for l in r.stdout.splitlines() if l.strip())
    if user is not None:  # erste Zeile ist das Ergebnis von set_config
        out = '\n'.join(out.splitlines()[1:])
    return r.returncode == 0, out, r.stderr.strip()


def run_file(db, path_or_sql, is_sql=False):
    args = ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db]
    if is_sql:
        r = subprocess.run(args, input=path_or_sql, capture_output=True, text=True)
    else:
        r = subprocess.run(args + ['-f', path_or_sql], capture_output=True, text=True)
    return r.returncode == 0, r.stderr


def new_db(name):
    subprocess.run(['psql', '-X', '-q', '-d', 'postgres', '-c', f'drop database if exists {name}'], capture_output=True)
    subprocess.run(['psql', '-X', '-q', '-d', 'postgres', '-c', f"create database {name} encoding 'UTF8' template template0"], check=True, capture_output=True)
    ok, err = run_file(name, MOCK)
    assert ok, err


# ---------- Prüfungen ----------
def suite(db, label):
    T = lambda n: f'[{label}] {n}'
    # Nutzer (Trigger legt Profile an)
    ok, _, err = psql(db, f"""insert into auth.users (id, email, raw_user_meta_data) values
      ('{OWNER}', 'owner@users.charakter-netz.app', '{{"username":"Owner"}}'),
      ('{VISITOR}', 'visitor@users.charakter-netz.app', '{{"username":"visitor"}}'),
      ('{STRANGER}', 'stranger@users.charakter-netz.app', '{{"username":"stranger"}}'),
      ('{MEMBER2}', 'member2@users.charakter-netz.app', '{{"username":"member2"}}');""")
    check(T('Registrierung (Trigger legt Profile an)'), ok, err)
    # Ersteller legt Board mit Inhalt an
    ok, bid, err = psql(db, "insert into boards (name) values ('B1') returning id;", OWNER, 'authenticated')
    check(T('Ersteller legt Board an'), ok and re.match(r'^[0-9a-f-]{36}$', bid), err)
    C1, C2, F1 = 'cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000001'
    ok, _, err = psql(db, f"""
      insert into characters (id, board_id, name) values ('{C1}', '{bid}', 'C1'), ('{C2}', '{bid}', 'C2');
      insert into links (board_id, a, b, short) values ('{bid}', '{C1}', '{C2}', 'x');
      insert into factions (id, board_id, name, color) values ('{F1}', '{bid}', 'F', '#ff0000');
      insert into character_factions values ('{bid}', '{C1}', '{F1}', 0);
      insert into storage.objects (bucket_id, name) values ('board-images', '{bid}/p-1.jpg');""", OWNER, 'authenticated')
    check(T('Ersteller: Charaktere, Verbindung, Fraktion, Bild anlegen'), ok, err)
    ok, tok, err = psql(db, f"select get_share_token('{bid}');", OWNER, 'authenticated')
    check(T('Ersteller liest Freigabe-Schlüssel'), ok and len(tok) == 36, err)

    def cnt(user, sql, role='authenticated'):
        ok, out, err = psql(db, sql, user, role)
        return out if ok else 'ERR'

    # Fremder ohne Link
    check(T('Fremder sieht keine Boards'), cnt(STRANGER, 'select count(*) from boards;') == '0')
    check(T('Fremder sieht keine Charaktere'), cnt(STRANGER, 'select count(*) from characters;') == '0')
    check(T('Fremder sieht keine Bilder'), cnt(STRANGER, 'select count(*) from storage.objects;') == '0')
    check(T('Fremder sieht nur sein eigenes Profil'), cnt(STRANGER, 'select count(*) from profiles;') == '1')
    check(T('Falscher Schlüssel öffnet nichts'), cnt(STRANGER, f"select coalesce(open_shared_board('{bid}', gen_random_uuid())::text, 'null');") == 'null')
    check(T('Fremder bekommt keinen Schlüssel'), cnt(STRANGER, f"select coalesce(get_share_token('{bid}')::text, 'null');") == 'null')
    # Besucher mit Link
    check(T('Besucher öffnet Link'), cnt(VISITOR, f"select open_shared_board('{bid}', '{tok}') is not null;") == 't')
    check(T('Besucher sieht Charaktere'), cnt(VISITOR, 'select count(*) from characters;') == '2')
    check(T('Besucher sieht Bilder'), cnt(VISITOR, 'select count(*) from storage.objects;') == '1')
    check(T('Besucher sieht Ersteller-Profil'), cnt(VISITOR, 'select count(*) from profiles;') == '2')
    for name, sql in [('Charakter ändern', "with u as (update characters set name='hack' returning 1) select count(*) from u;"),
                      ('Verbindung löschen', 'with u as (delete from links returning 1) select count(*) from u;'),
                      ('Board löschen', 'with u as (delete from boards returning 1) select count(*) from u;'),
                      ('Bild löschen', 'with u as (delete from storage.objects returning 1) select count(*) from u;'),
                      ('Fraktion löschen', 'with u as (delete from factions returning 1) select count(*) from u;')]:
        r = cnt(VISITOR, sql)
        check(T(f'Besucher darf nicht: {name}'), r in ('0', 'ERR'), r)
    for name, sql in [('Charakter anlegen', f"insert into characters (board_id, name) values ('{bid}', 'hack');"),
                      ('Bild hochladen', f"insert into storage.objects (bucket_id, name) values ('board-images', '{bid}/hack.jpg');"),
                      ('Board umbenennen', f"update boards set name='hack' where id='{bid}';"),
                      ('Schlüssel lesen', 'select share_token from boards;'),
                      ('Link erneuern', f"select reset_share_link('{bid}');"),
                      ('Besuch umhängen', 'update board_visits set board_id = board_id;'),
                      ('Besuch selbst eintragen', f"insert into board_visits (user_id, board_id) values ('{VISITOR}', '{bid}');")]:
        r = cnt(VISITOR, sql)
        check(T(f'Besucher darf nicht: {name}'), r == 'ERR' or r == '', r)
    # Funktionen: interne nicht aufrufbar, Hilfen nicht im öffentlichen Schema
    ok, out, _ = psql(db, """select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('handle_new_user','touch_board','enforce_limits','protect_columns','touch_updated_at','cn_email_domain','protect_auth_email','set_note_author','protect_visits')
       and has_function_privilege('authenticated', p.oid, 'execute');""")
    check(T('Interne Funktionen für Angemeldete gesperrt'), ok and out == '', out)
    ok, out, _ = psql(db, """select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('is_board_owner','can_read_board','can_see_profile','board_image_quota_ok','board_id_from_path','can_edit_board','can_write_image');""")
    check(T('Rechte-Hilfen nicht im öffentlichen Schema'), ok and out == '', out)
    ok, out, _ = psql(db, """select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute');""")
    check(T('Nur die 5 gewollten API-Funktionen (Advisor-Warnung)'), ok and out == 'delete_my_account,get_share_token,open_shared_board,reset_share_link,transfer_board_owner', out)
    edit_rights_and_notes(db, T, cnt, bid, tok, C1, C2, F1)
    # Ersteller übertragen (seit 2.8)
    owner_of = lambda: psql(db, f"select owner_id from boards where id='{bid}';")[1]
    tr = lambda user, new: psql(db, f"select transfer_board_owner('{bid}', '{new}');", user, 'authenticated')
    ok, _, err = tr(VISITOR, VISITOR)
    check(T('Übertragen: Besucher kann sich nicht selbst zum Ersteller machen'), not ok and 'not_owner' in err and owner_of() == OWNER, err)
    ok, _, err = tr(STRANGER, STRANGER)
    check(T('Übertragen: Fremder kann nichts übertragen'), not ok and 'not_owner' in err and owner_of() == OWNER, err)
    check(T('Übertragen: Besitzer-Spalte nicht direkt änderbar'), cnt(OWNER, f"update boards set owner_id='{VISITOR}' where id='{bid}';") == 'ERR' and owner_of() == OWNER)
    ok, _, err = psql(db, f"update boards set owner_id='{VISITOR}' where id='{bid}';")
    check(T('Übertragen: auch ohne API nur über die Funktion (Schutz-Trigger)'), not ok and 'immutable_column' in err and owner_of() == OWNER, err)
    ok, _, err = tr(OWNER, STRANGER)
    check(T('Übertragen: nur an jemanden mit Zugriff (Fremder abgelehnt)'), not ok and 'new_owner_no_access' in err and owner_of() == OWNER, err)
    ok, _, err = tr(OWNER, OWNER)
    check(T('Übertragen: nicht an sich selbst'), not ok and 'invalid_new_owner' in err, err)
    ok, _, err = tr(OWNER, '99999999-9999-9999-9999-999999999999')
    check(T('Übertragen: unbekannter Nutzer abgelehnt'), not ok and 'new_owner_no_access' in err, err)
    ok, _, err = psql(db, f"select transfer_board_owner('{bid}', '{VISITOR}');", None, 'anon')
    check(T('Übertragen: ohne Anmeldung gesperrt'), not ok, err)
    psql(db, f"insert into boards (owner_id, name) select '{VISITOR}', 'voll' || g from generate_series(1, 200) g;")
    ok, _, err = tr(OWNER, VISITOR)
    check(T('Übertragen: neuer Ersteller mit 200 Boards abgelehnt'), not ok and 'limit_boards_new_owner' in err and owner_of() == OWNER, err)
    psql(db, f"delete from boards where owner_id='{VISITOR}' and name like 'voll%';")
    ok, _, err = tr(OWNER, VISITOR)
    check(T('Übertragen: Ersteller -> Besucher klappt'), ok and owner_of() == VISITOR, err)
    check(T('Übertragen: neuer Ersteller bearbeitet'), cnt(VISITOR, f"with u as (update characters set short='neu' where id='{C2}' returning 1) select count(*) from u;") == '1')
    check(T('Übertragen: neuer Ersteller liest Freigabe-Schlüssel'), cnt(VISITOR, f"select get_share_token('{bid}') = '{tok}';") == 't')
    check(T('Übertragen: neuer Ersteller lädt Bilder hoch'), cnt(VISITOR, f"insert into storage.objects (bucket_id, name) values ('board-images', '{bid}/p-neu.jpg');") != 'ERR')
    check(T('Übertragen: neuer Ersteller steht nicht mehr in der Besucherliste'), cnt(None, f"select count(*) from board_visits where board_id='{bid}' and user_id='{VISITOR}';", None) == '0')
    check(T('Übertragen: alter Ersteller ist jetzt Besucher (sieht noch alles)'), cnt(OWNER, 'select count(*) from characters;') == '2'
          and cnt(None, f"select count(*) from board_visits where board_id='{bid}' and user_id='{OWNER}';", None) == '1')
    r = cnt(OWNER, f"with u as (update characters set short='alt' where id='{C2}' returning 1) select count(*) from u;")
    check(T('Übertragen: alter Ersteller kann nicht mehr bearbeiten'), r in ('0', 'ERR'), r)
    check(T('Übertragen: alter Ersteller bekommt keinen Schlüssel mehr'), cnt(OWNER, f"select coalesce(get_share_token('{bid}')::text, 'null');") == 'null')
    check(T('Übertragen: alter Ersteller lädt keine Bilder mehr hoch'), cnt(OWNER, f"insert into storage.objects (bucket_id, name) values ('board-images', '{bid}/p-alt.jpg');") == 'ERR')
    ok, _, err = tr(OWNER, OWNER)
    check(T('Übertragen: alter Ersteller kann nicht zurückholen'), not ok and 'not_owner' in err and owner_of() == VISITOR, err)
    check(T('Übertragen: Fremder sieht weiterhin nichts'), cnt(STRANGER, 'select count(*) from boards;') == '0')
    check(T('Übertragen: neuer Ersteller sieht Profil des Besuchers (Mitgliederliste)'), cnt(VISITOR, f"select count(*) from profiles where id='{OWNER}';") == '1')
    ok, _, err = tr(VISITOR, OWNER)
    check(T('Übertragen: zurück an den ursprünglichen Ersteller'), ok and owner_of() == OWNER
          and cnt(None, f"select count(*) from board_visits where board_id='{bid}' and user_id='{VISITOR}';", None) == '1', err)
    psql(db, f"delete from storage.objects where name='{bid}/p-neu.jpg';")
    # Ersteller: geschützte Spalten
    check(T('Ersteller kann created_at nicht ändern'), cnt(OWNER, f"update characters set created_at='2000-01-01' where id='{C2}';") == 'ERR')
    check(T('Ersteller kann ID nicht ändern'), cnt(OWNER, f"update characters set id=gen_random_uuid() where id='{C2}';") == 'ERR')
    # Ersteller: normale App-Abläufe
    for name, sql in [('Charakter bearbeiten', f"with u as (update characters set name='C1b', short='s', info='i', place='p', image_path=null, x=5, y=6, map_x=0.5, map_y=0.5, dead=true where id='{C1}' returning 1) select count(*) from u;"),
                      ('Verbindung bearbeiten', "with u as (update links set short='y', long='z' returning 1) select count(*) from u;"),
                      ('Fraktion bearbeiten', "with u as (update factions set name='F2', color='#00ff00' returning 1) select count(*) from u;"),
                      ('Fraktions-Zuordnung löschen', f"with u as (delete from character_factions where character_id='{C1}' returning 1) select count(*) from u;"),
                      ('Board bearbeiten', f"with u as (update boards set name='B1x', map_path='{bid}/map-1.jpg', map_w=10, map_h=10 where id='{bid}' returning 1) select count(*) from u;")]:
        r = cnt(OWNER, sql)
        check(T(f'Ersteller: {name}'), r == '1', r)
    # Titelbild (seit 2.10): nur Ersteller, nur eigene Datei "<board>/cover-<uuid>.jpg"
    cov = f"{bid}/cover-12345678-1234-4123-8123-123456789abc.jpg"
    check(T('Titelbild: Ersteller setzt es'), cnt(OWNER, f"with u as (update boards set cover_path='{cov}' where id='{bid}' returning 1) select count(*) from u;") == '1')
    check(T('Titelbild: Besucher sieht es'), cnt(VISITOR, f"select cover_path from boards where id='{bid}';") == cov)
    r = cnt(VISITOR, f"with u as (update boards set cover_path=null where id='{bid}' returning 1) select count(*) from u;")
    check(T('Titelbild: Besucher kann es nicht ändern'), r in ('0', 'ERR') and cnt(OWNER, f"select cover_path from boards where id='{bid}';") == cov, r)
    for name, val in [('fremdes Board', '99999999-9999-4999-8999-999999999999/cover-12345678-1234-4123-8123-123456789abc.jpg'),
                      ('anderer Dateiname', f'{bid}/p-12345678-1234-4123-8123-123456789abc.jpg'), ('Pfad mit ..', f'{bid}/../x/cover-1.jpg'), ('beliebiger Text', 'https://evil.example/x.jpg')]:
        check(T(f'Titelbild: abgelehnt ({name})'), cnt(OWNER, f"update boards set cover_path='{val}' where id='{bid}';") == 'ERR')
    check(T('Titelbild: Ersteller entfernt es'), cnt(OWNER, f"with u as (update boards set cover_path=null where id='{bid}' returning 1) select count(*) from u;") == '1')
    check(T('Ersteller: Fraktion wieder zuordnen'), cnt(OWNER, f"insert into character_factions values ('{bid}', '{C1}', '{F1}', 0);") != 'ERR')
    check(T('Ersteller: Link erneuern + Besucher entfernen'), cnt(OWNER, f"select reset_share_link('{bid}', true) is not null;") == 't')
    check(T('Besucher danach ohne Zugriff'), cnt(VISITOR, 'select count(*) from characters;') == '0')
    # Anmeldename nicht änderbar
    ok, _, err = psql(db, f"update auth.users set email='someoneelse@users.charakter-netz.app' where id='{OWNER}';")
    check(T('Anmeldename (E-Mail) nicht änderbar'), not ok and 'email_change_not_allowed' in err, err)
    ok, _, err = psql(db, f"update auth.users set updated_at=now() where id='{OWNER}';")
    check(T('Andere Änderungen an auth.users weiter möglich'), ok, err)
    # Nicht angemeldet
    check(T('Ohne Anmeldung: keine Tabellen'), cnt(None, 'select count(*) from boards;', 'anon') == 'ERR')
    check(T('Ohne Anmeldung: Link öffnen gesperrt'), cnt(None, f"select open_shared_board('{bid}', '{tok}');", 'anon') == 'ERR')
    # Bild-Obergrenze 3000 je Board
    psql(db, f"insert into storage.objects (bucket_id, name) select 'board-images', '{bid}/q' || g || '.jpg' from generate_series(1, 2998) g;")
    check(T('Bild 3000 erlaubt'), cnt(OWNER, f"insert into storage.objects (bucket_id, name) values ('board-images', '{bid}/ok.jpg');") != 'ERR')
    check(T('Bild 3001 abgelehnt'), cnt(OWNER, f"insert into storage.objects (bucket_id, name) values ('board-images', '{bid}/zuviel.jpg');") == 'ERR')
    # Benutzernamen (Japanisch, Normalisierung) – Werte müssen zu emailFor() in app.js passen
    ok, out, _ = psql(db, "select private.cn_email_for('山田太郎') || ' ' || private.cn_email_for('Tim_2');")
    check(T('Adresse für 山田太郎 / Tim_2'), out == 'u+6b0e1c8cc616be88a16bef09ef113a91a3ecceb0@users.charakter-netz.app tim_2@users.charakter-netz.app', out)
    def signup(name, email_of=None, email=None):
        e = email or psql(db, f"select private.cn_email_for('{email_of or name}');")[1]
        return psql(db, f"""insert into auth.users (email, raw_user_meta_data) values ('{e}', '{{"username":"{name}"}}');""")
    check(T('Registrierung 山田太郎'), signup('山田太郎')[0])
    check(T('Halbbreite ｶﾀｶﾅ wird zu カタカナ'), signup('ｶﾀｶﾅ', 'カタカナ')[0] and cnt(None, "select count(*) from profiles where username='カタカナ';", None) == '1')
    check(T('カタカナ ein zweites Mal abgelehnt'), not signup('カタカナ')[0])
    check(T('Vollbreite Ｈａｎａ wird zu Hana'), signup('Ｈａｎａ', 'Hana')[0] and cnt(None, "select count(*) from profiles where username='Hana';", None) == '1')
    ok, _, err = signup('さくら', email='x@users.charakter-netz.app')
    check(T('Falsche Adresse zum Namen abgelehnt'), not ok and 'email_username_mismatch' in err, err)
    ok, _, err = signup('ab😀')
    check(T('Emoji im Namen abgelehnt'), not ok and 'invalid_username' in err, err)
    ok, _, err = signup('x')
    check(T('Name mit 1 Zeichen abgelehnt'), not ok, err)
    # Konto löschen
    check(T('Konto löschen'), cnt(STRANGER, 'select delete_my_account();') != 'ERR' and cnt(None, f"select count(*) from auth.users where id='{STRANGER}';", None) == '0')


def edit_rights_and_notes(db, T, cnt, bid, tok, C1, C2, F1):
    """Bearbeitungsrechte für Mitglieder und Notizzettel (seit 2.11). Stellt am Ende den Ausgangszustand wieder her."""
    n = lambda user, sql: cnt(user, f'with u as ({sql} returning 1) select count(*) from u;')
    can_edit = lambda: psql(db, f"select can_edit from board_visits where board_id='{bid}' and user_id='{VISITOR}';")[1]
    check(T('Rechte: Mitglied 2 öffnet Link'), cnt(MEMBER2, f"select open_shared_board('{bid}', '{tok}') is not null;") == 't')
    check(T('Rechte: neue Mitglieder dürfen standardmäßig nicht bearbeiten'), can_edit() == 'f'
          and cnt(VISITOR, f"select members_can_edit from boards where id='{bid}';") == 'f')
    # Mitglied ohne Recht kann sich keins geben
    check(T('Rechte: Besucher kann sich selbst kein Bearbeitungsrecht geben'), n(VISITOR, f"update board_visits set can_edit=true where user_id='{VISITOR}'") in ('0', 'ERR') and can_edit() == 'f')
    check(T('Rechte: Besucher kann „Alle dürfen bearbeiten“ nicht einschalten'), n(VISITOR, f"update boards set members_can_edit=true where id='{bid}'") in ('0', 'ERR')
          and psql(db, f"select members_can_edit from boards where id='{bid}';")[1] == 'f')
    check(T('Rechte: Besucher kann Notiz nicht anheften'), cnt(VISITOR, f"insert into character_notes (board_id, character_id, body) values ('{bid}', '{C1}', 'x');") == 'ERR')
    check(T('Rechte: Fremder kann kein Recht vergeben'), n(STRANGER, f"update board_visits set can_edit=true where board_id='{bid}'") in ('0', 'ERR') and can_edit() == 'f')
    # Ersteller vergibt das Recht einzeln
    check(T('Rechte: Ersteller gibt Besucher Bearbeitungsrecht'), n(OWNER, f"update board_visits set can_edit=true where board_id='{bid}' and user_id='{VISITOR}'") == '1' and can_edit() == 't')
    check(T('Rechte: Ersteller kann Besuchszeit anderer nicht ändern'), cnt(OWNER, f"update board_visits set visited_at=now() where board_id='{bid}' and user_id='{VISITOR}';") == 'ERR')
    check(T('Rechte: Mitglied aktualisiert eigene Besuchszeit weiter'), n(VISITOR, f"update board_visits set visited_at=now() where board_id='{bid}' and user_id='{VISITOR}'") == '1')
    for name, sql, exp in [
            ('Charakter ändern', f"update characters set short='vom Mitglied' where id='{C2}'", '1'),
            ('Charakter anlegen', f"insert into characters (board_id, name) values ('{bid}', 'Neu vom Mitglied')", '1'),
            ('Verbindung anlegen', f"insert into links (board_id, a, b, short) values ('{bid}', '{C2}', '{C1}', 'm')", '1'),
            ('Fraktion anlegen', f"insert into factions (board_id, name, color) values ('{bid}', 'MF', '#00ff00')", '1'),
            ('Fraktion zuordnen', f"insert into character_factions values ('{bid}', '{C2}', '{F1}', 0)", '1'),
            ('Bild hochladen', f"insert into storage.objects (bucket_id, name) values ('board-images', '{bid}/p-mitglied.jpg')", '1'),
            ('Bild löschen', f"delete from storage.objects where name='{bid}/p-mitglied.jpg'", '1'),
            ('Weltkarte ändern', f"update boards set map_w=11, map_h=12 where id='{bid}'", '1')]:
        r = n(VISITOR, sql)
        check(T(f'Rechte: Bearbeiter darf {name}'), r == exp, r)
    for name, sql in [('Board umbenennen', f"update boards set name='hack' where id='{bid}'"),
                      ('Titelbild setzen', f"update boards set cover_path='{bid}/cover-12345678-1234-4123-8123-123456789abc.jpg' where id='{bid}'"),
                      ('„Alle dürfen bearbeiten“ ändern', f"update boards set members_can_edit=true where id='{bid}'"),
                      ('Board löschen', f"delete from boards where id='{bid}'"),
                      ('Titelbild-Datei hochladen', f"insert into storage.objects (bucket_id, name) values ('board-images', '{bid}/cover-x.jpg')"),
                      ('Rechte anderer ändern', f"update board_visits set can_edit=true where board_id='{bid}' and user_id='{MEMBER2}'"),
                      ('Mitglied entfernen', f"delete from board_visits where board_id='{bid}' and user_id='{MEMBER2}'")]:
        r = n(VISITOR, sql)
        check(T(f'Rechte: Bearbeiter darf nicht {name}'), r in ('0', 'ERR'), r)
    check(T('Rechte: Board-Name unverändert'), psql(db, f"select name from boards where id='{bid}';")[1] != 'hack')
    psql(db, f"insert into storage.objects (bucket_id, name) values ('board-images', '{bid}/cover-y.jpg');")
    check(T('Rechte: Bearbeiter darf Titelbild-Datei nicht löschen'), n(VISITOR, f"delete from storage.objects where name='{bid}/cover-y.jpg'") in ('0', 'ERR'))
    psql(db, f"delete from storage.objects where name='{bid}/cover-y.jpg';")
    for name, sql in [('Schlüssel lesen', f"select coalesce(get_share_token('{bid}')::text, 'null');"),
                      ('Link erneuern', f"select reset_share_link('{bid}');"),
                      ('Ersteller übertragen', f"select transfer_board_owner('{bid}', '{VISITOR}');")]:
        r = cnt(VISITOR, sql)
        check(T(f'Rechte: Bearbeiter darf nicht {name}'), r in ('null', 'ERR'), r)
    check(T('Rechte: Mitglied 2 ohne Recht darf weiter nicht bearbeiten'), n(MEMBER2, f"update characters set short='m2' where id='{C2}'") in ('0', 'ERR'))
    check(T('Rechte: Fremder darf weiter nichts'), n(STRANGER, f"update characters set short='f' where id='{C2}'") in ('0', 'ERR'))
    # Notizzettel
    ok, out, err = psql(db, f"insert into character_notes (board_id, character_id, kind, body) values ('{bid}', '{C1}', 'guess', 'Er ist der Verräter') returning author_name || '|' || (author_id = '{VISITOR}')::text;", VISITOR, 'authenticated')
    check(T('Notiz: Bearbeiter heftet Vermutung an (Verfasser vom Server)'), ok and out == 'visitor|true', err or out)
    ok, out, err = psql(db, f"insert into character_notes (board_id, character_id, kind, body) values ('{bid}', '{C1}', 'decision', 'Wir vertrauen ihm nicht') returning author_name;", OWNER, 'authenticated')
    check(T('Notiz: Ersteller heftet Gruppenentscheidung an'), ok and out == 'Owner', err or out)
    check(T('Notiz: Verfasser nicht fälschbar'), cnt(VISITOR, f"insert into character_notes (board_id, character_id, body, author_name) values ('{bid}', '{C1}', 'x', 'Owner');") == 'ERR')
    check(T('Notiz: Zeitpunkt nicht fälschbar'), cnt(VISITOR, f"insert into character_notes (board_id, character_id, body, created_at) values ('{bid}', '{C1}', 'x', '2000-01-01');") == 'ERR')
    for name, body, kind in [('leerer Text', "'   '", "'note'"), ('Text über 280 Zeichen', "repeat('a', 281)", "'note'"), ('unbekannte Art', "'x'", "'hack'")]:
        check(T(f'Notiz: abgelehnt ({name})'), cnt(VISITOR, f"insert into character_notes (board_id, character_id, kind, body) values ('{bid}', '{C1}', {kind}, {body});") == 'ERR')
    check(T('Notiz: 280 Zeichen und Japanisch erlaubt'), cnt(VISITOR, f"insert into character_notes (board_id, character_id, body) values ('{bid}', '{C1}', repeat('あ', 280));") != 'ERR')
    check(T('Notiz: 4. Zettel erlaubt'), cnt(VISITOR, f"insert into character_notes (board_id, character_id, body) values ('{bid}', '{C1}', 'vier');") != 'ERR')
    ok, _, err = psql(db, f"insert into character_notes (board_id, character_id, body) values ('{bid}', '{C1}', 'fünf');", VISITOR, 'authenticated')
    check(T('Notiz: 5. Zettel abgelehnt (höchstens 4)'), not ok and 'limit_notes' in err, err)
    check(T('Notiz: anderer Charakter hat eigene 4'), cnt(VISITOR, f"insert into character_notes (board_id, character_id, body) values ('{bid}', '{C2}', 'C2');") != 'ERR')
    check(T('Notiz: Mitglied ohne Recht sieht Notizen'), cnt(MEMBER2, 'select count(*) from character_notes;') == '5')
    check(T('Notiz: Mitglied ohne Recht kann nicht entfernen'), n(MEMBER2, 'delete from character_notes') in ('0', 'ERR'))
    check(T('Notiz: Mitglied ohne Recht kann nicht anheften'), cnt(MEMBER2, f"insert into character_notes (board_id, character_id, body) values ('{bid}', '{C2}', 'x');") == 'ERR')
    check(T('Notiz: Fremder sieht keine Notizen'), cnt(STRANGER, 'select count(*) from character_notes;') == '0')
    check(T('Notiz: nicht änderbar (nur anheften/entfernen)'), cnt(OWNER, "update character_notes set body='geändert';") == 'ERR')
    check(T('Notiz: nicht an Charakter eines fremden Boards'), cnt(VISITOR, f"insert into character_notes (board_id, character_id, body) values (gen_random_uuid(), '{C1}', 'x');") == 'ERR')
    check(T('Notiz: Bearbeiter entfernt eine Notiz'), n(VISITOR, f"delete from character_notes where body='vier'") == '1')
    check(T('Notiz: Ersteller entfernt eine Notiz'), n(OWNER, "delete from character_notes where kind='decision'") == '1')
    # Recht wieder entziehen
    check(T('Rechte: Ersteller entzieht Bearbeitungsrecht'), n(OWNER, f"update board_visits set can_edit=false where board_id='{bid}' and user_id='{VISITOR}'") == '1')
    check(T('Rechte: danach wieder nur ansehen'), n(VISITOR, f"update characters set short='x' where id='{C2}'") in ('0', 'ERR')
          and n(VISITOR, 'delete from character_notes') in ('0', 'ERR')
          and cnt(VISITOR, f"insert into storage.objects (bucket_id, name) values ('board-images', '{bid}/p-z.jpg');") == 'ERR')
    # Alle Mitglieder dürfen bearbeiten
    check(T('Rechte: Ersteller schaltet „Alle Mitglieder dürfen bearbeiten“ ein'), n(OWNER, f"update boards set members_can_edit=true where id='{bid}'") == '1')
    check(T('Rechte: alle Mitglieder dürfen jetzt bearbeiten'), n(VISITOR, f"update characters set short='alle' where id='{C2}'") == '1'
          and n(MEMBER2, f"update characters set short='alle2' where id='{C2}'") == '1')
    check(T('Rechte: Mitglied sieht die Einstellung'), cnt(MEMBER2, f"select members_can_edit from boards where id='{bid}';") == 't')
    check(T('Rechte: Fremder darf trotzdem nichts'), n(STRANGER, f"update characters set short='f' where id='{C2}'") in ('0', 'ERR')
          and cnt(STRANGER, f"insert into character_notes (board_id, character_id, body) values ('{bid}', '{C2}', 'x');") == 'ERR')
    check(T('Rechte: „Alle“ wieder aus'), n(OWNER, f"update boards set members_can_edit=false where id='{bid}'") == '1'
          and n(MEMBER2, f"update characters set short='m' where id='{C2}'") in ('0', 'ERR'))
    # Notiz verschwindet mit dem Charakter; Aufräumen
    check(T('Notiz: an neuen Charakter angeheftet'), n(OWNER, f"insert into character_notes (board_id, character_id, body) select '{bid}', id, 'mit weg' from characters where name='Neu vom Mitglied'") == '1')
    check(T('Notiz: wird mit dem Charakter gelöscht'), n(OWNER, "delete from characters where name='Neu vom Mitglied'") == '1'
          and psql(db, "select count(*) from character_notes where body='mit weg';")[1] == '0')
    psql(db, f"delete from links where short='m'; delete from factions where name='MF'; delete from character_factions where character_id='{C2}';"
             f"delete from board_visits where user_id='{MEMBER2}'; update characters set short='' where id='{C2}';")
    psql(db, 'delete from character_notes;')


def main():
    stop = start_server()
    try:
        # 1) frisch, 2x hintereinander
        new_db('cn_fresh')
        ok, err = run_file('cn_fresh', SCHEMA); check('[frisch] Skript läuft', ok, err[-300:])
        ok, err = run_file('cn_fresh', SCHEMA); check('[frisch] Skript läuft ein zweites Mal', ok, err[-300:])
        suite('cn_fresh', 'frisch')
        # 2) Upgrade von früheren Ständen (mit vorhandenen Daten)
        for rev in UPGRADE_FROM:
            r = subprocess.run(['git', '-C', ROOT, 'show', f'{rev}:supabase/schema.sql'], capture_output=True, text=True)
            if r.returncode:
                check(f'[upgrade {rev}] alter Stand in Git gefunden', False, 'git show fehlgeschlagen – Repo vollständig klonen')
                continue
            db = 'cn_up_' + rev
            new_db(db)
            ok, err = run_file(db, r.stdout, True); check(f'[upgrade {rev}] alter Stand installiert', ok, err[-300:])
            psql(db, """insert into auth.users (id, email, raw_user_meta_data) values ('44444444-4444-4444-4444-444444444444', 'alt@users.charakter-netz.app', '{"username":"Alt"}');
                        insert into boards (owner_id, name) values ('44444444-4444-4444-4444-444444444444', 'Altboard');""")
            ok, err = run_file(db, SCHEMA); check(f'[upgrade {rev}] neues Skript läuft', ok, err[-300:])
            ok, err = run_file(db, SCHEMA); check(f'[upgrade {rev}] neues Skript ein zweites Mal', ok, err[-300:])
            check(f'[upgrade {rev}] alte Daten erhalten', psql(db, "select name from boards;")[1] == 'Altboard')
            suite(db, f'upgrade {rev}')
    finally:
        if stop:
            stop()
    bad = [r for r in results if not r[0]]
    print(f'\nDatenbank: {len(results) - len(bad)} von {len(results)} Prüfungen bestanden.')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
