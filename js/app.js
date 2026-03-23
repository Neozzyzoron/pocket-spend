/* ═══════════════════════════════════════════════════════════════
   app.js — Boot, Auth, Routing, Realtime, Global state
═══════════════════════════════════════════════════════════════ */

import {
  supabase, mergePrefs, NAV_PAGES, applyTheme, calcCycle,
  generateInviteCode, fmtDate, todayISO, toISO, parseISO,
  todayDate, clampDay, lastDayOfMonth, escHtml,
} from './utils.js';

import * as Dashboard    from './dashboard.js';
import * as Transactions from './transactions.js';
import * as Accounts     from './accounts.js';
import * as Budgets      from './budgets.js';
import * as Analytics    from './analytics.js';
import * as Forecast     from './forecast.js';
import * as Recurring    from './recurring.js';
import * as Settings     from './settings.js';

// ── PAGE REGISTRY ────────────────────────────────────────────
const PAGE_MODULES = { Dashboard, Transactions, Accounts, Budgets, Analytics, Forecast, Recurring, Settings };

// ── GLOBAL STATE ─────────────────────────────────────────────
export const state = {
  user: null,
  profile: null,
  household: null,
  profiles: [],       // all household members
  settings: null,     // household_settings row
  accounts: [],
  categories: [],
  transactions: [],
  recurringTemplates: [],
  budgets: [],
  budgetSnapshots: [],
  currentPage: 'dashboard',
  prefs: mergePrefs({}),  // current user merged prefs
  accountOrder: [],
  recentlyInserted: new Set(), // realtime dedup
};

// Flag to prevent boot() running while signup DB setup is in progress
let isSigningUp = false;

// Shorthand getters
export function currency() { return state.household?.currency || 'Kč'; }
export function cycleMode() { return state.prefs.cycle_mode || 'month'; }
export function cyclePeriod() {
  const pa = memberA()?.preferences?.salary_day;
  const pb = memberB()?.preferences?.salary_day;
  return calcCycle(cycleMode(), { salary_day_a: pa, salary_day_b: pb });
}
export function memberA() { return state.profiles[0] || null; }
export function memberB() { return state.profiles[1] || null; }

// ── TOAST ─────────────────────────────────────────────────────
export function toast(msg, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 250);
  };
  const timer = setTimeout(dismiss, duration);
  el.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
}

// ── MODAL / BOTTOM SHEET ──────────────────────────────────────
export function openModal(title, bodyHTML, maxWidth = '') {
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    document.getElementById('sheet-title').textContent = title;
    document.getElementById('sheet-body').innerHTML = bodyHTML;
    const bd = document.getElementById('sheet-backdrop');
    bd.classList.remove('hidden');
    bd.style.alignItems = 'flex-end';
    bd.style.padding = '0';
    return;
  }
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  const modal = document.getElementById('modal');
  if (maxWidth) modal.style.maxWidth = maxWidth;
  else modal.style.maxWidth = '';
  document.getElementById('modal-backdrop').classList.remove('hidden');
}

export function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
  document.getElementById('sheet-backdrop').classList.add('hidden');
}

export function closeBottomSheet() {
  document.getElementById('sheet-backdrop').classList.add('hidden');
}

export function openConfirm(title, message, okLabel = 'Delete', okClass = 'btn-danger') {
  return new Promise(resolve => {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const okBtn = document.getElementById('confirm-ok-btn');
    okBtn.textContent = okLabel;
    okBtn.className = `btn ${okClass}`;
    document.getElementById('confirm-backdrop').classList.remove('hidden');
    const cleanup = (val) => {
      document.getElementById('confirm-backdrop').classList.add('hidden');
      resolve(val);
    };
    document.getElementById('confirm-ok-btn').onclick = () => cleanup(true);
    document.getElementById('confirm-cancel-btn').onclick = () => cleanup(false);
  });
}

