/* ═══════════════════════════════════════════════════════════════
   utils.js — Shared utilities, Supabase client, helpers
═══════════════════════════════════════════════════════════════ */

// ── SUPABASE CLIENT ──────────────────────────────────────────
const SUPABASE_URL = 'https://blnxkxhwllawdzghvwyy.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsbnhreGh3bGxhd2R6Z2h2d3l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NzYzNzgsImV4cCI6MjA4OTQ1MjM3OH0.jPe8eFxKHCrSRr-m6QU8iQvg2OZ0r4bQr6i1NPtnd_w';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── FORMAT HELPERS ───────────────────────────────────────────

/**
 * Format a numeric amount as currency string
 * @param {number} amount
 * @param {string} currency - symbol e.g. "Kč", "$", "£"
 * @param {boolean} signed - prefix + for positive
 */
export function fmtCurrency(amount, currency = 'Kč', signed = false) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  // Format with space-separated thousands, 2 decimal places
  const formatted = abs.toLocaleString('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  // Czech convention: number then symbol
  const sym = currency || 'Kč';
  const isPrefix = ['$', '£', '€'].includes(sym);
  const numStr = isPrefix ? `${sym}${formatted}` : `${formatted} ${sym}`;
  if (signed && n > 0) return `+${numStr}`;
  if (n < 0) return `−${numStr}`;
  return numStr;
}

/**
 * Short amount — compact thousands (e.g. 12.4k, 1.2M)
 */
export function fmtCompact(amount, currency = 'Kč') {
  const n = Math.abs(Number(amount) || 0);
  let str;
  if (n >= 1_000_000) str = `${(n / 1_000_000).toFixed(1)}M`;
  else if (n >= 1_000) str = `${(n / 1_000).toFixed(1)}k`;
  else str = n.toFixed(0);
  const sym = currency || 'Kč';
  const isPrefix = ['$', '£', '€'].includes(sym);
  const numStr = isPrefix ? `${sym}${str}` : `${str} ${sym}`;
  return Number(amount) < 0 ? `−${numStr}` : numStr;
}

/**
 * Format a date string/object as display date
 * @param {string|Date} d
 * @param {string} style - 'short' | 'medium' | 'long'
 */
