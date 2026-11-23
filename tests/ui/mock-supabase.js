// Nachgebauter Supabase-Client für tests/ui/test_ui.py (In-Memory, kein Netzwerk).
// Daten: Board 25fe99f5… von test_ersteller (31 Charaktere c0–c29 + cj1, 30 Verbindungen, Fraktionen Nordreich (c0, c1, c10)
// und Ostlande (c4, c10, c11; c10 hat beide), Figur 4 verstorben, 5 Pins, Karte), fremdes Board bbbbbbbb… von 山田太郎 (Besucher-Sicht),
// Besucher des eigenen Boards: test_besucher (u-vis) und さくら (u-jp) – für „Ersteller übertragen“. window.__transferFail = 'code' -> Fehler.
// Seit 2.11: Tabelle character_notes (Notizzettel, Verfasser setzt der „Server“ = test_ersteller, höchstens 4 je Charakter -> limit_notes),
// boards.members_can_edit, board_visits.can_edit (Bearbeitungsrechte).
// Steuerung: localStorage mock-out=1 -> abgemeldet; window.__delay = ms -> jede Anfrage verzögern (langsames Netz). Protokolle: window.__calls, window.__auth, window.__signs.
(() => {
  const OWNER = 'u-owner', BID = '25fe99f5-5b14-4518-94f2-9e278df9c4a9';
  const db = window.__db = {
    profiles: [{ id: OWNER, username: 'test_ersteller' }, { id: 'u-other', username: '山田太郎' }, { id: 'u-vis', username: 'test_besucher' }, { id: 'u-jp', username: 'さくら' }],
    boards: [{ id: BID, owner_id: OWNER, name: 'Testprojekt', map_path: BID + '/map-1.jpg', map_w: 800, map_h: 500, members_can_edit: false, created_at: '2026-01-01', updated_at: '2026-01-02' },
      { id: 'bbbbbbbb-0000-4000-8000-000000000002', owner_id: 'u-other', name: '東京の物語', map_path: null, members_can_edit: false, created_at: '2026-01-01', updated_at: '2026-01-02' }],
    characters: [], links: [], factions: [{ id: 'f1', board_id: BID, name: 'Nordreich', color: '#e74c3c' }, { id: 'f2', board_id: BID, name: 'Ostlande', color: '#3498db' }], character_factions: [], board_visits: [], character_notes: [],
  };
  for (let i = 0; i < 30; i++) db.characters.push({ id: 'c' + i, board_id: BID, name: 'Figur ' + i, short: 'k' + i, info: '', place: '', image_path: i % 3 ? null : BID + '/p-' + i + '.jpg', x: (i % 6) * 150, y: Math.floor(i / 6) * 150, map_x: i < 5 ? i / 6 : null, map_y: i < 5 ? 0.5 : null, dead: i === 4 });
  for (let i = 1; i < 30; i++) db.links.push({ id: 'l' + i, board_id: BID, a: 'c0', b: 'c' + i, short: 'Rel ' + i, long: '' });
  db.characters.push({ id: 'cj1', board_id: BID, name: 'カタカナ姫', short: 'とても長い日本語の説明文です', info: '', place: '', image_path: null, x: -200, y: -200, map_x: null, map_y: null, dead: false });
  db.links.push({ id: 'lj', board_id: BID, a: 'cj1', b: 'c1', short: '幼なじみの親友', long: '' });
  db.character_factions.push({ board_id: BID, character_id: 'c0', faction_id: 'f1', position: 0 });
  for (const c of ['c4', 'c10', 'c11']) db.character_factions.push({ board_id: BID, character_id: c, faction_id: 'f2', position: 0 });
  db.character_factions.push({ board_id: BID, character_id: 'c1', faction_id: 'f1', position: 0 }, { board_id: BID, character_id: 'c10', faction_id: 'f1', position: 1 });
  // Mitglieder (Besucher) des eigenen Boards: test_besucher und さくら
  db.board_visits.push({ user_id: 'u-vis', board_id: BID, visited_at: '2026-11-20T10:00:00Z', can_edit: false }, { user_id: 'u-jp', board_id: BID, visited_at: '2026-11-21T10:00:00Z', can_edit: false });
  window.__calls = []; window.__signs = 0;
  // Spalten auf oberster Ebene trennen (Klammern von Einbettungen beachten)
  const splitTop = (cols) => { const out = []; let d = 0, cur = ''; for (const ch of cols) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((c) => c.trim()).filter(Boolean); };
  const pick = (r, cols) => {
    const o = {};
    for (const c of splitTop(cols)) {
      const em = /^(\w+):(\w+)!\w*_(\w+?_id)_fkey\((.*)\)$/.exec(c); // Einbettung alias:tabelle!fremdschlüssel(spalten)
      if (em) { const row = db[em[2]].find((x) => x.id === r[em[3]]); o[em[1]] = row ? pick(row, em[4]) : null; continue; }
      const k = c.split('(')[0].split(':').pop(); if (k in r) o[k] = r[k];
      if (c.includes('(count)')) o[k] = [{ count: db[k].filter((x) => x.board_id === r.id).length }];
    }
    return o;
  };
  // Ersteller übertragen wie public.transfer_board_owner (gleiche Fehlercodes)
  const transfer = (a) => {
    const bd = db.boards.find((x) => x.id === a.p_board);
    if (!bd || bd.owner_id !== OWNER) return { data: null, error: { message: 'not_owner', code: 'P0001' } };
    if (!a.p_new_owner || a.p_new_owner === OWNER) return { data: null, error: { message: 'invalid_new_owner', code: 'P0001' } };
    if (window.__transferFail) return { data: null, error: { message: window.__transferFail, code: 'P0001' } };
    if (!db.board_visits.some((v) => v.board_id === bd.id && v.user_id === a.p_new_owner)) return { data: null, error: { message: 'new_owner_no_access', code: 'P0001' } };
    bd.owner_id = a.p_new_owner;
    db.board_visits = db.board_visits.filter((v) => !(v.board_id === bd.id && v.user_id === a.p_new_owner));
    db.board_visits.push({ user_id: OWNER, board_id: bd.id, visited_at: new Date().toISOString() });
    return { data: null, error: null };
  };
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.cols = '*'; this.single = false; this.ret = false; }
    select(c) { if (this.op === 'select') this.cols = c || '*'; else this.ret = true; return this; }
    eq(k, v) { this.f.push((r) => r[k] === v); return this; }
    order() { return this; } range(a, b) { this.rg = [a, b]; return this; }
    maybeSingle() { this.single = true; return this; }
    insert(rows) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
    update(p) { this.op = 'update'; this.patch = p; return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { return (window.__delay ? new Promise((r) => setTimeout(r, window.__delay)) : Promise.resolve()).then(() => this.run()).then(res, rej); }
    run() {
      window.__calls.push([this.op, this.t, this.patch || this.rows || null]);
      const tab = db[this.t]; const m = (r) => this.f.every((f) => f(r));
      if (this.op === 'insert' && this.t === 'character_notes') { // wie Trigger set_note_author + Grenze in enforce_limits
        for (const r of this.rows) {
          if (tab.filter((x) => x.character_id === r.character_id).length + this.rows.filter((x) => x !== r && x.character_id === r.character_id && this.rows.indexOf(x) < this.rows.indexOf(r)).length >= 4) return { data: null, error: { message: 'limit_notes', code: 'P0001' } };
        }
        const out = this.rows.map((r) => ({ id: r.id || crypto.randomUUID(), ...r, author_id: OWNER, author_name: 'test_ersteller', created_at: new Date().toISOString() }));
        tab.push(...out); return { data: out.map((r) => ({ id: r.id })), error: null };
      }
      if (this.op === 'insert') { const out = this.rows.map((r) => ({ id: r.id || crypto.randomUUID(), owner_id: OWNER, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r })); tab.push(...out); return { data: out.map((r) => ({ id: r.id })), error: null }; }
      if (this.op === 'update') { const hit = tab.filter(m); hit.forEach((r) => Object.assign(r, this.patch)); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
      if (this.op === 'delete') { const hit = tab.filter(m); db[this.t] = tab.filter((r) => !m(r)); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
      let rows = tab.filter(m).map((r) => (this.cols === '*' ? { ...r } : pick(r, this.cols)));
      if (this.rg) rows = rows.slice(this.rg[0], this.rg[1] + 1);
      return { data: this.single ? rows[0] || null : rows, error: null };
    }
  }
  const session = { access_token: 't', user: { id: OWNER } };
  const loggedIn = () => localStorage.getItem('mock-out') !== '1';
  window.__auth = [];
  window.supabase = { createClient: () => ({
    from: (t) => new Q(t),
    rpc: async (n, a) => { window.__calls.push(['rpc', n, a]); if (n === 'transfer_board_owner') return transfer(a); return { data: n === 'get_share_token' ? '11111111-2222-3333-4444-555555555555' : n === 'open_shared_board' ? a.p_board : null, error: null }; },
    auth: {
      getSession: async () => ({ data: { session: loggedIn() ? session : null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { localStorage.setItem('mock-out', '1'); return {}; },
      signInWithPassword: async (x) => { window.__auth.push(['in', x.email]); localStorage.removeItem('mock-out'); return { error: null }; },
      updateUser: async () => ({ error: null }),
      signUp: async (x) => { window.__auth.push(['up', x.email, x.options.data.username]); localStorage.removeItem('mock-out'); return { data: { session }, error: null }; },
    },
    storage: { from: () => ({
      createSignedUrls: async (paths) => { window.__signs++; return { data: paths.map((p) => ({ path: p, signedUrl: 'https://cecddgekcowcxripwxzi.supabase.co/storage/v1/object/sign/' + p + '?t=' + window.__signs })), error: null }; },
      upload: async () => ({ error: null }), remove: async () => ({ error: null }), list: async () => ({ data: [], error: null }), download: async () => ({ data: new Blob(['x']), error: null }),
    }) },
  }) };
})();