// ── NAVIGATION ────────────────────────────────────────────────
export function navigate(page) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  // Show target
  const el = document.getElementById(`page-${page}`);
  if (!el) return;
  el.classList.remove('hidden');

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });

  // Update topbar title
  const pageInfo = NAV_PAGES[page];
  if (pageInfo) document.getElementById('topbar-title').textContent = pageInfo.label;

  // Save to localStorage
  state.currentPage = page;
  localStorage.setItem('pocket_last_page', page);

  // Render page module
  const modName = page.charAt(0).toUpperCase() + page.slice(1);
  const mod = PAGE_MODULES[modName];
  if (mod?.render) mod.render(state);

  // Close sidebar on mobile
  if (window.innerWidth <= 768) closeSidebar();
}

// ── SIDEBAR ───────────────────────────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('visible');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
}

// ── RENDER SIDEBAR NAV ────────────────────────────────────────
function renderSidebarNav() {
  const order = state.prefs.nav_order || Object.keys(NAV_PAGES);
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = order.map(page => {
    const info = NAV_PAGES[page];
    if (!info) return '';
    return `<div class="nav-item${state.currentPage === page ? ' active' : ''}" data-page="${page}">
      <span class="nav-item-icon">${info.icon}</span>
      <span class="nav-item-label">${info.label}</span>
    </div>`;
  }).join('');

  nav.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });
}

// ── RENDER CYCLE TOGGLE ───────────────────────────────────────
function renderCycleToggle() {
  const prefs = state.prefs;
  const profiles = state.profiles;
  const sdA = profiles[0]?.preferences?.salary_day;
  const sdB = profiles[1]?.preferences?.salary_day;
  const hasSalary = sdA || sdB;

  const container = document.getElementById('sidebar-cycle');
  container.style.display = hasSalary ? '' : 'none';
  if (!hasSalary) return;

  const current = prefs.cycle_mode || 'month';
  const opts = [{ key: 'month', label: 'Monthly' }];
  if (profiles[0]) opts.push({ key: 'user_a', label: `${profiles[0].display_name || 'User A'} cycle` });
  if (profiles[1]) opts.push({ key: 'user_b', label: `${profiles[1].display_name || 'User B'} cycle` });

  document.getElementById('cycle-options').innerHTML = opts.map(o =>
    `<div class="cycle-opt${current === o.key ? ' active' : ''}" data-mode="${o.key}">
      <span class="cycle-opt-dot"></span>${escHtml(o.label)}
    </div>`
  ).join('');

  document.querySelectorAll('.cycle-opt').forEach(el => {
    el.addEventListener('click', async () => {
      const mode = el.dataset.mode;
      state.prefs.cycle_mode = mode;
      await supabase.from('profiles').update({ preferences: state.prefs }).eq('id', state.user.id);
      renderCycleToggle();
      // Re-render current page
      navigate(state.currentPage);
    });
  });
}

// ── RENDER USER PILL ──────────────────────────────────────────
function renderUserPill() {
  const p = state.profile;
  const h = state.household;
  const name = p?.display_name || state.user?.email || '?';
  const initials = name.slice(0, 2).toUpperCase();
  document.getElementById('user-avatar').textContent = initials;
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-household').textContent = h?.name || '—';
}

// ── SIGN OUT ──────────────────────────────────────────────────
async function signOut() {
  await supabase.auth.signOut();
  location.reload();
}