export function fmtDate(d, style = 'medium') {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d + 'T00:00:00');
  if (isNaN(date)) return String(d);
  if (style === 'short') {
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
  }
  if (style === 'long') {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  // medium: "19 Mar 2026"
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Relative date — "Today", "Yesterday", "5 Mar"
 */
export function fmtRelDate(d) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d + 'T00:00:00');
  const today = todayDate();
  const diff = Math.round((today - date) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Format a percentage
 */
export function fmtPct(value, decimals = 1) {
  return `${(Number(value) || 0).toFixed(decimals)}%`;
}

// ── DATE HELPERS ─────────────────────────────────────────────

/** Today's Date object at midnight */
export function todayDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Today as ISO date string YYYY-MM-DD */
export function todayISO() {
  return toISO(todayDate());
}

/** Date object → 'YYYY-MM-DD' */
export function toISO(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse ISO string → local midnight Date */
export function parseISO(s) {
  if (!s) return null;
  return new Date(s + 'T00:00:00');
}

/** Last day of month for a given year/month (1-indexed) */
export function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** Clamp day to last day of month */
export function clampDay(year, month, day) {
  return Math.min(day, lastDayOfMonth(year, month));
}

/**
 * Calculate current cycle boundaries
 * @param {string} cycleMode - 'month' | 'user_a' | 'user_b'
 * @param {object} prefs - merged prefs {salary_day_a, salary_day_b}
 * @returns {{ start: Date, end: Date, label: string }}
 */
export function calcCycle(cycleMode, prefs = {}) {
  const today = todayDate();
  const y = today.getFullYear();
  const m = today.getMonth() + 1; // 1-indexed

  if (cycleMode === 'month') {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0); // last day
    return {
      start,
      end,
      label: today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    };
  }

  const salaryDay = cycleMode === 'user_a' ? (prefs.salary_day_a || 1) : (prefs.salary_day_b || 1);

  // Salary cycle: start = salary_day this month (or last month if not reached)
  let startM = m, startY = y;
  const clampedThisMonth = clampDay(y, m, salaryDay);
  if (today.getDate() < clampedThisMonth) {
    // Haven't reached salary day yet → cycle started last month
    startM = m - 1 || 12;
    startY = startM === 12 ? y - 1 : y;
  }
  const clampedStart = clampDay(startY, startM, salaryDay);
  const start = new Date(startY, startM - 1, clampedStart);

  // Cycle end = day before salary_day next month
  const nextM = startM === 12 ? 1 : startM + 1;
  const nextY = startM === 12 ? startY + 1 : startY;
  const clampedEnd = clampDay(nextY, nextM, salaryDay) - 1 || lastDayOfMonth(startY, startM);
  const end = new Date(nextY, nextM - 1, clampedEnd > 0 ? clampedEnd : lastDayOfMonth(startY, startM));

  const label = `${fmtDate(start, 'short')} – ${fmtDate(end, 'short')}`;
  return { start, end, label };
}

/**
 * Get N previous periods (for charts/analytics)
 * @param {string} cycleMode
 * @param {object} prefs
 * @param {number} n - number of periods
 * @returns {Array<{start:Date, end:Date, label:string}>}
 */
export function getPeriods(cycleMode, prefs, n) {
  const periods = [];
  const current = calcCycle(cycleMode, prefs);
  periods.unshift(current);

  for (let i = 1; i < n; i++) {
    const prev = getPrevPeriod(cycleMode, prefs, periods[0].start);
    periods.unshift(prev);
  }
  return periods;
}

function getPrevPeriod(cycleMode, prefs, currentStart) {
  const d = new Date(currentStart);
  d.setDate(d.getDate() - 1); // go one day before current start
  return calcCycleForDate(cycleMode, prefs, d);
}

function calcCycleForDate(cycleMode, prefs, date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;

  if (cycleMode === 'month') {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    return { start, end, label: date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) };
  }

  const salaryDay = cycleMode === 'user_a' ? (prefs.salary_day_a || 1) : (prefs.salary_day_b || 1);
  let startM = m, startY = y;
  const clamped = clampDay(y, m, salaryDay);
  if (date.getDate() < clamped) {
    startM = m - 1 || 12;
    startY = startM === 12 ? y - 1 : y;
  }
  const clampedStart = clampDay(startY, startM, salaryDay);
  const start = new Date(startY, startM - 1, clampedStart);
  const nextM = startM === 12 ? 1 : startM + 1;
  const nextY = startM === 12 ? startY + 1 : startY;
  const clampedEnd = clampDay(nextY, nextM, salaryDay) - 1;
  const end = new Date(nextY, nextM - 1, clampedEnd > 0 ? clampedEnd : lastDayOfMonth(startY, startM));
  return { start, end, label: `${fmtDate(start, 'short')} – ${fmtDate(end, 'short')}` };
}

// ── TRANSACTION HELPERS ──────────────────────────────────────

/** Is transaction effective (confirmed OR date <= today) */
export function isEffective(tx) {
  return tx.status === 'confirmed' || parseISO(tx.date) <= todayDate();
}

/** Type → display label (used for badges and individual type display) */
export const TX_TYPE_LABELS = {
  spend: 'Spend', income: 'Income', savings: 'Savings',
  investment: 'Investment', transfer: 'Transfer',
  withdrawal: 'Withdrawal', debt_payment: 'Debt Payment',
  adjustment: 'Adjust',
};

/** Ordered type list for form selectors — savings+investment merged */
export const TX_FORM_TYPES = [
  ['income',             'Income'],
  ['spend',              'Spend'],
  ['savings_investment', 'Savings & Investments'],
  ['debt_payment',       'Debt Payment'],
  ['transfer',           'Transfer'],
  ['adjustment',         'Adjust'],
];

/** Consolidated type list for filter dropdowns — savings+investment merged */
export const TX_FILTER_TYPES = [
  ['income',             'Income'],
  ['spend',              'Spend'],
  ['savings_investment', 'Savings & Investments'],
  ['debt_payment',       'Debt Payment'],
  ['transfer',           'Transfer'],
  ['adjustment',         'Adjust'],
];

/** Type → badge CSS class */
export function typeBadgeClass(type) {
  return `badge badge-${type?.replace('_', '-') || 'neutral'}`;
}

/** Effective account type (handles custom) */
export function effectiveType(account) {
  if (!account) return 'checking';
  return account.type === 'custom' ? (account.base_type || 'checking') : account.type;
}

