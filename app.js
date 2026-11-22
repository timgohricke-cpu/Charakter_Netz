'use strict';
/*
 * Charakter-Netz
 * Boards mit Charaktertabelle, Charakternetz und Weltkarte.
 * Version 1: Daten werden lokal im Browser (IndexedDB) gespeichert.
 * Alle Nutzertexte werden mit textContent eingefügt (kein innerHTML) -> Schutz vor Script-Injection.
 */
(() => {
  // ---------- Hilfsfunktionen ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  const R = 36; // Radius der Kreise im Netz
  const VIEWS = ['tabelle', 'netz', 'karte'];
  const $ = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const initials = (n) => (n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

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
    setTimeout(() => t.remove(), 3200);
  }
  function store(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch { return null; }
    return null;
  }

  // Bild laden, verkleinern und als JPEG-Data-URL zurückgeben
  function readImage(file, max, quality = 0.85) {
    return new Promise((res, rej) => {
      if (!file || !/^image\//.test(file.type)) return rej(new Error('Bitte eine Bilddatei wählen.'));
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
        res({ src: c.toDataURL('image/jpeg', quality), w, h });
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Das Bild konnte nicht geladen werden.')); };
      img.src = url;
    });
  }

  // ---------- Speicher (IndexedDB) ----------
  const DB = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('charakter-netz', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('boards', { keyPath: 'id' });
        r.onsuccess = () => { this.db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    os(mode) { return this.db.transaction('boards', mode).objectStore('boards'); },
    all() { return req(this.os('readonly').getAll()); },
    get(id) { return req(this.os('readonly').get(id)); },
    put(b) { return req(this.os('readwrite').put(b)); },
    del(id) { return req(this.os('readwrite').delete(id)); },
  };
  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  // ---------- Zustand ----------
  let board = null;
  let view = 'netz';
  let netMode = 'move';
  let placing = null; // {draft, isNew} oder {charId}
  let focusChar = null;
  let tableSort = { key: 'name', dir: 1 };
  let tableFilter = '';
  const netT = new Map();
  const mapT = new Map();

  // Platzhalter für die spätere Rechteverwaltung (Ersteller/Besucher)
  const canEdit = () => true;

  const byId = (id) => board.characters.find((c) => c.id === id);
  const byLink = (id) => board.links.find((l) => l.id === id);
  function save() {
    if (!board) return;
    board.updated = Date.now();
    DB.put(board).catch((e) => toast('Speichern fehlgeschlagen: ' + e.message));
  }
  const newChar = (x, y) => ({ id: uid(), name: '', short: '', info: '', image: null, place: '', x, y, mapPos: null });

  // ---------- Navigation ----------
  function go(id, v) {
    const h = id ? `#/b/${encodeURIComponent(id)}/${v}` : '#/';
    if (location.hash === h) route(); else location.hash = h;
  }
  async function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    if (parts[0] === 'b' && parts[1]) {
      const id = decodeURIComponent(parts[1]);
      if (!board || board.id !== id) {
        const b = await DB.get(id);
        if (!b) { toast('Board nicht gefunden.'); go(null); return; }
        board = b;
      }
      view = VIEWS.includes(parts[2]) ? parts[2] : 'netz';
      if (view !== 'karte' && placing) placing = null;
      renderBoard();
    } else {
      showHome();
    }
  }

  // ---------- Dialoge ----------
  let currentModal = null;
  function closeModal() { if (currentModal) { currentModal.remove(); currentModal = null; } }
  function modal(title, body, actions = []) {
    closeModal();
    const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'modal-head' }, el('h2', { text: title }), el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Schließen', text: '✕', onclick: closeModal })),
      el('div', { class: 'modal-body' }, body),
      actions.length ? el('div', { class: 'modal-actions' }, actions) : null);
    const back = el('div', { class: 'backdrop' }, box);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) closeModal(); });
    document.body.append(back);
    currentModal = back;
    const f = box.querySelector('.modal-body input:not([type=file]), .modal-body textarea');
    if (f) f.focus();
  }
  function confirmBox(title, text, yesLabel, onYes) {
    modal(title, el('p', { text }), [btn('Abbrechen', closeModal, 'ghost'), btn(yesLabel, () => { closeModal(); onYes(); }, 'primary')]);
  }
  function askText(title, label, value, onOk) {
    const inp = el('input', { type: 'text', value, maxlength: 100 });
    const ok = () => { const v = inp.value.trim(); if (!v) { toast('Bitte einen Namen eingeben.'); return; } closeModal(); onOk(v); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    modal(title, el('div', { class: 'form' }, field(label, inp)), [btn('Abbrechen', closeModal, 'ghost'), btn('OK', ok, 'primary')]);
  }

  // ---------- Startseite: Boards ----------
  async function showHome() {
    board = null; placing = null; closeModal();
    const boards = (await DB.all()).sort((a, b) => b.updated - a.updated);
    const list = el('div', { class: 'board-list' });
    if (!boards.length) list.append(el('p', { class: 'empty', text: 'Noch keine Boards. Erstelle dein erstes Board!' }));
    for (const b of boards) {
      list.append(el('div', { class: 'board-card' },
        el('button', { class: 'board-open', type: 'button', onclick: () => go(b.id, 'netz') },
          el('h3', { text: b.name }),
          el('p', { text: `${b.characters.length} Charaktere · ${b.links.length} Verbindungen` }),
          el('small', { text: 'Geändert: ' + new Date(b.updated).toLocaleString('de-DE') })),
        el('div', { class: 'board-tools' },
          btn('Umbenennen', () => askText('Board umbenennen', 'Name', b.name, async (v) => { b.name = v; b.updated = Date.now(); await DB.put(b); showHome(); }), 'ghost small'),
          btn('Exportieren', () => exportBoard(b), 'ghost small'),
          btn('Löschen', () => confirmBox('Board löschen?', `„${b.name}“ wird mit allen Charakteren unwiderruflich gelöscht.`, 'Löschen', async () => { await DB.del(b.id); showHome(); }), 'ghost small danger'))));
    }
    const imp = el('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', onchange: () => importBoard(imp.files[0]) });
    $('#app').replaceChildren(
      el('header', { class: 'topbar' },
        el('div', { class: 'brand' }, el('img', { src: 'icon.svg', alt: '', class: 'logo' }), el('span', { text: 'Charakter-Netz' })),
        el('div', { class: 'spacer' }), installButton()),
      el('main', { class: 'home' },
        el('div', { class: 'home-head' }, el('h1', { text: 'Deine Boards' }),
          el('div', { class: 'row' }, el('label', { class: 'btn' }, 'Importieren', imp), btn('+ Neues Board', newBoard, 'primary'))),
        list,
        el('p', { class: 'note', text: 'Hinweis: Deine Boards werden in dieser Version nur in diesem Browser auf diesem Gerät gespeichert. Mit „Exportieren“ kannst du ein Board als Datei sichern oder weitergeben.' })));
  }
  function newBoard() {
    askText('Neues Board', 'Name des Boards', '', async (name) => {
      const b = { id: uid(), name, created: Date.now(), updated: Date.now(), map: null, characters: [], links: [] };
      await DB.put(b);
      go(b.id, 'netz');
    });
  }
  function exportBoard(b) {
    const blob = new Blob([JSON.stringify({ format: 'charakter-netz', version: 1, ...b })], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: (b.name.replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim() || 'board') + '.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function importBoard(file) {
    if (!file) return;
    try {
      const b = sanitizeBoard(JSON.parse(await file.text()));
      await DB.put(b);
      toast('Board importiert.');
      showHome();
    } catch (e) { toast('Import fehlgeschlagen: ' + e.message); }
  }
  // Importierte Daten streng prüfen
  function sanitizeBoard(o) {
    const str = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '');
    const img = (s) => (typeof s === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : null);
    const num = (n) => (Number.isFinite(n) ? n : 0);
    if (!o || typeof o !== 'object' || !Array.isArray(o.characters)) throw new Error('Keine gültige Board-Datei.');
    const idMap = new Map();
    const characters = o.characters.slice(0, 2000).map((c) => {
      const id = uid(); idMap.set(c && c.id, id);
      const mp = c && c.mapPos && Number.isFinite(c.mapPos.x) && Number.isFinite(c.mapPos.y) ? { x: clamp(c.mapPos.x, 0, 1), y: clamp(c.mapPos.y, 0, 1) } : null;
      return { id, name: str(c.name, 100) || 'Unbenannt', short: str(c.short, 300), info: str(c.info, 20000), image: img(c.image), place: str(c.place, 2000), x: num(c.x), y: num(c.y), mapPos: mp };
    });
    const links = (Array.isArray(o.links) ? o.links : []).slice(0, 10000)
      .filter((l) => l && idMap.has(l.a) && idMap.has(l.b) && l.a !== l.b)
      .map((l) => ({ id: uid(), a: idMap.get(l.a), b: idMap.get(l.b), short: str(l.short, 120), long: str(l.long, 20000) }));
    const map = o.map && img(o.map.src) ? { src: o.map.src, w: num(o.map.w) || 1000, h: num(o.map.h) || 500 } : null;
    return { id: uid(), name: str(o.name, 100) || 'Importiertes Board', created: Date.now(), updated: Date.now(), map, characters, links };
  }

  // ---------- Board ----------
  function renderBoard() {
    closeModal();
    const items = [['tabelle', 'Tabelle', '▦'], ['netz', 'Charakternetz', '◉'], ['karte', 'Weltkarte', '◍']];
    const nav = el('nav', { class: 'sidenav', 'aria-label': 'Ansichten' }, items.map(([k, label, ico]) =>
      el('button', { class: 'nav-btn' + (k === view ? ' active' : ''), type: 'button', onclick: () => go(board.id, k), 'aria-current': k === view ? 'page' : null },
        el('span', { class: 'nav-ico', text: ico }), el('span', { text: label }))));
    const main = el('section', { class: 'view' });
    $('#app').replaceChildren(
      el('header', { class: 'topbar' },
        btn('← Boards', () => go(null), 'ghost small'),
        el('h1', { class: 'board-title', text: board.name }),
        el('div', { class: 'spacer' }), installButton()),
      el('div', { class: 'board-layout' }, nav, main));
    if (view === 'tabelle') renderTable(main);
    else if (view === 'karte') renderMap(main);
    else renderNet(main);
  }
  function avatarContent(c) {
    return c.image ? el('img', { src: c.image, alt: '' }) : el('span', { text: initials(c.name) });
  }

  // ---------- Charakter: Erstellen / Bearbeiten ----------
  function charForm(src, isNew) {
    const d = { ...src, mapPos: src.mapPos ? { ...src.mapPos } : null };
    const name = el('input', { type: 'text', value: d.name, maxlength: 100, placeholder: 'Name des Charakters' });
    const short = el('input', { type: 'text', value: d.short, maxlength: 300, placeholder: 'z. B. Junge Schmiedin aus dem Norden' });
    const info = el('textarea', { rows: 6, maxlength: 20000, placeholder: 'Ausführliche Infos: Aussehen, Geschichte, Eigenschaften …' });
    info.value = d.info;
    const place = el('textarea', { rows: 2, maxlength: 2000, placeholder: 'z. B. Lebt in der Hafenstadt Velmar' });
    place.value = d.place;
    const preview = el('div', { class: 'avatar big' });
    const setPrev = () => preview.replaceChildren(avatarContent({ ...d, name: name.value || d.name }));
    const rmImg = btn('Bild entfernen', () => { d.image = null; setPrev(); rmImg.hidden = true; }, 'ghost small danger');
    rmImg.hidden = !d.image;
    const file = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', onchange: async () => {
      try { d.image = (await readImage(file.files[0], 400)).src; setPrev(); rmImg.hidden = false; } catch (e) { toast(e.message); }
    } });
    name.addEventListener('input', () => { if (!d.image) setPrev(); });
    setPrev();
    const collect = () => { d.name = name.value.trim(); d.short = short.value.trim(); d.info = info.value; d.place = place.value; };
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
      field('Infos', info),
      el('fieldset', {}, el('legend', { text: 'Standort' }),
        field('Standort-Beschreibung', place),
        el('div', { class: 'row' }, mapState, setPos, rmPos)));
    modal(isNew ? 'Neuer Charakter' : 'Charakter bearbeiten', body, [
      btn('Abbrechen', closeModal, 'ghost'),
      btn(isNew ? 'Erstellen' : 'Speichern', () => {
        collect();
        if (!d.name) { toast('Bitte einen Namen eingeben.'); name.focus(); return; }
        if (isNew) board.characters.push(d);
        else { const i = board.characters.findIndex((c) => c.id === d.id); if (i >= 0) board.characters[i] = d; else board.characters.push(d); }
        save(); renderBoard();
      }, 'primary')]);
  }

  // ---------- Charakter: Infokarte ----------
  function charInfo(id) {
    const c = byId(id);
    if (!c) return;
    const links = board.links.filter((l) => l.a === id || l.b === id);
    const body = el('div', { class: 'info' },
      el('div', { class: 'info-head' }, el('div', { class: 'avatar big' }, avatarContent(c)),
        el('div', {}, el('h3', { text: c.name }), c.short ? el('p', { class: 'lead', text: c.short }) : null)),
      c.info ? section('Infos', el('p', { class: 'pre', text: c.info })) : null,
      (c.place || c.mapPos) ? section('Standort',
        c.place ? el('p', { class: 'pre', text: c.place }) : null,
        c.mapPos && board.map ? btn('Auf Weltkarte zeigen', () => { focusChar = id; go(board.id, 'karte'); }, 'small') : null) : null,
      section(`Verbindungen (${links.length})`, links.length
        ? el('ul', { class: 'link-list' }, links.map((l) => {
          const o = byId(l.a === id ? l.b : l.a);
          return el('li', {}, el('button', { class: 'linkbtn', type: 'button', onclick: () => linkInfo(l.id) },
            el('strong', { text: o ? o.name : '?' }), ' – ', l.short || '(ohne Beschreibung)'));
        }))
        : el('p', { class: 'muted', text: 'Noch keine Verbindungen.' })));
    const actions = canEdit()
      ? [btn('Löschen', () => confirmBox('Charakter löschen?', `„${c.name}“ und alle Verbindungen dieses Charakters werden gelöscht.`, 'Löschen', () => {
        board.characters = board.characters.filter((x) => x.id !== id);
        board.links = board.links.filter((l) => l.a !== id && l.b !== id);
        save(); renderBoard();
      }), 'ghost danger left'), btn('Bearbeiten', () => charForm(c, false), 'primary')]
      : [btn('Schließen', closeModal)];
    modal('Charakter', body, actions);
  }

  // ---------- Verbindungen ----------
  function linkForm(l, isNew) {
    const a = byId(l.a), b = byId(l.b);
    if (!a || !b) return;
    const short = el('input', { type: 'text', value: l.short, maxlength: 120, placeholder: 'z. B. Geschwister, Rivalen, Mentor' });
    const long = el('textarea', { rows: 7, maxlength: 20000, placeholder: 'Ausführliche Beschreibung der Beziehung …' });
    long.value = l.long;
    modal(isNew ? 'Neue Verbindung' : 'Verbindung bearbeiten', el('div', { class: 'form' },
      el('p', { class: 'pair' }, el('strong', { text: a.name }), '  ↔  ', el('strong', { text: b.name })),
      field('Kurzbeschreibung (steht auf der Linie)', short),
      field('Lange Beschreibung', long)), [
      btn('Abbrechen', closeModal, 'ghost'),
      btn(isNew ? 'Verbinden' : 'Speichern', () => {
        const d = { ...l, short: short.value.trim(), long: long.value };
        if (!d.short) { toast('Bitte eine Kurzbeschreibung eingeben.'); short.focus(); return; }
        if (isNew) board.links.push(d); else Object.assign(byLink(l.id), d);
        save(); renderBoard();
      }, 'primary')]);
  }
  function linkInfo(id) {
    const l = byLink(id);
    if (!l) return;
    const a = byId(l.a), b = byId(l.b);
    const person = (c) => el('button', { class: 'linkbtn', type: 'button', onclick: () => charInfo(c.id) }, el('strong', { text: c.name }));
    const body = el('div', { class: 'info' },
      el('div', { class: 'row' }, person(a), el('span', { text: '↔' }), person(b)),
      section('Kurzbeschreibung', el('p', { class: 'pre', text: l.short })),
      section('Beschreibung', l.long ? el('p', { class: 'pre', text: l.long }) : el('p', { class: 'muted', text: 'Keine lange Beschreibung.' })));
    modal('Verbindung', body, canEdit()
      ? [btn('Löschen', () => confirmBox('Verbindung löschen?', `Die Verbindung zwischen „${a.name}“ und „${b.name}“ wird gelöscht.`, 'Löschen', () => {
        board.links = board.links.filter((x) => x.id !== id); save(); renderBoard();
      }), 'ghost danger left'), btn('Bearbeiten', () => linkForm(l, false), 'primary')]
      : [btn('Schließen', closeModal)]);
  }

  // ---------- Verschieben & Zoomen (Maus, Mausrad, Touch, Pinch) ----------
  class PanZoom {
    constructor(c, apply, o = {}) {
      this.c = c; this.applyFn = apply; this.o = o;
      this.t = { x: 0, y: 0, k: 1 }; this.min = o.min ?? 0.1; this.max = o.max ?? 6;
      this.ptr = new Map(); this.h = null; this.pinch = null;
      c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }, { passive: false });
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
    const defs = sv('defs'); const cp = sv('clipPath', { id: 'clipc' }); cp.append(sv('circle', { cx: 0, cy: 0, r: R })); defs.append(cp);
    const vp = sv('g'); const gl = sv('g'); const gn = sv('g');
    const rubber = sv('line', { class: 'rubber' }); rubber.style.display = 'none';
    vp.append(gl, rubber, gn); svg.append(defs, vp); wrap.append(svg);
    const hint = el('div', { class: 'hint' });

    const modes = [['move', '✋ Bewegen'], ['add', '＋ Charakter'], ['link', '🔗 Verbinden']];
    const modeBtns = modes.map(([m, label]) => btn(label, () => setMode(m), 'small' + (netMode === m ? ' active' : '')));
    function setMode(m) {
      netMode = m; first = null; rubber.style.display = 'none';
      modeBtns.forEach((b, i) => b.classList.toggle('active', modes[i][0] === m));
      wrap.className = 'canvas grid mode-' + m;
      drawNodes(); updHint();
    }
    function updHint() {
      const txt = {
        move: board.characters.length ? 'Kreise ziehen zum Verschieben · Klick auf Kreis oder Linie: Infos · Hintergrund ziehen: Ansicht bewegen · Mausrad / zwei Finger: Zoom' : 'Wähle „＋ Charakter“ und klicke auf eine freie Stelle, um deinen ersten Charakter zu erstellen.',
        add: 'Klicke auf eine freie Stelle, um dort einen Charakter zu erstellen.',
        link: first ? 'Jetzt den zweiten Charakter anklicken (Klick ins Leere bricht ab).' : 'Klicke auf den ersten Charakter, dann auf den zweiten.',
      };
      hint.textContent = txt[netMode];
    }

    function drawLinks() {
      gl.replaceChildren();
      for (const l of board.links) {
        const a = byId(l.a), b = byId(l.b);
        if (!a || !b) continue;
        const g = sv('g', { class: 'link' });
        g.append(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
        const label = trunc(l.short || '…', 32);
        const w = label.length * 6.8 + 16;
        const lb = sv('g', { class: 'link-label', transform: `translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})`, tabindex: 0 });
        lb.dataset.link = l.id;
        lb.append(sv('rect', { x: -w / 2, y: -11, width: w, height: 22, rx: 11 }));
        const t = sv('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }); t.textContent = label;
        const tt = sv('title'); tt.textContent = l.short;
        lb.append(t, tt); g.append(lb); gl.append(g);
      }
    }
    function drawNodes() {
      gn.replaceChildren();
      for (const c of board.characters) {
        const g = sv('g', { class: 'node' + (first === c.id ? ' selected' : ''), transform: `translate(${c.x},${c.y})` });
        g.dataset.char = c.id;
        g.append(sv('circle', { class: 'node-bg', r: R }));
        if (c.image) {
          const im = sv('image', { x: -R, y: -R, width: 2 * R, height: 2 * R, 'clip-path': 'url(#clipc)', preserveAspectRatio: 'xMidYMid slice' });
          im.setAttribute('href', c.image);
          g.append(im);
        } else {
          const t = sv('text', { class: 'initials', 'text-anchor': 'middle', 'dominant-baseline': 'central' }); t.textContent = initials(c.name); g.append(t);
        }
        g.append(sv('circle', { class: 'node-ring', r: R }));
        const nm = sv('text', { class: 'node-name', 'text-anchor': 'middle', y: R + 18 }); nm.textContent = trunc(c.name, 24);
        g.append(nm); gn.append(g);
      }
    }
    function nodeTap(c) {
      if (netMode !== 'link') { charInfo(c.id); return; }
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
              move(ev) { const p = pz.toWorld(ev.clientX, ev.clientY); c.x = Math.round(ox + p.x - s.x); c.y = Math.round(oy + p.y - s.y); n.setAttribute('transform', `translate(${c.x},${c.y})`); drawLinks(); },
              up(ev, moved) { if (moved) save(); else charInfo(c.id); },
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
      const pad = R + 50;
      const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
      const k = clamp(Math.min(r.width / (maxX - minX), r.height / (maxY - minY)), 0.1, 1.5);
      pz.set({ x: r.width / 2 - ((minX + maxX) / 2) * k, y: r.height / 2 - ((minY + maxY) / 2) * k, k });
    }

    main.append(el('div', { class: 'toolbar' }, canEdit() ? modeBtns : null, el('div', { class: 'spacer' }), zoomButtons(pz, fit)), wrap, hint);
    wrap.className = 'canvas grid mode-' + netMode;
    drawLinks(); drawNodes(); updHint();
    const saved = netT.get(board.id);
    if (saved) pz.set(saved); else fit();
  }

  // ---------- Ansicht: Weltkarte ----------
  function renderMap(main) {
    const wrap = el('div', { class: 'canvas' });
    const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden', onchange: async () => {
      try {
        toast('Karte wird verarbeitet …');
        const r = await readImage(fileIn.files[0], 4096, 0.9);
        board.map = { src: r.src, w: r.w, h: r.h };
        mapT.delete(board.id); save(); renderBoard();
      } catch (e) { toast(e.message); }
    } });
    if (!board.map) {
      main.append(el('div', { class: 'toolbar' }, el('span', { class: 'muted', text: 'Weltkarte' })), wrap);
      wrap.append(el('div', { class: 'empty-map' },
        el('h2', { text: 'Noch keine Weltkarte' }),
        el('p', { text: 'Lade ein Bild deiner Weltkarte hoch. Danach kannst du deine Charaktere als Punkte darauf platzieren, hineinzoomen und sie anklicken.' }),
        canEdit() ? el('label', { class: 'btn primary' }, 'Kartenbild hochladen', fileIn) : null));
      placing = null;
      return;
    }
    const M = board.map;
    const inner = el('div', { class: 'map-inner' });
    inner.style.width = M.w + 'px'; inner.style.height = M.h + 'px';
    const img = el('img', { src: M.src, alt: 'Weltkarte', draggable: 'false', width: M.w, height: M.h });
    inner.append(img);
    const pins = [];
    for (const c of board.characters) {
      if (!c.mapPos) continue;
      const p = el('div', { class: 'pin' + (focusChar === c.id ? ' focus' : ''), role: 'button', tabindex: 0, title: c.name, 'aria-label': c.name },
        el('span', { class: 'pin-dot' }, avatarContent(c)), el('span', { class: 'pin-name', text: c.name }));
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
        if (!placing) return;
        const w = pz.toWorld(e.clientX, e.clientY);
        if (w.x < 0 || w.y < 0 || w.x > M.w || w.y > M.h) { toast('Bitte auf die Karte klicken.'); return; }
        const pos = { x: w.x / M.w, y: w.y / M.h };
        const pl = placing; placing = null;
        if (pl.draft) { pl.draft.mapPos = pos; renderBoard(); charForm(pl.draft, pl.isNew); }
        else { const c = byId(pl.charId); if (c) { c.mapPos = pos; save(); } renderBoard(); }
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
    const cols = [['bild', '', 'narrow'], ['name', 'Name', ''], ['short', 'Kurzbeschreibung', ''], ['place', 'Standort', 'hide-sm'], ['links', 'Verbindungen', 'hide-sm'], ['map', 'Karte', 'narrow hide-sm']];
    const val = (c, k) => (k === 'links' ? linkCount.get(c.id) || 0 : k === 'map' ? (c.mapPos ? 1 : 0) : (c[k] || '').toLowerCase());
    function fill() {
      const q = tableFilter.trim().toLowerCase();
      const rows = board.characters
        .filter((c) => !q || [c.name, c.short, c.place, c.info].some((s) => (s || '').toLowerCase().includes(q)))
        .sort((a, b) => { const x = val(a, tableSort.key), y = val(b, tableSort.key); return (x < y ? -1 : x > y ? 1 : 0) * tableSort.dir; });
      tbody.replaceChildren(...rows.map((c) => {
        const tr = el('tr', { tabindex: 0, onclick: () => charInfo(c.id) },
          el('td', { class: 'narrow' }, el('div', { class: 'avatar' }, avatarContent(c))),
          el('td', {}, el('strong', { text: c.name })),
          el('td', { class: 'clip', text: c.short }),
          el('td', { class: 'clip hide-sm', text: c.place }),
          el('td', { class: 'hide-sm', text: String(linkCount.get(c.id) || 0) }),
          el('td', { class: 'narrow hide-sm', text: c.mapPos ? '✓' : '–' }));
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') charInfo(c.id); });
        return tr;
      }));
      if (!rows.length) tbody.append(el('tr', {}, el('td', { colspan: 6, class: 'muted', text: board.characters.length ? 'Keine Treffer.' : 'Noch keine Charaktere. Füge über „+ Charakter“ einen hinzu.' })));
    }
    search.addEventListener('input', () => { tableFilter = search.value; fill(); });
    const thead = el('thead', {}, el('tr', {}, cols.map(([k, label, cls]) => el('th', { class: cls, onclick: k === 'bild' ? null : () => {
      tableSort = tableSort.key === k ? { key: k, dir: -tableSort.dir } : { key: k, dir: 1 };
      renderBoard();
    } }, label, tableSort.key === k && label ? (tableSort.dir > 0 ? ' ▲' : ' ▼') : ''))));
    main.append(
      el('div', { class: 'toolbar' }, search, el('div', { class: 'spacer' }),
        canEdit() ? btn('+ Charakter', () => charForm(newChar(Math.round(Math.random() * 400 - 200), Math.round(Math.random() * 300 - 150)), true), 'primary small') : null),
      el('div', { class: 'table-wrap' }, el('table', {}, thead, tbody)));
    fill();
  }

  // ---------- Installation als App (Desktop-Symbol) ----------
  let installEvt = null;
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
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
    } else showInstallHelp();
  }
  function showInstallHelp() {
    const steps = [];
    if (inAppBrowser) steps.push('Du bist im Browser einer App (z. B. WhatsApp). Öffne den Link zuerst über „⋮“ bzw. das Teilen-Symbol mit „Im Browser öffnen“.');
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
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (!currentModal) askInstallOnce(); });
  window.addEventListener('appinstalled', () => { installEvt = null; toast('App installiert!'); });

  // ---------- Start ----------
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && currentModal) closeModal(); });
  window.addEventListener('hashchange', route);

  async function start() {
    try { await DB.open(); } catch {
      $('#app').replaceChildren(el('p', { class: 'loading', text: 'Der Browser-Speicher ist nicht verfügbar (z. B. im privaten Modus). Bitte öffne die Seite in einem normalen Fenster.' }));
      return;
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    await route();
    // iOS und App-Browser haben keine Installations-Abfrage -> Anleitung einmal zeigen
    if ((isIOS || inAppBrowser) && !isStandalone()) setTimeout(() => { if (!currentModal && !store('cn-install-asked')) { store('cn-install-asked', '1'); showInstallHelp(); } }, 1200);
  }
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  start();
})();