// ── DATA LOADING ──────────────────────────────────────────────
async function loadAllData() {
  const hid = state.household.id;
  const [
    { data: accounts },
    { data: categories },
    { data: transactions },
    { data: templates },
    { data: budgets },
    { data: snapshots },
    { data: allProfiles },
    { data: settings },
  ] = await Promise.all([
    supabase.from('accounts').select('*').eq('household_id', hid).order('created_at'),
    supabase.from('categories').select('*').eq('household_id', hid).order('sort_order'),
    supabase.from('transactions').select('*').eq('household_id', hid).order('date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('recurring_templates').select('*').eq('household_id', hid).order('created_at'),
    supabase.from('budgets').select('*').eq('household_id', hid),
    supabase.from('budget_snapshots').select('*').eq('household_id', hid).order('period_start', { ascending: false }),
    supabase.from('profiles').select('*').eq('household_id', hid),
    supabase.from('household_settings').select('*').eq('household_id', hid).single(),
  ]);

  state.accounts          = accounts || [];
  state.categories        = categories || [];
  state.transactions      = transactions || [];
  state.recurringTemplates = templates || [];
  state.budgets           = budgets || [];
  state.budgetSnapshots   = snapshots || [];
  state.profiles          = (allProfiles || []).sort((a, b) => a.id.localeCompare(b.id));
  state.settings          = settings || { theme: {}, account_order: [] };
  state.accountOrder      = state.settings.account_order || [];

  // Apply theme — also cache in localStorage for instant apply on next page load
  applyTheme(state.settings.theme);
  try { localStorage.setItem('pocket_theme', JSON.stringify(state.settings.theme || {})); } catch (_) {}

  // Merge current user's prefs
  const myProfile = state.profiles.find(p => p.id === state.user.id);
  if (myProfile) {
    state.profile = myProfile;
    state.prefs = mergePrefs(myProfile.preferences || {});
  }
}

// ── PROCESS RECURRING DUE ────────────────────────────────────
async function processRecurringDue() {
  const today = todayDate();
  const active = state.recurringTemplates.filter(t => t.is_active);
  if (!active.length) return;

  // Build existing set: "templateId|dateISO"
  const existing = new Set(
    state.transactions
      .filter(tx => tx.recurring_template_id)
      .map(tx => `${tx.recurring_template_id}|${tx.date}`)
  );

  const toInsert = [];

  for (const tmpl of active) {
    const startDate = parseISO(tmpl.start_date);
    if (!startDate || startDate > today) continue;

    const dueDates = calcDueDates(tmpl, startDate, today);

    for (const dueDate of dueDates) {
      const key = `${tmpl.id}|${toISO(dueDate)}`;
      if (existing.has(key)) continue;

      toInsert.push({
        household_id: tmpl.household_id,
        user_id: tmpl.user_id,
        date: toISO(dueDate),
        description: tmpl.description,
        amount: tmpl.amount,
        type: tmpl.type,
        status: 'confirmed',
        category_id: tmpl.category_id,
        account_id: tmpl.account_id,
        to_account_id: tmpl.to_account_id,
        notes: tmpl.notes,
        is_recurring: true,
        recur_freq: tmpl.frequency,
        recurring_template_id: tmpl.id,
      });
    }
  }

  if (toInsert.length) {
    const { data, error } = await supabase.from('transactions').insert(toInsert).select();
    if (!error && data) {
      // Add to local state
      state.transactions.push(...data);
      state.transactions.sort((a, b) => b.date.localeCompare(a.date));
      // Mark as recently inserted so realtime doesn't duplicate
      data.forEach(tx => {
        state.recentlyInserted.add(tx.id);
        setTimeout(() => state.recentlyInserted.delete(tx.id), 5000);
      });
    }
  }
}

function calcDueDates(tmpl, startDate, today) {
  const dates = [];
  const freq = tmpl.frequency;

  if (freq === 'weekly' || freq === 'bi-weekly') {
    const stepDays = freq === 'weekly' ? 7 : 14;
    let d = new Date(startDate);
    // Advance to correct day_of_week (0=Mon)
    const targetDow = tmpl.day_of_week ?? d.getDay();
    while (((d.getDay() + 6) % 7) !== targetDow) d.setDate(d.getDate() + 1);
    // Collect all occurrences up to today
    while (d <= today) {
      if (d >= startDate) dates.push(new Date(d));
      d.setDate(d.getDate() + stepDays);
    }

  } else if (freq === 'monthly') {
    const dom = tmpl.day_of_month || 1;
    let y = startDate.getFullYear(), m = startDate.getMonth() + 1;
    for (let i = 0; i < 120; i++) { // max 10 years
      const day = clampDay(y, m, dom);
      const d = new Date(y, m - 1, day);
      if (d > today) break;
      if (d >= startDate) dates.push(d);
      m++;
      if (m > 12) { m = 1; y++; }
    }

  } else if (freq === 'annually') {
    const dom = tmpl.day_of_month || 1;
    const moy = tmpl.month_of_year || 1;
    let y = startDate.getFullYear();
    for (let i = 0; i < 20; i++) {
      const day = clampDay(y, moy, dom);
      const d = new Date(y, moy - 1, day);
      if (d > today) break;
      if (d >= startDate) dates.push(d);
      y++;
    }
  }

  return dates;
}

// ── REALTIME SUBSCRIPTIONS ────────────────────────────────────
function setupRealtime() {
  const hid = state.household.id;

  supabase.channel('pocket-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions',
        filter: `household_id=eq.${hid}` }, handleRealtimeTx)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts',
        filter: `household_id=eq.${hid}` }, handleRealtimeAccounts)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories',
        filter: `household_id=eq.${hid}` }, handleRealtimeCategories)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'recurring_templates',
        filter: `household_id=eq.${hid}` }, handleRealtimeTemplates)
    .subscribe();
}

