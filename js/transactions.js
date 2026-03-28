/* ═══════════════════════════════════════════════════════════════
   transactions.js — Transaction list, add/edit, filters, CSV
═══════════════════════════════════════════════════════════════ */

import {
  fmtCurrency, fmtDate, fmtRelDate, escHtml, parseISO, todayISO,
  isEffective, effectiveType, isLiquid, buildCategoryOptions,
  buildAccountOptions, TX_TYPE_LABELS, TX_FORM_TYPES, TX_FILTER_TYPES, typeBadgeClass, getCat,
} from './utils.js';

// Resolve 'savings_investment' to 'savings' or 'investment' based on category nature
function resolveType(rawType, categoryId, categories) {
  if (rawType !== 'savings_investment') return rawType;
  const cat = categories?.find(c => c.id === categoryId);
  return cat?.nature === 'Investments' ? 'investment' : 'savings';
}

// Map a stored tx type back to the form value
function toFormType(type) {
  return (type === 'savings' || type === 'investment') ? 'savings_investment' : (type || 'spend');
}

// ── STATE ─────────────────────────────────────────────────────
let filters = { search: '', status: 'all', type: '', category: '', account: '', person: '', month: '' };
let editingId = null;
let selectedIds = new Set();
let viewMode = 'flat'; // flat | nature | group | sub | tx_type

const ALL_COLUMNS = [
  { id: 'date',          label: 'Date' },
  { id: 'description',   label: 'Description' },
  { id: 'parent_group',  label: 'Parent group' },
  { id: 'category',      label: 'Category' },
  { id: 'nature',        label: 'Nature' },
  { id: 'type',          label: 'Type' },
  { id: 'recurring',     label: 'Recurring' },
  { id: 'amount',        label: 'Amount' },
  { id: 'account',       label: 'Account' },
  { id: 'running_balance', label: 'Running balance' },
  { id: 'person',        label: 'Person' },
  { id: 'status',        label: 'Status' },
  { id: 'notes',         label: 'Notes' },
];
const DEFAULT_COLUMNS = ['date','description','category','type','amount','account','person','status'];

function getVisibleCols(state) {
  const saved = state.prefs?.columns;
  const base = saved?.length ? saved : DEFAULT_COLUMNS;
  // running_balance only when single account filter active
  if (filters.account) return base.includes('running_balance') ? base : base;
  return base.filter(c => c !== 'running_balance');
}

