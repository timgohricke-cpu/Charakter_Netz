#!/usr/bin/env python3
"""Schnelle statische Prüfungen ohne Browser/Datenbank: Syntax, Sicherheitsregeln, Versionen, Doppel-Regeln."""
import json, os, re, shutil, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
rd = lambda f: open(os.path.join(ROOT, f), encoding='utf-8').read()
results = []


def check(name, cond, info=''):
    results.append(bool(cond))
    print(('OK   ' if cond else 'FAIL ') + name + ('' if cond or not info else f'  -> {info}'))


app, sw, idx, schema, css = rd('app.js'), rd('sw.js'), rd('index.html'), rd('supabase/schema.sql'), rd('style.css')
node = shutil.which('node')
for f in ['app.js', 'sw.js', 'config.js']:
    if node:
        r = subprocess.run([node, '--check', os.path.join(ROOT, f)], capture_output=True, text=True)
        check(f'Syntax {f}', r.returncode == 0, r.stderr[:200])
try:
    m = json.loads(rd('manifest.webmanifest')); check('Manifest ist gültiges JSON', True)
    check('Manifest: id/start_url/scope unverändert "./" (sonst Neuinstallation nötig)', m.get('id') == './' and m.get('start_url') == './' and m.get('scope') == './')
except Exception as e:
    check('Manifest ist gültiges JSON', False, str(e))
# Sicherheit
check('Kein innerHTML/outerHTML/insertAdjacentHTML/document.write in app.js', not re.search(r'\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write', app))
check('Kein eval/new Function in app.js', not re.search(r'\beval\(|new Function\(', app))
csp = re.search(r'Content-Security-Policy" content="([^"]+)"', idx)
check('CSP vorhanden', bool(csp))
if csp:
    c = csp.group(1)
    check("CSP: script-src nur 'self'", "script-src 'self';" in c)
    check("CSP: object-src 'none', base-uri 'self', form-action 'none'", all(x in c for x in ["object-src 'none'", "base-uri 'self'", "form-action 'none'"]))
    check('CSP: keine fremden Server außer Supabase', set(re.findall(r'https://[^\s;]+', c)) <= {'https://cecddgekcowcxripwxzi.supabase.co'}, re.findall(r'https://[^\s;]+', c))
check('Keine externen Skripte/CDN in index.html', not re.search(r'<script[^>]+src="https?://', idx))
check('Clickjacking-Schutz in app.js', 'window.top !== window.self' in app)
cfg = rd('config.js')
check('Kein geheimer Schlüssel in config.js (sb_secret_ / service_role-JWT)', not re.search(r"sb_secret_|'eyJ[\w-]{20,}", cfg) and re.search(r"SUPABASE_KEY: 'sb_publishable_", cfg))
# Versionen
v = re.search(r"APP_VERSION = '([^']+)'", app); cache = re.search(r"charakter-netz-v(\d+)", sw)
check('APP_VERSION und Cache-Name vorhanden', bool(v and cache))
stand = rd('PROJEKT-STAND.md')
check('PROJEKT-STAND.md nennt aktuellen Cache-Namen und APP_VERSION', bool(v and cache) and f'charakter-netz-v{cache.group(1)}' in stand and f'aktuell {v.group(1)}' in stand)
# Doppelte Regeln App <-> Datenbank müssen übereinstimmen
js_re = re.search(r'const USERNAME_RE = /\^\[(.+?)\]\{(\d+),(\d+)\}\$/;', app)
sql_re = re.search(r"u ~ '\^\[(.+?)\]\{(\d+),(\d+)\}\$'", schema)
norm = lambda s: re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), s).replace('\\-', '-')
check('Benutzernamen-Regel in app.js == schema.sql', bool(js_re and sql_re) and norm(js_re.group(1)) == norm(sql_re.group(1)) and js_re.group(2, 3) == sql_re.group(2, 3),
      (js_re and js_re.groups(), sql_re and sql_re.groups()))
check("E-Mail-Schema app.js == schema.sql ('u+' + 40 Hex)", "u+${hex.slice(0, 40)}" in app and "'u+' || left(encode(pg_catalog.sha256(convert_to(lower(u), 'UTF8')), 'hex'), 40)" in schema)
dom_js = re.search(r"EMAIL_DOMAIN: '([^']+)'", rd('config.js')); dom_sql = re.search(r"select '([^']+)'::text \$\$", schema)
check('E-Mail-Domain config.js == schema.sql', bool(dom_js and dom_sql) and dom_js.group(1) == dom_sql.group(1))
# Datenbank-Skript bleibt mehrfach ausführbar (grobe Prüfung)
bad = [l for l in schema.splitlines() if re.match(r'\s*create (table|index|unique index|schema) (?!if not exists)', l, re.I)]
check('schema.sql: create table/index/schema immer mit "if not exists"', not bad, bad[:3])
bad = [l for l in schema.splitlines() if re.match(r'\s*create function', l, re.I)]
check('schema.sql: Funktionen mit "create or replace"', not bad, bad[:3])
bad = [l for l in schema.splitlines() if re.match(r'\s*create (policy|trigger)', l, re.I)]
pol = [l for l in bad if not re.search(r'drop (policy|trigger) if exists', schema)]
check('schema.sql: Policies/Trigger vorher mit "drop … if exists"', not pol)
print(f'\nStatisch: {sum(results)} von {len(results)} Prüfungen bestanden.')
sys.exit(0 if all(results) else 1)