function handleRealtimeTx({ eventType, new: row, old }) {
  if (eventType === 'INSERT') {
    if (state.recentlyInserted.has(row.id)) return; // dedup
    state.transactions.unshift(row);
  } else if (eventType === 'UPDATE') {
    const idx = state.transactions.findIndex(t => t.id === row.id);
    if (idx !== -1) state.transactions[idx] = row;
  } else if (eventType === 'DELETE') {
    state.transactions = state.transactions.filter(t => t.id !== old.id);
  }
  // Re-render current page silently
  refreshCurrentPage();
}

function handleRealtimeAccounts({ eventType, new: row, old }) {
  if (eventType === 'INSERT') state.accounts.push(row);
  else if (eventType === 'UPDATE') { const i = state.accounts.findIndex(a => a.id === row.id); if (i !== -1) state.accounts[i] = row; }
  else if (eventType === 'DELETE') state.accounts = state.accounts.filter(a => a.id !== old.id);
  refreshCurrentPage();
}

function handleRealtimeCategories({ eventType, new: row, old }) {
  if (eventType === 'INSERT') state.categories.push(row);
  else if (eventType === 'UPDATE') { const i = state.categories.findIndex(c => c.id === row.id); if (i !== -1) state.categories[i] = row; }
  else if (eventType === 'DELETE') state.categories = state.categories.filter(c => c.id !== old.id);
  refreshCurrentPage();
}

function handleRealtimeTemplates({ eventType, new: row, old }) {
  if (eventType === 'INSERT') state.recurringTemplates.push(row);
  else if (eventType === 'UPDATE') { const i = state.recurringTemplates.findIndex(t => t.id === row.id); if (i !== -1) state.recurringTemplates[i] = row; }
  else if (eventType === 'DELETE') state.recurringTemplates = state.recurringTemplates.filter(t => t.id !== old.id);
  refreshCurrentPage();
}

function refreshCurrentPage() {
  const modName = state.currentPage.charAt(0).toUpperCase() + state.currentPage.slice(1);
  const mod = PAGE_MODULES[modName];
  if (mod?.render) mod.render(state);
}

// ── AUTH HANDLERS ─────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');
  btn.disabled = true; btn.textContent = 'Signing in…';

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  console.log('[login] attempting signInWithPassword for', email);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  console.log('[login] result:', { data, error });
  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Sign in';
    return;
  }
  // onAuthStateChange will fire and boot the app
}

