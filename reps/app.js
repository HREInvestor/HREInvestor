/* HREI REPS Log — private IRC 469(c)(7) hours tracker. Vanilla JS, no build step. */
(function () {
  'use strict';
  const SUPABASE_URL = 'https://lmivqwscebdupfxxwfcc.supabase.co';
  // Public anon key (same one the rest of hreinvestor.com uses). Data is protected by RLS + allowlist.
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaXZxd3NjZWJkdXBmeHh3ZmNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1NjQ1NzAsImV4cCI6MjA4NDE0MDU3MH0.AzE-j9Rrz1HRoGNaqicMJ8jEwO1tVuCqbf9E9J3vuv4';
  const FN_URL = SUPABASE_URL + '/functions/v1/reps-notify';
  const BUCKET = 'reps-evidence';
  const CATS = [
    ['acquisition', 'Deal sourcing / acquisition', true],
    ['seller_calls', 'Seller calls / negotiations', true],
    ['property_mgmt', 'Property management / tenants', true],
    ['leasing', 'Leasing / showings', true],
    ['rehab', 'Rehab / contractor coordination', true],
    ['bookkeeping', 'Bookkeeping for the properties', true],
    ['travel', 'Travel to properties', true],
    ['other', 'Other real estate work', true],
    ['education', 'Education / investor-type (NOT qualifying)', false],
  ];
  const CAT = Object.fromEntries(CATS.map(([k, l, q]) => [k, { label: l, q }]));
  const PRESET_PROPS = ['3506 Gay St NW', 'General (not property-specific)'];
  const MIN_DESC = 40;

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'hrei-reps-auth' },
  });
  const $ = (id) => document.getElementById(id);
  const S = { user: null, settings: null, entries: [], versions: [], editing: null, allowed: false };
  window.repsApp = S; // handy for debugging/tests; contains no secrets

  // ---------- helpers ----------
  const pad = (n) => String(n).padStart(2, '0');
  const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fmtH = (min) => (min / 60).toFixed(1);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayName = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return localISO(d); };
  const mondayOf = (iso) => { const d = new Date(iso + 'T12:00:00'); return addDays(iso, -((d.getDay() + 6) % 7)); };
  function toast(t, ms = 2600) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (el.hidden = true), ms); }
  function msg(id, t, kind) { const el = $(id); el.textContent = t || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); }
  const year = () => (S.settings && S.settings.tax_year) || 2027;
  const selfName = () => (S.settings && S.settings.display_name) || 'Me';
  const spouseName = () => (S.settings && S.settings.spouse_name) || 'Joshua';

  // When was it effectively recorded? Server time, unless it was saved offline and synced later.
  function recordedAt(e) {
    const c = Date.parse(e.created_at), l = e.client_logged_at ? Date.parse(e.client_logged_at) : NaN;
    return !isNaN(l) && l < c && c - l > 5 * 60e3 ? l : c;
  }
  function isLate(e) { const end = new Date(e.work_date + 'T23:59:59').getTime(); return recordedAt(e) - end > 48 * 3600e3; }
  const syncedLater = (e) => e.client_logged_at && Date.parse(e.created_at) - Date.parse(e.client_logged_at) > 5 * 60e3;

  // ---------- IndexedDB offline queue ----------
  const idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('reps-log', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('queue', { keyPath: 'client_id' }); r.result.createObjectStore('kv'); };
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => rej(r.error);
      });
    },
    async tx(store, mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => { const t = db.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); });
    },
    put(store, v, k) { return this.tx(store, 'readwrite', (s) => (k === undefined ? s.put(v) : s.put(v, k))); },
    del(store, k) { return this.tx(store, 'readwrite', (s) => s.delete(k)); },
    all(store) { return this.tx(store, 'readonly', (s) => s.getAll()); },
    get(store, k) { return this.tx(store, 'readonly', (s) => s.get(k)); },
  };

  async function updateQueueBadge() {
    const q = await idb.all('queue').catch(() => []);
    const b = $('queueBadge'); b.hidden = !q.length; b.textContent = q.length + ' unsynced';
    return q.length;
  }
  function netBadge() { $('netBadge').hidden = navigator.onLine; }

  // ---------- auth ----------
  let pendingEmail = '';
  $('signinForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('siEmail').value.trim().toLowerCase();
    if (!email) return;
    $('siSend').disabled = true; msg('siMsg', 'Checking…');
    try {
      const { data: ok, error } = await sb.rpc('reps_is_allowed', { p_email: email });
      if (error) throw error;
      if (!ok) { msg('siMsg', "That email isn't on the access list.", 'err'); return; }
      const { error: e2 } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + '/reps/' } });
      if (e2) throw e2;
      pendingEmail = email;
      $('signinForm').hidden = true; $('codeForm').hidden = false; $('siCode').focus();
      msg('siMsg', 'Check your email for the code.', 'ok');
    } catch (e) { msg('siMsg', e.message || 'Could not send the code.', 'err'); }
    finally { $('siSend').disabled = false; }
  });
  $('codeForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const token = $('siCode').value.replace(/\D/g, '');
    if (token.length < 6) return msg('siMsg', 'Enter the code from the email.', 'err');
    msg('siMsg', 'Signing in…');
    const { error } = await sb.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
    if (error) msg('siMsg', error.message || 'That code did not work.', 'err');
  });
  $('siLinkBtn').addEventListener('click', async () => {
    try {
      const u = new URL($('siLink').value.trim());
      const p = u.searchParams, h = new URLSearchParams(u.hash.slice(1));
      if (h.get('access_token')) { const { error } = await sb.auth.setSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token') }); if (error) throw error; return; }
      const hash = p.get('token_hash') || p.get('token');
      if (!hash) throw new Error('No sign-in token found in that link.');
      const t = p.get('type'); const type = ['magiclink', 'signup', 'email', 'invite', 'recovery'].includes(t) ? t : 'email';
      const { error } = await sb.auth.verifyOtp({ token_hash: hash, type });
      if (error) throw error;
    } catch (e) { msg('siMsg', e.message || 'That link did not work.', 'err'); }
  });
  $('siBack').addEventListener('click', () => { $('codeForm').hidden = true; $('signinForm').hidden = false; msg('siMsg', ''); });
  document.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-action="signout"]'); if (!a) return;
    const q = await updateQueueBadge();
    if (q && !confirm(q + ' entries are not synced yet and will stay on this device. Sign out anyway?')) return;
    await sb.auth.signOut(); location.hash = ''; location.reload();
  });

  // ---------- routing ----------
  const VIEWS = ['signin', 'denied', 'log', 'dash', 'entries', 'export', 'settings'];
  function show(v) {
    VIEWS.forEach((x) => ($('view-' + x).hidden = x !== v));
    document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === v));
    $('tabs').hidden = !S.allowed;
    if (v === 'dash') renderDash();
    if (v === 'entries') renderEntries();
    if (v === 'settings') renderSettings();
    if (v === 'export') renderExport();
    window.scrollTo(0, 0);
  }
  function route() {
    if (!S.user) return show('signin');
    if (!S.allowed) return show('denied');
    const v = (location.hash || '#log').slice(1);
    show(VIEWS.includes(v) && v !== 'signin' && v !== 'denied' ? v : 'log');
  }
  window.addEventListener('hashchange', route);

  // ---------- data ----------
  function cacheKey() { return 'reps_cache_' + (S.user && S.user.id); }
  function saveCache() { try { localStorage.setItem(cacheKey(), JSON.stringify({ settings: S.settings, entries: S.entries })); } catch (_) {} }
  function loadCache() { try { const c = JSON.parse(localStorage.getItem(cacheKey()) || 'null'); if (c) { S.settings = c.settings; S.entries = c.entries || []; } } catch (_) {} }

  async function loadSettings() {
    let { data, error } = await sb.from('reps_settings').select('*').eq('user_id', S.user.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      const ins = await sb.from('reps_settings').insert({ user_id: S.user.id }).select().single();
      if (ins.error) throw ins.error; data = ins.data;
    }
    S.settings = data;
  }
  async function loadEntries() {
    const all = []; let from = 0;
    for (;;) {
      const { data, error } = await sb.from('reps_entries').select('*').order('work_date', { ascending: false }).order('created_at', { ascending: false }).range(from, from + 999);
      if (error) throw error; all.push(...data); if (data.length < 1000) break; from += 1000;
    }
    S.entries = all;
    saveCache();
  }
  async function refreshAll() {
    try { await loadSettings(); await loadEntries(); } catch (e) { if (navigator.onLine) toast('Could not load: ' + (e.message || e)); }
    applySettingsToUI();
  }
  function applySettingsToUI() {
    $('yearLabel').textContent = 'HREI · ' + year();
    $('selfLabel').textContent = selfName() === 'Me' ? 'Me' : selfName();
    $('spouseLabel').textContent = spouseName() + ' (MP only)';
    fillPropList();
  }

  // ---------- entry form ----------
  $('fCat').innerHTML = '<option value="" disabled selected>Choose activity…</option>' + CATS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
  function fillPropList() {
    const recent = [];
    for (const e of S.entries) if (e.property && !recent.includes(e.property)) recent.push(e.property);
    const props = [...new Set([...PRESET_PROPS, ...recent])].slice(0, 12);
    $('propList').innerHTML = props.map((p) => `<option value="${esc(p)}">`).join('');
    $('propChips').innerHTML = props.slice(0, 5).map((p) => `<button type="button" data-p="${esc(p)}">${esc(p)}</button>`).join('');
  }
  $('propChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { $('fProp').value = b.dataset.p; } });
  const tmode = () => document.querySelector('input[name=tmode]:checked').value;
  const person = () => document.querySelector('input[name=person]:checked').value;
  document.querySelectorAll('input[name=tmode]').forEach((r) => r.addEventListener('change', () => { $('rangeBox').hidden = tmode() !== 'range'; $('durBox').hidden = tmode() !== 'dur'; calcDur(); }));
  document.querySelectorAll('input[name=person]').forEach((r) => r.addEventListener('change', () => { $('spouseNote').hidden = person() !== 'spouse'; }));
  $('durChips').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const add = +b.dataset.m; let tot = add === 0 ? 0 : (+$('fHrs').value || 0) * 60 + (+$('fMin').value || 0) + add;
    $('fHrs').value = Math.floor(tot / 60); $('fMin').value = tot % 60; calcDur();
  });
  function durMinutes() {
    if (tmode() === 'dur') return (+$('fHrs').value || 0) * 60 + (+$('fMin').value || 0);
    const s = $('fStart').value, e = $('fEnd').value; if (!s || !e) return 0;
    let m = (+e.slice(0, 2) * 60 + +e.slice(3, 5)) - (+s.slice(0, 2) * 60 + +s.slice(3, 5));
    if (m < 0) m += 1440; return m;
  }
  function calcDur() { const m = durMinutes(); $('durOut').textContent = m ? `= ${Math.floor(m / 60)} h ${m % 60} m (${fmtH(m)} h)` : ''; }
  ['fStart', 'fEnd', 'fHrs', 'fMin'].forEach((id) => $(id).addEventListener('input', calcDur));
  $('fCat').addEventListener('change', () => { $('eduWarn').hidden = $('fCat').value !== 'education'; });
  $('fDesc').addEventListener('input', descHint);
  function descHint() {
    const n = $('fDesc').value.trim().length;
    $('descHint').textContent = n < MIN_DESC ? `${n}/${MIN_DESC} characters. Add who, what, which property and the result so it holds up later.` : `${n} characters ✓`;
  }
  $('fDate').addEventListener('change', lateCheck);
  function lateCheck() {
    const d = $('fDate').value; if (!d) return;
    const late = Date.now() - new Date(d + 'T23:59:59').getTime() > 48 * 3600e3;
    $('lateWarn').hidden = !late || !!S.editing;
    $('lateWarn').textContent = 'This is more than 48 hours after the work date. It will be saved and flagged as a late entry. Same-day logs are much more credible.';
  }
  $('fFiles').addEventListener('change', () => { $('fileList').textContent = [...$('fFiles').files].map((f) => f.name + ' (' + Math.round(f.size / 1024) + ' KB)').join(', '); });

  function resetForm() {
    S.editing = null;
    $('entryForm').reset();
    $('fDate').value = localISO(); $('fHrs').value = 0; $('fMin').value = 0;
    $('rangeBox').hidden = false; $('durBox').hidden = true;
    $('formTitle').textContent = 'Log time'; $('saveBtn').textContent = 'Save entry'; $('cancelEdit').hidden = true;
    $('eduWarn').hidden = true; $('spouseNote').hidden = true; $('fileList').textContent = '';
    calcDur(); descHint(); lateCheck();
  }
  $('cancelEdit').addEventListener('click', () => { resetForm(); location.hash = '#entries'; });

  function startEdit(e) {
    resetForm(); S.editing = e;
    $('formTitle').textContent = 'Edit entry'; $('saveBtn').textContent = 'Save changes (keeps history)'; $('cancelEdit').hidden = false;
    document.querySelector(`input[name=person][value=${e.person}]`).checked = true; $('spouseNote').hidden = e.person !== 'spouse';
    $('fDate').value = e.work_date;
    if (e.start_time && e.end_time) { $('fStart').value = e.start_time.slice(0, 5); $('fEnd').value = e.end_time.slice(0, 5); }
    else { document.querySelector('input[name=tmode][value=dur]').checked = true; $('rangeBox').hidden = true; $('durBox').hidden = false; $('fHrs').value = Math.floor(e.duration_minutes / 60); $('fMin').value = e.duration_minutes % 60; }
    $('fCat').value = e.category; $('eduWarn').hidden = e.category !== 'education';
    $('fProp').value = e.property || ''; $('fDesc').value = e.description;
    calcDur(); descHint(); lateCheck();
    location.hash = '#log';
  }

  $('entryForm').addEventListener('submit', async (ev) => {
    ev.preventDefault(); msg('formMsg', '');
    const minutes = durMinutes();
    const row = {
      work_date: $('fDate').value,
      start_time: tmode() === 'range' ? $('fStart').value || null : null,
      end_time: tmode() === 'range' ? $('fEnd').value || null : null,
      duration_minutes: minutes,
      category: $('fCat').value,
      person: person(),
      property: $('fProp').value.trim() || null,
      description: $('fDesc').value.trim(),
    };
    if (!row.work_date) return msg('formMsg', 'Pick the date you worked.', 'err');
    if (row.work_date > localISO()) return msg('formMsg', "The date can't be in the future.", 'err');
    if (!minutes || minutes > 1440) return msg('formMsg', tmode() === 'range' ? 'Enter a start and end time.' : 'Enter how long you worked.', 'err');
    if (!row.category) return msg('formMsg', 'Choose an activity.', 'err');
    if (row.description.length < 10) return msg('formMsg', 'Describe what you did (at least a sentence).', 'err');
    if (row.description.length < MIN_DESC && !confirm('The description is short. Detailed notes hold up much better if you are ever audited. Save anyway?')) return;
    const files = [...$('fFiles').files];
    $('saveBtn').disabled = true;
    try {
      if (S.editing) {
        const e = S.editing; const paths = [...(e.evidence_paths || [])];
        for (const f of files) paths.push(await uploadFile(e.client_id, f));
        const { error } = await sb.from('reps_entries').update({ ...row, evidence_paths: paths }).eq('id', e.id);
        if (error) throw error;
        toast('Changes saved. Previous version kept in history.');
        resetForm(); await loadEntries(); location.hash = '#entries';
      } else {
        const item = { client_id: uuid(), row: { ...row, client_logged_at: new Date().toISOString() }, files: files.map((f) => ({ name: f.name, type: f.type, blob: f })) };
        await idb.put('queue', item);
        resetForm();
        const r = await syncQueue();
        toast(r.synced ? 'Saved ✓ ' + fmtH(minutes) + ' h' : 'Saved on this phone. It will sync when you are back online.');
      }
    } catch (e) { msg('formMsg', 'Could not save: ' + (e.message || e), 'err'); }
    finally { $('saveBtn').disabled = false; updateQueueBadge(); }
  });

  async function uploadFile(clientId, f) {
    const safe = (f.name || 'file').replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `${S.user.id}/${clientId}/${Date.now()}-${safe}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, f.blob || f, { contentType: f.type || undefined, upsert: false });
    if (error && !/exists|duplicate/i.test(error.message)) throw error;
    return path;
  }

  let syncing = false;
  async function syncQueue() {
    if (syncing || !S.user || !S.allowed) return { synced: 0 };
    syncing = true; let synced = 0;
    try {
      const q = await idb.all('queue');
      for (const item of q) {
        if (!navigator.onLine) break;
        try {
          const paths = item.paths || [];
          for (let i = paths.length; i < item.files.length; i++) { paths.push(await uploadFile(item.client_id, item.files[i])); item.paths = paths; await idb.put('queue', item); }
          const { error } = await sb.from('reps_entries').upsert({ ...item.row, client_id: item.client_id, evidence_paths: paths }, { onConflict: 'client_id', ignoreDuplicates: true });
          if (error) throw error;
          await idb.del('queue', item.client_id); synced++;
        } catch (e) { console.warn('sync failed', e); if (!/fetch|network|Failed/i.test(e.message || '')) toast('Sync problem: ' + e.message); break; }
      }
      if (synced) await loadEntries();
    } finally { syncing = false; updateQueueBadge(); }
    return { synced };
  }
  window.addEventListener('online', () => { netBadge(); syncQueue(); });
  window.addEventListener('offline', netBadge);
  $('syncNow').addEventListener('click', async () => { const r = await syncQueue(); await refreshAll(); toast(r.synced ? `Synced ${r.synced}` : 'Up to date'); });

  // ---------- timer ----------
  const TKEY = 'reps_timer_start';
  function timerTick() {
    const t = +localStorage.getItem(TKEY) || 0;
    $('timerBtn').textContent = t ? 'Stop' : 'Start';
    $('timerBtn').classList.toggle('primary', true);
    if (!t) { $('timerDisplay').textContent = '00:00:00'; $('timerSince').textContent = 'Tap Start when you begin working'; return; }
    const s = Math.floor((Date.now() - t) / 1000);
    $('timerDisplay').textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
    $('timerSince').textContent = 'Started ' + new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  $('timerBtn').addEventListener('click', () => {
    const t = +localStorage.getItem(TKEY) || 0;
    if (!t) { localStorage.setItem(TKEY, String(Date.now())); timerTick(); return; }
    localStorage.removeItem(TKEY);
    const st = new Date(t), en = new Date();
    if (!S.editing) resetForm();
    document.querySelector('input[name=tmode][value=range]').checked = true; $('rangeBox').hidden = false; $('durBox').hidden = true;
    $('fDate').value = localISO(st); $('fStart').value = hhmm(st); $('fEnd').value = hhmm(en);
    if (localISO(st) !== localISO(en)) { document.querySelector('input[name=tmode][value=dur]').checked = true; $('rangeBox').hidden = true; $('durBox').hidden = false; const m = Math.min(1440, Math.round((en - st) / 60000)); $('fHrs').value = Math.floor(m / 60); $('fMin').value = m % 60; }
    calcDur(); timerTick(); $('fCat').focus(); toast('Timer stopped. Add the details and save.');
  });
  setInterval(timerTick, 1000);

  // ---------- stats ----------
  function stats(entries, y) {
    const inY = entries.filter((e) => !e.deleted_at && e.work_date.startsWith(String(y)));
    const self = inY.filter((e) => e.person === 'self');
    const q = self.filter((e) => e.qualifying);
    const sum = (a) => a.reduce((t, e) => t + e.duration_minutes, 0);
    const today = localISO(), wk = mondayOf(today), mo = today.slice(0, 7);
    const byCat = {}; for (const e of self) byCat[e.category] = (byCat[e.category] || 0) + e.duration_minutes;
    const mpByProp = {}; for (const e of inY.filter((x) => x.qualifying)) { const p = e.property || '(unspecified)'; mpByProp[p] = mpByProp[p] || { self: 0, spouse: 0 }; mpByProp[p][e.person] += e.duration_minutes; }
    return {
      inY, qMin: sum(q), nonQMin: sum(self.filter((e) => !e.qualifying)), spouseMin: sum(inY.filter((e) => e.person === 'spouse' && e.qualifying)),
      weekMin: sum(q.filter((e) => e.work_date >= wk && e.work_date <= today)), monthMin: sum(q.filter((e) => e.work_date.startsWith(mo))),
      byCat, mpByProp, late: inY.filter(isLate), edited: inY.filter((e) => e.version > 1),
    };
  }
  function pace(qMin, y, goal) {
    const start = new Date(y + '-01-01T00:00:00').getTime(), end = new Date((y + 1) + '-01-01T00:00:00').getTime(), now = Date.now();
    const ytd = qMin / 60;
    if (now < start) return { pre: true, weeksToStart: Math.ceil((start - now) / 6048e5), perWeek: goal / 52.14 };
    const frac = Math.min(1, (now - start) / (end - start));
    const weeksLeft = Math.max((end - now) / 6048e5, 0.1);
    return { expected: goal * frac, behind: Math.max(0, goal * frac - ytd), perWeek: now >= end ? 0 : Math.max(0, (goal - ytd) / weeksLeft), weeksLeft, done: now >= end };
  }

  function renderDash() {
    const y = year(), goal = +S.settings.goal_hours || 750, target = +S.settings.target_hours || 900;
    const st = stats(S.entries, y), ytd = st.qMin / 60;
    const p = pace(st.qMin, y, goal), pt = pace(st.qMin, y, target);
    const pct = Math.min(100, (ytd / target) * 100), goalPos = (goal / target) * 100;
    const warns = [];
    if (!p.pre && !p.done && p.behind > 0.05) warns.push(`Behind pace for ${goal} h by <b>${p.behind.toFixed(1)} h</b>. Need <b>${p.perWeek.toFixed(1)} h/week</b> from here.`);
    if (st.late.length) warns.push(`<b>${st.late.length}</b> ${y} entr${st.late.length === 1 ? 'y was' : 'ies were'} logged more than 48 h after the work date. Try to log the same day.`);
    const other = +S.settings.other_work_hours || 0;
    const totalRE = (st.qMin + st.nonQMin) / 60;
    const fifty = other === 0 ? 'Met: no other job hours recorded.' : (ytd > other ? `Met: ${ytd.toFixed(0)} real estate h vs ${other} other work h.` : `NOT met yet: ${ytd.toFixed(0)} real estate h vs ${other} other work h.`);
    const catRows = CATS.map(([k, l, q]) => ({ k, l, q, m: st.byCat[k] || 0 })).filter((r) => r.m).sort((a, b) => b.m - a.m);
    const maxCat = Math.max(1, ...catRows.map((r) => r.m));
    const mpRows = Object.entries(st.mpByProp).sort((a, b) => (b[1].self + b[1].spouse) - (a[1].self + a[1].spouse));
    const mpTot = (st.qMin + st.spouseMin) / 60;
    $('dash').innerHTML = `
      ${p.pre ? `<div class="note">${y} hasn't started yet (${p.weeksToStart} weeks). Entries dated ${y} count here. Plan for about <b>${(goal / 52.14).toFixed(1)}–${(target / 52.14).toFixed(1)} h/week</b>.</div>` : ''}
      ${warns.map((w) => `<div class="warn">${w}</div>`).join('')}
      <div class="card mt">
        <div class="label">${y} qualifying hours (${esc(selfName())})</div>
        <div class="big-num">${ytd.toFixed(1)} <small class="muted" style="font-size:1rem">/ ${goal} h</small></div>
        <div class="bar"><i style="width:${pct}%"></i><span class="mark" style="left:${goalPos}%"></span></div>
        <div class="small muted">Goal ${goal} h (mark) · target ${target} h · ${Math.max(0, goal - ytd).toFixed(1)} h to go</div>
        <div class="small mt">${ytd >= goal ? '<b>750-hour test met ✓</b>' : 'Required pace: <b>' + (p.pre ? (goal / 52.14).toFixed(1) : p.perWeek.toFixed(1)) + ' h/week</b> for ' + goal + ' h, <b>' + (pt.pre ? (target / 52.14).toFixed(1) : pt.perWeek.toFixed(1)) + ' h/week</b> for ' + target + ' h'}</div>
      </div>
      <div class="stat-grid">
        <div class="stat"><b>${fmtH(st.weekMin)}</b><span>This week (Mon–Sun)</span></div>
        <div class="stat"><b>${fmtH(st.monthMin)}</b><span>This month</span></div>
        <div class="stat"><b>${fmtH(st.nonQMin)}</b><span>Non-qualifying (education)</span></div>
        <div class="stat"><b>${st.inY.length}</b><span>Entries in ${y}</span></div>
      </div>
      <div class="card mt"><h2>By activity</h2>${catRows.length ? catRows.map((r) => `<div class="cat-row"><span>${esc(r.l)}</span><b>${fmtH(r.m)} h</b><div class="bar"><i style="width:${(r.m / maxCat) * 100}%;${r.q ? '' : 'background:var(--muted)'}"></i></div></div>`).join('') : '<p class="muted">No entries yet.</p>'}</div>
      <div class="card"><h2>Material participation (rentals)</h2>
        <p class="small muted">Spouses' hours combine for this test. Common safe harbor: 500+ combined hours per activity (or elect to group all rentals as one activity).</p>
        <div class="big-num">${mpTot.toFixed(1)} h</div><div class="small">${esc(selfName())} ${fmtH(st.qMin)} h + ${esc(spouseName())} ${fmtH(st.spouseMin)} h ${mpTot >= 500 ? '· <b>500 h met ✓</b>' : '· ' + (500 - mpTot).toFixed(1) + ' h to 500'}</div>
        ${mpRows.map(([k, v]) => `<div class="cat-row"><span>${esc(k)}</span><b>${fmtH(v.self + v.spouse)} h</b></div>`).join('')}
      </div>
      <div class="card"><h2>More-than-half test</h2><p class="small">${esc(fifty)}</p><p class="small muted">Update "other work hours" in Settings if she takes any non-real-estate job.</p></div>
      <div class="card"><p class="small muted">Edited entries: ${st.edited.length} (history kept). Real estate hours incl. non-qualifying: ${totalRE.toFixed(1)}.</p></div>`;
  }

  // ---------- entries list ----------
  $('eMonth').addEventListener('change', renderEntries);
  $('eShow').addEventListener('change', renderEntries);
  function renderEntries() {
    if (!$('eMonth').value) $('eMonth').value = localISO().slice(0, 7);
    const m = $('eMonth').value, showDel = $('eShow').value === 'all';
    const rows = S.entries.filter((e) => e.work_date.startsWith(m) && (showDel || !e.deleted_at));
    idb.all('queue').then((q) => {
      const pending = q.filter((i) => i.row.work_date.startsWith(m));
      let html = pending.length ? `<div class="note">${pending.length} entr${pending.length === 1 ? 'y' : 'ies'} waiting to sync.</div>` : '';
      let last = '';
      for (const e of rows) {
        if (e.work_date !== last) { last = e.work_date; const dayMin = rows.filter((x) => x.work_date === last && !x.deleted_at && x.person === 'self' && x.qualifying).reduce((a, x) => a + x.duration_minutes, 0); html += `<div class="day-h">${dayName(last)} · ${fmtH(dayMin)} h</div>`; }
        html += `<div class="entry ${e.deleted_at ? 'deleted' : ''}" data-id="${e.id}"><div class="entry-top"><span>${esc(CAT[e.category].label.replace(' (NOT qualifying)', ''))}</span><span>${fmtH(e.duration_minutes)} h</span></div>
          <div class="small muted">${e.start_time ? e.start_time.slice(0, 5) + '–' + (e.end_time || '').slice(0, 5) + ' · ' : ''}${esc(e.property || '')}</div>
          <div class="desc">${esc(e.description)}</div>
          ${e.person === 'spouse' ? `<span class="tag">${esc(spouseName())} · MP only</span>` : ''}${!e.qualifying ? '<span class="tag bad">Non-qualifying</span>' : ''}${isLate(e) ? '<span class="tag bad">Logged late</span>' : ''}${e.version > 1 ? `<span class="tag">Edited v${e.version}</span>` : ''}${(e.evidence_paths || []).length ? `<span class="tag">📎 ${e.evidence_paths.length}</span>` : ''}${e.deleted_at ? '<span class="tag bad">Deleted</span>' : ''}</div>`;
      }
      $('entryList').innerHTML = html || '<div class="card muted">No entries this month.</div>';
    });
  }
  $('entryList').addEventListener('click', (ev) => { const el = ev.target.closest('.entry'); if (el) openSheet(S.entries.find((e) => e.id === el.dataset.id)); });

  async function openSheet(e) {
    if (!e) return;
    const body = $('sheetBody');
    const fmtTs = (t) => (t ? new Date(t).toLocaleString() : '');
    body.innerHTML = `<h2>${esc(CAT[e.category].label)}</h2>
      <dl class="kv"><dt>Date</dt><dd>${dayName(e.work_date)}</dd><dt>Time</dt><dd>${e.start_time ? e.start_time.slice(0, 5) + '–' + (e.end_time || '').slice(0, 5) : '—'} (${fmtH(e.duration_minutes)} h)</dd>
      <dt>Who</dt><dd>${e.person === 'self' ? esc(selfName()) : esc(spouseName()) + ' (material participation only)'}</dd><dt>Property</dt><dd>${esc(e.property || '—')}</dd>
      <dt>Qualifying</dt><dd>${e.qualifying ? 'Yes' : 'No (education / investor-type)'}</dd>
      <dt>Recorded</dt><dd>${fmtTs(e.created_at)} (server)${syncedLater(e) ? '<br>saved offline ' + fmtTs(e.client_logged_at) : ''}${isLate(e) ? '<br><b>Logged more than 48 h after the work date</b>' : ''}</dd>
      <dt>Version</dt><dd>v${e.version}${e.version > 1 ? ' · last edited ' + fmtTs(e.updated_at) : ''}</dd>${e.deleted_at ? `<dt>Deleted</dt><dd>${fmtTs(e.deleted_at)}</dd>` : ''}</dl>
      <p style="white-space:pre-wrap">${esc(e.description)}</p>
      <div class="thumbs" id="thumbs"></div><div id="hist"></div>
      ${e.deleted_at ? '<button class="btn block" id="shRestore">Restore entry</button>' : '<button class="btn primary block" id="shEdit">Edit</button><button class="btn danger block" id="shDel">Delete (kept in history)</button>'}
      <button class="btn ghost block" id="shClose">Close</button>`;
    $('sheet').showModal();
    $('shClose').onclick = () => $('sheet').close();
    if ($('shEdit')) $('shEdit').onclick = () => { $('sheet').close(); startEdit(e); };
    if ($('shDel')) $('shDel').onclick = async () => {
      if (!confirm('Delete this entry? It stays in the audit history and exports as deleted.')) return;
      const { error } = await sb.from('reps_entries').update({ deleted_at: new Date().toISOString() }).eq('id', e.id);
      if (error) return toast(error.message); $('sheet').close(); await loadEntries(); renderEntries(); toast('Entry deleted (history kept)');
    };
    if ($('shRestore')) $('shRestore').onclick = async () => {
      const { error } = await sb.from('reps_entries').update({ deleted_at: null }).eq('id', e.id);
      if (error) return toast(error.message); $('sheet').close(); await loadEntries(); renderEntries(); toast('Restored');
    };
    for (const p of e.evidence_paths || []) {
      const { data } = await sb.storage.from(BUCKET).createSignedUrl(p, 600);
      if (!data) continue;
      const a = document.createElement('a'); a.href = data.signedUrl; a.target = '_blank'; a.rel = 'noopener';
      if (/\.pdf$/i.test(p)) { a.textContent = '📄 ' + p.split('/').pop(); a.className = 'btn'; } else { const img = document.createElement('img'); img.src = data.signedUrl; img.alt = 'evidence'; a.appendChild(img); }
      $('thumbs').appendChild(a);
    }
    if (e.version > 1 || e.deleted_at) {
      const { data } = await sb.from('reps_entry_versions').select('*').eq('entry_id', e.id).order('version');
      $('hist').innerHTML = '<h3 class="mt">History</h3>' + (data || []).map((v) => `<div class="hist"><b>v${v.version}</b> → ${esc(v.change_type)} on ${fmtTs(v.changed_at)}<br>${esc(v.snapshot.work_date)} · ${fmtH(v.snapshot.duration_minutes)} h · ${esc(CAT[v.snapshot.category] ? CAT[v.snapshot.category].label : v.snapshot.category)}<br><span class="muted">${esc(v.snapshot.description)}</span></div>`).join('');
    }
  }

  // ---------- settings ----------
  function renderSettings() {
    const s = S.settings; if (!s) return;
    $('sName').value = s.display_name || ''; $('sSpouse').value = s.spouse_name || ''; $('sYear').value = s.tax_year; $('sOther').value = s.other_work_hours || 0;
    $('sGoal').value = s.goal_hours; $('sTarget').value = s.target_hours;
    $('sDaily').checked = s.daily_enabled; $('sDailyT').value = String(s.daily_time).slice(0, 5);
    $('sWeekly').checked = s.weekly_enabled; $('sWeeklyD').value = s.weekly_dow; $('sWeeklyT').value = String(s.weekly_time).slice(0, 5);
    $('sMonthly').checked = s.monthly_enabled; $('sMonthlyD').value = s.monthly_day; $('sMonthlyT').value = String(s.monthly_time).slice(0, 5);
    $('whoami').textContent = 'Signed in as ' + (S.user.email || '');
    pushStatus();
  }
  $('setForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const upd = {
      display_name: $('sName').value.trim() || null, spouse_name: $('sSpouse').value.trim() || null,
      tax_year: +$('sYear').value || 2027, other_work_hours: +$('sOther').value || 0,
      goal_hours: +$('sGoal').value || 750, target_hours: +$('sTarget').value || 900,
      daily_enabled: $('sDaily').checked, daily_time: $('sDailyT').value || '19:30',
      weekly_enabled: $('sWeekly').checked, weekly_dow: +$('sWeeklyD').value, weekly_time: $('sWeeklyT').value || '18:00',
      monthly_enabled: $('sMonthly').checked, monthly_day: Math.min(28, Math.max(1, +$('sMonthlyD').value || 1)), monthly_time: $('sMonthlyT').value || '09:00',
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await sb.from('reps_settings').update(upd).eq('user_id', S.user.id).select().single();
    if (error) return msg('setMsg', error.message, 'err');
    S.settings = data; saveCache(); applySettingsToUI(); msg('setMsg', 'Saved ✓', 'ok');
  });

  // ---------- push ----------
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function b64ToU8(s) { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); }
  async function fn(action, extra) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(FN_URL, { method: 'POST', headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + (session ? session.access_token : SUPABASE_ANON_KEY) }, body: JSON.stringify({ action, ...(extra || {}) }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j;
  }
  async function pushStatus() {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    $('iosHint').hidden = !(isIOS && !standalone);
    if (!supported) { $('pushState').textContent = isIOS && !standalone ? 'Not available in the browser on iPhone. Install to Home Screen first.' : 'This browser does not support push notifications.'; ['pushOn', 'pushTest', 'pushOff'].forEach((i) => ($(i).disabled = true)); return; }
    const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    $('pushState').textContent = sub ? 'Notifications are ON for this device.' : (Notification.permission === 'denied' ? 'Notifications are blocked. Re-enable them in your phone settings for REPS Log.' : 'Notifications are off for this device.');
    $('pushOn').hidden = !!sub; $('pushOff').hidden = !sub; $('pushTest').disabled = !sub;
  }
  $('pushOn').addEventListener('click', async () => {
    try {
      msg('pushMsg', 'Asking permission…');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Permission was not granted.');
      const { publicKey } = await fn('vapid');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) });
      await saveSub(sub);
      msg('pushMsg', 'Notifications are on ✓', 'ok'); pushStatus();
    } catch (e) { msg('pushMsg', e.message || String(e), 'err'); }
  });
  async function saveSub(sub) {
    const j = sub.toJSON();
    const { error } = await sb.from('reps_push_subscriptions').upsert({ user_id: S.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' });
    if (error) throw error;
  }
  $('pushTest').addEventListener('click', async () => {
    try { msg('pushMsg', 'Sending…'); const r = await fn('test'); msg('pushMsg', r.sent ? `Sent to ${r.sent} device(s). It should appear in a few seconds.` : 'No device received it: ' + (r.errors || []).join(', '), r.sent ? 'ok' : 'err'); }
    catch (e) { msg('pushMsg', e.message, 'err'); }
  });
  $('pushOff').addEventListener('click', async () => {
    const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
    if (sub) { await sb.from('reps_push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
    msg('pushMsg', 'Turned off for this device.'); pushStatus();
  });

  // ---------- export ----------
  function renderExport() {
    const y = year(), today = localISO();
    const m0 = today.slice(0, 7) + '-01';
    const lastM = addDays(m0, -1).slice(0, 7);
    const endOf = (ym) => { const [a, b] = ym.split('-').map(Number); return localISO(new Date(a, b, 0)); };
    const presets = [
      ['This month', m0, today], ['Last month', lastM + '-01', endOf(lastM)],
      ['Q1 ' + y, y + '-01-01', y + '-03-31'], ['Q2 ' + y, y + '-04-01', y + '-06-30'], ['Q3 ' + y, y + '-07-01', y + '-09-30'], ['Q4 ' + y, y + '-10-01', y + '-12-31'],
      ['Full year ' + y, y + '-01-01', y + '-12-31'],
    ];
    $('rangeChips').innerHTML = presets.map(([l, a, b]) => `<button type="button" data-a="${a}" data-b="${b}">${l}</button>`).join('');
    if (!$('xFrom').value) { $('xFrom').value = m0; $('xTo').value = today; }
    $('taxPkgBtn').textContent = `Tax package ${y} (for the CPA)`;
  }
  $('rangeChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $('xFrom').value = b.dataset.a; $('xTo').value = b.dataset.b; document.querySelectorAll('#rangeChips button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('exportBtn').addEventListener('click', () => buildPackage($('xFrom').value, $('xTo').value, null));
  $('taxPkgBtn').addEventListener('click', () => { const y = year(); buildPackage(y + '-01-01', y + '-12-31', `HREI-REPS-Tax-Package-${y}`); });

  function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }
  const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
  const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  async function sha256(buf) { const h = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join(''); }

  async function buildPackage(from, to, name) {
    if (!from || !to || from > to) return msg('xMsg', 'Pick a valid date range.', 'err');
    if (!navigator.onLine) return msg('xMsg', 'Connect to the internet to build a package.', 'err');
    msg('xMsg', 'Building package…'); $('xOut').innerHTML = '';
    try {
      await syncQueue();
      await Promise.all(['vendor/jszip-3.10.1.min.js', 'vendor/jspdf-2.5.2.umd.min.js'].map(loadScript));
      await loadScript('vendor/jspdf-autotable-3.8.4.min.js');
      await loadEntries();
      const rows = S.entries.filter((e) => e.work_date >= from && e.work_date <= to).sort((a, b) => (a.work_date + a.created_at).localeCompare(b.work_date + b.created_at));
      const ids = rows.map((e) => e.id); let versions = [];
      for (let i = 0; i < ids.length; i += 100) { const { data, error } = await sb.from('reps_entry_versions').select('*').in('entry_id', ids.slice(i, i + 100)).order('changed_at'); if (error) throw error; versions = versions.concat(data); }
      const zip = new JSZip(); const generated = new Date();
      const base = name || `HREI-REPS-${from}_to_${to}`;
      const folder = zip.folder(base); const hashes = [];
      const addText = async (fname, text) => { const buf = new TextEncoder().encode(text); folder.file(fname, buf); hashes.push([fname, await sha256(buf), buf.length]); };
      // entries.csv
      const head = ['entry_id', 'status', 'work_date', 'start_time', 'end_time', 'duration_minutes', 'duration_hours', 'who', 'category', 'qualifying_for_750', 'property', 'description', 'evidence_files', 'recorded_server_utc', 'saved_on_device_utc', 'logged_more_than_48h_after_work', 'version', 'last_edited_utc', 'deleted_utc'];
      const evName = (e, p) => `evidence/${e.work_date}_${e.id.slice(0, 8)}/${p.split('/').pop()}`;
      const csv = [head].concat(rows.map((e) => [e.id, e.deleted_at ? 'deleted' : 'active', e.work_date, e.start_time ? e.start_time.slice(0, 5) : '', e.end_time ? e.end_time.slice(0, 5) : '', e.duration_minutes, (e.duration_minutes / 60).toFixed(2), e.person === 'self' ? selfName() : spouseName() + ' (MP only)', CAT[e.category].label, e.qualifying && e.person === 'self' ? 'yes' : 'no', e.property || '', e.description, (e.evidence_paths || []).map((p) => evName(e, p)).join(' | '), e.created_at, e.client_logged_at || '', isLate(e) ? 'yes' : 'no', e.version, e.version > 1 ? e.updated_at : '', e.deleted_at || '']));
      await addText('entries.csv', toCSV(csv));
      const vh = ['entry_id', 'prior_version', 'change', 'changed_at_utc', 'prior_work_date', 'prior_duration_minutes', 'prior_category', 'prior_who', 'prior_property', 'prior_description'];
      await addText('edit_history.csv', toCSV([vh].concat(versions.map((v) => [v.entry_id, v.version, v.change_type, v.changed_at, v.snapshot.work_date, v.snapshot.duration_minutes, v.snapshot.category, v.snapshot.person, v.snapshot.property || '', v.snapshot.description]))));
      // evidence
      let evCount = 0, evFail = 0;
      for (const e of rows) for (const p of e.evidence_paths || []) {
        msg('xMsg', `Downloading evidence ${evCount + evFail + 1}…`);
        const { data, error } = await sb.storage.from(BUCKET).download(p);
        if (error || !data) { evFail++; continue; }
        const buf = new Uint8Array(await data.arrayBuffer()); const n = evName(e, p);
        folder.file(n, buf); hashes.push([n, await sha256(buf), buf.length]); evCount++;
      }
      // pdf
      msg('xMsg', 'Writing PDF…');
      const pdfBuf = new Uint8Array(makePdf(rows, versions, from, to, generated, { evCount, evFail }).output('arraybuffer'));
      folder.file('summary.pdf', pdfBuf); hashes.push(['summary.pdf', await sha256(pdfBuf), pdfBuf.length]);
      const readme = `HREI REPS records package\nRange: ${from} to ${to}\nGenerated: ${generated.toISOString()} by ${S.user.email}\nEntries: ${rows.length} (${rows.filter((e) => e.deleted_at).length} deleted, kept for the audit trail)\nEvidence files: ${evCount}${evFail ? ` (${evFail} could not be downloaded)` : ''}\n\nFiles\n- entries.csv: every entry with server timestamps (recorded_server_utc is set by the database, not the phone), version and deletion status.\n- edit_history.csv: the prior version of every edited or deleted entry.\n- summary.pdf: totals by category, month and property, the 750-hour test, and a signature line.\n- evidence/: photos and receipts attached to entries.\n\nSHA-256 checksums\n` + hashes.map(([n, h, l]) => `${h}  ${n}  (${l} bytes)`).join('\n') + '\n';
      folder.file('README.txt', readme);
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const file = new File([blob], base + '.zip', { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      $('xOut').innerHTML = `<a class="btn primary block big" id="dlLink" href="${url}" download="${esc(base)}.zip">Download ${esc(base)}.zip (${Math.round(blob.size / 1024)} KB)</a>` + (navigator.canShare && navigator.canShare({ files: [file] }) ? '<button class="btn block" id="shareBtn" type="button">Share / Save to Files…</button>' : '');
      if ($('shareBtn')) $('shareBtn').onclick = () => navigator.share({ files: [file], title: base }).catch(() => {});
      window.repsLastExport = { blob, name: base };
      msg('xMsg', `Ready: ${rows.length} entries, ${evCount} evidence file(s).`, 'ok');
    } catch (e) { console.error(e); msg('xMsg', 'Export failed: ' + (e.message || e), 'err'); }
  }

  function makePdf(rows, versions, from, to, generated, ev) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const W = doc.internal.pageSize.getWidth(); let y = 54;
    const forest = [17, 61, 59], gold = [200, 138, 44];
    const active = rows.filter((e) => !e.deleted_at);
    const self = active.filter((e) => e.person === 'self'), q = self.filter((e) => e.qualifying), nq = self.filter((e) => !e.qualifying);
    const sp = active.filter((e) => e.person === 'spouse' && e.qualifying);
    const H = (a) => (a.reduce((t, e) => t + e.duration_minutes, 0) / 60);
    const goal = +S.settings.goal_hours || 750, other = +S.settings.other_work_hours || 0;
    const fullYear = /-01-01$/.test(from) && /-12-31$/.test(to) && from.slice(0, 4) === to.slice(0, 4);
    doc.setFillColor(...forest); doc.rect(0, 0, W, 34, 'F'); doc.setTextColor(255); doc.setFontSize(11); doc.text('Huntsville Real Estate Investors LLC  ·  REPS hours log', 40, 22);
    doc.setTextColor(...forest); doc.setFontSize(20); doc.text('Real Estate Professional Hours Summary', 40, y += 20);
    doc.setFontSize(10); doc.setTextColor(60);
    doc.text(`Taxpayer: ${selfName()}    Period: ${from} to ${to}    Generated: ${generated.toLocaleString()}`, 40, y += 20);
    doc.text('IRC §469(c)(7): 750+ hours in real property trades or businesses in which the taxpayer materially participates,', 40, y += 16);
    doc.text('and more than half of personal services in all trades or businesses performed in real property trades or businesses.', 40, y += 12);
    const qH = H(q), met = qH >= goal;
    doc.setFontSize(13); doc.setTextColor(...(met ? forest : gold));
    doc.text(`${fullYear ? '750-hour test' : '750-hour test (partial period)'}: ${qH.toFixed(1)} qualifying hours — ${met ? 'MET' : fullYear ? 'NOT MET' : 'in progress'}`, 40, y += 24);
    doc.setFontSize(10); doc.setTextColor(40);
    doc.text(`More-than-half test: ${other === 0 ? 'no other (non-real-estate) work hours reported — met' : `${qH.toFixed(1)} real estate h vs ${other} other work h — ${qH > other ? 'met' : 'not met'}`}`, 40, y += 16);
    doc.text(`Non-qualifying (education / investor-type) hours, excluded: ${H(nq).toFixed(1)}`, 40, y += 14);
    doc.text(`Material participation (spouses combined, qualifying): ${(qH + H(sp)).toFixed(1)} h  (${selfName()} ${qH.toFixed(1)} + ${spouseName()} ${H(sp).toFixed(1)})`, 40, y += 14);
    doc.text(`Entries: ${rows.length} (${rows.length - active.length} deleted, retained)  ·  edited: ${rows.filter((e) => e.version > 1).length}  ·  logged >48h late: ${active.filter(isLate).length}  ·  evidence files: ${ev.evCount}`, 40, y += 14);
    const table = (title, head, body) => { doc.autoTable({ startY: y + 14, head: [head], body, theme: 'grid', headStyles: { fillColor: forest }, styles: { fontSize: 9, cellPadding: 4 }, margin: { left: 40, right: 40 }, didDrawPage: () => {} }); y = doc.lastAutoTable.finalY; void title; };
    const group = (arr, key) => { const m = {}; for (const e of arr) { const k = key(e); m[k] = (m[k] || 0) + e.duration_minutes; } return m; };
    const byCat = group(self, (e) => e.category);
    table('cat', ['Activity (' + selfName() + ')', 'Qualifying', 'Hours'], CATS.filter(([k]) => byCat[k]).map(([k, l, qq]) => [l, qq ? 'Yes' : 'No', (byCat[k] / 60).toFixed(1)]).concat([['Total qualifying', '', qH.toFixed(1)]]));
    const byMonth = group(q, (e) => e.work_date.slice(0, 7));
    table('month', ['Month', 'Qualifying hours', 'Cumulative'], (() => { let c = 0; return Object.keys(byMonth).sort().map((k) => { c += byMonth[k]; return [k, (byMonth[k] / 60).toFixed(1), (c / 60).toFixed(1)]; }); })());
    const props = {}; for (const e of active.filter((x) => x.qualifying)) { const k = e.property || '(unspecified)'; props[k] = props[k] || [0, 0]; props[k][e.person === 'self' ? 0 : 1] += e.duration_minutes; }
    table('prop', ['Property / deal', selfName() + ' h', spouseName() + ' h (MP)', 'Combined'], Object.entries(props).sort((a, b) => b[1][0] + b[1][1] - a[1][0] - a[1][1]).map(([k, v]) => [k, (v[0] / 60).toFixed(1), (v[1] / 60).toFixed(1), ((v[0] + v[1]) / 60).toFixed(1)]));
    doc.addPage(); y = 40;
    doc.setFontSize(13); doc.setTextColor(...forest); doc.text('Entry log', 40, y);
    doc.autoTable({ startY: y + 10, head: [['Date', 'Time', 'Hrs', 'Who', 'Activity', 'Property', 'Description', 'Recorded']], body: rows.map((e) => [e.work_date + (e.deleted_at ? ' (DELETED)' : ''), e.start_time ? e.start_time.slice(0, 5) + '-' + (e.end_time || '').slice(0, 5) : '', (e.duration_minutes / 60).toFixed(2), e.person === 'self' ? 'Self' : 'Spouse', CAT[e.category].label.replace(' (NOT qualifying)', ' (NQ)'), e.property || '', e.description, new Date(e.created_at).toLocaleString() + (isLate(e) ? ' LATE' : '') + (e.version > 1 ? ' v' + e.version : '')]), theme: 'striped', headStyles: { fillColor: forest }, styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak' }, columnStyles: { 6: { cellWidth: 170 } }, margin: { left: 30, right: 30 } });
    y = doc.lastAutoTable.finalY + 30;
    if (y > 640) { doc.addPage(); y = 60; }
    doc.setFontSize(10); doc.setTextColor(40);
    doc.text(doc.splitTextToSize('I declare that this log was kept contemporaneously as the work was performed and that, to the best of my knowledge, it is true, correct and complete. Entries show server timestamps; edits and deletions are preserved in edit_history.csv.', W - 80), 40, y);
    y += 50; doc.line(40, y, 300, y); doc.line(340, y, 520, y); doc.text('Signature: ' + selfName(), 40, y + 14); doc.text('Date', 340, y + 14);
    y += 44; doc.line(40, y, 300, y); doc.line(340, y, 520, y); doc.text('Signature: ' + spouseName() + ' (spouse, material participation hours)', 40, y + 14); doc.text('Date', 340, y + 14);
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Page ${i} of ${pages}  ·  ${from} to ${to}  ·  generated ${generated.toISOString()}`, 40, doc.internal.pageSize.getHeight() - 20); }
    return doc;
  }

  // ---------- boot ----------
  async function onSession(session) {
    S.user = session ? session.user : null;
    if (!S.user) { S.allowed = false; route(); return; }
    loadCache();
    if (S.settings) { S.allowed = true; applySettingsToUI(); }
    try {
      const { data, error } = await sb.rpc('reps_me_allowed');
      if (error) throw error;
      S.allowed = !!data;
    } catch (e) { if (navigator.onLine) S.allowed = false; }
    route();
    if (S.allowed) { await refreshAll(); await syncQueue(); route(); maybeRefreshSub(); }
  }
  async function maybeRefreshSub() {
    // keep the server copy of this device's subscription current (endpoints can rotate)
    try { if (!('serviceWorker' in navigator) || !('PushManager' in window)) return; const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await saveSub(sub); } catch (_) {}
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (ev) => { if (ev.data && ev.data.type === 'reps-push') { window.repsLastPush = ev.data; toast('🔔 ' + ev.data.title); } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch((e) => console.warn('SW', e));
  resetForm(); timerTick(); netBadge(); updateQueueBadge();
  let booted = false;
  sb.auth.onAuthStateChange((evt, session) => {
    if (evt === 'TOKEN_REFRESHED') return;
    if (evt === 'INITIAL_SESSION' || evt === 'SIGNED_IN' || evt === 'SIGNED_OUT') { if (evt === 'SIGNED_IN' && booted && S.user && session && S.user.id === session.user.id) return; booted = true; setTimeout(() => onSession(session), 0); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.allowed) syncQueue(); });
})();