/** Is account liquid (for from-account filters) */
export function isLiquid(account) {
  return ['checking', 'credit', 'cash'].includes(effectiveType(account));
}

// ── MISC HELPERS ─────────────────────────────────────────────

/** Generate a random 6-char uppercase invite code */
export function generateInviteCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/** Debounce */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Deep clone (JSON-safe) */
export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/** Merge preferences with defaults */
export const DEFAULT_PREFS = {
  columns: ['date', 'description', 'category', 'type', 'amount', 'account', 'person'],
  dash: {
    cards: { income: true, spending: true, saved: true, invested: true, withdrawn: false,
             debt_payments: false, net_balance: true, net_worth: false, total_debt: false,
             due_eop: true, expected_eop: true, runway: false },
    cardOrder: ['income', 'spending', 'saved', 'invested', 'withdrawn', 'debt_payments',
                'net_balance', 'net_worth', 'total_debt', 'due_eop', 'expected_eop', 'runway'],
    sections: { breakdown: true, cashflow: true, recent: true },
  },
  salary_day: null,
  cycle_mode: 'month',
  nav_order: ['dashboard', 'transactions', 'budgets', 'analytics', 'forecast', 'recurring', 'accounts', 'settings'],
  forecast_avg_window: 3,
};

export function mergePrefs(stored) {
  const base = clone(DEFAULT_PREFS);
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    dash: {
      ...base.dash,
      ...(stored.dash || {}),
      cards: { ...base.dash.cards, ...(stored.dash?.cards || {}) },
      sections: { ...base.dash.sections, ...(stored.dash?.sections || {}) },
      cardOrder: stored.dash?.cardOrder || base.dash.cardOrder,
    },
  };
}

/** Nav page definitions */
export const NAV_PAGES = {
  dashboard:    { label: 'Dashboard',    icon: '◉' },
  transactions: { label: 'Transactions', icon: '↕' },
  budgets:      { label: 'Budgets',      icon: '◎' },
  analytics:    { label: 'Analytics',    icon: '∿' },
  forecast:     { label: 'Forecast',     icon: '◈' },
  recurring:    { label: 'Recurring',    icon: '↻' },
  accounts:     { label: 'Accounts',     icon: '▣' },
  categories:   { label: 'Categories',   icon: '⊞' },
  settings:     { label: 'Settings',     icon: '⚙' },
};

/** Apply household theme — derives all CSS vars from bg, text, accent */
export function applyTheme(theme) {
  if (!theme || (!theme.bg && !theme.text && !theme.accent)) return;
  const root = document.documentElement;

  const bg     = theme.bg     || '#faf7f2';
  const text   = theme.text   || '#1c1917';
  const accent = theme.accent || '#22c55e';

  function hexToRgb(h) {
    const s = h.replace('#','');
    return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)];
  }
  function toHex(r,g,b) {
    return '#' + [r,g,b].map(v => Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
  }
  function mix(c1, c2, t) { // t=0→c1, t=1→c2
    const [r1,g1,b1] = hexToRgb(c1), [r2,g2,b2] = hexToRgb(c2);
    return toHex(r1+(r2-r1)*t, g1+(g2-g1)*t, b1+(b2-b1)*t);
  }
  function luma(hex) {
    const [r,g,b] = hexToRgb(hex).map(v => v/255);
    return 0.2126*r + 0.7152*g + 0.0722*b;
  }

  const dark = luma(bg) < 0.4;

  root.style.setProperty('--bg',         bg);
  root.style.setProperty('--text',       text);
  root.style.setProperty('--accent',     accent);
  root.style.setProperty('--sidebar-bg', mix(bg, text, dark ? 0.06 : 0.05));
  root.style.setProperty('--surface',    mix(bg, text, dark ? 0.13 : 0.08));
  root.style.setProperty('--surface2',   mix(bg, text, dark ? 0.22 : 0.14));
  root.style.setProperty('--border',     mix(bg, text, dark ? 0.20 : 0.18));
  root.style.setProperty('--text2',      mix(text, bg, dark ? 0.42 : 0.45));
  root.style.setProperty('--text3',      mix(text, bg, dark ? 0.60 : 0.65));
  root.style.setProperty('--accent-l',   mix(bg, accent, dark ? 0.22 : 0.28));
  root.style.setProperty('--shadow',     `0 2px 8px rgba(${dark?'0,0,0,.35':'0,0,0,.10'})`);
  root.style.setProperty('--shadow-lg',  `0 8px 32px rgba(${dark?'0,0,0,.5':'0,0,0,.18'})`);

  // Status colors — lightened one stop on dark backgrounds for legibility
  root.style.setProperty('--green',  dark ? '#4ade80' : '#22c55e');
  root.style.setProperty('--red',    dark ? '#f87171' : '#ef4444');
  root.style.setProperty('--amber',  dark ? '#fbbf24' : '#f59e0b');
  root.style.setProperty('--blue',   dark ? '#60a5fa' : '#3b82f6');
  root.style.setProperty('--purple', dark ? '#c084fc' : '#a855f7');
  root.style.setProperty('--cyan',   dark ? '#22d3ee' : '#06b6d4');
  root.style.setProperty('--violet', dark ? '#c4b5fd' : '#a78bfa');
}