async function handleSignup(e) {
  e.preventDefault();
  const btn = document.getElementById('signup-btn');
  const errEl = document.getElementById('signup-error');
  errEl.classList.add('hidden');
  btn.disabled = true; btn.textContent = 'Creating…';
  isSigningUp = true;

  const name     = document.getElementById('signup-name').value.trim();
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const isJoin   = document.getElementById('choice-join').classList.contains('active');

  if (!name || !email || !password) {
    isSigningUp = false;
    showSignupError(errEl, btn, 'Please fill in all fields.');
    return;
  }

  const { data: authData, error: authErr } = await supabase.auth.signUp({ email, password });
  if (authErr) { isSigningUp = false; showSignupError(errEl, btn, authErr.message); return; }
  const userId = authData.user.id;

  // Use SECURITY DEFINER RPC functions to create household + profile
  // bypassing RLS entirely — safe because we validate inputs server-side
  if (isJoin) {
    const code = document.getElementById('signup-invite').value.trim().toUpperCase();
    const { error: joinErr } = await supabase.rpc('join_household', {
      p_user_id: userId, p_invite_code: code, p_display_name: name,
    });
    if (joinErr) { isSigningUp = false; showSignupError(errEl, btn, joinErr.message); return; }
  } else {
    const hhName = document.getElementById('signup-household').value.trim();
    const currency = document.getElementById('signup-currency').value.trim() || 'Kč';
    if (!hhName) { isSigningUp = false; showSignupError(errEl, btn, 'Please enter a household name.'); return; }
    const { error: setupErr } = await supabase.rpc('setup_household', {
      p_user_id: userId, p_household_name: hhName,
      p_invite_code: generateInviteCode(), p_currency: currency, p_display_name: name,
    });
    if (setupErr) { isSigningUp = false; showSignupError(errEl, btn, setupErr.message); return; }
  }

  // All DB setup done — now boot the app
  isSigningUp = false;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    await boot(session.user);
  } else {
    // Fallback: sign in explicitly
    const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
    if (loginErr) { showSignupError(errEl, btn, loginErr.message); return; }
  }
}

function showSignupError(errEl, btn, msg) {
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
  btn.disabled = false; btn.textContent = 'Create account';
}

// ── BOOT SEQUENCE ─────────────────────────────────────────────
let bootInProgress = false;
let booted = false; // true once app has successfully booted; prevents re-boot on TOKEN_REFRESHED
async function boot(user) {
  if (bootInProgress) { console.log('[boot] already in progress, skipping'); return; }
  bootInProgress = true;

  // Hard timeout: if boot hangs > 10s, the Supabase client is likely stuck in a
  // _recoverAndRefresh loop with a stale/locked localStorage token. Clear it so
  // the next page load starts fresh instead of hanging again.
  const bootTimeout = setTimeout(async () => {
    console.error('[boot] timed out — clearing stale auth token from localStorage');
    try { await supabase.auth.signOut({ scope: 'local' }); } catch (_) {}
    bootInProgress = false;
    showAuthScreen();
  }, 10000);

  try {
    state.user = user;
    console.log('[boot] loading profile...');

    // Fetch profile — 8s timeout so a paused/unreachable Supabase fails fast
    const profileAbort = new AbortController();
    const profileTimer = setTimeout(() => profileAbort.abort(), 8000);
    const { data: profile, error: profileError } = await supabase
      .from('profiles').select('*').eq('id', user.id).abortSignal(profileAbort.signal).single();
    clearTimeout(profileTimer);
    console.log('[boot] profile result:', { profile, profileError });

    if (profileError || !profile || !profile.household_id) {
      console.warn('[boot] no profile/household_id', profileError);
      clearTimeout(bootTimeout);
      bootInProgress = false;
      showAuthScreen();
      return;
    }

    const householdAbort = new AbortController();
    const householdTimer = setTimeout(() => householdAbort.abort(), 8000);
    const { data: household, error: householdError } = await supabase
      .from('households').select('*').eq('id', profile.household_id).abortSignal(householdAbort.signal).single();
    clearTimeout(householdTimer);
    console.log('[boot] household result:', { household, householdError });

    if (householdError || !household) {
      console.warn('[boot] no household', householdError);
      clearTimeout(bootTimeout);
      bootInProgress = false;
      showAuthScreen();
      return;
    }

    state.profile = profile;
    state.household = household;
    state.prefs = mergePrefs(profile.preferences || {});

    // Load all data
    console.log('[boot] loading all data...');
    await loadAllData();
    console.log('[boot] data loaded');

    // Process recurring templates
    console.log('[boot] processing recurring...');
    await processRecurringDue();
    console.log('[boot] recurring done');

    // Setup realtime
    setupRealtime();

    // Render shell
    renderSidebarNav();
    renderCycleToggle();
    renderUserPill();

    // Show app
    hideLoading();
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    // Restore last page
    const lastPage = localStorage.getItem('pocket_last_page') || 'dashboard';
    const validPage = NAV_PAGES[lastPage] ? lastPage : 'dashboard';
    console.log('[boot] navigating to', validPage);
    navigate(validPage);
    booted = true;
    clearTimeout(bootTimeout);
    bootInProgress = false;
  } catch (err) {
    console.error('[boot] failed:', err);
    clearTimeout(bootTimeout);
    bootInProgress = false;
    showAuthScreen();
  }
}