// ── MAIN RENDER ───────────────────────────────────────────────
export function render(state) {
  const el = document.getElementById('page-transactions');
  const cur = App.currency();

  // Reset edit state on re-render
  editingId = null;
  selectedIds.clear();

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Transactions</div>
        <div class="page-subtitle" id="tx-count-label">${state.transactions.length} transactions</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" id="tx-columns-btn">Columns ▾</button>
        <button class="btn btn-ghost btn-sm" id="tx-export-btn">↓ CSV</button>
        <button class="btn btn-primary" id="tx-add-btn">+ Add transaction</button>
      </div>
    </div>

    <!-- View modes -->
    <div class="section" style="padding-bottom:0;padding-top:.5rem">
      <div class="toggle-group">
        <button class="toggle-group-btn tx-view-btn${viewMode==='flat'?' active':''}" data-view="flat">Flat</button>
        <button class="toggle-group-btn tx-view-btn${viewMode==='tx_type'?' active':''}" data-view="tx_type">Tx Type</button>
        <button class="toggle-group-btn tx-view-btn${viewMode==='nature'?' active':''}" data-view="nature">Nature</button>
        <button class="toggle-group-btn tx-view-btn${viewMode==='group'?' active':''}" data-view="group">Group</button>
        <button class="toggle-group-btn tx-view-btn${viewMode==='sub'?' active':''}" data-view="sub">Subcategory</button>
      </div>
    </div>

    <!-- Filters -->
    <div class="section" style="padding-bottom:0">
      <div class="flex gap-2" style="flex-wrap:wrap;align-items:center">
        <input class="form-input" id="tx-search" placeholder="Search…" style="width:200px;flex:none" value="${escHtml(filters.search)}" />
        <div class="toggle-group">
          <button class="toggle-group-btn tx-status-btn${filters.status === 'all' ? ' active' : ''}" data-status="all">All</button>
          <button class="toggle-group-btn tx-status-btn${filters.status === 'confirmed' ? ' active' : ''}" data-status="confirmed">Confirmed</button>
          <button class="toggle-group-btn tx-status-btn${filters.status === 'pending' ? ' active' : ''}" data-status="pending">Pending</button>
        </div>
        <select class="form-select" id="tx-filter-type" style="width:auto">
          <option value="">All types</option>
          ${TX_FILTER_TYPES.map(([k,v]) => `<option value="${k}"${filters.type===k?' selected':''}>${v}</option>`).join('')}
        </select>
        <select class="form-select" id="tx-filter-account" style="width:auto">
          <option value="">All accounts</option>
          ${state.accounts.filter(a=>!a.is_archived).map(a => `<option value="${a.id}"${filters.account===a.id?' selected':''}>${escHtml(a.name)}</option>`).join('')}
        </select>
        <select class="form-select" id="tx-filter-category" style="width:auto">
          <option value="">All categories</option>
          ${state.categories.filter(c => !c.parent_id).map(g => {
            const subs = state.categories.filter(c => c.parent_id === g.id);
            if (subs.length) {
              return `<optgroup label="${escHtml((g.icon||'')+' '+g.name)}">
                <option value="${g.id}"${filters.category===g.id?' selected':''}>${escHtml((g.icon||'')+' '+g.name)} (group)</option>
                ${subs.map(s => `<option value="${s.id}"${filters.category===s.id?' selected':''}>${escHtml('\u00a0\u00a0'+(s.icon||'')+' '+s.name)}</option>`).join('')}
              </optgroup>`;
            }
            return `<option value="${g.id}"${filters.category===g.id?' selected':''}>${escHtml((g.icon||'')+' '+g.name)}</option>`;
          }).join('')}
        </select>
        <select class="form-select" id="tx-filter-person" style="width:auto">
          <option value="">All people</option>
          ${state.profiles.map(p => `<option value="${p.id}"${filters.person===p.id?' selected':''}>${escHtml(p.display_name)}</option>`).join('')}
        </select>
        <select class="form-select" id="tx-filter-month" style="width:auto">
          <option value="">All months</option>
          ${[...new Set(state.transactions.map(t => t.date.slice(0,7)))].sort().reverse()
              .map(m => `<option value="${m}"${filters.month===m?' selected':''}>${m}</option>`).join('')}
        </select>
        <div id="tx-bulk-actions"></div>
        <button class="btn btn-ghost btn-sm" id="tx-clear-filters">Clear filters</button>
      </div>
    </div>

    <!-- Table -->
    <div class="section">
      <div id="tx-table-container"></div>
    </div>
  `;

  // Wire events
  document.getElementById('tx-add-btn').addEventListener('click', () => openTxModal(state));
  document.getElementById('tx-export-btn').addEventListener('click', () => exportCSV(state));
  document.getElementById('tx-columns-btn').addEventListener('click', () => openColumnsModal(state));
  el.querySelectorAll('.tx-view-btn').forEach(btn => {
    btn.addEventListener('click', () => { viewMode = btn.dataset.view; render(state); });
  });
  document.getElementById('tx-search').addEventListener('input', e => { filters.search = e.target.value; renderTable(state); });
  document.getElementById('tx-filter-type').addEventListener('change', e => { filters.type = e.target.value; renderTable(state); });
  document.getElementById('tx-filter-account').addEventListener('change', e => { filters.account = e.target.value; renderTable(state); });
  document.getElementById('tx-filter-category').addEventListener('change', e => { filters.category = e.target.value; renderTable(state); });
  document.getElementById('tx-filter-person').addEventListener('change', e => { filters.person = e.target.value; renderTable(state); });
  document.getElementById('tx-filter-month').addEventListener('change', e => { filters.month = e.target.value; renderTable(state); });
  document.getElementById('tx-clear-filters').addEventListener('click', () => {
    filters = { search: '', status: 'all', type: '', category: '', account: '', person: '', month: '' };
    render(state);
  });
  el.querySelectorAll('.tx-status-btn').forEach(btn => {
    btn.addEventListener('click', () => { filters.status = btn.dataset.status; render(state); });
  });
  renderTable(state);
}

// ── FILTER & RENDER TABLE ─────────────────────────────────────
function getFiltered(state) {
  const { transactions, categories, accounts, profiles } = state;
  const search = filters.search.toLowerCase();
  return transactions.filter(tx => {
    if (filters.status === 'confirmed' && tx.status !== 'confirmed') return false;
    if (filters.status === 'pending' && tx.status !== 'pending') return false;
    if (filters.type) {
      if (filters.type === 'savings_investment') {
        if (tx.type !== 'savings' && tx.type !== 'investment') return false;
      } else if (tx.type !== filters.type) return false;
    }
    if (filters.account && tx.account_id !== filters.account && tx.to_account_id !== filters.account) return false;
    if (filters.person && tx.user_id !== filters.person) return false;
    if (filters.category) {
      // Match direct or parent category
      const cat = categories.find(c => c.id === tx.category_id);
      if (!cat) return false;
      if (cat.id !== filters.category && cat.parent_id !== filters.category) return false;
    }
    if (filters.month && !tx.date.startsWith(filters.month)) return false;
    if (search) {
      const desc = (tx.description || '').toLowerCase();
      const notes = (tx.notes || '').toLowerCase();
      if (!desc.includes(search) && !notes.includes(search)) return false;
    }
    return true;
  });
}

function renderTable(state) {
  const container = document.getElementById('tx-table-container');
  if (!container) return;
  const cur = App.currency();
  const filtered = getFiltered(state);
  const { categories, accounts, profiles } = state;

  // Update count label
  const countEl = document.getElementById('tx-count-label');
  if (countEl) countEl.textContent = `${filtered.length} of ${state.transactions.length} transactions`;

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">No transactions found</div>`;
    return;
  }

  const isMobile = window.innerWidth <= 768;

  if (isMobile) {
    container.innerHTML = filtered.map(tx => renderMobileCard(tx, state, cur)).join('');
    container.querySelectorAll('.tx-card').forEach(card => {
      card.addEventListener('click', () => openTxModal(state, state.transactions.find(t => t.id === card.dataset.id)));
    });
    return;
  }

  const cols = getVisibleCols(state);
  const colSpan = cols.length + 2; // checkbox + actions

  const headerCells = cols.map(c => {
    const meta = ALL_COLUMNS.find(x => x.id === c);
    return `<th${c === 'amount' || c === 'running_balance' ? ' class="amount-col"' : ''}>${meta?.label || c}</th>`;
  }).join('');

  // Build running balance map if needed
  let runningBalMap = {};
  if (cols.includes('running_balance') && filters.account) {
    const accTx = [...filtered].sort((a,b) => a.date.localeCompare(b.date));
    let bal = 0;
    const acc = state.accounts.find(a => a.id === filters.account);
    bal = acc ? Number(acc.opening_balance || 0) : 0;
    for (const tx of accTx) {
      const sign = ['income','withdrawal','transfer'].includes(tx.type) && tx.to_account_id === filters.account ? 1
                 : tx.account_id === filters.account && ['spend','savings','investment','transfer','debt_payment'].includes(tx.type) ? -1
                 : tx.account_id === filters.account ? 1 : 0;
      bal += sign * Number(tx.amount);
      runningBalMap[tx.id] = bal;
    }
  }

  let bodyHtml;
  if (viewMode === 'flat') {
    bodyHtml = filtered.map(tx => renderRow(tx, state, cur, cols, runningBalMap)).join('');
  } else {
    bodyHtml = renderGroupedRows(filtered, state, cur, cols, runningBalMap, colSpan);
  }

  container.innerHTML = `<div class="table-wrap">
    <table class="table" id="tx-table">
      <thead><tr>
        <th style="width:32px"><input type="checkbox" id="tx-select-all" /></th>
        ${headerCells}
        <th style="width:80px"></th>
      </tr></thead>
      <tbody id="tx-tbody">${bodyHtml}</tbody>
    </table>
  </div>`;

  // Update bulk-actions bar
  const bulkEl = document.getElementById('tx-bulk-actions');
  if (bulkEl) {
    bulkEl.innerHTML = selectedIds.size
      ? `<button class="btn btn-danger btn-sm" id="tx-bulk-delete">Delete (${selectedIds.size})</button>`
      : '';
    document.getElementById('tx-bulk-delete')?.addEventListener('click', () => bulkDelete(state));
  }

  // Set select-all checkbox state
  const selectAllCb = document.getElementById('tx-select-all');
  if (selectAllCb) {
    const allChecked = filtered.length > 0 && filtered.every(tx => selectedIds.has(tx.id));
    const someChecked = filtered.some(tx => selectedIds.has(tx.id));
    selectAllCb.checked = allChecked;
    selectAllCb.indeterminate = someChecked && !allChecked;
  }

  // Wire table events
  document.getElementById('tx-select-all')?.addEventListener('change', e => {
    if (e.target.checked) filtered.forEach(tx => selectedIds.add(tx.id));
    else selectedIds.clear();
    renderTable(state);
  });

  document.querySelectorAll('.tx-row-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (editingId === id) { editingId = null; renderTable(state); return; }
      editingId = id;
      const tx = state.transactions.find(t => t.id === id);
      expandInlineEdit(tx, state, cur);
    });
  });

  document.querySelectorAll('.tx-row-delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const ok = await App.openConfirm('Delete transaction', 'This cannot be undone.');
      if (!ok) return;
      const { error } = await App.supabase.from('transactions').delete().eq('id', id).eq('household_id', App.state.household.id);
      if (!error) {
        state.transactions = state.transactions.filter(t => t.id !== id);
        renderTable(state);
        App.toast('Transaction deleted', 'success');
      } else {
        App.toast('Error: ' + error.message, 'error');
      }
    });
  });

  document.querySelectorAll('.tx-row-confirm').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const { error } = await App.supabase
        .from('transactions').update({ status: 'confirmed' })
        .eq('id', id).eq('household_id', App.state.household.id);
      if (!error) {
        const tx = state.transactions.find(t => t.id === id);
        if (tx) tx.status = 'confirmed';
        renderTable(state);
        App.toast('Transaction confirmed', 'success');
      }
    });
  });

  document.querySelectorAll('.tx-select-cb').forEach(cb => {
    cb.addEventListener('change', e => {
      if (e.target.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
    });
  });

  document.querySelectorAll('.tx-row-fav').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleQpFav(state, btn.dataset.id);
      const fav = isQpFav(state, btn.dataset.id);
      btn.textContent = fav ? '★' : '☆';
      btn.style.color = fav ? 'var(--accent)' : 'var(--text-muted)';
    });
  });
}

