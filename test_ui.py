#!/usr/bin/env python3
"""
Oberflächen-Tests der App (Chrome headless über Playwright) mit nachgebautem Supabase-Client.

Die echten App-Dateien (index.html, app.js, style.css, sw.js, manifest, Icons) werden in einen
Temp-Ordner kopiert; statt vendor/supabase.js wird tests/ui/mock-supabase.js geladen (In-Memory-Daten,
siehe dort). Supabase selbst wird dabei NICHT angesprochen – die echten Rechte prüft tests/db/test_db.py.

Aufruf:   python3 tests/ui/test_ui.py
Voraussetzung: pip install playwright  (und: python3 -m playwright install chromium, falls kein Chrome da ist)
Ausgabe:  OK/FAIL je Prüfung, Screenshots in tests/ui/out/, Exit-Code 1 bei Fehlern.
"""
import functools, http.server, math, os, re, shutil, socket, sys, tempfile, threading, traceback, urllib.parse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
BID = '25fe99f5-5b14-4518-94f2-9e278df9c4a9'          # eigenes Board (Ersteller test_ersteller)
BID2 = 'bbbbbbbb-0000-4000-8000-000000000002'         # fremdes Board (Besucher-Sicht)
TOK = '11111111-2222-3333-4444-555555555555'          # Freigabe-Schlüssel aus dem Nachbau
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf00000301010018dd8db40000000049454e44ae426082')
results = []


def check(name, cond, info=''):
    results.append(bool(cond))
    print(('OK   ' if cond else 'FAIL ') + name + ('' if cond or not info else f'  -> {info}'), flush=True)


def section(name, fn, *a):
    try:
        fn(*a)
    except Exception as e:  # Abschnitt abgebrochen -> als Fehler zählen, weiter mit dem nächsten
        check(f'{name}: Abschnitt vollständig durchgelaufen', False, f'{type(e).__name__}: {str(e).splitlines()[0][:200]}')
        traceback.print_exc(limit=1)