function showAuthScreen() {
  hideLoading();
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('auth-screen').classList.remove('hidden');
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.add('done');
  setTimeout(() => overlay.style.display = 'none', 400);
}

// ── INIT ──────────────────────────────────────────────────────
async function init() {
  // ── Wire auth form toggles
  document.getElementById('show-signup').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('signup-form').classList.remove('hidden');
  });
  document.getElementById('show-login').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('signup-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
  });

  // ── Login / signup submit
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('signup-btn').addEventListener('click', handleSignup);

  // ── Household choice toggle
  document.getElementById('choice-create').addEventListener('click', () => switchHouseholdChoice('create'));
  document.getElementById('choice-join').addEventListener('click',   () => switchHouseholdChoice('join'));

  // ── Sidebar
  document.getElementById('hamburger').addEventListener('click', openSidebar);
  document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

  // Sign out
  document.getElementById('sign-out-btn').addEventListener('click', signOut);

  // Modal close
  document.getElementById('modal-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('sheet-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeBottomSheet();
  });
  document.getElementById('sheet-close-btn').addEventListener('click', closeBottomSheet);

  // Enter key on login
  ['login-email', 'login-password'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleLogin(e);
    });
  });

  // ── Auth state machine ────────────────────────────────────────
  // CRITICAL: the onAuthStateChange callback MUST be synchronous (no async/await).
  // Supabase v2 awaits all callbacks inside _notifyAllSubscribers. If our callback
  // makes any supabase call (including getSession inside a DB query), it creates a
  // circular wait: _initialize awaits our callback, our callback awaits getSession,
  // getSession awaits _initialize → deadlock on every page reload.
  //
  // Fix: return synchronously, defer all Supabase work to the next event-loop tick
  // via setTimeout(0) so _initialize can complete before we touch the client.

  const authSafety = setTimeout(() => {
    if (booted || bootInProgress) return;
    console.warn('[auth] INITIAL_SESSION never fired within 8s');
    showAuthScreen();
  }, 8000);

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'INITIAL_SESSION') {
      clearTimeout(authSafety);
      if (session?.user && !isSigningUp) {
        setTimeout(() => boot(session.user), 0);
      } else if (!session?.user) {
        setTimeout(() => showAuthScreen(), 0);
      }
      // user + isSigningUp: signup flow calls boot() directly after DB setup

    } else if (event === 'SIGNED_IN' && !booted && !isSigningUp) {
      clearTimeout(authSafety);
      setTimeout(() => boot(session.user), 0);

    } else if (event === 'SIGNED_OUT') {
      clearTimeout(authSafety);
      booted = false;
      if (!bootInProgress) showAuthScreen();
    }
    // TOKEN_REFRESHED: deliberately ignored — happens every ~50 min and must
    // not trigger a re-boot mid-session.
  });
}

function switchHouseholdChoice(choice) {
  const isCreate = choice === 'create';
  document.getElementById('choice-create').classList.toggle('active', isCreate);
  document.getElementById('choice-join').classList.toggle('active', !isCreate);
  document.getElementById('create-fields').classList.toggle('hidden', !isCreate);
  document.getElementById('join-fields').classList.toggle('hidden', isCreate);
}

// ── GLOBAL API (for use in page modules and inline handlers) ──
window.App = {
  state, navigate, toast, openModal, closeModal, closeBottomSheet, openConfirm,
  openSidebar, closeSidebar, signOut, refreshCurrentPage,
  currency, cycleMode, cyclePeriod, memberA, memberB,
  supabase, loadAllData, renderSidebarNav, renderCycleToggle, renderUserPill,
};

// Start
init();
