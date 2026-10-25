// test stand-in for supabase-js with roles: window.__ROLE (from localStorage 'stubrole') picks who is signed in
(function () {
  const KEY = '__KEY__';
  const role = localStorage.getItem('stubrole') || 'owner';
  const scope = role === 'organizer' ? ['t1'] : null;
  const T = { site_secret: [{ key: KEY }], players_claim: [], confirmations: [], admin_changes: JSON.parse(localStorage.getItem('stubchanges') || '[]'), replay_uploads: [{ id: 7, match_id: 'gap-1-2', player: 'Ryan', status: 'rejected', message: 'This replay is from 2026-10-20 18:00 UTC; the missing game was between 2026-10-23 05:30 and 2026-10-23 06:08 UTC', uploaded_by: 'u-owner', path: 'u-owner/x' }] };
  const people = [
    { user_id: 'u-owner', player: 'Ryan', name: 'spartan3100', email: 'owner@example.com', role: 'owner', scope: null, added_at: '2026-10-22T12:00:00Z' },
    { user_id: 'u-org', player: 'Christopher', name: 'spartan1196', email: 'org@example.com', role: 'organizer', scope: ['t1'], added_at: '2026-10-22T13:00:00Z' },
    { user_id: 'u-p', player: 'Daniel', name: 'dirtydan44', email: 'p@example.com', role: 'player', scope: null, added_at: '2026-10-23T12:00:00Z' },
    { user_id: 'u-v', player: null, name: 'a_friend', email: 'v@example.com', role: 'viewer', scope: null, added_at: '2026-10-24T12:00:00Z' },
  ];
  let invites = [{ code: 'abcdef1234567890abcd', role: 'player', created_at: '2026-10-25T12:00:00Z', expires_at: '2026-11-08T12:00:00Z' }];
  let nextId = 100 + T.admin_changes.length;
  window.__T = T; window.__people = people;
  const save = () => localStorage.setItem('stubchanges', JSON.stringify(T.admin_changes));
  function q(table) {
    let op = 'select', filt = [], payload = null, single = false;
    const b = {
      select() { return b; }, order() { return b; }, eq(k, v) { filt.push([k, v]); return b; }, in(k, vs) { filt.push([k, vs]); return b; }, maybeSingle() { single = true; return b; },
      insert(p) { op = 'insert'; payload = p; return b; }, delete() { op = 'delete'; return b; }, upsert(p) { op = 'upsert'; payload = p; return b; },
      then(res, rej) {
        const m = (r) => filt.every(([k, v]) => Array.isArray(v) ? v.map(String).includes(String(r[k])) : String(r[k]) === String(v));
        let out = { data: null, error: null };
        const rows = T[table] || [];
        if (op === 'select') { const d = rows.filter(m); out.data = single ? d[0] || null : d; }
        if (op === 'insert') { if (table === 'replay_uploads' ? role === 'viewer' : role === 'player' || role === 'viewer') out.error = { message: 'new row violates row-level security policy' }; else { rows.push({ id: nextId++, created_at: new Date().toISOString(), status: 'waiting', message: '', ...payload }); save(); } }
        if (op === 'delete') { T[table] = rows.filter((r) => !m(r)); save(); }
        if (op === 'upsert') { T[table] = rows.filter((r) => !(r.match_id === payload.match_id && r.side === payload.side && r.tournament_id === payload.tournament_id)).concat(payload); }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return b;
  }
  const rpcs = {
    my_access: () => ({ role, scope }), is_admin: () => role === 'owner',
    members_list: () => people.map((p) => ({ ...p, email: role === 'owner' ? p.email : null })),
    invites_list: () => invites,
    create_invite: (a) => { const c = Math.random().toString(16).slice(2, 22).padEnd(20, '0'); invites.unshift({ code: c, role: a.p_role, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 14 * 864e5).toISOString() }); return c; },
    cancel_invite: (a) => { invites = invites.filter((i) => i.code !== a.p_code); },
    set_member_role: (a) => { if (role !== 'owner') throw { message: 'Only the owner can change roles' }; const p = people.find((x) => x.user_id === a.p_user); p.role = a.p_role; p.scope = a.p_role === 'organizer' ? a.p_scope : null; },
    remove_member: (a) => { const i = people.findIndex((x) => x.user_id === a.p_user); people.splice(i, 1); },
  };
  window.supabase = { createClient: () => ({
    auth: { updateUser: async (u) => { window.__meta = u.data; localStorage.setItem('stubmeta', JSON.stringify(u.data)); return { error: null }; }, getSession: async () => ({ data: { session: { user: { id: role === 'owner' ? 'u-owner' : 'u-' + role, user_metadata: JSON.parse(localStorage.getItem('stubmeta') || '{}') } } } }), onAuthStateChange() {}, signOut: async () => {} },
    from: q,
    storage: { from: () => ({ upload: async (p, f) => { window.__files = (window.__files || []).concat([[p, f.name, f.size]]); return { error: role === 'viewer' ? { message: 'denied' } : null }; }, remove: async (ps) => { window.__removed = ps; return { error: null }; } }) },
    rpc: async (n, a) => { try { return { data: rpcs[n] ? rpcs[n](a || {}) : null, error: rpcs[n] ? null : { message: 'function ' + n + ' does not exist' } }; } catch (e) { return { data: null, error: e }; } },
  }) };
})();