/** Read a CSS custom property value from the document root at call time */
export function getCSSColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/** Compute account balance from opening_balance + transactions */
export function calcAccountBalance(account, transactions) {
  let bal = Number(account.opening_balance) || 0;
  const et = effectiveType(account);
  const isLoan = et === 'loan';

  for (const tx of transactions) {
    if (!isEffective(tx)) continue;
    const isSource = tx.account_id === account.id;
    const isDest = tx.to_account_id === account.id;
    if (!isSource && !isDest) continue;

    const amt = Number(tx.amount);
    if (isLoan) {
      if (isDest && tx.type === 'debt_payment') bal += amt; // payment arrives at loan → reduces outstanding balance
      // loan doesn't receive transfers normally
    } else {
      if (isSource) {
        // income: account_id is the receiving account → credit
        if (tx.type === 'income') bal += amt;
        // outflows
        if (['spend', 'savings', 'investment', 'transfer', 'withdrawal', 'debt_payment'].includes(tx.type)) bal -= amt;
        if (tx.type === 'adjustment') bal += (tx.notes === 'subtract' ? -amt : amt);
      }
      if (isDest) {
        // inbound transfers/savings/investment/withdrawal arriving at this account
        if (['savings', 'investment', 'transfer', 'withdrawal'].includes(tx.type)) bal += amt;
      }
    }
  }
  return bal;
}

/** Group categories into {groups, subsByParent} */
export function buildCategoryTree(categories) {
  const groups = categories.filter(c => !c.parent_id)
    .sort((a, b) => a.sort_order - b.sort_order);
  const subsByParent = {};
  for (const c of categories.filter(c => c.parent_id)) {
    if (!subsByParent[c.parent_id]) subsByParent[c.parent_id] = [];
    subsByParent[c.parent_id].push(c);
  }
  for (const arr of Object.values(subsByParent)) {
    arr.sort((a, b) => a.sort_order - b.sort_order);
  }
  return { groups, subsByParent };
}

/** Build category <select> options HTML */
export function buildCategoryOptions(categories, selectedId = null) {
  const { groups, subsByParent } = buildCategoryTree(categories);
  let html = '<option value="">— Select category —</option>';
  for (const g of groups) {
    const subs = subsByParent[g.id] || [];
    if (subs.length > 0) {
      html += `<optgroup label="${g.icon} ${escHtml(g.name)}">`;
      html += `<option value="${g.id}"${selectedId === g.id ? ' selected' : ''}>${g.icon} ${escHtml(g.name)} (group)</option>`;
      for (const s of subs) {
        html += `<option value="${s.id}"${selectedId === s.id ? ' selected' : ''}>${s.icon} ${escHtml(s.name)}</option>`;
      }
      html += '</optgroup>';
    } else {
      html += `<option value="${g.id}"${selectedId === g.id ? ' selected' : ''}>${g.icon} ${escHtml(g.name)}</option>`;
    }
  }
  return html;
}