function renderRow(tx, state, cur, cols = DEFAULT_COLUMNS, runningBalMap = {}) {
  const { categories, accounts, profiles } = state;
  const cat = categories.find(c => c.id === tx.category_id);
  const group = cat?.parent_id ? categories.find(c => c.id === cat.parent_id) : cat;
  const acc = accounts.find(a => a.id === tx.account_id);
  const toAcc = accounts.find(a => a.id === tx.to_account_id);
  const person = profiles.find(p => p.id === tx.user_id);
  const isNeg = ['spend','savings','investment','transfer','debt_payment'].includes(tx.type);
  const isPending = tx.status === 'pending';
  const checked = selectedIds.has(tx.id);

  if (editingId === tx.id) return renderInlineEditRow(tx, state, cur, cols);

  const cellMap = {
    date:            `<td class="text-sm" style="white-space:nowrap">${fmtDate(tx.date, 'short')}</td>`,
    description:     `<td class="truncate" style="max-width:200px">${escHtml(tx.description || '—')}${tx.is_recurring ? ' <span class="text-muted" title="Recurring">↻</span>' : ''}</td>`,
    parent_group:    `<td class="text-sm text-muted">${group && cat?.parent_id ? escHtml((group.icon||'')+' '+group.name) : '—'}</td>`,
    category:        `<td class="text-sm">${cat ? escHtml((cat.icon||'')+' '+cat.name) : '—'}</td>`,
    nature:          `<td class="text-sm text-muted">${cat?.nature || '—'}</td>`,
    type:            `<td><span class="${typeBadgeClass(tx.type)}">${TX_TYPE_LABELS[tx.type] || tx.type}</span></td>`,
    recurring:       `<td class="text-sm text-muted">${tx.is_recurring ? '↻ ' + (tx.recur_freq || '') : '—'}</td>`,
    amount:          `<td class="amount-col text-mono ${isNeg ? 'negative' : 'positive'}">${isNeg ? '−' : '+'}${fmtCurrency(tx.amount, cur)}</td>`,
    account:         `<td class="text-sm text-muted">${acc ? escHtml(acc.name) + (toAcc ? ' → ' + escHtml(toAcc.name) : '') : '—'}</td>`,
    running_balance: `<td class="amount-col text-mono">${runningBalMap[tx.id] != null ? fmtCurrency(runningBalMap[tx.id], cur) : '—'}</td>`,
    person:          `<td class="text-sm text-muted">${person ? escHtml(person.display_name) : '—'}</td>`,
    status:          `<td>${isPending ? '<span class="badge badge-pending">Pending</span>' : '<span class="badge badge-green">✓</span>'}</td>`,
    notes:           `<td class="text-sm text-muted truncate" style="max-width:160px">${escHtml(tx.notes || '—')}</td>`,
  };

  return `<tr class="${isPending ? 'text-muted' : ''}" data-id="${tx.id}">
    <td><input type="checkbox" class="tx-select-cb" data-id="${tx.id}" ${checked ? 'checked' : ''} /></td>
    ${cols.map(c => cellMap[c] || '').join('')}
    <td>
      <div class="flex gap-1">
        ${isPending ? `<button class="btn btn-ghost btn-sm tx-row-confirm" data-id="${tx.id}" title="Confirm">✓</button>` : ''}
        <button class="btn btn-ghost btn-sm tx-row-fav" data-id="${tx.id}" title="Quick add favourite" style="color:${isQpFav(state, tx.id) ? 'var(--accent)' : 'var(--text-muted)'}">${isQpFav(state, tx.id) ? '★' : '☆'}</button>
        <button class="btn btn-ghost btn-sm tx-row-edit" data-id="${tx.id}" title="Edit">✎</button>
        <button class="btn btn-ghost btn-sm tx-row-delete" data-id="${tx.id}" title="Delete">✕</button>
      </div>
    </td>
  </tr>`;
}

