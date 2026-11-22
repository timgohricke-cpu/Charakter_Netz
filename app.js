'use strict';
/*
 * Charakter-Netz – Version 2
 * Boards mit Charaktertabelle, Charakternetz und Weltkarte.
 * Daten liegen in Supabase (Postgres mit Row Level Security), Bilder in einem privaten Storage-Bucket.
 * Alle Nutzertexte werden mit textContent eingefügt (kein innerHTML) -> Schutz vor Script-Injection.
 */
(() => {
  // ---------- Schutz vor Clickjacking ----------
  // GitHub Pages kann keinen „frame-ancestors“-Header setzen: In einem fremden Rahmen startet die App deshalb nicht.
  let framed = true;
  try { framed = window.top !== window.self; } catch { framed = true; }
  if (framed) {
    const app = document.getElementById('app');
    const p = document.createElement('p'); p.className = 'loading';
    const a = document.createElement('a'); a.href = location.href; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = 'Charakter-Netz in einem eigenen Fenster öffnen';
    p.append(a);
    if (app) app.replaceChildren(p);
    return;
  }

  // ---------- Konfiguration ----------
  const CFG = window.CN_CONFIG || {};
  const SB_URL = String(CFG.SUPABASE_URL || '').replace(/\/+$/, '');
  const SB_KEY = String(CFG.SUPABASE_KEY || '');
  const EMAIL_DOMAIN = String(CFG.EMAIL_DOMAIN || 'users.charakter-netz.app');
  const BUCKET = 'board-images';
  const APP_VERSION = '2.6'; // bei jeder Veröffentlichung zusammen mit dem Cache-Namen in sw.js erhöhen
  const CONFIGURED = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(SB_URL) && SB_KEY.length > 20 && !!window.supabase;
  // Benutzernamen: 2–24 Zeichen, Buchstaben/Ziffern . _ - sowie Japanisch (Hiragana, Katakana, Kanji).
  // Muss zu private.cn_username_ok() in supabase/schema.sql passen.
  const USERNAME_RE = /^[A-Za-z0-9_.\-\u3005-\u3007\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]{2,24}$/;
  const normUser = (s) => String(s || '').trim().normalize('NFKC');
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const BOARD_COLS = 'id,owner_id,name,map_path,map_w,map_h,created_at,updated_at';
  const CHAR_COLS = 'id,name,short,info,place,image_path,x,y,map_x,map_y,dead';
  const FACTION_COLS = 'id,name,color';
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  const DEAD_COLOR = '#8b9099';
  const FACTION_PALETTE = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#e84393', '#a0522d', '#00b894'];
  const LINK_COLS = 'id,a,b,short,long';

  // ---------- Hilfsfunktionen ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  const R = 36; // Grundradius der Kreise im Netz
  // Wichtigkeit: mehr Verbindungen -> etwas größerer Kreis (Wurzel-Kurve, gedeckelt, damit niemand alles überragt)
  const radiusFor = (deg) => Math.round(Math.min(52, 32 + 4.5 * Math.sqrt(deg || 0)));
  const VIEWS = ['tabelle', 'netz', 'karte'];
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  // Japanische (breite) Zeichen zählen doppelt, damit Beschriftungen nicht überlaufen
  const isWide = (ch) => /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{20000}-\u{3FFFD}]/u.test(ch);
  const textUnits = (s) => { let n = 0; for (const ch of String(s)) n += isWide(ch) ? 2 : 1; return n; };
  // Kürzen nach Breite, ohne Schriftzeichen zu zerschneiden
  const trunc = (s, n) => {
    s = String(s); if (textUnits(s) <= n) return s;
    let out = '', u = 0;
    for (const ch of s) { const w = isWide(ch) ? 2 : 1; if (u + w > n - 1) break; out += ch; u += w; }
    return out + '…';
  };
  // Suche: Groß/klein, Voll-/Halbbreite und Hiragana/Katakana spielen keine Rolle
  const fold = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  const collator = new Intl.Collator(['de', 'ja'], { numeric: true, sensitivity: 'base' });
  const byName = (x, y) => collator.compare(x.name, y.name);
  // Bei japanischer Eingabe (IME) bestätigt Enter nur die Umwandlung – dann nichts auslösen
  const imeEnter = (e) => e.isComposing || e.keyCode === 229;
  const initials = (n) => (n || '').split(/\s+/).map((w) => (w.match(/[\p{L}\p{N}]/u) || [''])[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return n;
  }
  function sv(tag, attrs = {}) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }
  const btn = (label, onclick, cls = '') => el('button', { class: 'btn ' + cls, type: 'button', onclick }, label);
  const field = (label, input) => el('label', { class: 'field' }, el('span', { text: label }), input);
  const section = (title, ...kids) => el('section', { class: 'sec' }, el('h4', { text: title }), ...kids);

  function toast(msg) {
    const t = el('div', { class: 'toast', text: msg });
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 4200);
  }
  function store(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch { return null; }
    return null;
  }
  function sstore(key, val) {
    try { if (val === undefined) return sessionStorage.getItem(key); if (val === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, val); } catch { return null; }
    return null;
  }
  // ---------- Offene Einladung ----------
  // Ein Freigabe-Link wird gemerkt, bis man angemeldet ist – auch über die Installation der App hinweg
  // (localStorage teilen sich Browser und installierte App). Gültig 2 Tage, danach verworfen.
  const INVITE_KEY = 'cn-invite';
  const INVITE_RE = /^#\/(s|b)\/[0-9a-f-]{36}(\/[0-9a-z-]{1,36})?$/i;
  function setPending(hash) {
    if (!INVITE_RE.test(hash || '')) return;
    store(INVITE_KEY, JSON.stringify({ hash, exp: Date.now() + 2 * 86400000 }));
  }
  function getPending() {
    try {
      const v = JSON.parse(store(INVITE_KEY) || 'null');
      if (v && typeof v.hash === 'string' && INVITE_RE.test(v.hash) && v.exp > Date.now()) return v.hash;
    } catch { /* beschädigt */ }
    store(INVITE_KEY, null);
    return null;
  }
  const clearPending = () => { store(INVITE_KEY, null); sstore('cn-pending', null); };

  // ---------- Hell / Dunkel ----------
  const THEME_KEY = 'cn-theme';
  const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', t === 'light' ? '#ffffff' : '#1b1f2a');
  }
  applyTheme(store(THEME_KEY) || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  function appShareButton() {
    return el('button', { class: 'icon-btn', type: 'button', title: 'App weiterempfehlen', 'aria-label': 'App weiterempfehlen', onclick: () => shareAppDialog() }, '📣');
  }
  function themeButton() {
    const label = () => (currentTheme() === 'light' ? 'Dunkles Design' : 'Helles Design');
    const b = el('button', { class: 'icon-btn theme-btn', type: 'button', title: label(), 'aria-label': label() }, currentTheme() === 'light' ? '🌙' : '☀️');
    b.addEventListener('click', () => {
      const t = currentTheme() === 'light' ? 'dark' : 'light';
      applyTheme(t); store(THEME_KEY, t);
      b.textContent = t === 'light' ? '🌙' : '☀️'; b.title = label(); b.setAttribute('aria-label', label());
    });
    return b;
  }

  // Knopf während einer Server-Aktion sperren
  async function busy(button, fn) {
    if (button) { if (button.disabled) return undefined; button.disabled = true; button.classList.add('busy'); }
    try { return await fn(); } finally { if (button) { button.disabled = false; button.classList.remove('busy'); } }
  }

  // Bild laden, verkleinern, als JPEG neu kodieren (entfernt dabei auch Metadaten wie GPS-Daten)
  function readImage(file, max, quality = 0.85) {
    return new Promise((res, rej) => {
      if (!file || !/^image\//.test(file.type)) return rej(new UErr('Bitte eine Bilddatei wählen.'));
      if (file.size > 40 * 1024 * 1024) return rej(new UErr('Das Bild ist zu groß (höchstens 40 MB).'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * s));
        const h = Math.max(1, Math.round(img.naturalHeight * s));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob((blob) => (blob ? res({ blob, w, h }) : rej(new UErr('Das Bild konnte nicht verarbeitet werden.'))), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new UErr('Das Bild konnte nicht geladen werden.')); };
      img.src = url;
    });
  }
  function dataUrlToBlob(u) {
    const m = /^data:([^;,]+);base64,(.*)$/.exec(u || '');
    if (!m) throw new UErr('Ungültiges Bild.');
    const bin = atob(m[2]); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: m[1] });
  }
  const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  // Nur Bildadressen aus dem eigenen Supabase-Speicher oder lokal erzeugte Blobs anzeigen
  const safeSrc = (u) => (typeof u === 'string' && (u.startsWith(SB_URL + '/storage/v1/') || u.startsWith('blob:')) ? u : null);

  // ---------- Fehlermeldungen auf Deutsch ----------
  class UErr extends Error {} // eigene, bereits verständliche Meldung
  function errMsg(e) {
    if (e instanceof UErr) return e.message;
    const m = String((e && (e.message || e.error_description || e.msg)) || e || '');
    const code = String((e && (e.code || e.error_code)) || '');
    const status = e && e.status;
    if (/Failed to fetch|NetworkError|Load failed|network|fetch failed/i.test(m)) return 'Keine Verbindung zum Server. Bist du online?';
    if (code === 'invalid_credentials' || /Invalid login credentials/i.test(m)) return 'Benutzername oder Passwort ist falsch.';
    if (code === 'user_already_exists' || /already (registered|exists)/i.test(m)) return 'Dieser Benutzername ist schon vergeben.';
    if (/Database error saving new user/i.test(m)) return 'Dieser Benutzername ist schon vergeben oder ungültig.';
    if (/email_change_not_allowed/.test(m)) return 'Der Anmeldename kann nicht geändert werden.';
    if (code === '23505' || /duplicate key|unique constraint/i.test(m)) return 'Dieser Eintrag existiert bereits. Bitte lade die Seite neu.';
    if (code === 'email_address_invalid' || /email.*invalid|invalid.*email/i.test(m)) return 'Die Registrierung ist auf dem Server falsch eingerichtet (E-Mail-Domain). Bitte EMAIL_DOMAIN in config.js prüfen.';
    if (code === 'email_not_confirmed' || /Email not confirmed/i.test(m)) return 'Dieses Konto ist noch nicht bestätigt. In Supabase muss „Confirm email“ ausgeschaltet sein.';
    if (code === 'weak_password' || /weak|Password should/i.test(m)) return 'Das Passwort ist zu schwach. Bitte nimm mindestens 8 Zeichen, gemischt aus Buchstaben und Zahlen.';
    if (code === 'same_password') return 'Das neue Passwort muss sich vom alten unterscheiden.';
    if (status === 429 || /rate limit|too many/i.test(m)) return 'Zu viele Versuche. Bitte warte einen Moment und versuche es dann erneut.';
    if (/JWT|session.*(missing|expired)|refresh token/i.test(m)) return 'Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an.';
    if (code === '42501' || /row-level security|permission denied|not_owner|no_permission/i.test(m)) return 'Dafür hast du keine Berechtigung.';
    if (/limit_boards/.test(m)) return 'Du hast die Höchstzahl von 200 Boards erreicht.';
    if (/limit_characters/.test(m)) return 'Dieses Board hat die Höchstzahl von 2000 Charakteren erreicht.';
    if (/limit_factions/.test(m)) return 'Ein Board kann höchstens 50 Fraktionen haben.';
    if (/limit_links/.test(m)) return 'Dieses Board hat die Höchstzahl von 10 000 Verbindungen erreicht.';
    if (/Payload too large|exceeded the maximum|too large/i.test(m)) return 'Die Datei ist zu groß.';
    if (/mime type|not supported/i.test(m)) return 'Dieses Dateiformat wird nicht unterstützt.';
    return 'Es ist ein Fehler aufgetreten. Bitte versuche es erneut.' + (m ? ` (${trunc(m, 120)})` : '');
  }
  const denied = () => Object.assign(new Error('no_permission'), { code: '42501' });

  // ---------- Supabase ----------
  // „Angemeldet bleiben“: Sitzung in localStorage (bleibt) oder sessionStorage (endet mit dem Fenster)
  const REMEMBER_KEY = 'cn-remember';
  const authStorage = {
    getItem(k) { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
    setItem(k, v) {
      try {
        const keep = localStorage.getItem(REMEMBER_KEY) === '1';
        (keep ? localStorage : sessionStorage).setItem(k, v);
        (keep ? sessionStorage : localStorage).removeItem(k);
      } catch { /* Speicher nicht verfügbar */ }
    },
    removeItem(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* egal */ } },
  };
  const sb = CONFIGURED ? window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { storage: authStorage, storageKey: 'cn-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  }) : null;
  async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
  // Anmelde-Adresse zu einem Benutzernamen (muss zu private.cn_email_for() in schema.sql passen):
  // reine ASCII-Namen wie bisher <name klein>@domain, sonst u+<40 Hex-Zeichen SHA-256>@domain
  async function emailFor(username) {
    const u = normUser(username);
    if (/^[A-Za-z0-9_.-]+$/.test(u)) return `${u.toLowerCase()}@${EMAIL_DOMAIN}`;
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(u.toLowerCase()));
    const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `u+${hex.slice(0, 40)}@${EMAIL_DOMAIN}`;
  }

  // Signierte (zeitlich begrenzte) Bildadressen aus dem privaten Bucket
  const urlCache = new Map();
  async function signUrls(paths) {
    const now = Date.now();
    const need = [...new Set(paths.filter((p) => p && !((urlCache.get(p) || {}).exp > now + 5 * 60000)))];
    for (const part of chunks(need, 200)) {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(part, 3600);
      if (error) throw error;
      for (const r of data || []) if (r.signedUrl && !r.error) urlCache.set(r.path, { url: r.signedUrl, exp: now + 3600000 });
    }
    return (p) => (p ? safeSrc((urlCache.get(p) || {}).url) : null);
  }
  async function uploadImage(boardId, blob, prefix) {
    const path = `${boardId}/${prefix}${uid()}.jpg`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
    if (error) throw error;
    return path;
  }
  async function removeImages(paths) {
    const list = paths.filter(Boolean);
    for (const part of chunks(list, 500)) { try { await sb.storage.from(BUCKET).remove(part); } catch { /* verwaiste Datei, nicht kritisch */ } }
    list.forEach((p) => urlCache.delete(p));
  }
  async function listBoardFiles(bid) {
    const out = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb.storage.from(BUCKET).list(bid, { limit: 1000, offset: off });
      if (error) throw error;
      out.push(...(data || []).filter((f) => f && f.name && f.id !== null).map((f) => `${bid}/${f.name}`));
      if (!data || data.length < 1000) return out;
    }
  }
  async function deleteBoardFully(bid) {
    await removeImages(await listBoardFiles(bid));
    const r = await q(sb.from('boards').delete().eq('id', bid).select('id'));
    if (!r.length) throw denied();
  }
  async function fetchAll(table, cols, bid, order = ['id']) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      let qy = sb.from(table).select(cols).eq('board_id', bid);
      for (const o of order) qy = qy.order(o);
      const data = await q(qy.range(from, from + 999));
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }
  const charRow = (c, bid) => ({
    id: c.id, board_id: bid, name: c.name, short: c.short || '', info: c.info || '', place: c.place || '',
    image_path: c.imagePath || null, x: c.x, y: c.y,
    map_x: c.mapPos ? c.mapPos.x : null, map_y: c.mapPos ? c.mapPos.y : null,
    dead: !!c.dead,
  });
  const charFromRow = (r) => ({
    id: r.id, name: r.name, short: r.short, info: r.info, place: r.place, imagePath: r.image_path, image: null,
    x: r.x, y: r.y, mapPos: r.map_x != null && r.map_y != null ? { x: r.map_x, y: r.map_y } : null,
    factionIds: [], dead: !!r.dead,
  });

  // Ein Board komplett vom Server laden (optional mit Bildadressen)
  async function loadBoard(bid, withUrls = true) {
    const [b, chars, links, factions, cf] = await Promise.all([
      q(sb.from('boards').select(BOARD_COLS).eq('id', bid).maybeSingle()),
      fetchAll('characters', CHAR_COLS, bid),
      fetchAll('links', LINK_COLS, bid),
      fetchAll('factions', FACTION_COLS, bid),
      fetchAll('character_factions', 'character_id,faction_id,position', bid, ['character_id', 'faction_id']),
    ]);
    if (!b) return null;
    const out = {
      id: b.id, name: b.name, ownerId: b.owner_id, ownerName: '', created: b.created_at, updated: b.updated_at,
      map: b.map_path ? { path: b.map_path, w: b.map_w || 1000, h: b.map_h || 500, src: null } : null,
      characters: chars.map(charFromRow),
      links: links.map((l) => ({ id: l.id, a: l.a, b: l.b, short: l.short, long: l.long })),
      factions: factions.filter((f) => COLOR_RE.test(f.color)).sort(byName),
    };
    const cmap = new Map(out.characters.map((c) => [c.id, c]));
    cf.sort((x, y) => x.position - y.position);
    for (const r of cf) { const c = cmap.get(r.character_id); if (c && out.factions.some((f) => f.id === r.faction_id)) c.factionIds.push(r.faction_id); }
    if (withUrls) {
      const get = await signUrls([out.map && out.map.path, ...out.characters.map((c) => c.imagePath)]);
      if (out.map) out.map.src = get(out.map.path);
      for (const c of out.characters) c.image = get(c.imagePath);
    }
    if (me && out.ownerId !== me.id) {
      const p = await q(sb.from('profiles').select('username').eq('id', out.ownerId).maybeSingle()).catch(() => null);
      out.ownerName = p ? p.username : '';
    }
    return out;
  }

  // Liste von IDs aus localStorage lesen (beschädigte Einträge werden ignoriert)
  function readIdList(key) {
    try { const v = JSON.parse(store(key) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
  }

  // ---------- Lokaler Speicher aus Version 1 (nur noch für die Übernahme) ----------
  const LocalDB = {
    db: null,
    async open() {
      if (this.db) return this.db;
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('charakter-netz', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('boards', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return this.db;
    },
    async all() { try { const db = await this.open(); return await req(db.transaction('boards', 'readonly').objectStore('boards').getAll()); } catch { return []; } },
    async del(id) { const db = await this.open(); return req(db.transaction('boards', 'readwrite').objectStore('boards').delete(id)); },
  };
  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  // ---------- Zustand ----------
  let me = null; // { id, username }
  let board = null;
  let view = 'netz';
  let netMode = 'move';
  let placing = null; // {draft, isNew} oder {charId}
  let focusChar = null;
  let tableSort = { key: 'name', dir: 1 };
  let tableFilter = '';
  let routeSeq = 0;
  let joinedNotice = false;
  const netT = new Map();
  const mapT = new Map();
  // Auswahl im Charakternetz (je Board, nur in diesem Fenster): Fraktionen, einzelne Charaktere,
  // jeweils mit/ohne verbundene Charaktere, Status (beide / lebende / verstorbene)
  const focusStates = new Map();
  function focusOf(bid) {
    if (!focusStates.has(bid)) focusStates.set(bid, { factions: new Set(), chars: new Set(), fNb: false, cNb: true, life: 'all', open: false });
    return focusStates.get(bid);
  }

  // Rechte: Nur der Ersteller darf bearbeiten. Der Server prüft das zusätzlich per Row Level Security.
  const canEdit = () => !!(board && me && board.ownerId === me.id);

  const byId = (id) => board.characters.find((c) => c.id === id);
  const byLink = (id) => board.links.find((l) => l.id === id);
  const byFaction = (id) => (id ? board.factions.find((f) => f.id === id) : null);
  const newChar = (x, y) => ({ id: uid(), name: '', short: '', info: '', image: null, imagePath: null, place: '', x, y, mapPos: null, factionIds: [], dead: false });
  const factionsOf = (c) => (c.factionIds || []).map(byFaction).filter(Boolean);
  // Farben eines Charakters: die Farben seiner Fraktionen (keine = neutral). Verstorbene behalten ihre Farben
  // und werden über die Klasse „dead“ verblasst/halbdurchsichtig dargestellt.
  function colorsOf(c) {
    return factionsOf(c).map((f) => f.color).filter((x) => COLOR_RE.test(x));
  }
  const paint = (node, color) => { if (color) node.style.setProperty('--c', color); else node.style.removeProperty('--c'); return node; };
  // Mehrere Farben: harte Farbabschnitte für Text (waagerecht) und Rand (rundherum)
  const stops = (cols) => cols.map((c, i) => `${c} ${(i * 100 / cols.length).toFixed(2)}% ${((i + 1) * 100 / cols.length).toFixed(2)}%`).join(', ');
  function paintMany(node, cols) {
    paint(node, cols[0] || null);
    node.classList.toggle('multi', cols.length > 1);
    if (cols.length > 1) {
      node.style.setProperty('--grad-h', `linear-gradient(90deg, ${stops(cols)})`);
      node.style.setProperty('--grad-c', `conic-gradient(${stops(cols)})`);
    } else { node.style.removeProperty('--grad-h'); node.style.removeProperty('--grad-c'); }
    return node;
  }
  const colorName = (c, cls = 'colored') => paintMany(el('span', { class: cls + (c.dead ? ' is-dead' : ''), text: displayName(c) }), colorsOf(c));
  const factionTag = (f) => paint(el('span', { class: 'tag' }, el('span', { class: 'dot' }), el('span', { text: f.name })), f.color);
  function degrees() {
    const m = new Map();
    for (const l of board.links) { m.set(l.a, (m.get(l.a) || 0) + 1); m.set(l.b, (m.get(l.b) || 0) + 1); }
    return m;
  }
  const displayName = (c) => (c.dead ? c.name + ' †' : c.name);

  // Server-Aktion ausführen; bei Fehler Meldung zeigen und Board neu laden
  async function persist(fn) {
    try { return await fn(); } catch (e) {
      toast(errMsg(e));
      if (board) { const id = board.id; board = null; if (location.hash.includes(id)) route(); }
      throw e;
    }
  }
  const mustAffect = (rows) => { if (!rows || !rows.length) throw denied(); return rows; };

  // ---------- Navigation ----------
  function go(id, v) {
    const h = id ? `#/b/${encodeURIComponent(id)}/${v}` : '#/';
    if (location.hash === h) route(); else location.hash = h;
  }
  function showLoading(text = 'Lädt …') { $('#app').replaceChildren(el('p', { class: 'loading', text })); }
  async function route() {
    const seq = ++routeSeq;
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    if (!me) {
      if ((parts[0] === 's' || parts[0] === 'b') && parts[1]) setPending(location.hash);
      showAuth();
      return;
    }
    if (parts[0] === 's') { await openShare(parts[1], parts[2], seq); return; }
    if (parts[0] === 'b' && UUID_RE.test(parts[1] || '')) {
      const id = parts[1].toLowerCase();
      if (!board || board.id !== id) {
        showLoading('Board wird geladen …');
        let b = null;
        try { b = await loadBoard(id); } catch (e) { if (seq !== routeSeq) return; toast(errMsg(e)); go(null); return; }
        if (seq !== routeSeq) return;
        if (!b) { toast('Board nicht gefunden oder du hast keinen Zugriff darauf.'); go(null); return; }
        board = b;
        if (joinedNotice) { joinedNotice = false; if (!canEdit()) toast(`„${b.name}“ wurde zu „Mit mir geteilt“ hinzugefügt.`); }
        if (!canEdit()) sb.from('board_visits').update({ visited_at: new Date().toISOString() }).eq('user_id', me.id).eq('board_id', id).then(() => {}, () => {});
      }
      view = VIEWS.includes(parts[2]) ? parts[2] : 'netz';
      if (view !== 'karte' && placing) placing = null;
      renderBoard();
    } else {
      showHome();
    }
  }
  async function openShare(bid, token, seq) {
    if (!UUID_RE.test(bid || '') || !UUID_RE.test(token || '')) { toast('Dieser Link ist ungültig.'); go(null); return; }
    showLoading('Geteiltes Board wird geöffnet …');
    try {
      const id = await q(sb.rpc('open_shared_board', { p_board: bid, p_token: token }));
      if (seq !== routeSeq) return;
      if (!id) { toast('Dieser Link ist ungültig oder wurde vom Ersteller zurückgesetzt.'); go(null); return; }
      board = null; joinedNotice = true;
      location.replace(`#/b/${id}/netz`); // Link mit Schlüssel nicht im Verlauf behalten
    } catch (e) { toast(errMsg(e)); go(null); }
  }

  // ---------- Dialoge ----------
  let currentModal = null;
  function closeModal() {
    if (!currentModal) return;
    const cb = currentModal._onClose; currentModal.remove(); currentModal = null;
    if (cb) cb();
  }
  function modal(title, body, actions = [], opts = {}) {
    closeModal();
    const box = el('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'modal-head' }, el('h2', { text: title }), opts.locked ? null : el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', text: '✕', onclick: closeModal })),
      el('div', { class: 'modal-body' }, body),
      actions.length ? el('div', { class: 'modal-actions' }, actions) : null);
    const back = el('div', { class: 'backdrop' }, box);
    if (!opts.locked) back.addEventListener('pointerdown', (e) => { if (e.target === back) closeModal(); });
    back.dataset.locked = opts.locked ? '1' : '';
    document.body.append(back);
    currentModal = back;
    const f = box.querySelector('.modal-body input:not([type=file]):not([type=checkbox]):not([readonly]), .modal-body textarea');
    if (f) f.focus();
    return box;
  }
  function confirmBox(title, text, yesLabel, onYes) {
    const yes = btn(yesLabel, () => busy(yes, async () => { await onYes(); closeModal(); }).catch((e) => toast(errMsg(e))), 'primary');
    modal(title, el('p', { text }), [btn('Abbrechen', closeModal, 'ghost'), yes]);
  }
  function askText(title, label, value, onOk) {
    const inp = el('input', { type: 'text', value, maxlength: 100 });
    const okBtn = btn('OK', () => ok(), 'primary');
    const ok = () => {
      const v = inp.value.trim();
      if (!v) { toast('Bitte einen Namen eingeben.'); return; }
      busy(okBtn, async () => { await onOk(v); closeModal(); }).catch((e) => toast(errMsg(e)));
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !imeEnter(e)) ok(); });
    modal(title, el('div', { class: 'form' }, field(label, inp)), [btn('Abbrechen', closeModal, 'ghost'), okBtn]);
  }

  // ---------- Anmeldung / Registrierung ----------
  // Gemeinsame Passwort-Regeln für Registrierung und Passwort-Änderung
  function passwordProblem(p, name) {
    if (p.length < 8) return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
    if (new TextEncoder().encode(p).length > 72) return 'Das Passwort ist zu lang (höchstens 72 Zeichen).';
    if (name && fold(p).includes(fold(name))) return 'Das Passwort darf den Benutzernamen nicht enthalten.';
    if (/^(.)\1+$/.test(p) || /^(12345678|password|passwort|qwertz|qwerty)/i.test(p)) return 'Dieses Passwort ist zu leicht zu erraten.';
    return null;
  }
  function showAuth(mode = 'auto') {
    board = null; placing = null; closeModal();
    if (!CONFIGURED) {
      $('#app').replaceChildren(el('main', { class: 'auth' }, el('div', { class: 'auth-card' },
        el('h1', { text: 'Charakter-Netz' }),
        el('p', { text: 'Die App ist noch nicht mit dem Server verbunden. Trage in config.js die Supabase-URL und den anon key ein.' }))));
      return;
    }
    const pending = getPending();
    const invite = !!pending && pending.startsWith('#/s/');
    if (invite && mode === 'auto') mode = 'register'; // Einladung: meist ist man neu
    if (mode === 'auto') mode = 'login';
    const isReg = mode === 'register';
    const user = el('input', { type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: 24, required: true, placeholder: 'z. B. tim_schreibt' });
    const pw = el('input', { type: 'password', name: 'password', autocomplete: isReg ? 'new-password' : 'current-password', maxlength: 72, required: true, minlength: isReg ? 8 : null });
    const pw2 = isReg ? el('input', { type: 'password', name: 'password2', autocomplete: 'new-password', maxlength: 72, required: true }) : null;
    const remember = el('input', { type: 'checkbox', checked: store(REMEMBER_KEY) ? store(REMEMBER_KEY) === '1' : isStandalone() });
    const err = el('p', { class: 'form-error', role: 'alert' });
    const submit = el('button', { class: 'btn primary wide', type: 'submit' }, isReg ? 'Konto erstellen' : 'Anmelden');
    const form = el('form', { class: 'form', novalidate: true },
      field('Benutzername', user),
      isReg ? el('small', { class: 'muted', text: '2–24 Zeichen: Buchstaben, Zahlen, japanische Schrift (Hiragana, Katakana, Kanji), Punkt, Unter- und Bindestrich. Groß-/Kleinschreibung spielt keine Rolle.' }) : null,
      field('Passwort', pw),
      isReg ? field('Passwort wiederholen', pw2) : null,
      isReg ? el('small', { class: 'muted', text: 'Mindestens 8 Zeichen. Es gibt keine E-Mail-Wiederherstellung – merke dir dein Passwort gut.' }) : null,
      el('label', { class: 'check' }, remember, el('span', { text: 'Angemeldet bleiben' })),
      el('small', { class: 'muted', text: 'Nur auf deinen eigenen Geräten aktivieren. Ohne Haken endet die Anmeldung, wenn du das Fenster schließt.' }),
      err, submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      err.textContent = '';
      const name = normUser(user.value);
      const p = pw.value;
      if (!USERNAME_RE.test(name)) { err.textContent = 'Der Benutzername muss 2–24 Zeichen lang sein und darf nur Buchstaben, Zahlen, japanische Schriftzeichen (Hiragana, Katakana, Kanji), Punkt, Unter- und Bindestrich enthalten.'; user.focus(); return; }
      if (isReg) {
        const prob = passwordProblem(p, name);
        if (prob) { err.textContent = prob; pw.focus(); return; }
        if (p !== pw2.value) { err.textContent = 'Die beiden Passwörter stimmen nicht überein.'; pw2.focus(); return; }
      } else if (!p) { err.textContent = 'Bitte das Passwort eingeben.'; pw.focus(); return; }
      store(REMEMBER_KEY, remember.checked ? '1' : '0');
      busy(submit, async () => {
        try {
          if (isReg) {
            const { data, error } = await sb.auth.signUp({ email: await emailFor(name), password: p, options: { data: { username: name } } });
            if (error) throw error;
            if (!data.session) throw new UErr('Das Konto wurde angelegt, aber die E-Mail-Bestätigung ist in Supabase noch aktiv. Bitte „Confirm email“ ausschalten.');
          } else {
            const { error } = await sb.auth.signInWithPassword({ email: await emailFor(name), password: p });
            if (error) throw error;
          }
          await afterLogin(isReg);
        } catch (e2) { err.textContent = errMsg(e2); }
      });
    });
    $('#app').replaceChildren(
      el('header', { class: 'topbar' },
        el('div', { class: 'brand' }, el('img', { src: 'icon.svg', alt: '', class: 'logo' }), el('span', { text: 'Charakter-Netz' })),
        el('div', { class: 'spacer' }), themeButton(), appShareButton(), installButton()),
      el('main', { class: 'auth' }, el('div', { class: 'auth-card' },
        invite ? inviteBox(isReg) : (pending ? el('div', { class: 'banner invite' }, el('span', { text: 'Bitte melde dich an, um das Board zu öffnen.' })) : null),
        el('div', { class: 'tabs', role: 'tablist' },
          el('button', { class: 'tab' + (isReg ? '' : ' active'), type: 'button', role: 'tab', 'aria-selected': String(!isReg), onclick: () => showAuth('login') }, 'Anmelden'),
          el('button', { class: 'tab' + (isReg ? ' active' : ''), type: 'button', role: 'tab', 'aria-selected': String(isReg), onclick: () => showAuth('register') }, 'Registrieren')),
        form)));
    // Bei Einladungen nicht sofort die Handy-Tastatur öffnen, damit die Schritte sichtbar bleiben
    if (!invite || matchMedia('(pointer: fine)').matches) user.focus();
  }
  // Schritte für Eingeladene: App installieren (falls möglich) -> Konto -> Board wird angehängt
  let installedNow = false;
  let onInstallChange = null;
  function inviteBox(isReg) {
    const box = el('div', { class: 'banner invite invite-box' });
    const draw = () => {
      const steps = [];
      if (!isStandalone()) {
        let body;
        if (installedNow) body = [el('p', { text: '✓ Installiert! Öffne Charakter-Netz jetzt über das neue Symbol – deine Einladung wartet dort. Du kannst auch hier im Browser weitermachen.' })];
        else if (inAppBrowser) body = [el('p', { text: 'Du bist im Browser einer App (z. B. WhatsApp). Öffne den Link über „⋮“ bzw. das Teilen-Symbol mit „Im Browser öffnen“ – nur dort lässt sich die App installieren.' })];
        else if (isIOS) body = [el('p', { text: 'iPhone/iPad: Erstelle zuerst hier dein Konto (nächster Schritt) – das Board wird sofort deinem Konto angehängt. Danach in Safari auf Teilen (□↑) → „Zum Home-Bildschirm“ und in der App anmelden.' })];
        else if (installEvt) body = [el('p', { text: 'Mit eigenem Symbol auf dem Startbildschirm bzw. Desktop. Danach geht es direkt in der App weiter.' }), btn('App installieren', doInstall, 'primary small')];
        else body = [el('p', { text: 'Optional: Charakter-Netz mit eigenem Symbol starten.' }), btn('So installierst du die App', showInstallHelp, 'small')];
        steps.push(el('li', {}, el('strong', { text: 'App installieren (empfohlen)' }), ...body));
      }
      steps.push(el('li', {}, el('strong', { text: isReg ? 'Konto erstellen' : 'Anmelden' }),
        el('p', { text: isReg ? 'Neu hier? Wähle unten Benutzername und Passwort. Schon ein Konto? Dann auf „Anmelden“ tippen.' : 'Mit deinem bestehenden Konto. Neu hier? Dann auf „Registrieren“ tippen.' })));
      steps.push(el('li', {}, el('strong', { text: 'Board ansehen' }),
        el('p', { text: 'Das Board wird automatisch zu „Mit mir geteilt“ hinzugefügt und geöffnet.' })));
      box.replaceChildren(el('p', { class: 'invite-title', text: '📨 Dir wurde ein Board geteilt' }), el('ol', { class: 'steps' }, steps));
    };
    draw();
    onInstallChange = () => { if (!box.isConnected) { onInstallChange = null; return false; } draw(); return true; };
    return box;
  }
  async function loadMe() {
    const { data } = await sb.auth.getSession();
    const s = data && data.session;
    if (!s) { me = null; return; }
    const p = await q(sb.from('profiles').select('id,username').eq('id', s.user.id).maybeSingle());
    me = p ? { id: p.id, username: p.username } : null;
    if (!me) { await sb.auth.signOut({ scope: 'local' }).catch(() => {}); }
  }
  async function afterLogin(isNew) {
    await loadMe();
    if (!me) throw new UErr('Das Profil konnte nicht geladen werden. Bitte versuche es erneut.');
    toast(isNew ? `Willkommen, ${me.username}!` : `Angemeldet als ${me.username}.`);
    const pending = getPending();
    clearPending();
    if (pending && pending !== location.hash) location.hash = pending; else await route();
    setTimeout(() => offerMigration(false), 400);
  }
  async function logout() {
    closeModal();
    clearSessionState();
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    location.hash = '#/';
    showAuth();
    toast('Du wurdest abgemeldet.');
  }
  function clearSessionState() {
    me = null; board = null; placing = null; focusChar = null; tableFilter = ''; urlCache.clear(); netT.clear(); mapT.clear();
    clearPending();
  }

  // ---------- Konto ----------
  function accountDialog() {
    const cur = el('input', { type: 'password', autocomplete: 'current-password', maxlength: 72 });
    const n1 = el('input', { type: 'password', autocomplete: 'new-password', maxlength: 72 });
    const n2 = el('input', { type: 'password', autocomplete: 'new-password', maxlength: 72 });
    const chg = btn('Passwort ändern', () => {
      if (!cur.value) { toast('Bitte das aktuelle Passwort eingeben.'); cur.focus(); return; }
      const prob = passwordProblem(n1.value, me.username);
      if (prob) { toast(prob); n1.focus(); return; }
      if (n1.value !== n2.value) { toast('Die neuen Passwörter stimmen nicht überein.'); return; }
      busy(chg, async () => {
        // Aktuelles Passwort prüfen, bevor es geändert wird
        const { error: e1 } = await sb.auth.signInWithPassword({ email: await emailFor(me.username), password: cur.value });
        if (e1) throw e1;
        const { error: e2 } = await sb.auth.updateUser({ password: n1.value });
        if (e2) throw e2;
        cur.value = n1.value = n2.value = '';
        toast('Passwort geändert.');
      }).catch((e) => toast(errMsg(e)));
    }, 'small');
    modal('Mein Konto', el('div', { class: 'form' },
      el('p', {}, 'Angemeldet als ', el('strong', { text: me.username }), el('span', { class: 'muted', text: ` · Version ${APP_VERSION}` })),
      el('fieldset', {}, el('legend', { text: 'Passwort ändern' }),
        field('Aktuelles Passwort', cur), field('Neues Passwort (mind. 8 Zeichen)', n1), field('Neues Passwort wiederholen', n2), chg),
      el('fieldset', {}, el('legend', { text: 'Konto löschen' }),
        el('p', { class: 'muted', text: 'Löscht dein Konto mit allen deinen Boards, Charakteren und Bildern endgültig. Geteilte Links funktionieren danach nicht mehr.' }),
        btn('Konto löschen …', deleteAccountDialog, 'small danger'))),
    [btn('Abmelden', logout, 'ghost danger left'), btn('Schließen', closeModal, 'primary')]);
  }
  function deleteAccountDialog() {
    const name = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    const pw = el('input', { type: 'password', autocomplete: 'current-password' });
    const go2 = btn('Endgültig löschen', () => busy(go2, async () => {
      if (fold(normUser(name.value)) !== fold(me.username)) throw new UErr('Bitte gib zur Bestätigung deinen Benutzernamen ein.');
      const { error } = await sb.auth.signInWithPassword({ email: await emailFor(me.username), password: pw.value });
      if (error) throw error;
      const mine = await q(sb.from('boards').select('id').eq('owner_id', me.id));
      for (const b of mine) await removeImages(await listBoardFiles(b.id));
      await q(sb.rpc('delete_my_account'));
      store(`cn-migrate-asked-${me.id}`, null); store(`cn-migrated-${me.id}`, null);
      clearSessionState();
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      closeModal(); location.hash = '#/'; showAuth();
      toast('Dein Konto wurde gelöscht.');
    }).catch((e) => toast(errMsg(e))), 'primary danger-bg');
    modal('Konto endgültig löschen?', el('div', { class: 'form' },
      el('p', { text: 'Das kann nicht rückgängig gemacht werden. Exportiere vorher Boards, die du behalten möchtest.' }),
      field(`Benutzername zur Bestätigung („${me.username}“)`, name), field('Passwort', pw)),
    [btn('Abbrechen', accountDialog, 'ghost'), go2]);
  }

  // ---------- Startseite ----------
  function topbarHome() {
    return el('header', { class: 'topbar' },
      el('div', { class: 'brand' }, el('img', { src: 'icon.svg', alt: '', class: 'logo' }), el('span', { class: 'hide-xs', text: 'Charakter-Netz' })),
      el('div', { class: 'spacer' }), themeButton(), appShareButton(), installButton(),
      el('button', { class: 'btn ghost small user-btn', type: 'button', onclick: accountDialog, title: 'Mein Konto' }, '👤 ', el('span', { text: me.username })));
  }
  async function showHome() {
    const seq = routeSeq;
    board = null; placing = null; closeModal();
    showLoading('Boards werden geladen …');
    let mine = [], shared = [], local = [];
    try {
      [mine, shared, local] = await Promise.all([
        q(sb.from('boards').select(BOARD_COLS + ',characters(count),links(count)').eq('owner_id', me.id).order('updated_at', { ascending: false })),
        q(sb.from('board_visits').select('board_id,visited_at,board:boards!board_visits_board_id_fkey(id,name,updated_at,owner:profiles!boards_owner_id_fkey(username))').eq('user_id', me.id).order('visited_at', { ascending: false })),
        LocalDB.all(),
      ]);
    } catch (e) {
      if (seq !== routeSeq) return;
      $('#app').replaceChildren(topbarHome(), el('main', { class: 'home' },
        el('p', { class: 'empty', text: errMsg(e) }), btn('Erneut versuchen', () => route(), 'primary')));
      return;
    }
    if (seq !== routeSeq) return;
    const count = (x) => (Array.isArray(x) && x[0] ? x[0].count : 0);

    const myList = el('div', { class: 'board-list' });
    if (!mine.length) myList.append(el('p', { class: 'empty', text: 'Noch keine eigenen Boards. Erstelle dein erstes Board!' }));
    for (const b of mine) {
      myList.append(el('div', { class: 'board-card' },
        el('button', { class: 'board-open', type: 'button', onclick: () => go(b.id, 'netz') },
          el('h3', { text: b.name }),
          el('p', { text: `${count(b.characters)} Charaktere · ${count(b.links)} Verbindungen` }),
          el('small', { text: 'Geändert: ' + new Date(b.updated_at).toLocaleString('de-DE') })),
        el('div', { class: 'board-tools' },
          btn('📤 Einladen', () => shareDialog(b.id, b.name), 'ghost small'),
          btn('Umbenennen', () => askText('Board umbenennen', 'Name', b.name, async (v) => {
            mustAffect(await q(sb.from('boards').update({ name: v }).eq('id', b.id).select('id'))); showHome();
          }), 'ghost small'),
          btn('Exportieren', (e) => busy(e.currentTarget, () => exportBoard(b.id)).catch((er) => toast(errMsg(er))), 'ghost small'),
          btn('Löschen', () => confirmBox('Board löschen?', `„${b.name}“ wird mit allen Charakteren, Bildern und Freigaben unwiderruflich gelöscht.`, 'Löschen', async () => {
            await deleteBoardFully(b.id); toast('Board gelöscht.'); showHome();
          }), 'ghost small danger'))));
    }

    const shList = el('div', { class: 'board-list' });
    const sharedOk = shared.filter((v) => v.board);
    if (!sharedOk.length) shList.append(el('p', { class: 'empty', text: 'Hier erscheinen Boards, die dir jemand per Link geteilt hat.' }));
    for (const v of sharedOk) {
      const b = v.board;
      shList.append(el('div', { class: 'board-card shared' },
        el('button', { class: 'board-open', type: 'button', onclick: () => go(b.id, 'netz') },
          el('h3', { text: b.name }),
          el('p', { text: 'von ' + ((b.owner && b.owner.username) || 'unbekannt') + ' · nur ansehen' }),
          el('small', { text: 'Zuletzt besucht: ' + new Date(v.visited_at).toLocaleString('de-DE') })),
        el('div', { class: 'board-tools' },
          btn('Aus Liste entfernen', () => confirmBox('Aus der Liste entfernen?', `„${b.name}“ verschwindet aus „Mit mir geteilt“. Über den Link kannst du es später wieder öffnen.`, 'Entfernen', async () => {
            await q(sb.from('board_visits').delete().eq('user_id', me.id).eq('board_id', b.id)); showHome();
          }), 'ghost small'))));
    }

    const migrated = new Set(readIdList(`cn-migrated-${me.id}`));
    const localOpen = local.filter((b) => !migrated.has(b.id));
    const imp = el('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', onchange: (e) => { const f = imp.files[0]; const lbl = e.target.closest('label'); imp.value = ''; importBoard(f, lbl); } });
    $('#app').replaceChildren(
      topbarHome(),
      el('main', { class: 'home' },
        localOpen.length ? el('div', { class: 'banner' },
          el('span', { text: `In diesem Browser liegen noch ${localOpen.length} Board(s) aus der alten Version.` }),
          btn('In mein Konto übernehmen', () => offerMigration(true), 'small primary')) : null,
        el('div', { class: 'home-head' }, el('h1', { text: 'Meine Boards' }),
          el('div', { class: 'row' }, el('label', { class: 'btn' }, 'Importieren', imp), btn('+ Neues Board', newBoard, 'primary'))),
        myList,
        el('div', { class: 'home-head' }, el('h1', { text: 'Mit mir geteilt' })),
        shList,
        el('p', { class: 'note', text: 'Deine Boards werden in deinem Konto gespeichert. Nur du kannst sie bearbeiten. Wer deinen Freigabe-Link hat und angemeldet ist, kann sie ansehen.' })));
  }
  function newBoard() {
    askText('Neues Board', 'Name des Boards', '', async (name) => {
      const [b] = await q(sb.from('boards').insert({ name }).select('id'));
      go(b.id, 'netz');
    });
  }

  // ---------- Teilen ----------
  // Teilen-Knöpfe: Teilen-Menü des Geräts (WhatsApp, Discord, Telegram, Mail … – alles, was installiert ist)
  // plus direkte Wege als Rückfall. get() liefert jeweils den aktuellen { title, text, url }.
  function shareButtons(get) {
    const msg = () => { const d = get(); return `${d.text} ${d.url}`; };
    const copy = async (silent) => {
      const { url } = get();
      try { await navigator.clipboard.writeText(url); if (!silent) toast('Link kopiert.'); return true; } catch { toast('Kopieren ging nicht – bitte den Link oben markieren und kopieren.'); return false; }
    };
    const native = async () => {
      const d = get();
      try { await navigator.share({ title: d.title, text: d.text, url: d.url }); } catch (e) { if (e && e.name !== 'AbortError') copy(); }
    };
    const ext = (label, href, cls = '') => {
      const a = el('a', { class: 'btn small share-opt ' + cls, target: '_blank', rel: 'noopener noreferrer', href: '#' }, label);
      a.addEventListener('click', () => a.setAttribute('href', href())); // immer mit dem aktuellen Link
      a.setAttribute('href', href());
      return a;
    };
    const discord = btn('Discord', async () => {
      if (await copy(true)) toast('Link kopiert – in Discord einfach in den Chat einfügen.');
      window.open('https://discord.com/channels/@me', '_blank', 'noopener,noreferrer');
    }, 'small share-opt');
    return el('div', { class: 'share-box' },
      navigator.share ? btn('📤 Teilen … (WhatsApp, Discord, Mail …)', native, 'primary wide') : null,
      el('div', { class: 'share-grid' },
        ext('WhatsApp', () => 'https://api.whatsapp.com/send?text=' + encodeURIComponent(msg())),
        ext('Telegram', () => 'https://t.me/share/url?url=' + encodeURIComponent(get().url) + '&text=' + encodeURIComponent(get().text)),
        discord,
        ext('E-Mail', () => 'mailto:?subject=' + encodeURIComponent(get().title) + '&body=' + encodeURIComponent(msg())),
        isMobileDevice ? ext('SMS', () => 'sms:?&body=' + encodeURIComponent(msg())) : null,
        btn('🔗 Link kopieren', () => copy(false), navigator.share ? 'small share-opt' : 'small share-opt primary')));
  }
  const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const appUrl = () => location.origin + location.pathname;

  // Die App allgemein weiterempfehlen (ohne Board) – darf jeder
  function shareAppDialog() {
    const url = appUrl();
    const inp = el('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Link zur App' });
    inp.addEventListener('focus', () => inp.select());
    modal('Charakter-Netz weiterempfehlen', el('div', { class: 'form' },
      el('p', { text: 'Teile den Link zur App. Damit lädst du niemanden zu einem Board ein – jeder kann sich ein eigenes Konto anlegen.' }),
      inp,
      shareButtons(() => ({ title: 'Charakter-Netz', text: 'Schau dir Charakter-Netz an – Charaktere, Beziehungen und Weltkarten für deine Kampagne:', url }))),
    [btn('Fertig', closeModal, 'primary')]);
  }

  // Zu einem Board einladen – nur der Ersteller (der Server gibt den Freigabe-Schlüssel nur ihm heraus)
  async function shareDialog(bid, name) {
    let token;
    try { token = await q(sb.rpc('get_share_token', { p_board: bid })); } catch (e) { toast(errMsg(e)); return; }
    if (!token) { toast('Nur der Ersteller kann zu diesem Board einladen.'); return; }
    const linkOf = (t) => `${appUrl()}#/s/${bid}/${t}`;
    let link = linkOf(token);
    const inp = el('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Einladungslink' });
    inp.addEventListener('focus', () => inp.select());
    const visitors = el('ul', { class: 'link-list' }, el('li', { class: 'muted', text: 'Lädt …' }));
    const loadVisitors = async () => {
      try {
        const v = await q(sb.from('board_visits').select('visited_at,user:profiles!board_visits_user_id_fkey(username)').eq('board_id', bid).order('visited_at', { ascending: false }));
        visitors.replaceChildren(...(v.length ? v.map((x) => el('li', {}, el('strong', { text: (x.user && x.user.username) || '?' }), el('span', { class: 'muted', text: ' · ' + new Date(x.visited_at).toLocaleDateString('de-DE') })))
          : [el('li', { class: 'muted', text: 'Noch niemand hat das Board über den Link geöffnet.' })]));
      } catch { visitors.replaceChildren(el('li', { class: 'muted', text: 'Konnte nicht geladen werden.' })); }
    };
    const reset = (removeAll) => async () => {
      const t = await q(sb.rpc('reset_share_link', { p_board: bid, p_remove_visitors: removeAll }));
      link = linkOf(t); inp.value = link;
      toast(removeAll ? 'Neuer Link erstellt, alle Besucher entfernt.' : 'Neuer Link erstellt. Der alte Link funktioniert nicht mehr.');
      loadVisitors();
    };
    const r1 = btn('Neuen Link erzeugen', () => busy(r1, reset(false)).catch((e) => toast(errMsg(e))), 'ghost small');
    const r2 = btn('Neuer Link + alle Besucher entfernen', () => busy(r2, reset(true)).catch((e) => toast(errMsg(e))), 'ghost small danger');
    modal('Zum Board einladen', el('div', { class: 'form' },
      el('p', { text: `Schicke diesen Link an Mitspieler. Wer ihn öffnet, installiert bei Bedarf die App, meldet sich an oder registriert sich – danach ist „${name}“ in seinem Konto unter „Mit mir geteilt“ (nur ansehen).` }),
      inp,
      shareButtons(() => ({ title: `Einladung: ${name}`, text: `Ich lade dich zu meinem Board „${name}“ in Charakter-Netz ein:`, url: link })),
      el('fieldset', {}, el('legend', { text: 'Wer hat Zugriff?' }), visitors,
        el('p', { class: 'muted', text: 'Wenn der Link in falsche Hände geraten ist: Erzeuge einen neuen Link. Der alte wird sofort ungültig.' }),
        el('div', { class: 'row' }, r1, r2)))
    , [btn('Fertig', closeModal, 'primary')]);
    loadVisitors();
  }

  // ---------- Import / Export ----------
  async function exportBoard(bid) {
    toast('Export wird vorbereitet …');
    const b = await loadBoard(bid, false);
    if (!b) throw denied();
    const dl = async (p) => {
      if (!p) return null;
      const { data, error } = await sb.storage.from(BUCKET).download(p);
      if (error) return null;
      return blobToDataUrl(data);
    };
    const map = b.map ? { src: await dl(b.map.path), w: b.map.w, h: b.map.h } : null;
    const characters = [];
    for (const c of b.characters) characters.push({ id: c.id, name: c.name, short: c.short, info: c.info, image: await dl(c.imagePath), place: c.place, x: c.x, y: c.y, mapPos: c.mapPos, factions: c.factionIds, dead: c.dead });
    const out = { format: 'charakter-netz', version: 2, id: b.id, name: b.name, created: Date.parse(b.created), updated: Date.parse(b.updated), map: map && map.src ? map : null, factions: b.factions, characters, links: b.links };
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: (b.name.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim() || 'board') + '.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function importBoard(file, label) {
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) { toast('Die Datei ist zu groß.'); return; }
    try {
      const o = sanitizeBoard(JSON.parse(await file.text()));
      if (label) label.classList.add('busy');
      toast('Board wird importiert …');
      await uploadBoardObject(o);
      toast('Board importiert.');
      showHome();
    } catch (e) { toast('Import fehlgeschlagen: ' + (e instanceof SyntaxError ? 'Keine gültige Board-Datei.' : errMsg(e))); } finally { if (label) label.classList.remove('busy'); }
  }
  // Importierte / lokale Daten streng prüfen
  function sanitizeBoard(o) {
    const str = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');
    const img = (s) => (typeof s === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : null);
    const num = (n) => (Number.isFinite(n) ? clamp(n, -1e6, 1e6) : 0);
    if (!o || typeof o !== 'object' || !Array.isArray(o.characters)) throw new UErr('Keine gültige Board-Datei.');
    const fMap = new Map();
    const factions = (Array.isArray(o.factions) ? o.factions : []).slice(0, 50)
      .filter((f) => f && typeof f.name === 'string' && f.name.trim() && COLOR_RE.test(f.color))
      .map((f) => { const id = uid(); fMap.set(f.id, id); return { id, name: str(f.name, 60).trim(), color: f.color.toLowerCase() }; });
    const idMap = new Map();
    const characters = o.characters.slice(0, 2000).map((c) => {
      const id = uid(); idMap.set(c && c.id, id);
      const mp = c && c.mapPos && Number.isFinite(c.mapPos.x) && Number.isFinite(c.mapPos.y) ? { x: clamp(c.mapPos.x, 0, 1), y: clamp(c.mapPos.y, 0, 1) } : null;
      return { id, name: str(c && c.name, 100).trim() || 'Unbenannt', short: str(c && c.short, 300), info: str(c && c.info, 20000), image: img(c && c.image), place: str(c && c.place, 2000), x: Math.round(num(c && c.x)), y: Math.round(num(c && c.y)), mapPos: mp, factionIds: [...new Set((c && Array.isArray(c.factions) ? c.factions : (c && c.faction ? [c.faction] : [])).map((x) => fMap.get(x)).filter(Boolean))].slice(0, 10), dead: !!(c && c.dead === true) };
    });
    const seen = new Set();
    const links = (Array.isArray(o.links) ? o.links : []).slice(0, 10000)
      .filter((l) => l && idMap.has(l.a) && idMap.has(l.b) && l.a !== l.b)
      .map((l) => ({ id: uid(), a: idMap.get(l.a), b: idMap.get(l.b), short: str(l.short, 120).trim() || '…', long: str(l.long, 20000) }))
      .filter((l) => { const k = [l.a, l.b].sort().join(); if (seen.has(k)) return false; seen.add(k); return true; });
    const map = o.map && img(o.map.src) ? { src: o.map.src } : null;
    return { name: str(o.name, 100).trim() || 'Importiertes Board', map, factions, characters, links };
  }
  // Ein (geprüftes) Board im Format von Version 1 ins Konto hochladen
  async function uploadBoardObject(o, onProgress) {
    const [created] = await q(sb.from('boards').insert({ name: o.name }).select('id'));
    const bid = created.id;
    try {
      if (o.map) {
        const r = await readImage(dataUrlToBlob(o.map.src), 4096, 0.9);
        const p = await uploadImage(bid, r.blob, 'map-');
        mustAffect(await q(sb.from('boards').update({ map_path: p, map_w: r.w, map_h: r.h }).eq('id', bid).select('id')));
      }
      if (o.factions.length) await q(sb.from('factions').insert(o.factions.map((f) => ({ ...f, board_id: bid }))));
      const rows = new Array(o.characters.length);
      let done = 0, next = 0;
      const worker = async () => {
        while (next < o.characters.length) {
          const i = next++; const c = o.characters[i];
          let path = null;
          if (c.image) {
            let r = null;
            try { r = await readImage(dataUrlToBlob(c.image), 400); } catch { r = null; } // defektes Bild überspringen
            if (r) path = await uploadImage(bid, r.blob, 'p-');
          }
          rows[i] = charRow({ ...c, imagePath: path }, bid);
          done++; if (onProgress) onProgress(done, o.characters.length);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      for (const part of chunks(rows, 500)) await q(sb.from('characters').insert(part));
      const cfRows = o.characters.flatMap((c) => (c.factionIds || []).map((fid, i) => ({ board_id: bid, character_id: c.id, faction_id: fid, position: i })));
      for (const part of chunks(cfRows, 1000)) await q(sb.from('character_factions').insert(part));
      const lrows = o.links.map((l) => ({ id: l.id, board_id: bid, a: l.a, b: l.b, short: l.short, long: l.long }));
      for (const part of chunks(lrows, 1000)) await q(sb.from('links').insert(part));
      return bid;
    } catch (e) {
      await deleteBoardFully(bid).catch(() => {});
      throw e;
    }
  }

  // ---------- Übernahme der lokalen Boards aus Version 1 ----------
  async function offerMigration(manual) {
    if (!me) return;
    const askedKey = `cn-migrate-asked-${me.id}`;
    if (!manual && store(askedKey)) return;
    const migratedKey = `cn-migrated-${me.id}`;
    const migrated = new Set(readIdList(migratedKey));
    const local = (await LocalDB.all()).filter((b) => b && !migrated.has(b.id));
    if (!local.length) { if (manual) toast('Keine lokalen Boards gefunden.'); return; }
    if (currentModal && !manual) return;
    store(askedKey, '1');
    const boxes = local.map((b) => ({ b, cb: el('input', { type: 'checkbox', checked: true }) }));
    const status = el('p', { class: 'muted', role: 'status' });
    const up = btn('Hochladen', () => busy(up, async () => {
      const sel = boxes.filter((x) => x.cb.checked).map((x) => x.b);
      if (!sel.length) { toast('Bitte mindestens ein Board auswählen.'); return; }
      let ok = 0; const failed = [];
      for (const [i, lb] of sel.entries()) {
        try {
          status.textContent = `Board ${i + 1} von ${sel.length}: „${lb.name}“ …`;
          const o = sanitizeBoard(lb);
          await uploadBoardObject(o, (d, n) => { status.textContent = `Board ${i + 1} von ${sel.length}: „${lb.name}“ – Charakter ${d}/${n}`; });
          migrated.add(lb.id); store(migratedKey, JSON.stringify([...migrated])); ok++;
        } catch (e) { failed.push(`${lb.name}: ${errMsg(e)}`); }
      }
      const done = sel.filter((b) => migrated.has(b.id));
      modal('Übernahme abgeschlossen', el('div', { class: 'form' },
        el('p', { text: `${ok} von ${sel.length} Board(s) wurden in dein Konto übernommen.` }),
        failed.length ? el('ul', { class: 'help-list' }, failed.map((f) => el('li', { class: 'form-error', text: f }))) : null,
        done.length ? el('p', { class: 'muted', text: 'Die lokalen Kopien sind noch in diesem Browser gespeichert. Auf einem gemeinsam genutzten Gerät solltest du sie löschen.' }) : null),
      [done.length ? btn('Lokale Kopien löschen', async () => { for (const b of done) await LocalDB.del(b.id).catch(() => {}); toast('Lokale Kopien gelöscht.'); closeModal(); showHome(); }, 'ghost danger left') : null,
        btn('Fertig', () => { closeModal(); route(); }, 'primary')].filter(Boolean));
    }).catch((e) => toast(errMsg(e))), 'primary');
    modal('Lokale Boards übernehmen?', el('div', { class: 'form' },
      el('p', { text: 'In diesem Browser sind noch Boards aus der vorherigen Version gespeichert. Möchtest du sie in dein Konto hochladen? Danach kannst du sie auf allen Geräten nutzen und teilen.' }),
      el('div', { class: 'check-list' }, boxes.map(({ b, cb }) => el('label', { class: 'check' }, cb,
        el('span', {}, el('strong', { text: b.name || 'Unbenannt' }), el('span', { class: 'muted', text: ` · ${(b.characters || []).length} Charaktere` }))))),
      status),
    [btn('Später', closeModal, 'ghost'), up]);
  }

  // ---------- Board ----------
  // keepModal: einen inzwischen geöffneten anderen Dialog nicht schließen (z. B. nach langsamem Speichern)
  function renderBoard(keepModal = false) {
    if (!keepModal) closeModal();
    const items = [['tabelle', 'Tabelle', '▦'], ['netz', 'Charakternetz', '◉'], ['karte', 'Weltkarte', '◍']];
    const nav = el('nav', { class: 'sidenav', 'aria-label': 'Ansichten' }, items.map(([k, label, ico]) =>
      el('button', { class: 'nav-btn' + (k === view ? ' active' : ''), type: 'button', onclick: () => go(board.id, k), 'aria-current': k === view ? 'page' : null },
        el('span', { class: 'nav-ico', text: ico }), el('span', { text: label }))));
    const main = el('section', { class: 'view' });
    $('#app').replaceChildren(
      el('header', { class: 'topbar' },
        btn('← Boards', () => go(null), 'ghost small'),
        el('h1', { class: 'board-title', text: board.name }),
        canEdit() ? null : el('span', { class: 'badge', title: 'Du kannst dieses Board nur ansehen.', text: '👁 Nur ansehen' + (board.ownerName ? ' · von ' + board.ownerName : '') }),
        el('div', { class: 'spacer' }),
        canEdit() ? el('button', { class: 'btn small primary share-btn', type: 'button', title: 'Board teilen / einladen', 'aria-label': 'Board teilen', onclick: () => shareDialog(board.id, board.name) }, '📤', el('span', { class: 'lbl', text: ' Board teilen' })) : null,
        themeButton(), installButton()),
      el('div', { class: 'board-layout' }, nav, main));
    if (view === 'tabelle') renderTable(main);
    else if (view === 'karte') renderMap(main);
    else renderNet(main);
  }
  function avatarContent(c) {
    const src = safeSrc(c.image);
    return src ? el('img', { src, alt: '' }) : el('span', { text: initials(c.name) });
  }

  // ---------- Fraktionen verwalten ----------
  function factionDialog() {
    if (!canEdit()) return;
    let changed = false;
    const list = el('div', { class: 'faction-list' });
    const count = (fid) => board.characters.filter((c) => (c.factionIds || []).includes(fid)).length;
    const save = async (f, patch) => {
      try {
        mustAffect(await q(sb.from('factions').update(patch).eq('id', f.id).select('id')));
        Object.assign(f, patch); changed = true;
      } catch (e) { toast(errMsg(e)); }
    };
    function draw() {
      list.replaceChildren(...(board.factions.length ? board.factions.map((f) => {
        const color = el('input', { type: 'color', value: f.color, 'aria-label': 'Farbe von ' + f.name });
        color.addEventListener('change', () => { if (COLOR_RE.test(color.value)) save(f, { color: color.value.toLowerCase() }); });
        const name = el('input', { type: 'text', value: f.name, maxlength: 60, 'aria-label': 'Name der Fraktion' });
        name.addEventListener('change', () => { const v = name.value.trim(); if (!v) { name.value = f.name; return; } save(f, { name: v }); });
        let armed = false;
        const del = btn('Löschen', () => {
          if (!armed) { armed = true; del.textContent = 'Wirklich löschen?'; del.title = 'Charaktere verlieren dabei nur ihre Fraktion.'; setTimeout(() => { armed = false; del.textContent = 'Löschen'; }, 4000); return; }
          busy(del, async () => {
            try { mustAffect(await q(sb.from('factions').delete().eq('id', f.id).select('id'))); } catch (e) { toast(errMsg(e)); return; }
            board.factions = board.factions.filter((x) => x.id !== f.id);
            board.characters.forEach((c) => { c.factionIds = (c.factionIds || []).filter((x) => x !== f.id); });
            changed = true; draw();
          });
        }, 'ghost small danger');
        return el('div', { class: 'faction-row' }, color, name, el('span', { class: 'muted small', text: `${count(f.id)} Ch.` }), del);
      }) : [el('p', { class: 'muted', text: 'Noch keine Fraktionen. Lege unten die erste an.' })]));
    }
    const newColor = el('input', { type: 'color', value: FACTION_PALETTE[board.factions.length % FACTION_PALETTE.length], 'aria-label': 'Farbe' });
    const newName = el('input', { type: 'text', maxlength: 60, placeholder: 'z. B. Nordreich, Rebellen, Gilde' });
    const add = btn('+ Hinzufügen', () => {
      const v = newName.value.trim();
      if (!v) { toast('Bitte einen Namen für die Fraktion eingeben.'); newName.focus(); return; }
      if (board.factions.some((f) => fold(f.name) === fold(v))) { toast('Diese Fraktion gibt es schon.'); return; }
      busy(add, async () => {
        const f = { id: uid(), name: v, color: COLOR_RE.test(newColor.value) ? newColor.value.toLowerCase() : FACTION_PALETTE[0] };
        try { await q(sb.from('factions').insert({ ...f, board_id: board.id })); } catch (e) { toast(errMsg(e)); return; }
        board.factions.push(f); board.factions.sort(byName);
        changed = true; newName.value = ''; newColor.value = FACTION_PALETTE[board.factions.length % FACTION_PALETTE.length]; draw(); newName.focus();
      });
    }, 'primary small');
    newName.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !imeEnter(e)) add.click(); });
    draw();
    const box = modal('Fraktionen', el('div', { class: 'form' },
      el('p', { class: 'muted', text: 'Die Farbe einer Fraktion wird zur Randfarbe des Kreises und zur Farbe des Namens. Verstorbene Charaktere werden immer grau dargestellt.' }),
      list,
      el('fieldset', {}, el('legend', { text: 'Neue Fraktion' }), el('div', { class: 'faction-row' }, newColor, newName, add)))
    , [btn('Fertig', closeModal, 'primary')]);
    box.parentElement._onClose = () => { if (changed) renderBoard(); };
  }

  // ---------- Fraktions-Auswahl mit Vorschlägen ----------
  function nextFactionColor(extra = []) {
    const used = new Set([...board.factions, ...extra].map((f) => f.color.toLowerCase()));
    return FACTION_PALETTE.find((c) => !used.has(c)) || FACTION_PALETTE[(board.factions.length + extra.length) % FACTION_PALETTE.length];
  }
  function factionPicker(sel, onChange) {
    const pending = sel.filter((f) => f.isNew);
    const pool = () => [...board.factions, ...pending];
    const chips = el('div', { class: 'chips' });
    const input = el('input', { type: 'text', class: 'chip-input', maxlength: 60, autocomplete: 'off', spellcheck: 'false', placeholder: 'Fraktion hinzufügen …', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false' });
    const list = el('ul', { class: 'suggest', role: 'listbox', hidden: true });
    const wrapEl = el('div', { class: 'picker' }, chips, list);
    let items = []; let active = 0;
    const changed = () => { drawChips(); onChange(); };
    function drawChips() {
      chips.replaceChildren(...sel.map((f) => paint(el('span', { class: 'chip' }, el('span', { class: 'dot' }), el('span', { text: f.name }),
        el('button', { type: 'button', class: 'chip-x', 'aria-label': f.name + ' entfernen', onclick: () => { sel.splice(sel.indexOf(f), 1); changed(); input.focus(); } }, '×')), f.color)), input);
      input.placeholder = sel.length ? '' : 'Fraktion hinzufügen …';
    }
    function pick(it) {
      if (sel.length >= 10) { toast('Höchstens 10 Fraktionen pro Charakter.'); return; }
      if (it.create) {
        const name = it.create.slice(0, 60);
        const f = { id: uid(), name, color: nextFactionColor(pending), isNew: true };
        pending.push(f); sel.push(f);
      } else if (!sel.includes(it)) sel.push(it);
      input.value = ''; changed(); suggest(); input.focus();
    }
    function suggest() {
      const v = input.value.trim(); const lv = fold(v);
      items = pool().filter((f) => !sel.includes(f) && (!lv || fold(f.name).includes(lv)))
        .sort((x, y) => (fold(x.name).startsWith(lv) ? 0 : 1) - (fold(y.name).startsWith(lv) ? 0 : 1) || byName(x, y)).slice(0, 8);
      const exact = pool().find((f) => fold(f.name) === lv);
      if (v && !exact) items.push({ create: v });
      if (exact && !sel.includes(exact) && !items.includes(exact)) items.unshift(exact);
      active = 0;
      list.replaceChildren(...items.map((it, i) => {
        const li = it.create
          ? el('li', { role: 'option', class: 'new' }, el('span', { text: `+ Neue Fraktion „${it.create}“ anlegen` }))
          : paint(el('li', { role: 'option' }, el('span', { class: 'dot' }), el('span', { text: it.name })), it.color);
        li.classList.toggle('active', i === active);
        li.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(it); });
        return li;
      }));
      if (!items.length) list.append(el('li', { class: 'muted empty-opt', text: pool().length ? 'Alle Fraktionen sind schon ausgewählt.' : 'Noch keine Fraktionen – tippe einen Namen ein.' }));
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
    const hide = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
    const mark = () => [...list.children].forEach((li, i) => li.classList.toggle('active', i === active));
    input.addEventListener('focus', suggest);
    input.addEventListener('input', suggest);
    input.addEventListener('blur', () => setTimeout(hide, 120));
    input.addEventListener('keydown', (e) => {
      if (imeEnter(e)) return; // Umwandlung der japanischen Eingabe läuft noch
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; mark(); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; mark(); }
      else if (e.key === 'Enter' || e.key === ',') { if (items[active]) { e.preventDefault(); pick(items[active]); } }
      else if (e.key === 'Backspace' && !input.value && sel.length) { sel.pop(); changed(); suggest(); }
      else if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); hide(); }
    });
    chips.addEventListener('click', (e) => { if (e.target === chips) input.focus(); });
    drawChips();
    return wrapEl;
  }

  // ---------- Charakter: Erstellen / Bearbeiten ----------
  function charForm(src, isNew) {
    if (!canEdit()) return;
    const d = { ...src, mapPos: src.mapPos ? { ...src.mapPos } : null };
    const name = el('input', { type: 'text', value: d.name, maxlength: 100, placeholder: 'Name des Charakters' });
    const short = el('input', { type: 'text', value: d.short, maxlength: 300, placeholder: 'z. B. Junge Schmiedin aus dem Norden' });
    const info = el('textarea', { rows: 6, maxlength: 20000, placeholder: 'Ausführliche Infos: Aussehen, Geschichte, Eigenschaften …' });
    info.value = d.info;
    const place = el('textarea', { rows: 2, maxlength: 2000, placeholder: 'z. B. Lebt in der Hafenstadt Velmar' });
    place.value = d.place;
    // Fraktionen: ausgewählte Liste (bestehende + im Formular neu angelegte) bleibt auch beim Platzieren auf der Karte erhalten
    if (!d._fsel) d._fsel = (d.factionIds || []).map(byFaction).filter(Boolean);
    const dead = el('input', { type: 'checkbox', checked: !!d.dead });
    const preview = el('div', { class: 'avatar big' });
    const setPrev = () => {
      preview.replaceChildren(avatarContent({ ...d, name: name.value || d.name }));
      paintMany(preview, d._fsel.map((f) => f.color));
      preview.classList.toggle('dead', dead.checked);
    };
    const picker = factionPicker(d._fsel, setPrev);
    dead.addEventListener('change', setPrev);
    const rmImg = btn('Bild entfernen', () => { d.image = null; d._blob = null; d._rm = true; setPrev(); rmImg.hidden = true; }, 'ghost small danger');
    rmImg.hidden = !d.image;
    const file = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', onchange: async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      try { const r = await readImage(f, 400); d._blob = r.blob; d._rm = false; d.image = URL.createObjectURL(r.blob); setPrev(); rmImg.hidden = false; } catch (e) { toast(e.message); }
    } });
    name.addEventListener('input', () => { if (!d.image) setPrev(); });
    setPrev();
    const collect = () => { d.name = name.value.trim(); d.short = short.value.trim(); d.info = info.value; d.place = place.value; d.dead = dead.checked; };
    const mapState = el('span', { class: 'muted' });
    const rmPos = btn('Entfernen', () => { d.mapPos = null; updMap(); }, 'ghost small danger');
    const setPos = btn('Auf Weltkarte setzen', () => {
      collect();
      if (!board.map) { toast('Lade zuerst in der Weltkarte ein Kartenbild hoch.'); return; }
      placing = { draft: d, isNew };
      go(board.id, 'karte');
    }, 'small');
    const updMap = () => { mapState.textContent = d.mapPos ? '✓ Auf der Weltkarte platziert' : 'Noch nicht auf der Weltkarte'; rmPos.hidden = !d.mapPos; };
    updMap();
    const body = el('div', { class: 'form' },
      el('div', { class: 'form-img' }, preview, el('div', { class: 'col' }, el('label', { class: 'btn small' }, 'Bild wählen', file), rmImg)),
      field('Name', name),
      field('Kurzbeschreibung', short),
      el('div', { class: 'field' }, el('span', { text: 'Fraktionen (optional, auch mehrere)' }), picker),
      el('small', { class: 'muted', text: 'Tippen, um bestehende Fraktionen vorzuschlagen, oder einen neuen Namen eingeben und Enter drücken. Farben änderst du über „🎨 Fraktionen“.' }),
      el('label', { class: 'check' }, dead, el('span', { text: 'Verstorben (wird verblasst dargestellt)' })),
      field('Infos', info),
      el('fieldset', {}, el('legend', { text: 'Standort' }),
        field('Standort-Beschreibung', place),
        el('div', { class: 'row' }, mapState, setPos, rmPos)));
    const saveBtn = btn(isNew ? 'Erstellen' : 'Speichern', () => {
      collect();
      if (!d.name) { toast('Bitte einen Namen eingeben.'); name.focus(); return; }
      busy(saveBtn, async () => {
        const old = isNew ? null : byId(d.id);
        const oldPath = old ? old.imagePath : null;
        let path = d.imagePath || null; let uploaded = null;
        try {
          // Im Formular neu angelegte Fraktionen zuerst speichern
          const chosen = d._fsel.slice(0, 10);
          const fresh = chosen.filter((f) => f.isNew);
          if (fresh.length) {
            await q(sb.from('factions').insert(fresh.map((f) => ({ id: f.id, board_id: board.id, name: f.name, color: f.color }))));
            for (const f of fresh) { delete f.isNew; if (!byFaction(f.id)) board.factions.push(f); }
            board.factions.sort(byName);
          }
          if (d._blob) { uploaded = await uploadImage(board.id, d._blob, 'p-'); path = uploaded; } else if (d._rm) path = null;
          const rec = { id: d.id, name: d.name, short: d.short, info: d.info, place: d.place, imagePath: path, image: path ? d.image : null, x: d.x, y: d.y, mapPos: d.mapPos, factionIds: chosen.map((f) => f.id), dead: !!d.dead };
          const row = charRow(rec, board.id);
          if (isNew) await q(sb.from('characters').insert(row));
          else { const { id, board_id: _b, ...rest } = row; mustAffect(await q(sb.from('characters').update(rest).eq('id', id).select('id'))); }
          const prevIds = old ? (old.factionIds || []) : [];
          if (prevIds.join() !== rec.factionIds.join()) {
            if (!isNew) await q(sb.from('character_factions').delete().eq('character_id', rec.id));
            if (rec.factionIds.length) await q(sb.from('character_factions').insert(rec.factionIds.map((fid, pos) => ({ board_id: board.id, character_id: rec.id, faction_id: fid, position: pos }))));
          }
          if (oldPath && oldPath !== path) removeImages([oldPath]);
          const i = board.characters.findIndex((c) => c.id === rec.id);
          if (i >= 0) board.characters[i] = rec; else board.characters.push(rec);
          // Nur den eigenen Dialog schließen: Wurde er während des Speicherns geschlossen und ein neuer geöffnet,
          // bleibt der neue offen (sonst gingen dessen Eingaben verloren).
          renderBoard(currentModal !== formBack);
        } catch (e) {
          if (uploaded) removeImages([uploaded]);
          toast(errMsg(e));
        }
      });
    }, 'primary');
    const formBack = modal(isNew ? 'Neuer Charakter' : 'Charakter bearbeiten', body, [btn('Abbrechen', closeModal, 'ghost'), saveBtn]).parentElement;
  }

  // ---------- Charakter: Infokarte ----------
  function charInfo(id) {
    const c = byId(id);
    if (!c) return;
    const links = board.links.filter((l) => l.a === id || l.b === id);
    const body = el('div', { class: 'info' },
      el('div', { class: 'info-head' }, paintMany(el('div', { class: 'avatar big' + (c.dead ? ' dead' : '') }, avatarContent(c)), colorsOf(c)),
        el('div', {}, el('h3', {}, colorName(c)), c.short ? el('p', { class: 'lead', text: c.short }) : null,
          el('div', { class: 'row tags' },
            factionsOf(c).map(factionTag),
            c.dead ? paint(el('span', { class: 'tag' }, el('span', { class: 'dot' }), el('span', { text: 'Verstorben' })), DEAD_COLOR) : null))),
      c.info ? section('Infos', el('p', { class: 'pre', text: c.info })) : null,
      (c.place || c.mapPos) ? section('Standort',
        c.place ? el('p', { class: 'pre', text: c.place }) : null,
        c.mapPos && board.map ? btn('Auf Weltkarte zeigen', () => { focusChar = id; go(board.id, 'karte'); }, 'small') : null) : null,
      section(`Verbindungen (${links.length})`, links.length
        ? btn('🔍 Im Netz hervorheben', () => {
          const F = focusOf(board.id); F.chars = new Set([id]); F.factions = new Set(); F.cNb = true;
          closeModal(); if (view === 'netz') renderBoard(); else go(board.id, 'netz');
        }, 'small focus-me') : null,
      links.length
        ? el('ul', { class: 'link-list' }, links.map((l) => {
          const o = byId(l.a === id ? l.b : l.a);
          return el('li', {}, el('button', { class: 'linkbtn', type: 'button', onclick: () => linkInfo(l.id) },
            el('strong', { text: o ? o.name : '?' }), ' – ', l.short || '(ohne Beschreibung)'));
        }))
        : el('p', { class: 'muted', text: 'Noch keine Verbindungen.' })));
    const actions = canEdit()
      ? [btn('Löschen', () => confirmBox('Charakter löschen?', `„${c.name}“ und alle Verbindungen dieses Charakters werden gelöscht.`, 'Löschen', async () => {
        try {
          mustAffect(await q(sb.from('characters').delete().eq('id', id).select('id')));
        } catch (e) { toast(errMsg(e)); return; }
        removeImages([c.imagePath]);
        board.characters = board.characters.filter((x) => x.id !== id);
        board.links = board.links.filter((l) => l.a !== id && l.b !== id);
        renderBoard();
      }), 'ghost danger left'), btn('Bearbeiten', () => charForm(c, false), 'primary')]
      : [btn('Schließen', closeModal)];
    modal('Charakter', body, actions);
  }

  // ---------- Verbindungen ----------
  function linkForm(l, isNew) {
    if (!canEdit()) return;
    const a = byId(l.a), b = byId(l.b);
    if (!a || !b) return;
    const short = el('input', { type: 'text', value: l.short, maxlength: 120, placeholder: 'z. B. Geschwister, Rivalen, Mentor' });
    const long = el('textarea', { rows: 7, maxlength: 20000, placeholder: 'Ausführliche Beschreibung der Beziehung …' });
    long.value = l.long;
    const saveBtn = btn(isNew ? 'Verbinden' : 'Speichern', () => {
      const d = { ...l, short: short.value.trim(), long: long.value };
      if (!d.short) { toast('Bitte eine Kurzbeschreibung eingeben.'); short.focus(); return; }
      busy(saveBtn, async () => {
        try {
          if (isNew) await q(sb.from('links').insert({ id: d.id, board_id: board.id, a: d.a, b: d.b, short: d.short, long: d.long }));
          else mustAffect(await q(sb.from('links').update({ short: d.short, long: d.long }).eq('id', d.id).select('id')));
        } catch (e) { toast(errMsg(e)); return; }
        if (isNew) board.links.push(d); else Object.assign(byLink(l.id), d);
        renderBoard(currentModal !== formBack);
      });
    }, 'primary');
    const formBack = modal(isNew ? 'Neue Verbindung' : 'Verbindung bearbeiten', el('div', { class: 'form' },
      el('p', { class: 'pair' }, el('strong', { text: a.name }), '  ↔  ', el('strong', { text: b.name })),
      field('Kurzbeschreibung (steht auf der Linie)', short),
      field('Lange Beschreibung', long)), [btn('Abbrechen', closeModal, 'ghost'), saveBtn]).parentElement;
  }
  function linkInfo(id) {
    const l = byLink(id);
    if (!l) return;
    const a = byId(l.a), b = byId(l.b);
    if (!a || !b) return;
    const person = (c) => el('button', { class: 'linkbtn', type: 'button', onclick: () => charInfo(c.id) }, el('strong', { text: c.name }));
    const body = el('div', { class: 'info' },
      el('div', { class: 'row' }, person(a), el('span', { text: '↔' }), person(b)),
      section('Kurzbeschreibung', el('p', { class: 'pre', text: l.short })),
      section('Beschreibung', l.long ? el('p', { class: 'pre', text: l.long }) : el('p', { class: 'muted', text: 'Keine lange Beschreibung.' })));
    modal('Verbindung', body, canEdit()
      ? [btn('Löschen', () => confirmBox('Verbindung löschen?', `Die Verbindung zwischen „${a.name}“ und „${b.name}“ wird gelöscht.`, 'Löschen', async () => {
        try { mustAffect(await q(sb.from('links').delete().eq('id', id).select('id'))); } catch (e) { toast(errMsg(e)); return; }
        board.links = board.links.filter((x) => x.id !== id); renderBoard();
      }), 'ghost danger left'), btn('Bearbeiten', () => linkForm(l, false), 'primary')]
      : [btn('Schließen', closeModal)]);
  }

  // ---------- Verschieben & Zoomen (Maus, Mausrad, Touch, Pinch) ----------
  class PanZoom {
    constructor(c, apply, o = {}) {
      this.c = c; this.applyFn = apply; this.o = o;
      this.t = { x: 0, y: 0, k: 1 }; this.min = o.min ?? 0.1; this.max = o.max ?? 6;
      this.ptr = new Map(); this.h = null; this.pinch = null;
      c.addEventListener('wheel', (e) => {
        if (e.target.closest && e.target.closest('.legend, .unplaced, .focus-panel')) return; // eigene Listen scrollen lassen
        e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }, { passive: false });
      c.addEventListener('pointerdown', (e) => this.down(e));
      c.addEventListener('pointermove', (e) => this.move(e));
      c.addEventListener('pointerup', (e) => this.up(e, false));
      c.addEventListener('pointercancel', (e) => this.up(e, true));
    }
    set(t) { this.t = t; this.applyFn(t); }
    rect() { return this.c.getBoundingClientRect(); }
    toWorld(cx, cy) { const r = this.rect(); return { x: (cx - r.left - this.t.x) / this.t.k, y: (cy - r.top - this.t.y) / this.t.k }; }
    zoomAt(cx, cy, f) {
      const r = this.rect(); const px = cx - r.left, py = cy - r.top;
      const k = clamp(this.t.k * f, this.min, this.max); const s = k / this.t.k;
      this.set({ x: px - (px - this.t.x) * s, y: py - (py - this.t.y) * s, k });
    }
    zoomCenter(f) { const r = this.rect(); this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); }
    down(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { this.c.setPointerCapture(e.pointerId); } catch { /* egal */ }
      if (this.ptr.size === 2) { const [a, b] = [...this.ptr.values()]; this.h = null; this.pinch = { d: dist(a, b) || 1, m: mid(a, b) }; return; }
      if (this.ptr.size > 2) return;
      this.sx = e.clientX; this.sy = e.clientY; this.moved = false; this.downEvt = e; this.st = { ...this.t };
      this.h = (this.o.onDown && this.o.onDown(e)) || 'pan';
    }
    move(e) {
      if (this.o.onHover) this.o.onHover(e);
      if (!this.ptr.has(e.pointerId)) return;
      this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.ptr.size >= 2) {
        const [a, b] = [...this.ptr.values()]; const d = dist(a, b) || 1, m = mid(a, b);
        this.zoomAt(m.x, m.y, d / this.pinch.d);
        this.set({ ...this.t, x: this.t.x + m.x - this.pinch.m.x, y: this.t.y + m.y - this.pinch.m.y });
        this.pinch = { d, m };
        return;
      }
      if (!this.h) return;
      if (!this.moved && Math.hypot(e.clientX - this.sx, e.clientY - this.sy) > 5) this.moved = true;
      if (!this.moved) return;
      if (this.h === 'pan') this.set({ ...this.t, x: this.st.x + e.clientX - this.sx, y: this.st.y + e.clientY - this.sy });
      else this.h.move(e);
    }
    up(e, cancel) {
      if (!this.ptr.has(e.pointerId)) return;
      this.ptr.delete(e.pointerId);
      if (this.pinch) { if (this.ptr.size < 2) this.pinch = null; this.h = null; return; }
      const h = this.h; this.h = null;
      if (!h || cancel) return;
      if (h === 'pan') { if (!this.moved && this.o.onTap) this.o.onTap(this.downEvt); }
      else h.up(e, this.moved);
    }
  }
  function zoomButtons(pz, fit) {
    return [btn('−', () => pz.zoomCenter(1 / 1.3), 'small'), btn('+', () => pz.zoomCenter(1.3), 'small'), btn('Alles zeigen', fit, 'small')];
  }

  // ---------- Ansicht: Charakternetz ----------
  function renderNet(main) {
    if (!canEdit()) netMode = 'move';
    let first = null; // erster Kreis beim Verbinden
    const wrap = el('div', { class: 'canvas grid' });
    const svg = sv('svg', { class: 'net', role: 'img', 'aria-label': 'Charakternetz' });
    const defs = sv('defs'); const cp = sv('clipPath', { id: 'clipc', clipPathUnits: 'objectBoundingBox' }); cp.append(sv('circle', { cx: 0.5, cy: 0.5, r: 0.5 })); defs.append(cp);
    const grads = sv('g'); defs.append(grads); // Farbverläufe für Namen mit mehreren Fraktionen
    const vp = sv('g'); const gl = sv('g'); const gn = sv('g'); const glb = sv('g'); // Beschriftungen über den Kreisen
    const rubber = sv('line', { class: 'rubber' }); rubber.style.display = 'none';
    vp.append(gl, rubber, gn, glb); svg.append(defs, vp); wrap.append(svg);
    const hint = el('div', { class: 'hint' });

    // ---- Auswahl: Wer ist hervorgehoben, wer nur noch minimal sichtbar? ----
    const F = focusOf(board.id);
    const focusOn = () => F.factions.size > 0 || F.chars.size > 0 || F.life !== 'all';
    function computeFocus() {
      const sel = F.factions.size > 0 || F.chars.size > 0;
      const inFac = (c) => (c.factionIds || []).some((f) => F.factions.has(f));
      const picked = new Set(); // ausdrücklich gewählt (Fraktionsmitglied oder einzeln)
      if (sel) for (const c of board.characters) if (F.chars.has(c.id) || inFac(c)) picked.add(c.id);
      const vis = new Set(sel ? picked : board.characters.map((c) => c.id));
      if (sel && (F.fNb || F.cNb)) {
        for (const l of board.links) {
          for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) {
            if (!picked.has(x)) continue;
            const c = byId(x);
            if (c && ((F.cNb && F.chars.has(x)) || (F.fNb && inFac(c)))) vis.add(y);
          }
        }
      }
      if (F.life !== 'all') for (const id of [...vis]) { const c = byId(id); if (!c || c.dead !== (F.life === 'dead')) vis.delete(id); }
      return { sel, picked, vis };
    }
    let countEl = null; let legendEl = null; let charQuery = '';
    const focusBtn = btn('🔍 Auswahl', () => { F.open = !F.open; renderPanel(); applyFocus(); updHint(); }, 'small focus-btn');
    const clearBtn = btn('✕ Auswahl aufheben', () => resetFocus(), 'small ghost focus-clear');
    function resetFocus() { F.factions = new Set(); F.chars = new Set(); F.fNb = false; F.cNb = true; F.life = 'all'; renderPanel(); applyFocus(); }
    function applyFocus() {
      const on = focusOn(); const r = computeFocus();
      wrap.classList.toggle('focusing', on);
      wrap.classList.toggle('panel-open', F.open);
      for (const g of gn.children) {
        const id = g.dataset.char;
        g.classList.toggle('dim', on && !r.vis.has(id));
        g.classList.toggle('picked', r.sel && r.picked.has(id) && r.vis.has(id));
      }
      for (const l of board.links) {
        const e = linkEls.get(l.id); if (!e) continue;
        // Hervorgehoben: beide Enden sichtbar und (bei einer Auswahl) mindestens ein Ende ausgewählt
        const show = !on || (r.vis.has(l.a) && r.vis.has(l.b) && (!r.sel || r.picked.has(l.a) || r.picked.has(l.b)));
        for (const x of [e.g, e.lb]) { x.classList.toggle('dim', !show); x.classList.toggle('hl', on && show); }
        e.lb.setAttribute('tabindex', show ? '0' : '-1');
      }
      const shown = on ? r.vis.size : board.characters.length;
      focusBtn.textContent = on ? `🔍 Auswahl · ${shown}/${board.characters.length}` : '🔍 Auswahl';
      focusBtn.classList.toggle('active', F.open || on);
      focusBtn.setAttribute('aria-pressed', String(F.open));
      clearBtn.hidden = !on;
      if (countEl) countEl.textContent = `${shown} von ${board.characters.length} sichtbar`;
      if (legendEl) for (const it of legendEl.querySelectorAll('[data-faction]')) it.setAttribute('aria-pressed', String(F.factions.has(it.dataset.faction)));
    }
    const panel = el('div', { class: 'focus-panel', role: 'region', 'aria-label': 'Auswahl' });
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    const charSearch = el('input', { type: 'search', placeholder: 'Charakter suchen …', 'aria-label': 'Charakter suchen' });
    charSearch.addEventListener('input', () => { charQuery = charSearch.value; fillCharList(); });
    const charList = el('div', { class: 'focus-list' });
    function fillCharList() {
      const qy = fold(charQuery.trim());
      const rows = board.characters.filter((c) => !qy || fold(c.name).includes(qy))
        .sort((a, b) => (F.chars.has(b.id) - F.chars.has(a.id)) || collator.compare(a.name, b.name));
      charList.replaceChildren(...rows.map((c) => {
        const cb = el('input', { type: 'checkbox', checked: F.chars.has(c.id) });
        cb.dataset.char = c.id;
        cb.addEventListener('change', () => { if (cb.checked) F.chars.add(c.id); else F.chars.delete(c.id); applyFocus(); });
        return el('label', { class: 'check focus-row' }, cb, colorName(c));
      }), ...(rows.length ? [] : [el('p', { class: 'muted', text: 'Keine Treffer.' })]));
    }
    function renderPanel() {
      if (!F.open) { panel.remove(); countEl = null; return; }
      const chip = (f) => {
        const b = el('button', { type: 'button', class: 'fchip', 'aria-pressed': String(F.factions.has(f.id)), onclick: () => {
          if (F.factions.has(f.id)) F.factions.delete(f.id); else F.factions.add(f.id);
          b.setAttribute('aria-pressed', String(F.factions.has(f.id))); applyFocus();
        } }, el('span', { class: 'dot' }), el('span', { text: f.name }));
        b.dataset.faction = f.id;
        return paint(b, f.color);
      };
      const nb = (key, label) => {
        const cb = el('input', { type: 'checkbox', checked: F[key] }); cb.dataset.opt = key;
        cb.addEventListener('change', () => { F[key] = cb.checked; applyFocus(); });
        return el('label', { class: 'check' }, cb, el('span', { text: label }));
      };
      const lifeOpts = [['all', 'Beide'], ['alive', 'Lebende'], ['dead', 'Verstorbene']];
      const life = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Status' });
      for (const [v, label] of lifeOpts) {
        const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(F.life === v), class: F.life === v ? 'active' : '', onclick: () => {
          F.life = v;
          for (const x of life.children) { const a = x === b; x.classList.toggle('active', a); x.setAttribute('aria-checked', String(a)); }
          applyFocus();
        } }, label);
        b.dataset.life = v; life.append(b);
      }
      countEl = el('span', { class: 'muted focus-count' });
      charSearch.value = charQuery; fillCharList();
      panel.replaceChildren(
        el('div', { class: 'focus-head' }, el('strong', { text: '🔍 Auswahl' }), countEl,
          el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Auswahl-Fenster schließen', text: '✕', onclick: () => { F.open = false; renderPanel(); applyFocus(); updHint(); } })),
        el('h4', { text: 'Fraktionen' }),
        board.factions.length ? el('div', { class: 'fchips' }, board.factions.map(chip)) : el('p', { class: 'muted', text: 'Noch keine Fraktionen.' }),
        nb('fNb', 'Mit ihren Verbindungen'),
        el('h4', { text: 'Einzelne Charaktere' }),
        charSearch, charList,
        nb('cNb', 'Mit ihren Verbindungen'),
        el('h4', { text: 'Status' }), life,
        el('p', { class: 'muted focus-tip', text: 'Solange dieses Fenster offen ist, wählt ein Klick auf einen Kreis ihn aus oder ab.' }),
        btn('Alles zurücksetzen', resetFocus, 'small ghost'));
      if (!panel.isConnected) wrap.append(panel);
    }
    // Klick auf einen Kreis: bei offenem Auswahl-Fenster aus-/abwählen, sonst Infokarte
    function tapChar(c) {
      if (F.open) { if (F.chars.has(c.id)) F.chars.delete(c.id); else F.chars.add(c.id); fillCharList(); applyFocus(); return; }
      charInfo(c.id);
    }

    const modes = [['move', '✋ Bewegen'], ['add', '＋ Charakter'], ['link', '🔗 Verbinden']];
    const modeBtns = modes.map(([m, label]) => btn(label, () => setMode(m), 'small' + (netMode === m ? ' active' : '')));
    function setMode(m) {
      netMode = m; first = null; rubber.style.display = 'none';
      modeBtns.forEach((b, i) => b.classList.toggle('active', modes[i][0] === m));
      wrap.className = 'canvas grid mode-' + m;
      drawNodes(); updHint();
    }
    function updHint() {
      const touch = matchMedia('(pointer: coarse)').matches;
      if (F.open && netMode !== 'link') { hint.textContent = (touch ? 'Auswahl: Kreis antippen' : 'Auswahl: Kreis anklicken') + ' = aus- oder abwählen · Hintergrund ziehen: Ansicht bewegen'; return; }
      const txt = canEdit() ? {
        move: board.characters.length ? (touch ? 'Kreise ziehen zum Verschieben · Tippen: Infos · Hintergrund ziehen: Ansicht bewegen · zwei Finger: Zoom' : 'Kreise ziehen zum Verschieben · Klick auf Kreis oder Linie: Infos · Hintergrund ziehen: Ansicht bewegen · Mausrad: Zoom') : 'Wähle „＋ Charakter“ und klicke auf eine freie Stelle, um deinen ersten Charakter zu erstellen.',
        add: 'Klicke auf eine freie Stelle, um dort einen Charakter zu erstellen.',
        link: first ? 'Jetzt den zweiten Charakter anklicken (Klick ins Leere bricht ab).' : 'Klicke auf den ersten Charakter, dann auf den zweiten.',
      } : { move: board.characters.length ? (touch ? 'Nur ansehen · Tippen: Infos · Hintergrund ziehen: Ansicht bewegen · zwei Finger: Zoom' : 'Nur ansehen · Klick auf Kreis oder Linie: Infos · Hintergrund ziehen: Ansicht bewegen · Mausrad: Zoom') : 'Dieses Board hat noch keine Charaktere.' };
      hint.textContent = txt[netMode] || txt.move;
    }

    const linkEls = new Map(); // Verbindungs-ID -> { line, lb }
    function drawLinks() {
      gl.replaceChildren(); glb.replaceChildren(); linkEls.clear();
      for (const l of board.links) {
        const a = byId(l.a), b = byId(l.b);
        if (!a || !b) continue;
        const g = sv('g', { class: 'link' });
        const line = sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        g.append(line);
        const label = trunc(l.short || '…', 32);
        const w = textUnits(label) * 6.8 + 16;
        const lb = sv('g', { class: 'link-label', transform: `translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})`, tabindex: 0, role: 'button', 'aria-label': `Verbindung ${a.name} – ${b.name}: ${l.short}` });
        lb.dataset.link = l.id;
        linkEls.set(l.id, { line, lb, g });
        lb.append(sv('rect', { x: -w / 2, y: -11, width: w, height: 22, rx: 11 }));
        const t = sv('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }); t.textContent = label;
        const tt = sv('title'); tt.textContent = l.short;
        lb.append(t, tt); gl.append(g); glb.append(lb);
      }
    }
    // Nur die Linien eines verschobenen Charakters neu setzen (schnell auch bei vielen Verbindungen)
    function moveLinksOf(cid) {
      for (const l of board.links) {
        if (l.a !== cid && l.b !== cid) continue;
        const e = linkEls.get(l.id); const a = byId(l.a), b = byId(l.b);
        if (!e || !a || !b) continue;
        e.line.setAttribute('x1', a.x); e.line.setAttribute('y1', a.y); e.line.setAttribute('x2', b.x); e.line.setAttribute('y2', b.y);
        e.lb.setAttribute('transform', `translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})`);
      }
    }
    function drawNodes() {
      gn.replaceChildren(); grads.replaceChildren();
      const deg = degrees();
      board.characters.forEach((c, idx) => {
        const r = radiusFor(deg.get(c.id));
        const cols = colorsOf(c);
        const g = sv('g', { class: 'node' + (first === c.id ? ' selected' : '') + (c.dead ? ' dead' : ''), transform: `translate(${c.x},${c.y})`, tabindex: 0, role: 'button', 'aria-label': displayName(c) });
        g.dataset.char = c.id;
        paint(g, cols[0] || null);
        g.append(sv('circle', { class: 'halo', r: r + 9 }), sv('circle', { class: 'node-bg', r }));
        const src = safeSrc(c.image);
        if (src) {
          const im = sv('image', { x: -r, y: -r, width: 2 * r, height: 2 * r, 'clip-path': 'url(#clipc)', preserveAspectRatio: 'xMidYMid slice' });
          im.setAttribute('href', src);
          g.append(im);
        } else {
          const t = sv('text', { class: 'initials', 'text-anchor': 'middle', 'dominant-baseline': 'central' }); t.textContent = initials(c.name);
          t.style.fontSize = Math.round(r * 0.6) + 'px';
          g.append(t);
        }
        if (cols.length > 1) {
          // Rand in gleich große Farbabschnitte teilen (oben beginnend)
          const circ = 2 * Math.PI * r, seg = circ / cols.length;
          cols.forEach((col, i) => {
            const ring = sv('circle', { class: 'node-ring', r, transform: 'rotate(-90)', 'stroke-dasharray': `${seg} ${circ - seg}`, 'stroke-dashoffset': String(-i * seg) });
            paint(ring, col); g.append(ring);
          });
        } else g.append(sv('circle', { class: 'node-ring', r }));
        const nm = sv('text', { class: 'node-name', 'text-anchor': 'middle', y: r + 18 }); nm.textContent = trunc(displayName(c), 26);
        if (cols.length > 1) {
          const gid = 'ng' + idx;
          const lg = sv('linearGradient', { id: gid, x1: '0', y1: '0', x2: '1', y2: '0' });
          cols.forEach((col, i) => {
            lg.append(sv('stop', { offset: String(i / cols.length), 'stop-color': col }), sv('stop', { offset: String((i + 1) / cols.length), 'stop-color': col }));
          });
          grads.append(lg);
          nm.style.fill = `url(#${gid})`;
        }
        g.append(nm); gn.append(g);
      });
      applyFocus();
    }
    function legend() {
      const used = board.factions.filter((f) => board.characters.some((c) => (c.factionIds || []).includes(f.id)));
      const anyDead = board.characters.some((c) => c.dead);
      if (!used.length && !anyDead) return null;
      // Klick auf eine Fraktion: nur ihre Mitglieder zeigen (erneuter Klick hebt das wieder auf)
      const item = (f) => {
        const b = el('button', { type: 'button', class: 'legend-item', title: `Nur „${f.name}“ zeigen`, 'aria-pressed': 'false', onclick: () => {
          const only = F.factions.size === 1 && F.factions.has(f.id) && !F.chars.size;
          F.factions = only ? new Set() : new Set([f.id]); F.chars = new Set(); renderPanel(); applyFocus();
        } }, el('span', { class: 'dot' }), el('span', { text: f.name }));
        b.dataset.faction = f.id;
        return paint(b, f.color);
      };
      return el('div', { class: 'legend', 'aria-label': 'Legende' }, used.map(item),
        anyDead ? el('span', { class: 'legend-item legend-dead', title: 'Verstorbene behalten ihre Fraktionsfarben und werden verblasst dargestellt' }, el('span', { class: 'dot' }), el('span', { text: 'Verstorben † (verblasst)' })) : null);
    }
    function nodeTap(c) {
      if (netMode !== 'link') { tapChar(c); return; }
      if (!first) { first = c.id; drawNodes(); updHint(); return; }
      if (first === c.id) { first = null; rubber.style.display = 'none'; drawNodes(); updHint(); return; }
      const a = first; first = null; rubber.style.display = 'none'; drawNodes(); updHint();
      const exists = board.links.find((l) => (l.a === a && l.b === c.id) || (l.b === a && l.a === c.id));
      if (exists) { toast('Diese Verbindung gibt es schon.'); linkInfo(exists.id); return; }
      linkForm({ id: uid(), a, b: c.id, short: '', long: '' }, true);
    }

    const pz = new PanZoom(wrap, (t) => { vp.setAttribute('transform', `translate(${t.x},${t.y}) scale(${t.k})`); netT.set(board.id, { ...t }); }, {
      min: 0.1, max: 4,
      onDown(e) {
        const n = e.target.closest && e.target.closest('.node');
        if (n) {
          const c = byId(n.dataset.char);
          if (netMode === 'move' && canEdit()) {
            const s = pz.toWorld(e.clientX, e.clientY); const ox = c.x, oy = c.y;
            return {
              move(ev) { const p = pz.toWorld(ev.clientX, ev.clientY); c.x = Math.round(ox + p.x - s.x); c.y = Math.round(oy + p.y - s.y); n.setAttribute('transform', `translate(${c.x},${c.y})`); moveLinksOf(c.id); },
              up(ev, moved) {
                if (!moved) { tapChar(c); return; }
                persist(async () => mustAffect(await q(sb.from('characters').update({ x: c.x, y: c.y }).eq('id', c.id).select('id')))).catch(() => {});
              },
            };
          }
          return { move() {}, up(ev, moved) { if (!moved) nodeTap(c); } };
        }
        const lb = e.target.closest && e.target.closest('.link-label');
        if (lb) return { move() {}, up(ev, moved) { if (!moved) linkInfo(lb.dataset.link); } };
        return null;
      },
      onTap(e) {
        if (netMode === 'add' && canEdit()) { const p = pz.toWorld(e.clientX, e.clientY); charForm(newChar(Math.round(p.x), Math.round(p.y)), true); }
        else if (netMode === 'link' && first) { first = null; rubber.style.display = 'none'; drawNodes(); updHint(); }
      },
      onHover(e) {
        if (!first) return;
        const a = byId(first); const p = pz.toWorld(e.clientX, e.clientY);
        rubber.setAttribute('x1', a.x); rubber.setAttribute('y1', a.y); rubber.setAttribute('x2', p.x); rubber.setAttribute('y2', p.y);
        rubber.style.display = '';
      },
    });
    function fit() {
      const r = pz.rect();
      if (!board.characters.length) { pz.set({ x: r.width / 2, y: r.height / 2, k: 1 }); return; }
      const xs = board.characters.map((c) => c.x), ys = board.characters.map((c) => c.y);
      const pad = 52 + 50;
      const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
      const h = Math.max(120, r.height - 70); // Platz für den Hinweis unten lassen
      const k = clamp(Math.min(r.width / (maxX - minX), h / (maxY - minY)), 0.1, 1.5);
      pz.set({ x: r.width / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k, k });
    }

    main.append(el('div', { class: 'toolbar' }, canEdit() ? modeBtns : null, canEdit() ? btn('🎨 Fraktionen', factionDialog, 'small') : null,
      focusBtn, clearBtn, el('div', { class: 'spacer' }), zoomButtons(pz, fit)), wrap, hint);
    const lg = legend(); if (lg) { lg.addEventListener('pointerdown', (e) => e.stopPropagation()); wrap.append(lg); legendEl = lg; }
    // Tastatur: Enter / Leertaste auf Kreis oder Linienbeschriftung
    svg.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const n = e.target.closest && e.target.closest('.node');
      const lb = e.target.closest && e.target.closest('.link-label');
      if (n) { e.preventDefault(); const c = byId(n.dataset.char); if (c) nodeTap(c); }
      else if (lb) { e.preventDefault(); linkInfo(lb.dataset.link); }
    });
    wrap.className = 'canvas grid mode-' + netMode;
    drawLinks(); drawNodes(); renderPanel(); applyFocus(); updHint();
    const saved = netT.get(board.id);
    if (saved) pz.set(saved); else fit();
  }

  // ---------- Ansicht: Weltkarte ----------
  function renderMap(main) {
    const wrap = el('div', { class: 'canvas' });
    const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', onchange: async () => {
      const label = fileIn.closest('label');
      const f = fileIn.files[0]; fileIn.value = '';
      if (!f) return;
      if (label) label.classList.add('busy');
      try {
        toast('Karte wird hochgeladen …');
        const r = await readImage(f, 4096, 0.9);
        const oldPath = board.map && board.map.path;
        const path = await uploadImage(board.id, r.blob, 'map-');
        try { mustAffect(await q(sb.from('boards').update({ map_path: path, map_w: r.w, map_h: r.h }).eq('id', board.id).select('id'))); } catch (e) { removeImages([path]); throw e; }
        if (oldPath) removeImages([oldPath]);
        board.map = { path, w: r.w, h: r.h, src: URL.createObjectURL(r.blob) };
        mapT.delete(board.id); renderBoard();
      } catch (e) { toast(errMsg(e)); } finally { if (label) label.classList.remove('busy'); }
    } });
    const M = board.map;
    if (!M || !safeSrc(M.src)) {
      main.append(el('div', { class: 'toolbar' }, el('span', { class: 'muted', text: 'Weltkarte' })), wrap);
      wrap.append(el('div', { class: 'empty-map' },
        el('h2', { text: 'Noch keine Weltkarte' }),
        el('p', { text: canEdit() ? 'Lade ein Bild deiner Weltkarte hoch. Danach kannst du deine Charaktere als Punkte darauf platzieren, hineinzoomen und sie anklicken.' : 'Der Ersteller hat für dieses Board noch keine Weltkarte hochgeladen.' }),
        canEdit() ? el('label', { class: 'btn primary' }, 'Kartenbild hochladen', fileIn) : null));
      placing = null;
      return;
    }
    const inner = el('div', { class: 'map-inner' });
    inner.style.width = M.w + 'px'; inner.style.height = M.h + 'px';
    const img = el('img', { src: safeSrc(M.src), alt: 'Weltkarte', draggable: 'false', width: M.w, height: M.h });
    inner.append(img);
    const pins = [];
    for (const c of board.characters) {
      if (!c.mapPos) continue;
      const p = el('div', { class: 'pin' + (focusChar === c.id ? ' focus' : '') + (c.dead ? ' dead' : ''), role: 'button', tabindex: 0, title: displayName(c), 'aria-label': displayName(c) },
        paintMany(el('span', { class: 'pin-dot' }, avatarContent(c)), colorsOf(c)), el('span', { class: 'pin-name' }, colorName(c)));
      p.dataset.char = c.id;
      p.style.left = c.mapPos.x * M.w + 'px'; p.style.top = c.mapPos.y * M.h + 'px';
      p.addEventListener('keydown', (e) => { if (e.key === 'Enter') charInfo(c.id); });
      inner.append(p); pins.push(p);
    }
    wrap.append(inner);
    if (placing) wrap.classList.add('placing');

    const pz = new PanZoom(wrap, (t) => {
      inner.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.k})`;
      for (const p of pins) p.style.transform = `scale(${1 / t.k})`;
      mapT.set(board.id, { ...t });
    }, {
      min: 0.02, max: 12,
      onDown(e) {
        const p = !placing && e.target.closest && e.target.closest('.pin');
        if (p) return { move() {}, up(ev, moved) { if (!moved) charInfo(p.dataset.char); } };
        return null;
      },
      onTap(e) {
        if (!placing || !canEdit()) return;
        const w = pz.toWorld(e.clientX, e.clientY);
        if (w.x < 0 || w.y < 0 || w.x > M.w || w.y > M.h) { toast('Bitte auf die Karte klicken.'); return; }
        const pos = { x: w.x / M.w, y: w.y / M.h };
        const pl = placing; placing = null;
        if (pl.draft) { pl.draft.mapPos = pos; renderBoard(); charForm(pl.draft, pl.isNew); }
        else {
          const c = byId(pl.charId);
          if (!c) { renderBoard(); return; }
          persist(async () => mustAffect(await q(sb.from('characters').update({ map_x: pos.x, map_y: pos.y }).eq('id', c.id).select('id'))))
            .then(() => { c.mapPos = pos; renderBoard(); }, () => {});
        }
      },
    });
    function fit() {
      const r = pz.rect();
      const k = Math.min(r.width / M.w, r.height / M.h);
      pz.min = Math.min(0.02, k / 2);
      pz.set({ x: (r.width - M.w * k) / 2, y: (r.height - M.h * k) / 2, k });
    }

    const tools = [];
    if (placing) {
      const who = placing.draft ? (placing.draft.name || 'den neuen Charakter') : (byId(placing.charId) || {}).name;
      tools.push(el('div', { class: 'banner' }, el('span', { text: `Klicke auf die Karte, um „${who}“ zu platzieren.` }),
        btn('Abbrechen', () => { const pl = placing; placing = null; renderBoard(); if (pl.draft) charForm(pl.draft, pl.isNew); }, 'small ghost')));
    } else if (canEdit()) {
      tools.push(el('label', { class: 'btn small' }, 'Kartenbild ändern', fileIn));
    }
    main.append(el('div', { class: 'toolbar' }, tools, el('div', { class: 'spacer' }), zoomButtons(pz, fit)), wrap);

    // Liste der noch nicht platzierten Charaktere
    const unplaced = board.characters.filter((c) => !c.mapPos);
    if (canEdit() && !placing && unplaced.length) {
      wrap.append(el('div', { class: 'unplaced' }, el('h4', { text: 'Noch nicht auf der Karte' }),
        unplaced.map((c) => btn(c.name, () => { placing = { charId: c.id }; renderBoard(); }, 'small ghost'))));
      // Klicks auf die Liste sollen die Karte nicht verschieben
      wrap.lastChild.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    fit();
    const saved = mapT.get(board.id);
    if (focusChar) {
      const c = byId(focusChar); focusChar = null;
      if (c && c.mapPos) {
        const r = pz.rect(); const k = clamp(pz.t.k * 4, pz.t.k, 3);
        pz.set({ x: r.width / 2 - c.mapPos.x * M.w * k, y: r.height / 2 - c.mapPos.y * M.h * k, k });
      }
    } else if (saved) pz.set(saved);
  }

  // ---------- Ansicht: Tabelle ----------
  function renderTable(main) {
    const search = el('input', { type: 'search', placeholder: 'Charaktere durchsuchen …', value: tableFilter, 'aria-label': 'Suchen' });
    const tbody = el('tbody');
    const linkCount = new Map();
    for (const l of board.links) { linkCount.set(l.a, (linkCount.get(l.a) || 0) + 1); linkCount.set(l.b, (linkCount.get(l.b) || 0) + 1); }
    const cols = [['bild', '', 'narrow'], ['name', 'Name', ''], ['faction', 'Fraktion', ''], ['short', 'Kurzbeschreibung', 'hide-sm'], ['place', 'Standort', 'hide-sm'], ['links', 'Verbindungen', 'hide-sm'], ['map', 'Karte', 'narrow hide-sm']];
    const val = (c, k) => (k === 'links' ? linkCount.get(c.id) || 0 : k === 'map' ? (c.mapPos ? 1 : 0)
      : k === 'faction' ? (factionsOf(c).map((f) => f.name).join(', ') || '\uffff') : (c[k] || ''));
    function fill() {
      const qy = fold(tableFilter.trim());
      const rows = board.characters
        .filter((c) => !qy || [c.name, c.short, c.place, c.info, ...factionsOf(c).map((f) => f.name), c.dead ? 'verstorben tot' : ''].some((s) => fold(s).includes(qy)))
        .sort((a, b) => {
          const x = val(a, tableSort.key), y = val(b, tableSort.key);
          const r = typeof x === 'string' ? (x === y ? 0 : x === '\uffff' ? 1 : y === '\uffff' ? -1 : collator.compare(x, y)) : x - y;
          return r * tableSort.dir;
        });
      tbody.replaceChildren(...rows.map((c) => {
        const fs = factionsOf(c);
        const tr = el('tr', { tabindex: 0, onclick: () => charInfo(c.id) },
          el('td', { class: 'narrow' }, paintMany(el('div', { class: 'avatar' + (c.dead ? ' dead' : '') }, avatarContent(c)), colorsOf(c))),
          el('td', {}, el('strong', {}, colorName(c))),
          el('td', {}, fs.length ? el('div', { class: 'row tags-inline' }, fs.map(factionTag)) : el('span', { class: 'muted', text: '–' })),
          el('td', { class: 'clip hide-sm', text: c.short }),
          el('td', { class: 'clip hide-sm', text: c.place }),
          el('td', { class: 'hide-sm', text: String(linkCount.get(c.id) || 0) }),
          el('td', { class: 'narrow hide-sm', text: c.mapPos ? '✓' : '–' }));
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') charInfo(c.id); });
        return tr;
      }));
      if (!rows.length) tbody.append(el('tr', {}, el('td', { colspan: 7, class: 'muted', text: board.characters.length ? 'Keine Treffer.' : (canEdit() ? 'Noch keine Charaktere. Füge über „+ Charakter“ einen hinzu.' : 'Dieses Board hat noch keine Charaktere.') })));
    }
    search.addEventListener('input', () => { tableFilter = search.value; fill(); });
    const sortBy = (k) => { tableSort = tableSort.key === k ? { key: k, dir: -tableSort.dir } : { key: k, dir: 1 }; renderBoard(); };
    const thead = el('thead', {}, el('tr', {}, cols.map(([k, label, cls]) => el('th', {
      class: cls, scope: 'col', tabindex: k === 'bild' ? null : 0,
      'aria-sort': tableSort.key === k && label ? (tableSort.dir > 0 ? 'ascending' : 'descending') : null,
      onclick: k === 'bild' ? null : () => sortBy(k),
      onkeydown: k === 'bild' ? null : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(k); } },
    }, label, tableSort.key === k && label ? (tableSort.dir > 0 ? ' ▲' : ' ▼') : ''))));
    main.append(
      el('div', { class: 'toolbar' }, search, el('div', { class: 'spacer' }),
        canEdit() ? btn('+ Charakter', () => charForm(newChar(Math.round(Math.random() * 400 - 200), Math.round(Math.random() * 300 - 150)), true), 'primary small') : null),
      el('div', { class: 'table-wrap' }, el('table', {}, thead, tbody)));
    fill();
  }

  // ---------- Bildadressen auffrischen ----------
  // Signierte Bildadressen gelten 1 Stunde. Bleibt ein Board länger offen, werden sie rechtzeitig erneuert,
  // damit Bilder und Karte nicht plötzlich verschwinden.
  let pointerBusy = false;
  document.addEventListener('pointerdown', () => { pointerBusy = true; }, true);
  document.addEventListener('pointerup', () => { pointerBusy = false; }, true);
  document.addEventListener('pointercancel', () => { pointerBusy = false; }, true);
  let refreshing = false;
  async function refreshImages() {
    if (!board || !me || refreshing || document.visibilityState === 'hidden') return;
    const own = (u) => typeof u === 'string' && u.startsWith('blob:'); // gerade selbst hochgeladen
    const paths = [board.map && !own(board.map.src) ? board.map.path : null,
      ...board.characters.filter((c) => !own(c.image)).map((c) => c.imagePath)].filter(Boolean);
    const soon = Date.now() + 10 * 60000;
    if (!paths.some((p) => !((urlCache.get(p) || {}).exp > soon))) return;
    // Nicht mitten in einer Bedienung neu zeichnen
    const ae = document.activeElement;
    if (currentModal || pointerBusy || placing || (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName))) return;
    refreshing = true;
    const id = board.id;
    try {
      for (const p of paths) urlCache.delete(p);
      const get = await signUrls(paths);
      if (!board || board.id !== id) return;
      if (board.map && !own(board.map.src)) board.map.src = get(board.map.path);
      for (const c of board.characters) if (!own(c.image)) c.image = get(c.imagePath);
      if (!currentModal && !pointerBusy) renderBoard();
    } catch { /* nächster Versuch beim nächsten Intervall */ } finally { refreshing = false; }
  }
  setInterval(refreshImages, 2 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshImages(); });

  // ---------- Installation als App (Desktop-Symbol) ----------
  let installEvt = null;
  function isStandalone() { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inAppBrowser = /WhatsApp|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);

  function installButton() {
    if (isStandalone()) return null;
    return el('button', { class: 'btn ghost small install-btn', type: 'button', onclick: doInstall, title: 'Als App installieren' }, '⬇', el('span', { class: 'lbl', text: ' App installieren' }));
  }
  async function doInstall() {
    if (installEvt) {
      installEvt.prompt();
      try { await installEvt.userChoice; } catch { /* egal */ }
      installEvt = null;
      if (onInstallChange) onInstallChange();
    } else showInstallHelp();
  }
  function showInstallHelp() {
    const steps = [];
    if (inAppBrowser) steps.push('Du bist im Browser einer App (z. B. WhatsApp). Öffne den Link zuerst über „⋮“ bzw. das Teilen-Symbol mit „Im Browser öffnen“. Dort meldest du dich an und kannst die App installieren.');
    if (isIOS) steps.push('iPhone/iPad: In Safari auf das Teilen-Symbol (□↑) tippen, dann „Zum Home-Bildschirm“ wählen.');
    else {
      steps.push('Android: Im Chrome-Menü „⋮“ auf „App installieren“ bzw. „Zum Startbildschirm hinzufügen“ tippen.');
      steps.push('Computer (Chrome oder Edge): In der Adressleiste rechts auf das Installieren-Symbol klicken, oder im Menü „⋮“ → „Streamen, speichern und teilen“ → „Seite als App installieren“.');
    }
    modal('Als App installieren', el('div', { class: 'form' },
      el('p', { text: 'So bekommst du ein eigenes Symbol auf deinem Desktop bzw. Startbildschirm:' }),
      el('ol', { class: 'help-list' }, steps.map((s) => el('li', { text: s })))), [btn('Verstanden', closeModal, 'primary')]);
  }
  function askInstallOnce() {
    if (isStandalone() || store('cn-install-asked')) return;
    store('cn-install-asked', '1');
    modal('Desktop-Symbol erstellen?', el('p', { text: 'Möchtest du Charakter-Netz als App mit eigenem Symbol auf deinem Desktop bzw. Startbildschirm installieren? Dann startest du es wie ein normales Programm.' }),
      [btn('Nein, danke', closeModal, 'ghost'), btn('Ja, Symbol erstellen', () => { closeModal(); doInstall(); }, 'primary')]);
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); installEvt = e;
    const shown = onInstallChange && onInstallChange(); // Einladungsseite zeigt den Knopf selbst
    if (!shown && !currentModal) askInstallOnce();
  });
  window.addEventListener('appinstalled', () => { installEvt = null; installedNow = true; if (onInstallChange) onInstallChange(); toast('App installiert!'); });

  // ---------- Start ----------
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && currentModal && !currentModal.dataset.locked) closeModal(); });
  window.addEventListener('hashchange', route);

  async function start() {
    if (CONFIGURED) {
      try { await loadMe(); } catch (e) {
        me = null;
        const msg = errMsg(e);
        if (/Keine Verbindung/.test(msg)) {
          $('#app').replaceChildren(el('main', { class: 'auth' }, el('div', { class: 'auth-card' },
            el('h1', { text: 'Keine Verbindung' }),
            el('p', { text: 'Charakter-Netz braucht eine Internetverbindung, um deine Boards zu laden.' }),
            btn('Erneut versuchen', () => location.reload(), 'primary'))));
          return;
        }
        await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      }
      // Abmeldung in einem anderen Tab oder abgelaufene Sitzung
      sb.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT' && me) setTimeout(() => { clearSessionState(); showAuth(); toast('Du bist nicht mehr angemeldet.'); }, 0);
      });
    }
    // Bereits angemeldet (z. B. „Angemeldet bleiben“ in der installierten App) und eine Einladung wartet:
    // sofort einlösen, das Board wird angehängt und geöffnet.
    const pend = me ? getPending() : null;
    if (pend) { clearPending(); if (pend !== location.hash) history.replaceState(null, '', location.pathname + location.search + pend); }
    await route();
    if (me) setTimeout(() => offerMigration(false), 800);
    // iOS und App-Browser (z. B. WhatsApp) haben keine Installations-Abfrage -> Anleitung einmal zeigen
    if ((isIOS || inAppBrowser) && !isStandalone()) setTimeout(() => { if (!currentModal && !(onInstallChange && !me) && (inAppBrowser || !store('cn-install-asked'))) { store('cn-install-asked', '1'); showInstallHelp(); } }, 1500);
  }
  // ---------- Updates ----------
  // Neue Versionen kommen automatisch: Der Service Worker lädt immer zuerst vom Server. Läuft eine ältere
  // Fassung noch im offenen Fenster, erscheint ein Hinweis zum Neuladen. Eine Neuinstallation ist nie nötig.
  function showUpdateBanner() {
    if (document.querySelector('.update-banner')) return;
    const bar = el('div', { class: 'update-banner', role: 'status' },
      el('span', { text: 'Eine neue Version von Charakter-Netz ist da.' }),
      btn('Jetzt aktualisieren', () => location.reload(), 'primary small'),
      btn('Später', () => bar.remove(), 'ghost small'));
    document.body.append(bar);
  }
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', async () => {
      if (!hadController) return;
      // Nur melden, wenn auf dem Server wirklich eine andere Version liegt als die, die gerade läuft
      try {
        const src = await (await fetch('app.js', { cache: 'no-store' })).text();
        const v = (/APP_VERSION = '([^']+)'/.exec(src) || [])[1];
        if (v && v !== APP_VERSION) showUpdateBanner();
      } catch { /* offline: nichts melden */ }
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
        const check = () => reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
        setInterval(check, 30 * 60000);
      }).catch(() => {});
    });
  }
  // Link geöffnet, während die installierte App schon läuft (Chrome/Edge): Einladung im offenen Fenster öffnen
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer((p) => {
      try { const h = new URL(p.targetURL).hash; if (INVITE_RE.test(h) && h !== location.hash) location.hash = h; } catch { /* egal */ }
    });
  }
  start();
})();
