// Who can open the site, sign-in, "I'm" and confirmations, stored in Supabase (supabase/schema.sql, README.md).
//
// The site is invite-only: its data files are encrypted, and the key is only given (by the database rules) to
// people who signed in and joined with an invite link, plus the organizers. Until then a sign-in screen shows.
//
// The page was written for claude.ai's `window.claude` runtime; this file also provides that small surface
// (db + user) backed by Supabase, so render.js didn't need to change.
(() => {
  // role: 'owner' | 'organizer' | 'player' | 'viewer'; scope: an organizer's tournament_ids, null = all of them
  const st = { client: null, session: null, admin: false, role: '', scope: null, member: false, claim: '', configured: false, rows: [], msg: '', showForm: false, providers: [], email: false };
  const listeners = [];
  const emit = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  const el = (id) => document.getElementById(id);
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (text, fn, cls) => { const b = mk('button', 'tt-btn' + (cls ? ' ' + cls : ''), text); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const ls = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set: (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* blocked */ } } };
  const home = () => location.origin + location.pathname;
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });

  // an invite link is ".../?invite=CODE": keep the code through the sign-in redirect
  (() => {
    const q = new URLSearchParams(location.search);
    if (q.get('invite')) {
      ls.set('tt-invite', q.get('invite'));
      q.delete('invite');
      try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); } catch (e) { /* ignore */ }
    }
  })();

  async function init() {
    let cfg = {};
    try { cfg = await (await fetch('config/supabase.json', { cache: 'no-cache' })).json(); } catch (e) { cfg = {}; }
    if (!cfg.url || !cfg.anon_key || !window.supabase) {
      gate('This site isn’t set up yet.', 'The organizer still needs to connect the sign-in database (see the README).');
      resolveReady();
      return;
    }
    st.configured = true;
    st.providers = Array.isArray(cfg.providers) ? cfg.providers : ['discord'];
    st.email = cfg.email === true;
    st.client = window.supabase.createClient(cfg.url, cfg.anon_key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    try { const { data } = await st.client.auth.getSession(); st.session = data.session; } catch (e) { st.session = null; }
    st.client.auth.onAuthStateChange((event, s) => {
      const was = st.session && st.session.user.id;
      st.session = s;
      if ((s && s.user.id) !== was) location.reload();
    });
    await open();
    resolveReady();
  }

  // sign-in screen, or the site once the key is in hand
  async function open() {
    if (!st.session) { gate(ls.get('tt-invite') ? 'You’ve been invited' : 'Sign in', ls.get('tt-invite') ? 'Sign in to accept your invite to the AoE2 Tournaments site.' : 'This site is for invited players. Sign in to open it.', true); return; }
    let key = await fetchKey();
    if (!key && ls.get('tt-invite')) {
      const { data, error } = await st.client.rpc('redeem_invite', { p_code: ls.get('tt-invite') });
      ls.set('tt-invite', '');
      if (error) console.error(error);
      if (data) key = await fetchKey();
      else st.msg = 'That invite link has already been used or has expired. Ask the organizer for a new one.';
    }
    if (!key) {
      gate('You’re signed in, but not invited yet', 'Ask the organizer for an invite link, then open it on this device.', false, true);
      return;
    }
    st.member = true;
    const raw = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
    window.TT_setKey(await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']));
    await refreshMe();
    await Promise.all([loadVotes(), loadChanges()]);
    const poll = () => { if (document.visibilityState === 'visible') { loadVotes(); loadChanges(); } };
    setInterval(poll, 20000);
    document.addEventListener('visibilitychange', poll);
    const g = el('tt-gate');
    if (g) g.remove();
    document.documentElement.classList.remove('tt-locked');
    window.dispatchEvent(new Event('resize'));
  }

  async function fetchKey() {
    const { data, error } = await st.client.from('site_secret').select('key').maybeSingle();
    if (error) { console.error(error); return ''; }
    return data ? data.key : '';
  }

  function signInButtons(box) {
    const names = { discord: 'Discord', google: 'Google', github: 'GitHub' };
    st.providers.forEach((p, i) => box.append(button(`Sign in with ${names[p] || p}`, async () => {
      const { error } = await st.client.auth.signInWithOAuth({ provider: p, options: { redirectTo: home() } });
      if (error) { st.msg = `Couldn’t start sign-in: ${error.message}`; redraw(); }
    }, i === 0 ? 'primary' : '')));
    if (st.email) {
      if (!st.showForm) box.append(button(st.providers.length ? 'Email me a link instead' : 'Sign in with email', () => { st.showForm = true; redraw(); }));
      else {
        const input = mk('input'); input.type = 'email'; input.placeholder = 'Your email'; input.autocomplete = 'email'; input.setAttribute('aria-label', 'Your email');
        const send = async () => {
          const email = input.value.trim();
          if (!/^\S+@\S+\.\S+$/.test(email)) { st.msg = 'Type your email address.'; redraw(); return; }
          const { error } = await st.client.auth.signInWithOtp({ email, options: { emailRedirectTo: home() } });
          st.msg = error ? `Couldn’t send the link: ${error.message}` : `Check ${email} for a sign-in link.`;
          redraw();
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
        box.append(input, button('Send link', send));
        setTimeout(() => input.focus(), 0);
      }
    }
  }

  let lastGate = null;
  function redraw() { if (lastGate) gate(...lastGate); }
  function gate(title, text, showSignIn, showSignOut) {
    lastGate = [title, text, showSignIn, showSignOut];
    document.documentElement.classList.add('tt-locked');
    const draw = () => {
      let g = el('tt-gate');
      if (!g) { g = mk('div'); g.id = 'tt-gate'; document.body.prepend(g); }
      g.replaceChildren(mk('h1', '', title), mk('p', '', text));
      const row = mk('div', 'tt-btns');
      if (showSignIn) signInButtons(row);
      if (showSignOut) row.append(button('Sign out', async () => { await st.client.auth.signOut(); location.reload(); }));
      if (row.childNodes.length) g.append(row);
      if (st.msg) g.append(mk('p', 'err', st.msg));
    };
    if (document.body) draw(); else document.addEventListener('DOMContentLoaded', draw);
  }

  async function refreshMe() {
    st.admin = false; st.role = ''; st.scope = null; st.claim = '';
    if (st.session) {
      try {
        const { data } = await st.client.from('players_claim').select('player').eq('user_id', st.session.user.id).maybeSingle();
        st.claim = data ? data.player : '';
        const r = await st.client.rpc('my_access');
        if (!r.error) { st.role = (r.data && r.data.role) || ''; st.scope = (r.data && r.data.scope) || null; }
        else { const a = await st.client.rpc('is_admin'); st.role = a.data ? 'owner' : 'player'; } // schema.sql not re-run yet
        st.admin = st.role === 'owner';
      } catch (e) { console.error(e); }
    }
    renderAuth();
  }
  const isOrganizer = () => st.role === 'owner' || st.role === 'organizer';
  const canRunAll = () => st.role === 'owner' || (st.role === 'organizer' && st.scope == null);
  const canRun = (tid) => canRunAll() || (st.role === 'organizer' && (st.scope || []).includes(tid));

  async function loadVotes() {
    const { data, error } = await st.client.from('confirmations').select('*');
    if (error) { console.error(error); return; }
    st.rows = data || [];
    if (window.dash && dash._setData) dash._setData('votes', st.rows);
    emit();
  }

  // organizer changes to tournaments and players, not yet saved into config/ by the update job (site/js/admin.js)
  async function loadChanges() {
    const { data, error } = await st.client.from('admin_changes').select('*').order('id');
    if (error) { st.changesError = error.message; console.error(error); return; }
    st.changesError = '';
    if (window.dash && dash._setData) dash._setData('admin_changes', data || []);
  }
  async function saveChange(kind, payload) {
    const { error } = await st.client.from('admin_changes').insert({ kind, payload, created_by: st.session.user.id });
    if (error) throw error;
    await loadChanges();
  }
  async function cancelChange(id) {
    const { error } = await st.client.from('admin_changes').delete().eq('id', id);
    if (error) throw error;
    await loadChanges();
  }

  async function claim(player) {
    if (st.role === 'viewer') { st.claim = ''; return; } // viewers follow a player on this device only
    const uid = st.session.user.id;
    const q = player
      ? st.client.from('players_claim').upsert({ user_id: uid, player }, { onConflict: 'user_id' })
      : st.client.from('players_claim').delete().eq('user_id', uid);
    const { error } = await q;
    if (error) {
      st.msg = /duplicate|unique/i.test(error.message) ? `Someone else already chose ${player}. Ask the organizer to free it up if that's you.` : `Couldn’t save who you are: ${error.message}`;
      renderAuth();
      throw error;
    }
    st.claim = player; st.msg = ''; renderAuth();
  }

  async function vote(d) {
    const row = { tournament_id: d.tournament_id, match_id: String(d.match_id), side: d.side, player: d.player, answer: d.answer, user_id: st.session.user.id };
    const { error } = await st.client.from('confirmations').upsert(row, { onConflict: 'tournament_id,match_id,side' });
    if (error) throw error;
    await loadVotes();
  }

  // ---------------------------------------------------------------- replays added on the site (pipeline/uploads.py)
  const canAddReplays = () => !!st.session && st.member && st.role !== 'viewer';
  async function addReplay(file, info) {
    if (!canAddReplays()) throw new Error('Viewers can’t add replays.');
    if (!/\.(aoe2record|zip)$/i.test(file.name)) throw new Error('Choose the game’s .aoe2record file.');
    if (file.size > 50 * 1024 * 1024) throw new Error('That file is over 50 MB, too big for a replay.');
    const path = `${st.session.user.id}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80)}`;
    const up = await st.client.storage.from('replays').upload(path, file, { contentType: 'application/octet-stream', upsert: false });
    if (up.error) throw up.error;
    const { error } = await st.client.from('replay_uploads').insert({ match_id: info.match_id, player: info.player, game: info.game || {}, path, uploaded_by: st.session.user.id });
    if (error) { await st.client.storage.from('replays').remove([path]); throw error; }
  }
  async function addedReplays(matchId) {
    const { data, error } = await st.client.from('replay_uploads').select('id,match_id,player,status,message,created_at,uploaded_by,path').eq('match_id', matchId).order('id');
    if (error) throw error;
    return (data || []).map((r) => ({ ...r, mine: r.uploaded_by === st.session.user.id }));
  }
  async function takeBackReplay(r) {
    const { error } = await st.client.from('replay_uploads').delete().eq('id', r.id);
    if (error) throw error;
    if (r.mine && r.path) await st.client.storage.from('replays').remove([r.path]);
  }

  // ---------------------------------------------------------------- header: who's signed in
  function renderAuth() {
    const box = el('auth-box');
    if (!box) return;
    box.hidden = false;
    box.replaceChildren(mk('span', 'tt-label', `Signed in${st.claim ? ` as ${st.claim}` : ''}${st.role && st.role !== 'player' ? ` · ${st.role}` : ''}`),
      button('Sign out', async () => { await st.client.auth.signOut(); location.reload(); }));
    if (!st.claim && st.role !== 'viewer') box.append(mk('span', 'tt-label', '· choose yourself under “I’m”'));
    if (st.msg) box.append(mk('span', 'tt-label', st.msg));
  }

  // ---------------------------------------------------------------- the window.claude surface render.js uses
  const none = { get: async () => ({ exists: false, data: () => undefined }), set: async () => { throw new Error('not available'); }, update: async () => { throw new Error('not available'); }, acquire: async () => ({ acquired: false }) };
  const db = {
    doc(path) {
      if (/^data\/users\/[^/]+\/me$/.test(path)) return { ...none, get: async () => ({ exists: !!st.claim, data: () => ({ player: st.claim }) }), set: async (d) => claim(d.player) };
      if (path.startsWith('confirm/')) return { ...none, set: async (d) => vote(d) };
      return none;
    },
    collection() {
      return {
        onSnapshot(next) {
          const fire = () => next({ docs: st.rows.map((r) => ({ id: `${r.tournament_id}_${r.match_id}_${r.side}`, data: () => r })) });
          listeners.push(fire); fire();
          return () => {};
        },
      };
    },
  };
  const user = {
    id: async () => (st.session ? st.session.user.id : null),
    isOwner: async () => isOrganizer(),
    canEdit: async () => isOrganizer(),
    can: async () => !!st.session && st.member,
    me: async () => ({ id: st.session ? st.session.user.id : null, name: st.claim || '', isOwner: isOrganizer(), canEdit: isOrganizer() }),
  };
  window.claude = { use: async (name) => { await ready; if (!st.member) return null; return name === 'db' ? db : name === 'user' ? user : null; } };
  window.TT_BACKEND = st;
  // games that already have an added replay waiting or read (so the replay folder doesn't add another)
  async function claimedGames() {
    const { data, error } = await st.client.from('replay_uploads').select('match_id,status').in('status', ['waiting', 'done']);
    if (error) throw error;
    return new Set((data || []).map((r) => r.match_id));
  }
  window.TT_UPLOAD = { can: canAddReplays, send: addReplay, list: addedReplays, cancel: takeBackReplay, claimed: claimedGames };
  // the Admin tab (site/js/admin.js); the database rules (supabase/schema.sql) check every one of these again
  const rpc = async (name, args) => { const { data, error } = await st.client.rpc(name, args); if (error) throw error; return data; };
  window.TT_ORG = {
    save: saveChange, cancel: cancelChange, isOrganizer, canRun, canRunAll,
    people: () => rpc('members_list'),
    setRole: (user, role, scope) => rpc('set_member_role', { p_user: user, p_role: role, p_scope: scope }),
    remove: (user) => rpc('remove_member', { p_user: user }),
    invite: (role) => rpc('create_invite', { p_role: role }),
    invites: () => rpc('invites_list'),
    cancelInvite: (code) => rpc('cancel_invite', { p_code: code }),
    link: (code) => `${home()}?invite=${code}`,
    vote,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