function renderGroupedRows(filtered, state, cur, cols, runningBalMap, colSpan) {
  const { categories } = state;

  function getGroupKey(tx) {
    const cat = categories.find(c => c.id === tx.category_id);
    if (viewMode === 'nature') return cat?.nature || 'Uncategorised';
    if (viewMode === 'group') {
      const g = cat?.parent_id ? categories.find(c => c.id === cat.parent_id) : cat;
      return g ? (g.icon || '') + ' ' + g.name : 'Uncategorised';
    }
    if (viewMode === 'sub') return cat ? (cat.icon || '') + ' ' + cat.name : 'Uncategorised';
    if (viewMode === 'tx_type') {
      if (tx.type === 'savings' || tx.type === 'investment') return 'Savings & Investments';
      return TX_TYPE_LABELS[tx.type] || tx.type;
    }
    return '';
  }

  const groups = {};
  for (const tx of filtered) {
    const key = getGroupKey(tx);
    if (!groups[key]) groups[key] = [];
    groups[key].push(tx);
  }

  return Object.entries(groups).map(([key, txs]) => {
    const total = txs.reduce((s, tx) => s + (
      ['spend','savings','investment','transfer','debt_payment'].includes(tx.type) ? -Number(tx.amount) : Number(tx.amount)
    ), 0);
    const headerRow = `<tr style="background:var(--surface2)">
      <td></td>
      <td colspan="${cols.length}" style="font-weight:600;padding:.5rem .75rem">
        ${escHtml(key)}
        <span class="text-muted text-sm" style="margin-left:.5rem">${txs.length} tx</span>
      </td>
      <td class="amount-col text-mono ${total >= 0 ? 'positive' : 'negative'}" style="font-weight:600">
        ${total >= 0 ? '+' : '−'}${fmtCurrency(Math.abs(total), App.currency())}
      </td>
    </tr>`;
    const txRows = viewMode === 'hybrid'
      ? txs.map(tx => renderRow(tx, state, cur, cols, runningBalMap)).join('')
      : txs.map(tx => renderRow(tx, state, cur, cols, runningBalMap)).join('');
    return headerRow + txRows;
  }).join('');
}

function renderMobileCard(tx, state, cur) {
  const { categories } = state;
  const cat = categories.find(c => c.id === tx.category_id);
  const isNeg = ['spend','savings','investment','transfer','debt_payment'].includes(tx.type);
  const isPending = tx.status === 'pending';
  return `<div class="card tx-card" data-id="${tx.id}" style="margin-bottom:.5rem;cursor:pointer">
    <div class="flex justify-between items-center">
      <div>
        <div class="fw-500">${escHtml(tx.description || '—')}</div>
        <div class="text-sm text-muted">${fmtRelDate(tx.date)} · ${cat ? cat.icon + ' ' + cat.name : '—'}</div>
      </div>
      <div class="text-right">
        <div class="text-mono fw-600 ${isNeg ? 'c-red' : 'c-green'}">${isNeg ? '−' : '+'}${fmtCurrency(tx.amount, cur)}</div>
        ${isPending ? '<div class="badge badge-pending">Pending</div>' : ''}
      </div>
    </div>
  </div>`;
}