def build_site():
    d = tempfile.mkdtemp(prefix='cn-ui-')
    for f in ['index.html', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']:
        if os.path.exists(os.path.join(ROOT, f)):
            shutil.copy(os.path.join(ROOT, f), d)
    os.makedirs(os.path.join(d, 'vendor'))
    shutil.copy(os.path.join(HERE, 'mock-supabase.js'), os.path.join(d, 'vendor', 'supabase.js'))
    # gleiche Supabase-URL wie in config.js (die App zeigt nur Bilder von dort), Schlüssel ist ein Platzhalter
    url = re.search(r"SUPABASE_URL:\s*'([^']+)'", open(os.path.join(ROOT, 'config.js')).read()).group(1)
    open(os.path.join(d, 'config.js'), 'w').write(
        f"window.CN_CONFIG = Object.freeze({{ SUPABASE_URL: '{url}', SUPABASE_KEY: 'sb_publishable_test_test_test_test', EMAIL_DOMAIN: 'users.charakter-netz.app' }});\n")
    return d, url


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def main():
    from playwright.sync_api import sync_playwright
    os.makedirs(OUT, exist_ok=True)
    site, sb_url = build_site()
    app_version = re.search(r"APP_VERSION = '([^']+)'", open(os.path.join(ROOT, 'app.js')).read()).group(1)

    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    port = free_port()
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory=site))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    U = f'http://127.0.0.1:{port}/index.html'
    errs = []

    with sync_playwright() as p:
        chrome = shutil.which('google-chrome') or shutil.which('chromium')
        b = p.chromium.launch(executable_path=chrome, args=['--no-sandbox']) if chrome else p.chromium.launch()
        MOBILE = dict(viewport={'width': 375, 'height': 812}, is_mobile=True, has_touch=True,
                      user_agent='Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36')

        def context(**kw):
            ctx = b.new_context(**({'viewport': {'width': 1200, 'height': 800}} | kw))
            ctx.route(sb_url + '/**', lambda r: r.fulfill(status=200, body=PNG, content_type='image/png'))
            try: ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
            except Exception: pass
            return ctx

        def page(ctx, logged_in=True):
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.add_init_script("navigator.share = async (d) => { window.__shared = d; };")
            pg.goto(U + '#/')
            pg.evaluate("localStorage.clear(); localStorage.setItem('cn-install-asked','1')" + ("" if logged_in else "; localStorage.setItem('mock-out','1')"))
            pg.reload(); pg.wait_for_timeout(700)
            return pg

        def login(pg):
            pg.evaluate("localStorage.removeItem('mock-out')"); pg.reload(); pg.wait_for_timeout(600)

        def logout(pg):
            pg.evaluate("localStorage.setItem('mock-out','1')"); pg.goto(U + '#/'); pg.reload(); pg.wait_for_timeout(600)

        # ================= 1. Grundfunktionen (Desktop) =================
        def basics():
            ctx = context(); pg = page(ctx)
            check('Startseite zeigt eigenes Board', 'Testprojekt' in pg.inner_text('body'))
            pg.goto(U + f'#/b/{BID}/netz'); pg.wait_for_timeout(800)
            check('Netz: 31 Kreise', pg.locator('.node').count() == 31)
            check('Netz: 30 Linien', pg.locator('.link path').count() == 30)
            n = pg.locator('.node[data-char="c1"]'); bb = n.bounding_box()
            before = pg.locator('.link-label[data-link="l1"]').get_attribute('transform')
            pg.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); pg.mouse.down()
            pg.mouse.move(bb['x'] + 80, bb['y'] + 60, steps=8); pg.mouse.up(); pg.wait_for_timeout(300)
            check('Ziehen: Linienbeschriftung wandert mit', before != pg.locator('.link-label[data-link="l1"]').get_attribute('transform'))
            check('Ziehen: Position wird gespeichert', any(c[0] == 'update' and c[1] == 'characters' and c[2] and 'x' in c[2] for c in pg.evaluate('window.__calls')))
            pg.focus('.node[data-char="c2"]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
            check('Tastatur: Enter auf Kreis öffnet Infokarte', pg.locator('.modal h2').inner_text() == 'Charakter' and 'Figur 2' in pg.inner_text('.modal'))
            pg.keyboard.press('Escape')
            pg.focus('.link-label[data-link="l3"]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
            check('Tastatur: Enter auf Linie öffnet Verbindung', pg.locator('.modal h2').inner_text() == 'Verbindung')
            pg.keyboard.press('Escape')
            t0 = pg.locator('svg.net > g').get_attribute('transform')
            lg = pg.locator('.legend').bounding_box(); pg.mouse.move(lg['x'] + 5, lg['y'] + 5); pg.mouse.wheel(0, 300); pg.wait_for_timeout(100)
            check('Mausrad über Legende zoomt nicht', t0 == pg.locator('svg.net > g').get_attribute('transform'))
            pg.mouse.move(600, 500); pg.mouse.wheel(0, 300); pg.wait_for_timeout(100)
            check('Mausrad im Netz zoomt', t0 != pg.locator('svg.net > g').get_attribute('transform'))
            pg.get_by_role('button', name='＋ Charakter').click(); pg.mouse.click(300, 300); pg.wait_for_timeout(200)
            pg.fill('.modal input[placeholder="Name des Charakters"]', 'Neu<script>x</script>'); pg.get_by_role('button', name='Erstellen').click(); pg.wait_for_timeout(400)
            check('Charakter erstellen, Name nur als Text (kein HTML)', pg.locator('.node').count() == 32 and pg.locator('script:has-text("x")').count() == 0)
            pg.get_by_role('button', name='🔗 Verbinden').click()
            for cid in ['c5', 'c6']:
                bb = pg.locator(f'.node[data-char="{cid}"]').bounding_box(); pg.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); pg.wait_for_timeout(150)
            pg.fill('.modal input', 'Freunde'); pg.get_by_role('button', name='Verbinden', exact=True).click(); pg.wait_for_timeout(300)
            check('Verbindung erstellen', pg.locator('.link path').count() == 31)
            pg.goto(U + f'#/b/{BID}/tabelle'); pg.wait_for_timeout(500)
            first = pg.locator('tbody tr').first.inner_text()
            pg.focus('th:has-text("Name")'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
            check('Tabelle: Sortieren per Tastatur', pg.locator('tbody tr').first.inner_text() != first and pg.locator('th[aria-sort]').count() == 1)
            pg.fill('input[type=search]', 'verstorben'); pg.wait_for_timeout(100)
            check('Tabelle: Suche nach „verstorben“', pg.locator('tbody tr').count() == 1)
            pg.fill('input[type=search]', '')
            pg.goto(U + f'#/b/{BID}/karte'); pg.wait_for_timeout(600)
            up = pg.locator('.unplaced'); ub = up.bounding_box(); tr0 = pg.locator('.map-inner').get_attribute('style')
            pg.mouse.move(ub['x'] + 20, ub['y'] + 60); pg.mouse.wheel(0, 400); pg.wait_for_timeout(300)
            check('Karte: Liste „Noch nicht auf der Karte“ scrollt, Karte zoomt nicht', up.evaluate('e => e.scrollTop') > 0 and tr0 == pg.locator('.map-inner').get_attribute('style'))
            check('Karte: 5 Pins', pg.locator('.pin').count() == 5)
            s0 = pg.evaluate('window.__signs')
            pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(300)
            check('Bildadressen: keine Erneuerung, solange gültig', pg.evaluate('window.__signs') == s0)
            pg.evaluate("Date.now = ((n) => () => n() + 55*60000)(Date.now.bind(Date))")
            pg.mouse.click(5, 790)
            pg.evaluate("document.activeElement && document.activeElement.blur(); document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(400)
            check('Bildadressen: nach ~55 min erneuert', pg.evaluate('window.__signs') == s0 + 1 and f't={s0 + 1}' in pg.locator('.map-inner > img').get_attribute('src'))
            pg.locator('.theme-btn').click()
            check('Hell/Dunkel umschaltbar', pg.evaluate('document.documentElement.dataset.theme') in ('light', 'dark'))
            pg.goto(U + '#/'); pg.wait_for_timeout(500)
            pg.locator('.user-btn').click(); pg.wait_for_timeout(200)
            pw = pg.locator('.modal input[type=password]')
            pw.nth(0).fill('altes-Passwort1'); pw.nth(1).fill('aaaaaaaa'); pw.nth(2).fill('aaaaaaaa')
            pg.get_by_role('button', name='Passwort ändern').click(); pg.wait_for_timeout(200)
            check('Konto: schwaches neues Passwort abgelehnt', 'zu leicht' in pg.inner_text('#toasts'))
            check(f'Konto: Version {app_version} angezeigt', f'Version {app_version}' in pg.inner_text('.modal'))
            pg.keyboard.press('Escape')
            pg2 = ctx.new_page(); pg2.set_content(f'<iframe src="{U}" width=600 height=400></iframe>'); pg2.wait_for_timeout(1200)
            fr = pg2.frames[1]
            check('Clickjacking: im fremden Rahmen startet die App nicht', 'eigenen Fenster' in fr.inner_text('body') and fr.locator('.topbar').count() == 0)
            ctx.close()

        # ================= 2. Japanisch =================
        def japanese():
            ctx = context(); pg = page(ctx, logged_in=False)
            pg.get_by_role('tab', name='Registrieren').click()
            pg.fill('input[name=username]', 'ｶﾀｶﾅ'); pg.fill('input[name=password]', 'Sicheres-Pw-77'); pg.fill('input[name=password2]', 'Sicheres-Pw-77')
            pg.get_by_role('button', name='Konto erstellen').click(); pg.wait_for_timeout(500)
            a = pg.evaluate('window.__auth')
            check('Japanisch: ｶﾀｶﾅ -> gleiche Adresse wie die Datenbank', a and a[-1][1] == 'u+82c79cbaee7ce41601c1a83a0dfb78dddbc6e99b@users.charakter-netz.app' and a[-1][2] == 'カタカナ', a)
            for name, expect in [('山田太郎', 'u+6b0e1c8cc616be88a16bef09ef113a91a3ecceb0@'), ('Tim_2', 'tim_2@users.charakter-netz.app')]:
                logout(pg)
                pg.fill('input[name=username]', name); pg.fill('input[name=password]', 'x'); pg.get_by_role('button', name='Anmelden', exact=True).click(); pg.wait_for_timeout(400)
                check(f'Japanisch: Anmeldung {name} -> {expect}…', pg.evaluate('window.__auth')[-1][1].startswith(expect))
            logout(pg)
            pg.fill('input[name=username]', 'ab😀'); pg.fill('input[name=password]', 'x'); pg.get_by_role('button', name='Anmelden', exact=True).click(); pg.wait_for_timeout(200)
            check('Japanisch: Emoji im Namen abgelehnt', 'japanische' in pg.inner_text('.form-error'))
            pg.goto(U + f'#/b/{BID}/netz'); login(pg); pg.wait_for_timeout(300)
            lb = pg.locator('.link-label[data-link="lj"]')
            rw = float(lb.locator('rect').get_attribute('width')); tw = lb.locator('text').evaluate('e => e.getBBox().width')
            check(f'Japanisch: Linienbeschriftung passt in den Rahmen ({tw:.0f} <= {rw:.0f})', tw <= rw)
            check('Japanisch: Name im Netz', 'カタカナ姫' in pg.locator('.node[data-char="cj1"] .node-name').text_content())
            pg.goto(U + f'#/b/{BID}/tabelle'); pg.wait_for_timeout(500)
            pg.fill('input[type=search]', 'かたかな'); pg.wait_for_timeout(100)
            check('Japanisch: Suche mit Hiragana findet Katakana', pg.locator('tbody tr').count() == 1 and 'カタカナ姫' in pg.locator('tbody tr').inner_text())
            pg.goto(U + '#/'); pg.wait_for_timeout(500); pg.get_by_role('button', name='+ Neues Board').click(); pg.wait_for_timeout(200)
            pg.fill('.modal input', 'とうきょう')
            pg.locator('.modal input').evaluate("e => e.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', isComposing:true, bubbles:true}))"); pg.wait_for_timeout(300)
            check('Japanisch: Enter während der IME-Umwandlung sendet nichts ab', pg.locator('.modal').count() == 1)
            ctx.close()

        # ================= 3. Einladung =================
        def invite():
            ctx = context(); pg = page(ctx, logged_in=False)
            pg.goto(U + f'#/s/{BID2}/{TOK}'); pg.reload(); pg.wait_for_timeout(700)
            t = pg.inner_text('body')
            check('Einladung: Seite mit 3 Schritten', 'Dir wurde ein Board geteilt' in t and 'App installieren (empfohlen)' in t and 'Board ansehen' in t)
            check('Einladung: Reiter „Registrieren“ vorausgewählt', pg.locator('.tab.active').inner_text() == 'Registrieren')
            check('Einladung: gemerkt (localStorage cn-invite)', f'#/s/{BID2}/{TOK}' in (pg.evaluate("localStorage.getItem('cn-invite')") or ''))
            pg.evaluate("(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted = true; }; e.userChoice = Promise.resolve({outcome:'accepted'}); window.dispatchEvent(e); })()"); pg.wait_for_timeout(200)
            check('Einladung: „App installieren“-Knopf in den Schritten, kein Extra-Dialog', pg.locator('.invite-box button:has-text("App installieren")').count() == 1 and pg.locator('.modal').count() == 0)
            pg.locator('.invite-box button:has-text("App installieren")').click(); pg.wait_for_timeout(200)
            pg.evaluate("window.dispatchEvent(new Event('appinstalled'))"); pg.wait_for_timeout(200)
            check('Einladung: nach Installation Hinweis auf neues Symbol', pg.evaluate('window.__prompted') and 'Installiert!' in pg.inner_text('.invite-box'))
            pg.goto(U + '#/'); pg.reload(); pg.wait_for_timeout(600)
            check('Einladung: nach Neustart (wie installierte App) weiter da', 'Dir wurde ein Board geteilt' in pg.inner_text('body'))
            pg.fill('input[name=username]', 'さくら'); pg.fill('input[name=password]', 'Sicheres-Pw-77'); pg.fill('input[name=password2]', 'Sicheres-Pw-77')
            pg.get_by_role('button', name='Konto erstellen').click(); pg.wait_for_timeout(1200)
            calls = pg.evaluate('window.__calls')
            check('Einladung: nach Registrierung Board angehängt', any(c[0] == 'rpc' and c[1] == 'open_shared_board' and c[2]['p_board'] == BID2 for c in calls))
            check('Einladung: Board geöffnet + „hinzugefügt“', BID2 in pg.url and 'hinzugefügt' in pg.inner_text('#toasts'))
            check('Einladung: danach gelöscht, Schlüssel nicht in der Adresse', pg.evaluate("localStorage.getItem('cn-invite')") is None and TOK not in pg.url)
            pg.evaluate(f"localStorage.setItem('cn-invite', JSON.stringify({{hash:'#/s/{BID2}/{TOK}', exp: Date.now()+60000}}))")
            pg.goto(U + '#/'); pg.reload(); pg.wait_for_timeout(1000)
            check('Einladung: bereits angemeldet -> sofort eingelöst', BID2 in pg.url)
            pg.evaluate(f"localStorage.setItem('mock-out','1'); localStorage.setItem('cn-invite', JSON.stringify({{hash:'#/s/{BID2}/{TOK}', exp: Date.now()-1}}))")
            pg.goto(U + '#/'); pg.reload(); pg.wait_for_timeout(500)
            check('Einladung: abgelaufen -> verworfen', 'geteilt' not in pg.inner_text('.auth-card') and pg.evaluate("localStorage.getItem('cn-invite')") is None)
            pg.evaluate("localStorage.setItem('cn-invite', JSON.stringify({hash:'javascript:alert(1)', exp: Date.now()+60000}))"); pg.reload(); pg.wait_for_timeout(400)
            check('Einladung: manipulierter Eintrag ignoriert', pg.evaluate("localStorage.getItem('cn-invite')") is None)
            ctx.close()

        # ================= 4. Teilen (Desktop + Handy) =================
        def sharing(mobile):
            tag = 'Handy' if mobile else 'Desktop'
            ctx = context(**MOBILE) if mobile else context(); pg = page(ctx)
            check(f'Teilen {tag}: „📤 Einladen“ nur auf eigener Board-Karte', pg.locator('.board-card:not(.shared) button:has-text("Einladen")').count() == 1)
            pg.goto(U + f'#/b/{BID}/netz'); pg.wait_for_timeout(700)
            pg.locator('.share-btn').click(); pg.wait_for_timeout(400)
            link = pg.locator('.modal input[aria-label="Einladungslink"]').input_value()
            check(f'Teilen {tag}: Einladungsdialog mit Link', pg.locator('.modal h2').inner_text() == 'Zum Board einladen' and link.endswith(f'#/s/{BID}/{TOK}'))
            hrefs = {a.inner_text(): urllib.parse.unquote(a.get_attribute('href')) for a in pg.locator('.share-grid a').all()}
            check(f'Teilen {tag}: WhatsApp', hrefs.get('WhatsApp', '').startswith('https://api.whatsapp.com/send?text=') and link in hrefs['WhatsApp'])
            check(f'Teilen {tag}: Telegram', hrefs.get('Telegram', '').startswith('https://t.me/share/url?url=') and link in hrefs['Telegram'])
            check(f'Teilen {tag}: E-Mail', hrefs.get('E-Mail', '').startswith('mailto:?subject=') and link in hrefs['E-Mail'])
            check(f'Teilen {tag}: SMS nur auf dem Handy', ('SMS' in hrefs) == mobile)
            pg.locator('.share-box button:has-text("Teilen …")').click(); pg.wait_for_timeout(200)
            sh = pg.evaluate('window.__shared')
            check(f'Teilen {tag}: Teilen-Menü des Geräts', sh and sh['url'] == link)
            with ctx.expect_page() as newp:
                pg.locator('.share-grid button:has-text("Discord")').click()
            newp.value.close()
            check(f'Teilen {tag}: Discord kopiert Link + öffnet Discord', pg.evaluate('navigator.clipboard.readText()') == link)
            pg.screenshot(path=os.path.join(OUT, f'teilen_{tag.lower()}.png'))
            pg.keyboard.press('Escape')
            pg.goto(U + f'#/b/{BID2}/netz'); pg.wait_for_timeout(700)
            check(f'Teilen {tag}: Besucher sieht keinen Teilen-Knopf', pg.locator('.share-btn').count() == 0 and 'Nur ansehen' in pg.inner_text('.topbar'))
            pg.goto(U + '#/'); pg.wait_for_timeout(600)
            pg.locator('button[aria-label="App weiterempfehlen"]').click(); pg.wait_for_timeout(300)
            check(f'App teilen {tag}: nur App-Link, ohne Board/Schlüssel', pg.locator('.modal input').input_value() == U)
            pg.keyboard.press('Escape')
            check(f'{tag}: Kopfleiste ohne seitliches Scrollen', pg.evaluate('document.documentElement.scrollWidth') <= (375 if mobile else 1200))
            logout(pg)
            check(f'App teilen {tag}: 📣 auch auf der Anmeldeseite', pg.locator('button[aria-label="App weiterempfehlen"]').count() == 1)
            ctx.close()

        # ================= 5. Handy-Ansichten =================
        def mobile_views():
            ctx = context(**MOBILE); pg = page(ctx)
            for v in ['netz', 'tabelle', 'karte']:
                pg.goto(U + f'#/b/{BID}/{v}'); pg.wait_for_timeout(800)
                check(f'Handy: {v} ohne seitliches Scrollen', pg.evaluate('document.documentElement.scrollWidth') <= 375)
                pg.screenshot(path=os.path.join(OUT, f'handy_{v}.png'))
            pg.goto(U + f'#/b/{BID}/netz'); pg.wait_for_timeout(500)
            check('Handy: Hinweis ohne „Mausrad“', 'Mausrad' not in pg.inner_text('.hint'))
            pg.goto(U + f'#/b/{BID}/tabelle'); pg.wait_for_timeout(500)
            check('Handy: Suchfeld breit genug (>= 180 px)', pg.locator('input[type=search]').bounding_box()['width'] >= 180)
            pg.locator('.share-btn').click(); pg.wait_for_timeout(300)
            check('Handy: Teilen-Dialog passt', pg.evaluate('document.documentElement.scrollWidth') <= 375)
            pg.keyboard.press('Escape')
            logout(pg)
            pg.goto(U + f'#/s/{BID2}/{TOK}'); pg.reload(); pg.wait_for_timeout(800)
            check('Handy: Einladungsseite ohne seitliches Scrollen', pg.evaluate('document.documentElement.scrollWidth') <= 375)
            check('Handy: Tastatur bei Einladung nicht automatisch offen', pg.evaluate('document.activeElement.tagName') != 'INPUT')
            pg.screenshot(path=os.path.join(OUT, 'handy_einladung.png'), full_page=True)
            ctx.close()

        # ================= 6. Updates (Service Worker) =================
        def updates():
            ctx = context(); pg = page(ctx)
            pg.wait_for_timeout(1000); pg.reload(); pg.wait_for_timeout(1000)
            check('Updates: Service Worker steuert die Seite', pg.evaluate('!!navigator.serviceWorker.controller'))
            pg.evaluate("navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))"); pg.wait_for_timeout(500)
            check('Updates: gleiche Version -> kein Hinweis', pg.locator('.update-banner').count() == 0)
            pg.evaluate("(() => { const f = window.fetch; window.fetch = (u, o) => String(u).endsWith('app.js') ? Promise.resolve(new Response(\"const APP_VERSION = '999';\")) : f(u, o); })()")
            pg.evaluate("navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))"); pg.wait_for_timeout(500)
            check('Updates: neue Version -> Hinweis „Jetzt aktualisieren“', pg.locator('.update-banner').count() == 1)
            sw = open(os.path.join(ROOT, 'sw.js')).read()
            check('Updates: sw.js-Cache-Name enthält eine Versionsnummer', re.search(r"charakter-netz-v\d+", sw) is not None)
            ctx.close()

        # ================= 7. Verstorbene + Auswahl im Netz =================
        def selection():
            ctx = context(); pg = page(ctx)
            pg.goto(U + f'#/b/{BID}/netz'); pg.wait_for_timeout(800)
            N = lambda cid: pg.locator(f'.node[data-char="{cid}"]')
            op = lambda cid: float(N(cid).evaluate('e => getComputedStyle(e).opacity'))
            cls = lambda cid: N(cid).get_attribute('class')
            lk = lambda lid: pg.locator(f'.link-label[data-link="{lid}"]').get_attribute('class')
            # Verstorbene: Fraktionsfarbe bleibt, Kreis verblasst/halbdurchsichtig
            check('Verstorben: behält Fraktionsfarbe (Ostlande)', N('c4').evaluate("e => e.style.getPropertyValue('--c')") == '#3498db')
            check('Verstorben: halbdurchsichtig (Deckkraft 0,5)', abs(op('c4') - 0.5) < 0.01 and op('c5') == 1)
            check('Verstorben: Legende zeigt Fraktion trotz nur verstorbener Mitglieder + Hinweis „verblasst“',
                  pg.locator('.legend button[data-faction="f2"]').count() == 1 and 'verblasst' in pg.inner_text('.legend'))
            check('Auswahl: ohne Auswahl ist nichts ausgeblendet', pg.locator('.node.dim').count() == 0 and pg.locator('.focus-clear').is_hidden())
            # Fraktion in der Legende anklicken -> nur Mitglieder
            pg.locator('.legend button[data-faction="f2"]').click(); pg.wait_for_timeout(250)
            check('Legende: Fraktion anklicken zeigt nur Mitglieder', all('dim' not in cls(c) for c in ['c4', 'c10', 'c11']) and 'dim' in cls('c0') and 'dim' in cls('c5'))
            check('Auswahl: Ausgewählte haben Leuchtring', 'picked' in cls('c10') and N('c10').locator('.halo').evaluate('e => getComputedStyle(e).display') != 'none')
            check('Auswahl: Ausgeblendete minimal sichtbar (0,08), Verstorbene moderat (0,5)', abs(op('c5') - 0.08) < 0.01 and abs(op('c4') - 0.5) < 0.01 and op('c10') == 1)
            check('Auswahl: Verbindungen ohne gewähltes Ende werden ausgeblendet', 'dim' in lk('l10') and 'dim' in lk('l5'))
            fbt = pg.locator('.focus-btn').evaluate('e => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]')
            check('Auswahl-Knopf aktiv: Schrift lesbar (weiß auf Akzentfarbe)', fbt[0] == 'rgb(255, 255, 255)' and fbt[0] != fbt[1], fbt)
            check('Legende: gewählte Fraktion markiert + Knopf zeigt Anzahl', pg.locator('.legend button[data-faction="f2"]').get_attribute('aria-pressed') == 'true' and '3/31' in pg.inner_text('.focus-btn'))
            pg.locator('.legend button[data-faction="f2"]').click(); pg.wait_for_timeout(200)
            check('Legende: zweiter Klick hebt Auswahl auf', pg.locator('.node.dim').count() == 0)
            # Infokarte -> „Im Netz hervorheben“: Charakter + alle seine Verbindungen
            pg.focus('.node[data-char="c5"]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
            pg.locator('.modal button:has-text("Im Netz hervorheben")').click(); pg.wait_for_timeout(300)
            check('Infokarte: „Im Netz hervorheben“ zeigt Charakter + Verbundene', 'picked' in cls('c5') and 'dim' not in cls('c0') and 'picked' not in cls('c0') and 'dim' in cls('c6'))
            check('Auswahl: Verbindungen des Gewählten hervorgehoben', 'hl' in lk('l5') and 'dim' in lk('l6')
                  and pg.locator('.link:not(.dim) path').first.evaluate('e => parseFloat(getComputedStyle(e).strokeWidth)') >= 4)
            check('Auswahl: „✕ Auswahl aufheben“ sichtbar', pg.locator('.focus-clear').is_visible())
            # Auswahl-Fenster
            pg.locator('.focus-btn').click(); pg.wait_for_timeout(200)
            check('Auswahl-Fenster: öffnet mit Fraktionen, Charakteren, Status', pg.locator('.focus-panel').count() == 1 and pg.locator('.focus-panel .fchip').count() == 2
                  and pg.locator('.focus-panel .focus-row').count() == 31 and pg.locator('.focus-panel .seg [aria-checked="true"]').inner_text() == 'Beide')
            check('Auswahl-Fenster: gewählter Charakter steht oben und ist angehakt', pg.locator('.focus-row input').first.is_checked() and 'Figur 5' in pg.locator('.focus-row').first.inner_text())
            pg.locator('.focus-panel input[data-opt="cNb"]').uncheck(); pg.wait_for_timeout(150)
            check('Auswahl-Fenster: „Mit ihren Verbindungen“ aus -> nur der Charakter', 'dim' in cls('c0') and 'dim' not in cls('c5'))
            bb = N('c7').bounding_box(); pg.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2 - 10); pg.wait_for_timeout(200)
            check('Auswahl-Fenster offen: Klick auf Kreis wählt ihn aus (statt Infokarte)', pg.locator('.modal').count() == 0 and 'picked' in cls('c7')
                  and pg.locator('.focus-row input[data-char="c7"]').is_checked())
            pg.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2 - 10); pg.wait_for_timeout(200)
            check('Auswahl-Fenster offen: zweiter Klick wählt wieder ab', 'picked' not in cls('c7'))
            pg.locator('.focus-panel button:has-text("Alles zurücksetzen")').click(); pg.wait_for_timeout(150)
            pg.locator('.focus-panel .fchip[data-faction="f1"]').click(); pg.locator('.focus-panel input[data-opt="fNb"]').check(); pg.wait_for_timeout(150)
            # (Testdaten: Nordreich = c0, c1, c10 -> mit Verbindungen sind alle sichtbar, cj1 über c1)
            check('Fraktion + „Mit ihren Verbindungen“: Mitglieder und Verbundene sichtbar', 'picked' in cls('c0') and 'picked' in cls('c1') and 'dim' not in cls('c29') and 'picked' not in cls('c29') and 'dim' not in cls('cj1') and 'picked' not in cls('cj1'))
            pg.locator('.focus-panel input[data-opt="fNb"]').uncheck(); pg.wait_for_timeout(100)
            check('Fraktion ohne Verbindungen: nur Mitglieder', 'dim' in cls('c29') and 'dim' in cls('cj1') and 'dim' not in cls('c10'))
            pg.locator('.focus-panel input[data-opt="fNb"]').check(); pg.wait_for_timeout(100)
            pg.locator('.focus-panel .seg button[data-life="alive"]').click(); pg.wait_for_timeout(150)
            check('Status „Lebende“: Verstorbene ausgeblendet', 'dim' in cls('c4') and 'dim' not in cls('c3'))
            pg.locator('.focus-panel .seg button[data-life="dead"]').click(); pg.wait_for_timeout(150)
            check('Status „Verstorbene“: nur Verstorbene', 'dim' not in cls('c4') and 'dim' in cls('c3') and 'dim' in cls('c0'))
            pg.locator('.focus-panel button:has-text("Alles zurücksetzen")').click(); pg.locator('.focus-panel .seg button[data-life="dead"]').click(); pg.wait_for_timeout(150)
            check('Status allein (ohne Auswahl) wirkt auf alle', pg.locator('.node:not(.dim)').count() == 1 and 'dim' not in cls('c4'))
            pg.locator('.focus-panel button:has-text("Alles zurücksetzen")').click(); pg.wait_for_timeout(150)
            pg.fill('.focus-panel input[type=search]', 'かたかな'); pg.wait_for_timeout(150)
            check('Auswahl-Fenster: Charaktersuche (auch Hiragana -> Katakana)', pg.locator('.focus-row').count() == 1 and 'カタカナ姫' in pg.locator('.focus-row').inner_text())
            pg.fill('.focus-panel input[type=search]', '')
            t0 = pg.locator('svg.net > g').get_attribute('transform'); fb = pg.locator('.focus-list').bounding_box()
            pg.mouse.move(fb['x'] + 20, fb['y'] + 30); pg.mouse.wheel(0, 300); pg.wait_for_timeout(150)
            check('Auswahl-Fenster: Mausrad scrollt die Liste, Netz zoomt nicht', t0 == pg.locator('svg.net > g').get_attribute('transform'))
            check('Auswahl: zurückgesetzt -> alles normal sichtbar', pg.locator('.node.dim').count() == 0 and pg.locator('.link-label.dim').count() == 0 and pg.locator('.focus-clear').is_hidden())
            pg.locator('.legend button[data-faction="f1"]').click(); pg.goto(U + f'#/b/{BID}/tabelle'); pg.wait_for_timeout(400); pg.goto(U + f'#/b/{BID}/netz'); pg.wait_for_timeout(500)
            check('Auswahl bleibt beim Wechsel Tabelle -> Netz erhalten', 'picked' in cls('c0') and 'dim' in cls('c5'))
            pg.screenshot(path=os.path.join(OUT, 'auswahl_desktop.png'))
            pg.goto(U + f'#/b/{BID}/tabelle')
            pg.wait_for_timeout(400); pg.fill('input[type=search]', 'verstorben'); pg.wait_for_timeout(150)
            av = pg.locator('tbody tr .avatar').first
            check('Tabelle: Avatar verstorben halbdurchsichtig + Fraktionsfarbe', 'dead' in av.get_attribute('class') and av.evaluate("e => e.style.getPropertyValue('--c')") == '#3498db')
            pg.goto(U + f'#/b/{BID}/karte'); pg.wait_for_timeout(600)
            pin = pg.locator('.pin[data-char="c4"]')
            check('Karte: verstorbener Pin verblasst', abs(float(pin.evaluate('e => getComputedStyle(e).opacity')) - 0.55) < 0.01)
            # Lange Namen in „Noch nicht auf der Karte“ werden gekürzt (kein seitliches Scrollen)
            # (Testdaten nur im Speicher ändern: nicht neu laden, sondern über die Startseite neu öffnen)
            pg.evaluate("window.__db.characters.find(c => c.id === 'c20').name = 'Sehr langer Name ' + 'ラ'.repeat(60)")
            pg.goto(U + '#/'); pg.wait_for_timeout(400); pg.goto(U + f'#/b/{BID}/karte'); pg.wait_for_timeout(800)
            up = pg.locator('.unplaced')
            check('Karte: langer Name ist wirklich in der Liste', 'ラララ' in up.inner_text())
            check('Karte: lange Namen in der Liste gekürzt, kein seitliches Scrollen', up.evaluate('e => e.scrollWidth <= e.clientWidth + 1'))
            # Fehlerbehebung: langsames Speichern schließt keinen neu geöffneten Dialog
            pg.goto(U + f'#/b/{BID}/netz'); pg.wait_for_timeout(600)
            free = pg.evaluate("""() => { const r = []; for (let y = 760; y > 150 && r.length < 2; y -= 23) for (let x = 230; x < 1150 && r.length < 2; x += 37) { const e = document.elementFromPoint(x, y); if (e && e.matches('svg.net') && !r.some(p => Math.abs(p[0] - x) < 150)) r.push([x, y]); } return r; }""")
            pg.get_by_role('button', name='＋ Charakter').click(); pg.mouse.click(*free[0]); pg.wait_for_timeout(200)
            pg.fill('.modal input[placeholder="Name des Charakters"]', 'Langsam'); pg.evaluate('window.__delay = 400')
            pg.get_by_role('button', name='Erstellen').click(); pg.wait_for_timeout(50); pg.keyboard.press('Escape'); pg.wait_for_timeout(50)
            pg.mouse.click(*free[1]); pg.wait_for_timeout(100)
            pg.fill('.modal input[placeholder="Name des Charakters"]', 'Zweiter Entwurf'); pg.wait_for_timeout(1800); pg.evaluate('window.__delay = 0')
            check('Fehler behoben: langsames Speichern schließt neuen Dialog nicht', pg.locator('.modal').count() == 1
                  and pg.locator('.modal input[placeholder="Name des Charakters"]').input_value() == 'Zweiter Entwurf' and 'Langsam' in pg.locator('svg.net').text_content())
            pg.keyboard.press('Escape')
            # Besucher kann die Auswahl auch nutzen
            pg.goto(U + f'#/b/{BID2}/netz'); pg.wait_for_timeout(700)
            check('Besucher: Auswahl verfügbar', pg.locator('.focus-btn').count() == 1)
            ctx.close()
            # Handy
            ctx = context(**MOBILE); pg = page(ctx)
            pg.goto(U + f'#/b/{BID}/netz'); pg.wait_for_timeout(800)
            pg.locator('.focus-btn').click(); pg.wait_for_timeout(300)
            pb = pg.locator('.focus-panel').bounding_box()
            check('Handy: Charakterliste im Auswahl-Fenster nicht zusammengedrückt (>= 100 px)', pg.locator('.focus-list').bounding_box()['height'] >= 100)
            check('Handy: Auswahl-Fenster passt (375 px), Hinweis ausgeblendet', pg.evaluate('document.documentElement.scrollWidth') <= 375 and pb['x'] >= 0 and pb['x'] + pb['width'] <= 375 and pg.locator('.hint').is_hidden())
            pg.screenshot(path=os.path.join(OUT, 'handy_auswahl.png'))
            ctx.close()

        # ================= 8. Übersicht: Linien, Beschriftungen, Hover, Detailstufen, Inseln, Anordnen =================
        def overview():
            ctx = context(); pg = page(ctx)
            pg.goto(U + f'#/b/{BID}/netz'); pg.wait_for_timeout(800)
            N = lambda cid: pg.locator(f'.node[data-char="{cid}"]')
            LB = lambda lid: pg.locator(f'.link-label[data-link="{lid}"]')
            LG = lambda lid: pg.locator('.link').nth(pg.locator('.link-label').evaluate_all(f"(ls) => ls.findIndex(l => l.dataset.link === '{lid}')"))
            op = lambda loc: float(loc.evaluate('e => getComputedStyle(e).opacity'))
            pos = lambda loc: [float(v) for v in re.findall(r'-?[\d.]+', loc.get_attribute('transform'))[:2]]
            check('Linien leicht gebogen (Kurve, Bogen ≤ 36 px)', ' Q' in pg.locator('.link path').first.get_attribute('d'))
            check('Linie mit gemeinsamer Fraktion in Fraktionsfarbe', 'shared' in LG('l1').get_attribute('class') and LG('l1').evaluate("e => e.style.getPropertyValue('--c')") == '#e74c3c')
            check('Linie ohne gemeinsame Fraktion neutral', 'shared' not in LG('l2').get_attribute('class') and LG('l2').evaluate("e => e.style.getPropertyValue('--c')") == '')
            p0, p1, pl = pos(N('c0')), pos(N('c1')), pos(LB('l1'))
            check('Beschriftung rückt zum weniger verbundenen Ende', math.dist(pl, p1) < math.dist(pl, p0) - 20)
            boxes = pg.evaluate("""() => [...document.querySelectorAll('.link-label:not(.culled):not(.dim)')].map(e => { const r = e.querySelector('rect').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })""")
            ov = [(a, b) for i, a in enumerate(boxes) for b in boxes[i + 1:] if a[0] < b[2] - 1 and a[2] > b[0] + 1 and a[1] < b[3] - 1 and a[3] > b[1] + 1]
            culled = pg.locator('.link-label.culled')
            check(f'Beschriftungen überlappen nicht ({len(boxes)} sichtbar, {culled.count()} ausgeblendet)', not ov and culled.count() > 0 and op(culled.first) == 0, ov[:2])
            # Hover
            bb = N('c5').bounding_box(); pg.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2 - 10); pg.wait_for_timeout(200)
            check('Hover: Kreis + Verbundene hervorgehoben, Rest abgeblasst', 'hovering' in pg.locator('.canvas').get_attribute('class')
                  and 'hov' in N('c5').get_attribute('class') and 'hov' in N('c0').get_attribute('class') and abs(op(N('c6')) - 0.3) < 0.01)
            check('Hover: Beschriftung der Verbindungen sichtbar (auch wenn sonst ausgeblendet)', 'hov' in LB('l5').get_attribute('class') and op(LB('l5')) == 1)
            pg.mouse.move(5, 790); pg.wait_for_timeout(150)
            check('Hover: verlassen -> alles wieder normal', 'hovering' not in pg.locator('.canvas').get_attribute('class') and op(N('c6')) == 1)
            # Detailstufen
            check('Detailstufe nah: Namen normal groß', pg.locator('.canvas').get_attribute('data-lod') == 'near' and N('c0').locator('.node-name').evaluate('e => getComputedStyle(e).fontSize') == '13px')
            seen = set()
            for _ in range(30):
                pg.mouse.move(600, 450); pg.mouse.wheel(0, 120); pg.wait_for_timeout(30); seen.add(pg.locator('.canvas').get_attribute('data-lod'))
                if pg.locator('.canvas').get_attribute('data-lod') == 'far': break
            check('Detailstufen: beim Herauszoomen nah -> mittel -> fern', {'near', 'mid', 'far'} <= seen | {'near'} and 'mid' in seen and 'far' in seen, seen)
            nm = lambda cid: op(N(cid).locator('.node-name'))
            ranks = pg.evaluate("() => Object.fromEntries([...document.querySelectorAll('.node')].map(n => [n.dataset.char, n.dataset.rank]))")
            rc = next(k for k, v in ranks.items() if v == 'c')
            check('Detailstufe fern: keine Linienbeschriftungen, nur wichtigste Namen (größer)', op(LB('l3')) == 0 and ranks['c0'] == 'a' and nm('c0') == 1 and nm(rc) == 0
                  and float(N('c0').locator('.node-name').evaluate('e => parseFloat(getComputedStyle(e).fontSize)')) > 13)
            pg.get_by_role('button', name='Alles zeigen').click(); pg.wait_for_timeout(200)
            check('Detailstufe: „Alles zeigen“ -> wieder nah', pg.locator('.canvas').get_attribute('data-lod') == 'near')
            # Fraktionsinseln
            # (seit 2.8 gewollt geändert: Insel = Hauptfraktion, d. h. erste Fraktion; c10 hat Ostlande zuerst -> nur in der Ostlande-Insel)
            check('Inseln: jeder Charakter in der Insel seiner Hauptfraktion (c10: Ostlande, nicht Nordreich)', pg.locator('.island[data-faction="f1"] circle').count() == 2
                  and pg.locator('.island[data-faction="f2"] circle').count() == 3 and pg.locator('.island-name').count() == 2)
            pg.evaluate("window.__db.characters.find(c => c.id === 'c11').x = 4000")
            pg.goto(U + '#/'); pg.wait_for_timeout(400); pg.goto(U + f'#/b/{BID}/netz'); pg.wait_for_timeout(700)
            check('Inseln: weit entfernte Mitglieder bilden eigene Teilinsel (Verzweigung/Trennung)', pg.locator('.island-name').count() == 3 and pg.locator('.island[data-faction="f2"] line').count() == 1)
            pg.locator('.islands-btn').click(); pg.wait_for_timeout(150)
            check('Inseln: ausschaltbar (und gemerkt)', pg.locator('.island').count() == 0 and pg.evaluate("localStorage.getItem('cn-islands')") == '0')
            pg.reload(); pg.wait_for_timeout(700)
            check('Inseln: bleiben nach Neuladen aus', pg.locator('.island').count() == 0 and pg.locator('.islands-btn').get_attribute('aria-pressed') == 'false')
            pg.locator('.islands-btn').click(); pg.wait_for_timeout(150)
            check('Inseln: wieder einschaltbar', pg.locator('.island').count() == 2)
            # Anordnen + Rückgängig
            before = pg.evaluate("() => Object.fromEntries(window.__db.characters.filter(c => c.board_id === '" + BID + "').map(c => [c.id, [c.x, c.y]]))")
            n0 = len(pg.evaluate('window.__calls'))
            pg.locator('.arrange-btn').click(); pg.wait_for_timeout(200)
            check('Anordnen: fragt vorher nach (nach Fraktionsinseln)', pg.locator('.modal h2').inner_text() == 'Alle Charaktere anordnen?' and 'Fraktionsinseln' in pg.inner_text('.modal'))
            pg.locator('.modal button:has-text("Abbrechen")').click(); pg.wait_for_timeout(200)
            check('Anordnen: „Abbrechen“ ändert nichts', pg.locator('.modal').count() == 0 and not [c for c in pg.evaluate('window.__calls')[n0:] if c[0] == 'update'])
            pg.locator('.arrange-btn').click(); pg.wait_for_timeout(200)
            pg.locator('.modal button:has-text("Anordnen")').click(); pg.wait_for_timeout(1500)
            calls = [c for c in pg.evaluate('window.__calls')[n0:] if c[0] == 'update' and c[1] == 'characters']
            nodes = pg.evaluate("() => [...document.querySelectorAll('.node')].map(n => { const m = n.getAttribute('transform').match(/-?[\\d.]+/g).map(Number); return [n.dataset.char, m[0], m[1], +n.querySelector('.node-bg').getAttribute('r')]; })")
            gapmin = min(math.dist(a[1:3], b[1:3]) - a[3] - b[3] for i, a in enumerate(nodes) for b in nodes[i + 1:])
            P = {n[0]: n[1:3] for n in nodes}
            check(f'Anordnen: gespeichert ({len(calls)} Positionen), kein Kreis überlappt (Abstand ≥ {gapmin:.0f} px)', len(calls) >= 25 and gapmin >= 40)
            check('Anordnen: Fraktionsmitglieder liegen beieinander', math.dist(P['c0'], P['c1']) < math.dist(P['c0'], P['c11']) and math.dist(P['c4'], P['c11']) < math.dist(P['c4'], P['c1']))
            # (seit 2.8 gewollt geändert: c10 gehört zur Ostlande-Insel und liegt an deren Rand Richtung Nordreich)
            nord = ((P['c0'][0] + P['c1'][0]) / 2, (P['c0'][1] + P['c1'][1]) / 2)
            check('Anordnen: Charakter mit zwei Fraktionen am Rand seiner Hauptinsel, zur anderen Fraktion hin', math.dist(P['c10'], nord) < min(math.dist(P['c4'], nord), math.dist(P['c11'], nord))
                  and math.dist(P['c10'], P['c11']) < math.dist(P['c10'], nord))
            names = pg.locator('.island-name').evaluate_all('ts => ts.map(t => t.textContent)')
            check('Anordnen: genau eine Insel je Fraktion (keine Teilinseln)', sorted(names) == ['Nordreich', 'Ostlande'], names)
            check('Anordnen: „↶ Rückgängig“ erscheint', pg.locator('.undo-btn').count() == 1)
            pg.screenshot(path=os.path.join(OUT, 'angeordnet.png'))
            pg.locator('.undo-btn').click(); pg.wait_for_timeout(1500)
            after = pg.evaluate("() => Object.fromEntries(window.__db.characters.filter(c => c.board_id === '" + BID + "').map(c => [c.id, [c.x, c.y]]))")
            check('Rückgängig: alte Positionen wiederhergestellt', after == before and pg.locator('.undo-btn').count() == 0)
            big = pg.evaluate("""() => { const f = [...Array(12)].map((_, i) => ({ id: 'F' + i })); const ch = [...Array(400)].map((_, i) => ({ id: 'x' + i, name: 'N' + i, factionIds: i % 7 === 0 ? ['F' + (i % 12), 'F' + ((i + 3) % 12)] : i % 11 === 0 ? [] : ['F' + (i % 12)] }));
                const ls = [...Array(700)].map((_, i) => ({ a: 'x' + ((i * 37) % 400), b: 'x' + ((i * 91 + 5) % 400) })).filter(l => l.a !== l.b);
                const t = performance.now(); const p = window.__cnLayout(ch, ls, f); const ms = performance.now() - t;
                const deg = {}; for (const l of ls) { deg[l.a] = (deg[l.a] || 0) + 1; deg[l.b] = (deg[l.b] || 0) + 1; } const r = (id) => Math.min(52, Math.round(32 + 4.5 * Math.sqrt(deg[id] || 0)));
                let g = 1e9; const ids = [...p.keys()]; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = p.get(ids[i]), b = p.get(ids[j]); g = Math.min(g, Math.hypot(a.x - b.x, a.y - b.y) - r(ids[i]) - r(ids[j])); }
                return [p.size, ms, g]; }""")
            check(f'Anordnen groß: 400 Charaktere in {big[1]:.0f} ms, ohne Überlappung (Abstand {big[2]:.0f})', big[0] == 400 and big[1] < 3000 and big[2] >= 40)
            # Realistisches Board (Silber-Trilogie, 59 Charaktere, viele Mehrfach-Fraktionen): eine Insel je Fraktion, keine Überlappung
            silber = open(os.path.join(ROOT, 'tests', 'data', 'silber.json'), encoding='utf-8').read()
            sv = pg.evaluate("""(txt) => { const b = JSON.parse(txt); const ch = b.characters.map(c => ({ id: c.id, name: c.name, factionIds: c.factions }));
                const p = window.__cnLayout(ch, b.links, b.factions);
                const deg = {}; for (const l of b.links) { deg[l.a] = (deg[l.a] || 0) + 1; deg[l.b] = (deg[l.b] || 0) + 1; } const r = (id) => Math.min(52, Math.round(32 + 4.5 * Math.sqrt(deg[id] || 0)));
                let g = 1e9; const ids = [...p.keys()]; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = p.get(ids[i]), q = p.get(ids[j]); g = Math.min(g, Math.hypot(a.x - q.x, a.y - q.y) - r(ids[i]) - r(ids[j])); }
                const split = []; for (const f of b.factions) { const m = ch.filter(c => c.factionIds[0] === f.id).map(c => p.get(c.id)); const n = m.length; if (!n) continue;
                  const inT = Array(n).fill(false), best = Array(n).fill(Infinity); best[0] = 0; let comps = 1;
                  for (let k = 0; k < n; k++) { let u = -1; for (let i = 0; i < n; i++) if (!inT[i] && (u < 0 || best[i] < best[u])) u = i; inT[u] = true; if (k && best[u] > 430) comps++;
                    for (let v = 0; v < n; v++) if (!inT[v]) best[v] = Math.min(best[v], Math.hypot(m[u].x - m[v].x, m[u].y - m[v].y)); }
                  if (comps > 1) split.push(f.name); }
                return [p.size, g, split]; }""", silber)
            check(f'Anordnen Silber-Board: {sv[0]} Charaktere, eine Insel je Fraktion, ohne Überlappung (Abstand {sv[1]:.0f})', sv[0] == 59 and not sv[2] and sv[1] >= 40, sv[2])
            N('c0').click(); pg.wait_for_timeout(300); pg.locator('.modal button:has-text("Bearbeiten")').click(); pg.wait_for_timeout(300)
            check('Charakter-Formular: Hinweis „erste Fraktion = Hauptfraktion (Insel)“', 'Hauptfraktion' in pg.locator('.hint-main-faction').inner_text())
            pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
            pg.goto(U + f'#/b/{BID2}/netz'); pg.wait_for_timeout(700)
            check('Besucher: Inseln-Schalter ja, Anordnen nein', pg.locator('.islands-btn').count() == 1 and pg.locator('.arrange-btn').count() == 0)
            ctx.close()
            ctx = context(**MOBILE); pg = page(ctx)
            pg.goto(U + f'#/b/{BID}/netz'); pg.wait_for_timeout(800)
            check('Handy: Werkzeugleiste mit neuen Knöpfen ohne seitliches Scrollen', pg.evaluate('document.documentElement.scrollWidth') <= 375 and pg.locator('.islands-btn').is_visible())
            pg.screenshot(path=os.path.join(OUT, 'handy_netz_inseln.png'))
            ctx.close()

        # ================= 9. Ersteller übertragen (seit 2.8) =================
        def transfer_owner(mobile):
            tag = 'Handy' if mobile else 'Desktop'
            ctx = context(**MOBILE) if mobile else context(); pg = page(ctx)
            pg.goto(U + f'#/b/{BID}/netz'); pg.wait_for_timeout(700)
            pg.locator('.share-btn').click(); pg.wait_for_timeout(500)
            mem = pg.locator('.modal .member')
            check(f'Übertragen {tag}: Mitgliederliste mit Ersteller + 2 Besuchern', mem.count() == 3 and 'Ersteller (du)' in mem.nth(0).inner_text() and 'test_ersteller' in mem.nth(0).inner_text()
                  and mem.nth(0).locator('.transfer-btn').count() == 0 and pg.locator('.modal .transfer-btn').count() == 2, [mem.nth(i).inner_text() for i in range(mem.count())])
            check(f'Übertragen {tag}: Knopf je Besucher mit Namen (barrierefrei)', pg.locator('.modal button[aria-label="test_besucher zum Ersteller machen"]').count() == 1
                  and pg.locator('.modal button[aria-label="さくら zum Ersteller machen"]').count() == 1)
            check(f'Übertragen {tag}: Teilen-Dialog passt in die Breite', pg.evaluate('document.documentElement.scrollWidth') <= (375 if mobile else 1200))
            pg.screenshot(path=os.path.join(OUT, f'mitglieder_{tag.lower()}.png'))
            pg.locator('.modal button[aria-label="test_besucher zum Ersteller machen"]').click(); pg.wait_for_timeout(300)
            yes = pg.locator('.modal .transfer-yes')
            check(f'Übertragen {tag}: Rückfrage mit Namen und Folgen', pg.locator('.modal h2').inner_text() == 'Ersteller übertragen?' and 'test_besucher' in pg.inner_text('.modal')
                  and 'nur noch ansehen' in pg.inner_text('.modal'))
            check(f'Übertragen {tag}: Bestätigen erst nach Häkchen möglich', yes.is_disabled())
            check(f'Übertragen {tag}: Rückfrage passt in die Breite', pg.evaluate('document.documentElement.scrollWidth') <= (375 if mobile else 1200))
            pg.screenshot(path=os.path.join(OUT, f'uebertragen_{tag.lower()}.png'))
            pg.locator('.modal button:has-text("Abbrechen")').click(); pg.wait_for_timeout(500)
            check(f'Übertragen {tag}: „Abbrechen“ -> zurück zum Teilen-Dialog, nichts übertragen', pg.locator('.modal h2').inner_text() == 'Zum Board einladen'
                  and not [c for c in pg.evaluate('window.__calls') if c[0] == 'rpc' and c[1] == 'transfer_board_owner'])
            if not mobile:  # Fehler vom Server -> deutsche Meldung, nichts ändert sich
                pg.evaluate("window.__transferFail = 'new_owner_no_access'")
                pg.locator('.modal button[aria-label="さくら zum Ersteller machen"]').click(); pg.wait_for_timeout(300)
                pg.locator('.modal .transfer-ok').check(); pg.locator('.modal .transfer-yes').click(); pg.wait_for_timeout(400)
                check('Übertragen: Server lehnt ab -> deutsche Meldung, Board bleibt bearbeitbar', 'muss es zuerst über den Einladungslink öffnen' in pg.inner_text('body')
                      and pg.evaluate(f"window.__db.boards.find(b => b.id === '{BID}').owner_id") == 'u-owner' and pg.locator('.share-btn').count() == 1)
                pg.evaluate('window.__transferFail = null'); pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
                pg.locator('.share-btn').click(); pg.wait_for_timeout(500)
                pg.locator('.modal button[aria-label="test_besucher zum Ersteller machen"]').click(); pg.wait_for_timeout(300)
            else:
                pg.locator('.modal button[aria-label="test_besucher zum Ersteller machen"]').click(); pg.wait_for_timeout(300)
            pg.locator('.modal .transfer-ok').check()
            check(f'Übertragen {tag}: nach Häkchen bestätigbar', not pg.locator('.modal .transfer-yes').is_disabled())
            pg.locator('.modal .transfer-yes').click(); pg.wait_for_timeout(900)
            rpc = [c for c in pg.evaluate('window.__calls') if c[0] == 'rpc' and c[1] == 'transfer_board_owner']
            check(f'Übertragen {tag}: Server-Funktion mit Board und neuem Ersteller aufgerufen', rpc and rpc[-1][2] == {'p_board': BID, 'p_new_owner': 'u-vis'}, rpc)
            check(f'Übertragen {tag}: Dialog zu, Board jetzt nur ansehen (von test_besucher)', pg.locator('.modal').count() == 0 and 'Nur ansehen' in pg.inner_text('.topbar')
                  and 'test_besucher' in pg.inner_text('.topbar') and pg.locator('.share-btn').count() == 0 and pg.locator('.arrange-btn').count() == 0)
            pg.goto(U + '#/'); pg.wait_for_timeout(700)
            check(f'Übertragen {tag}: Board unter „Mit mir geteilt“, nicht mehr unter „Meine Boards“', pg.locator('.board-card.shared:has-text("Testprojekt")').count() == 1
                  and pg.locator('.board-card:not(.shared):has-text("Testprojekt")').count() == 0)
            ctx.close()

        section('Grundfunktionen', basics)
        section('Japanisch', japanese)
        section('Einladung', invite)
        section('Teilen Desktop', sharing, False)
        section('Teilen Handy', sharing, True)
        section('Handy-Ansichten', mobile_views)
        section('Verstorbene + Auswahl', selection)
        section('Übersicht', overview)
        section('Ersteller übertragen Desktop', transfer_owner, False)
        section('Ersteller übertragen Handy', transfer_owner, True)
        section('Updates', updates)
        b.close()
    srv.shutdown()
    check('Keine JavaScript-Fehler in der Seite', not errs, errs[:3])
    print(f'\nOberfläche: {sum(results)} von {len(results)} Prüfungen bestanden. Screenshots: {OUT}')
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main()