/** Build account <select> options HTML, respecting account_order */
export function buildAccountOptions(accounts, accountOrder = [], filterFn = null, selectedId = null) {
  // Sort by accountOrder
  const ordered = [...accounts].sort((a, b) => {
    const ia = accountOrder.indexOf(a.id);
    const ib = accountOrder.indexOf(b.id);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  const filtered = filterFn ? ordered.filter(filterFn) : ordered;
  const active = filtered.filter(a => !a.is_archived);
  let html = '<option value="">— Select account —</option>';
  for (const a of active) {
    html += `<option value="${a.id}"${selectedId === a.id ? ' selected' : ''}>${escHtml(a.name)}</option>`;
  }
  return html;
}

/** HTML-escape a string */
export function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Get category by id */
export function getCat(categories, id) {
  return categories.find(c => c.id === id) || null;
}

/** Get parent group for a category */
export function getParentCat(categories, cat) {
  if (!cat || !cat.parent_id) return null;
  return categories.find(c => c.id === cat.parent_id) || null;
}

/** Get display name for category (with parent if subcategory) */
export function catDisplay(categories, catId) {
  const cat = getCat(categories, catId);
  if (!cat) return '—';
  const parent = getParentCat(categories, cat);
  return parent ? `${cat.icon} ${cat.name}` : `${cat.icon} ${cat.name}`;
}

/** Spend sign for amount display */
export function amountSign(tx) {
  if (['spend', 'savings', 'investment', 'transfer', 'debt_payment'].includes(tx.type)) return -1;
  if (['income', 'withdrawal'].includes(tx.type)) return 1;
  return 0; // adjustment, transfer to
}

/** Sum transactions by type */
export function sumByType(transactions, type) {
  return transactions
    .filter(tx => isEffective(tx) && tx.type === type)
    .reduce((s, tx) => s + Number(tx.amount), 0);
}

// ── COLOR SWATCHES ────────────────────────────────────────────

const _FALLBACK_COLORS = [
  '#22c55e','#3b82f6','#ef4444','#f59e0b','#8b5cf6','#ec4899',
  '#06b6d4','#f97316','#10b981','#6366f1','#84cc16','#e11d48',
];

/** Returns HTML for a row of color swatches linked to an <input type="color" id="inputId"> */
export function colorSwatchesHtml(inputId) {
  const theme = window.App?.state?.settings?.theme || {};
  const saved = Array.isArray(theme.saved) ? theme.saved : [];
  const seen = new Set();
  const colors = [];
  const add = c => { if (c && !seen.has(c)) { seen.add(c); colors.push(c); } };
  if (theme.accent) add(theme.accent);
  saved.forEach(p => { add(p.accent); add(p.bg); });
  _FALLBACK_COLORS.forEach(add);
  return `<div class="csw-row" data-for="${escHtml(inputId)}" style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:.4rem">
    ${colors.slice(0, 18).map(c =>
      `<button type="button" class="csw-btn" data-color="${escHtml(c)}" title="${escHtml(c)}"
        style="width:22px;height:22px;border-radius:3px;background:${c};
               border:2px solid transparent;cursor:pointer;padding:0;flex-shrink:0"></button>`
    ).join('')}
  </div>`;
}

/** Wire swatch buttons inside root to their linked color input */
export function wireColorSwatches(root = document) {
  root.querySelectorAll('.csw-row').forEach(row => {
    const input = document.getElementById(row.dataset.for);
    if (!input) return;
    const highlight = val => {
      row.querySelectorAll('.csw-btn').forEach(b =>
        b.style.borderColor = b.dataset.color === val ? 'var(--text)' : 'transparent'
      );
    };
    highlight(input.value);
    row.querySelectorAll('.csw-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.dataset.color;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        highlight(btn.dataset.color);
      });
    });
  });
}

/** Minimal drag-to-reorder wiring for a list container.
 *  rowSel: CSS selector for draggable rows (must have data-id).
 *  onDrop(orderedIds): called after a drop with the new id order. */
export function wireDragReorder(container, rowSel, onDrop) {
  if (!container) return;
  let src = null;
  const rows = () => [...container.querySelectorAll(rowSel)];

  container.querySelectorAll(rowSel).forEach(row => {
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', e => {
      src = row;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => { if (src) src.style.opacity = '0.4'; }, 0);
    });
    row.addEventListener('dragend', () => {
      if (src) src.style.opacity = '1';
      src = null;
      onDrop(rows().map(r => r.dataset.id));
    });
    row.addEventListener('dragover', e => {
      if (!src || src === row) return;
      e.preventDefault();
      const mid = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
      if (e.clientY < mid) container.insertBefore(src, row);
      else row.after(src);
    });
  });
}