// ── INLINE EDIT ROW ───────────────────────────────────────────
function renderInlineEditRow(tx, state, cur, cols = DEFAULT_COLUMNS) {
  const { categories, accounts, profiles } = state;
  const needsCategory = !['transfer','adjustment'].includes(tx.type);
  const catOpts = buildCategoryOptions(categories, tx.category_id);
  const accOpts = buildAccountOptions(accounts, state.accountOrder, null, tx.account_id);
  const toAccOpts = buildAccountOptions(accounts, state.accountOrder, null, tx.to_account_id);
  const hasTwoAccounts = ['savings','investment','savings_investment','transfer','withdrawal','debt_payment'].includes(tx.type);
  const cat = categories.find(c => c.id === tx.category_id);
  const group = cat?.parent_id ? categories.find(c => c.id === cat.parent_id) : cat;

  const formType = toFormType(tx.type);
  const typeSelect = `<select class="form-select" id="ie-type">
    ${TX_FORM_TYPES.map(([k,v]) => `<option value="${k}"${formType===k?' selected':''}>${v}</option>`).join('')}
  </select>`;

  const accField = hasTwoAccounts
    ? `<div style="display:flex;flex-direction:column;gap:.2rem">
        <select class="form-select" id="ie-acc">${accOpts}</select>
        <select class="form-select" id="ie-to-acc">${toAccOpts}</select>
       </div>`
    : `<select class="form-select" id="ie-acc">${accOpts}</select>`;

  const cellMap = {
    date:            `<td><input class="form-input" type="date" id="ie-date" value="${tx.date}" /></td>`,
    description:     `<td><input class="form-input" id="ie-desc" value="${escHtml(tx.description || '')}" placeholder="Description" /></td>`,
    parent_group:    `<td class="text-sm text-muted">${group && cat?.parent_id ? escHtml((group.icon||'')+' '+group.name) : '—'}</td>`,
    category:        `<td>${needsCategory ? `<select class="form-select" id="ie-cat">${catOpts}</select>` : '<span class="text-muted text-sm">—</span>'}</td>`,
    nature:          `<td class="text-sm text-muted">${cat?.nature || '—'}</td>`,
    type:            `<td>${typeSelect}</td>`,
    recurring:       `<td class="text-sm text-muted">${tx.is_recurring ? '↻' : '—'}</td>`,
    amount:          `<td class="amount-col"><input class="form-input text-mono" type="number" id="ie-amt" value="${tx.amount}" step="0.01" style="text-align:right" /></td>`,
    account:         `<td>${accField}</td>`,
    running_balance: `<td class="amount-col text-mono text-muted">—</td>`,
    person:          `<td><select class="form-select" id="ie-person">
                        ${profiles.map(p => `<option value="${p.id}"${tx.user_id===p.id?' selected':''}>${escHtml(p.display_name)}</option>`).join('')}
                      </select></td>`,
    status:          `<td><select class="form-select" id="ie-status">
                        <option value="confirmed"${tx.status==='confirmed'?' selected':''}>Confirmed</option>
                        <option value="pending"${tx.status==='pending'?' selected':''}>Pending</option>
                      </select></td>`,
    notes:           `<td><input class="form-input" id="ie-notes" value="${escHtml(tx.notes || '')}" placeholder="Notes" /></td>`,
  };

  return `<tr class="tx-inline-edit" data-id="${tx.id}">
    <td></td>
    ${cols.map(c => cellMap[c] || '<td></td>').join('')}
    <td>
      <div class="flex gap-1">
        <button class="btn btn-primary btn-sm" id="ie-save">Save</button>
        <button class="btn btn-ghost btn-sm" id="ie-cancel">✕</button>
      </div>
    </td>
  </tr>`;
}

function expandInlineEdit(tx, state, cur) {
  renderTable(state);

  const saveBtn = document.getElementById('ie-save');
  const cancelBtn = document.getElementById('ie-cancel');

  cancelBtn?.addEventListener('click', () => { editingId = null; renderTable(state); });
  saveBtn?.addEventListener('click', async () => {
    const date = document.getElementById('ie-date')?.value;
    const description = document.getElementById('ie-desc')?.value.trim();
    const category_id = document.getElementById('ie-cat')?.value || null;
    const type = resolveType(document.getElementById('ie-type')?.value, category_id, state.categories);
    const account_id = document.getElementById('ie-acc')?.value || null;
    const to_account_id = document.getElementById('ie-to-acc')?.value || null;
    const amount = parseFloat(document.getElementById('ie-amt')?.value);
    const user_id = document.getElementById('ie-person')?.value || tx.user_id;
    const status = document.getElementById('ie-status')?.value || tx.status;
    const notes = document.getElementById('ie-notes')?.value.trim() || null;

    if (!date || !description || isNaN(amount) || amount <= 0) {
      App.toast('Please fill in required fields', 'error');
      return;
    }

    const updates = { date, description, category_id, type, account_id, to_account_id, amount, user_id, status, notes };
    const { error } = await App.supabase
      .from('transactions').update(updates)
      .eq('id', tx.id).eq('household_id', App.state.household.id);

    if (error) { App.toast('Save failed: ' + error.message, 'error'); return; }

    const idx = state.transactions.findIndex(t => t.id === tx.id);
    if (idx !== -1) state.transactions[idx] = { ...state.transactions[idx], ...updates };
    editingId = null;
    renderTable(state);
    App.toast('Transaction updated', 'success');
  });
}

// ── COLUMN TOGGLE MODAL ───────────────────────────────────────
function openColumnsModal(state) {
  const current = getVisibleCols(state);
  const html = `
    <div style="display:flex;flex-direction:column;gap:.4rem">
      ${ALL_COLUMNS.filter(c => c.id !== 'running_balance' || filters.account).map(c => `
        <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer">
          <input type="checkbox" data-col="${c.id}" ${current.includes(c.id) ? 'checked' : ''} />
          ${escHtml(c.label)}
        </label>`).join('')}
      <div class="btn-row" style="margin-top:.5rem">
        <button class="btn btn-ghost" onclick="App.closeModal()">Cancel</button>
        <button class="btn btn-primary" id="cols-save">Apply</button>
      </div>
    </div>`;
  App.openModal('Visible columns', html);
  document.getElementById('cols-save')?.addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('[data-col]:checked')].map(el => el.dataset.col);
    if (!checked.length) { App.toast('Select at least one column', 'error'); return; }
    const newPrefs = { ...state.prefs, columns: checked };
    const { error } = await App.supabase.from('profiles').update({ preferences: newPrefs }).eq('id', App.state.user.id);
    if (!error) {
      state.prefs.columns = checked;
      App.closeModal();
      render(state);
    }
  });
}

// ── BULK DELETE ───────────────────────────────────────────────
async function bulkDelete(state) {
  if (!selectedIds.size) return;
  const ok = await App.openConfirm('Delete transactions', `Delete ${selectedIds.size} transaction(s)? This cannot be undone.`);
  if (!ok) return;
  const ids = [...selectedIds];
  const { error } = await App.supabase.from('transactions').delete().in('id', ids).eq('household_id', App.state.household.id);
  if (!error) {
    state.transactions = state.transactions.filter(t => !ids.includes(t.id));
    selectedIds.clear();
    render(state);
    App.toast(`Deleted ${ids.length} transaction(s)`, 'success');
  } else {
    App.toast('Error: ' + error.message, 'error');
  }
}

// ── CSV EXPORT ────────────────────────────────────────────────
function exportCSV(state) {
  const filtered = getFiltered(state);
  const { categories, accounts, profiles } = state;
  const cur = App.currency();

  const cols = ['Date','Description','Category','Type','Amount','Account','To Account','Person','Status','Notes'];
  const rows = filtered.map(tx => {
    const cat = categories.find(c => c.id === tx.category_id);
    const acc = accounts.find(a => a.id === tx.account_id);
    const toAcc = accounts.find(a => a.id === tx.to_account_id);
    const person = profiles.find(p => p.id === tx.user_id);
    return [
      tx.date,
      tx.description || '',
      cat ? cat.name : '',
      TX_TYPE_LABELS[tx.type] || tx.type,
      tx.amount,
      acc ? acc.name : '',
      toAcc ? toAcc.name : '',
      person ? person.display_name : '',
      tx.status,
      tx.notes || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  const csv = '\uFEFF' + [cols.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'transactions.csv';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── QUICK PICKS (favorites) ────────────────────────────────────
function qpKey(state) { return `qp_${state.user?.id || 'default'}`; }

function getQuickPickIds(state) {
  try { return JSON.parse(localStorage.getItem(qpKey(state)) || 'null'); } catch { return null; }
}

function setQuickPickIds(state, ids) {
  localStorage.setItem(qpKey(state), JSON.stringify(ids));
}

function isQpFav(state, txId) {
  const ids = getQuickPickIds(state);
  return Array.isArray(ids) && ids.includes(txId);
}

function toggleQpFav(state, txId) {
  const freq = buildFreqMap(state);
  const all = freq.map(f => f.tx.id);
  let ids = getQuickPickIds(state);
  if (!Array.isArray(ids)) ids = all.slice(0, 10);
  if (ids.includes(txId)) ids = ids.filter(i => i !== txId);
  else ids = [txId, ...ids].slice(0, 10);
  setQuickPickIds(state, ids);
}

function buildFreqMap(state) {
  const freq = {};
  for (const t of state.transactions) {
    if (!t.description) continue;
    if (!freq[t.description]) freq[t.description] = { tx: t, count: 0 };
    freq[t.description].count++;
  }
  return Object.values(freq).sort((a, b) => b.count - a.count);
}

// ── ADD / EDIT MODAL ──────────────────────────────────────────
export function openTxModal(state, tx = null) {
  const isEdit = !!tx;
  const { categories, accounts, profiles } = state;
  const cur = App.currency();
  const defaultType = toFormType(tx?.type);

  // Build quick-pick list: saved favorites or top-10 frequent
  let quickPicks = [];
  if (!isEdit) {
    const freq = buildFreqMap(state);
    const savedIds = getQuickPickIds(state);
    if (Array.isArray(savedIds)) {
      savedIds.forEach(id => {
        const hit = state.transactions.find(t => t.id === id);
        if (hit) quickPicks.push({ tx: hit });
      });
    } else {
      quickPicks = freq.slice(0, 10);
    }
  }

  const html = `
    <form id="tx-form" autocomplete="off">
      <div class="form-group" style="margin-bottom:.75rem">
        <label class="form-label">Type *</label>
        <select class="form-select" id="tf-type">
          ${TX_FORM_TYPES.map(([k,v]) => `<option value="${k}"${defaultType===k?' selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      ${!isEdit ? `<div style="margin-bottom:1rem" id="qp-section">
        <div class="flex items-center justify-between" style="margin-bottom:.4rem">
          <span class="text-sm text-muted">Quick add</span>
          <button type="button" class="btn btn-ghost btn-sm" id="qp-manage-btn" style="font-size:.75rem;padding:.1rem .5rem">✎ Manage</button>
        </div>
        <div id="qp-chips" style="display:flex;flex-wrap:wrap;gap:.4rem">
          ${quickPicks.map(({tx: t}) => `<button type="button" class="chip quick-pick-btn" data-id="${t.id}" style="cursor:pointer">${escHtml(t.description)}</button>`).join('')}
        </div>
        <div id="qp-picker" style="display:none;margin-top:.6rem;border:1px solid var(--border);border-radius:var(--radius);padding:.6rem;max-height:200px;overflow-y:auto">
          <div class="text-sm text-muted" style="margin-bottom:.5rem">★ = shown in quick add (up to 10)</div>
          ${buildFreqMap(state).slice(0, 20).map(({tx: t}) => {
            const fav = Array.isArray(getQuickPickIds(state))
              ? getQuickPickIds(state).includes(t.id)
              : quickPicks.some(q => q.tx.id === t.id);
            return `<div class="flex items-center justify-between" style="padding:.25rem 0;border-bottom:1px solid var(--border)20">
              <span class="text-sm">${escHtml(t.description)}</span>
              <button type="button" class="btn btn-ghost btn-sm qp-toggle-btn" data-id="${t.id}" style="font-size:1rem;padding:.1rem .4rem;color:${fav ? 'var(--accent)' : 'var(--text-muted)'}">${fav ? '★' : '☆'}</button>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label class="form-label">Category</label>
          <select class="form-select" id="tf-cat">
            <option value="">— None (transfer/adjustment) —</option>
            ${buildCategoryOptions(categories, tx?.category_id)}
          </select>
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">Amount *</label>
          <input class="form-input text-mono" type="number" id="tf-amount" placeholder="0.00" step="0.01" min="0" value="${tx?.amount || ''}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label class="form-label">Description</label>
          <input class="form-input" id="tf-desc" placeholder="Description" value="${escHtml(tx?.description || '')}" />
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">Date *</label>
          <input class="form-input" type="date" id="tf-date" value="${tx?.date || todayISO()}" />
        </div>
      </div>
      <div id="tf-account-fields"></div>
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label class="form-label">Person</label>
          <select class="form-select" id="tf-person">
            ${profiles.map(p => `<option value="${p.id}"${(tx?.user_id || App.state.user.id) === p.id ? ' selected' : ''}>${escHtml(p.display_name)}</option>`).join('')}
          </select>
        </div>
        ${isEdit ? `<div class="form-group" style="flex:1">
          <label class="form-label">Status</label>
          <select class="form-select" id="tf-status">
            <option value="confirmed"${tx?.status !== 'pending' ? ' selected' : ''}>Confirmed</option>
            <option value="pending"${tx?.status === 'pending' ? ' selected' : ''}>Pending</option>
          </select>
        </div>` : ''}
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-textarea" id="tf-notes" rows="2" placeholder="Optional notes">${escHtml(tx?.notes || '')}</textarea>
      </div>
      ${!isEdit ? `<div class="form-check" style="margin-bottom:1rem">
        <label><input type="checkbox" id="tf-recurring-check" /> Create recurring template</label>
      </div>` : ''}
      <div id="tf-error" class="form-error hidden"></div>
      <div class="btn-row">
        <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Update' : 'Add transaction'}</button>
      </div>
    </form>
  `;

  App.openModal(isEdit ? 'Edit Transaction' : 'Add Transaction', html);

  // Render account fields based on current type
  renderTxAccountFields(state, tx);

  // Quick-pick chips pre-fill the form
  function wireQuickPickChips() {
    document.querySelectorAll('.quick-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = state.transactions.find(x => x.id === btn.dataset.id);
        if (!t) return;
        document.getElementById('tf-desc').value = t.description || '';
        document.getElementById('tf-type').value = t.type || 'spend';
        document.getElementById('tf-cat').value = t.category_id || '';
        document.getElementById('tf-amount').value = t.amount || '';
        if (t.user_id) document.getElementById('tf-person').value = t.user_id;
        renderTxAccountFields(state, t);
      });
    });
  }
  wireQuickPickChips();

  // Manage panel toggle & favorite toggling
  document.getElementById('qp-manage-btn')?.addEventListener('click', () => {
    const picker = document.getElementById('qp-picker');
    picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('qp-picker')?.addEventListener('click', e => {
    const btn = e.target.closest('.qp-toggle-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    toggleQpFav(state, id);
    const isFav = isQpFav(state, id);
    btn.textContent = isFav ? '★' : '☆';
    btn.style.color = isFav ? 'var(--accent)' : 'var(--text-muted)';
    // Rebuild chips
    const ids = getQuickPickIds(state);
    const newPicks = Array.isArray(ids)
      ? ids.map(i => state.transactions.find(t => t.id === i)).filter(Boolean)
      : buildFreqMap(state).slice(0, 10).map(f => f.tx);
    document.getElementById('qp-chips').innerHTML = newPicks
      .map(t => `<button type="button" class="chip quick-pick-btn" data-id="${t.id}" style="cursor:pointer">${escHtml(t.description)}</button>`)
      .join('');
    wireQuickPickChips();
  });

  // Auto-set type from category
  document.getElementById('tf-cat')?.addEventListener('change', e => {
    const catId = e.target.value;
    const cat = categories.find(c => c.id === catId);
    if (cat?.default_tx_type) {
      document.getElementById('tf-type').value = toFormType(cat.default_tx_type);
    }
    if (cat && !document.getElementById('tf-desc').value) {
      document.getElementById('tf-desc').value = cat.name;
    }
    renderTxAccountFields(state, tx);
  });

  document.getElementById('tf-type')?.addEventListener('change', () => renderTxAccountFields(state, tx));

  document.getElementById('tx-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    await saveTx(state, tx);
  });
}

function renderTxAccountFields(state, tx = null) {
  const container = document.getElementById('tf-account-fields');
  if (!container) return;
  const type = document.getElementById('tf-type')?.value || 'spend';
  const { accounts } = state;
  const order = state.accountOrder;

  const needsFrom = ['spend','savings_investment','transfer','withdrawal','debt_payment'].includes(type);
  const needsTo   = ['savings_investment','transfer','withdrawal','debt_payment'].includes(type);

  const fromFilter = type === 'withdrawal'
    ? a => ['savings','investment'].includes(effectiveType(a))
    : a => !needsFrom || isLiquid(a);

  const toFilter = type === 'savings_investment'
    ? a => ['savings','investment'].includes(effectiveType(a))
    : type === 'withdrawal'
    ? a => isLiquid(a)
    : type === 'debt_payment'
    ? a => effectiveType(a) === 'loan'
    : a => true; // transfer

  if (type === 'income') {
    container.innerHTML = `<div class="form-group">
      <label class="form-label">Account</label>
      <select class="form-select" id="tf-acc">${buildAccountOptions(accounts, order, null, tx?.account_id)}</select>
    </div>`;
  } else if (type === 'spend' || type === 'adjustment') {
    container.innerHTML = `<div class="form-group">
      <label class="form-label">${type === 'adjustment' ? 'Account' : 'Account'}</label>
      <select class="form-select" id="tf-acc">${buildAccountOptions(accounts, order, null, tx?.account_id)}</select>
    </div>`;
  } else {
    // Two accounts
    container.innerHTML = `<div class="form-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">From account</label>
        <select class="form-select" id="tf-acc">${buildAccountOptions(accounts, order, fromFilter, tx?.account_id)}</select>
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">To account</label>
        <select class="form-select" id="tf-to-acc">${buildAccountOptions(accounts, order, toFilter, tx?.to_account_id)}</select>
      </div>
    </div>`;
  }
}

async function saveTx(state, existing = null) {
  const errEl = document.getElementById('tf-error');
  errEl.classList.add('hidden');

  const date        = document.getElementById('tf-date')?.value;
  const description = document.getElementById('tf-desc')?.value.trim();
  const amount      = parseFloat(document.getElementById('tf-amount')?.value);
  const category_id = document.getElementById('tf-cat')?.value || null;
  const type        = resolveType(document.getElementById('tf-type')?.value, category_id, state.categories);
  const account_id  = document.getElementById('tf-acc')?.value || null;
  const to_account_id = document.getElementById('tf-to-acc')?.value || null;
  const user_id     = document.getElementById('tf-person')?.value || App.state.user.id;
  const status      = existing
    ? (document.getElementById('tf-status')?.value || 'confirmed')
    : (date > todayISO() ? 'pending' : 'confirmed');
  const notes       = document.getElementById('tf-notes')?.value.trim() || null;

  // Validation
  if (!date) { showErr(errEl, 'Date is required'); return; }
  if (!description) { showErr(errEl, 'Description is required'); return; }
  if (isNaN(amount) || amount <= 0) { showErr(errEl, 'Enter a valid amount'); return; }
  if (!['transfer','adjustment'].includes(type) && !category_id) {
    showErr(errEl, 'Category is required for this transaction type'); return;
  }

  const payload = {
    date, description, amount, type, category_id, account_id, to_account_id,
    user_id, status, notes, household_id: App.state.household.id,
  };

  if (existing) {
    const { error } = await App.supabase
      .from('transactions').update(payload).eq('id', existing.id).eq('household_id', App.state.household.id);
    if (error) { showErr(errEl, error.message); return; }
    const idx = state.transactions.findIndex(t => t.id === existing.id);
    if (idx !== -1) state.transactions[idx] = { ...state.transactions[idx], ...payload };
    App.toast('Transaction updated', 'success');
  } else {
    const { data, error } = await App.supabase
      .from('transactions').insert(payload).select().single();
    if (error) { showErr(errEl, error.message); return; }
    state.transactions.unshift(data);
    state.recentlyInserted?.add(data.id);
    setTimeout(() => state.recentlyInserted?.delete(data.id), 5000);

    // Handle recurring template creation
    const wantsRecurring = document.getElementById('tf-recurring-check')?.checked;
    if (wantsRecurring && data) {
      await createRecurringFromTx(data);
    }
    App.toast('Transaction added', 'success');
  }

  App.closeModal();
  render(state);
}

async function createRecurringFromTx(tx) {
  const txDate = new Date(tx.date + 'T00:00:00');
  const dom = txDate.getDate();
  // Start template from next month's occurrence so we don't duplicate the tx just added
  const nm = new Date(txDate.getFullYear(), txDate.getMonth() + 1, 1);
  const daysInNm = new Date(nm.getFullYear(), nm.getMonth() + 1, 0).getDate();
  const nextStart = new Date(nm.getFullYear(), nm.getMonth(), Math.min(dom, daysInNm));
  const startDate = nextStart.toISOString().slice(0, 10);

  await App.supabase.from('recurring_templates').insert({
    household_id: tx.household_id,
    user_id: tx.user_id,
    description: tx.description,
    amount: tx.amount,
    type: tx.type,
    category_id: tx.category_id,
    account_id: tx.account_id,
    to_account_id: tx.to_account_id,
    notes: tx.notes,
    frequency: 'monthly',
    day_of_month: dom,
    start_date: startDate,
    is_active: true,
  });
}

function showErr(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}
