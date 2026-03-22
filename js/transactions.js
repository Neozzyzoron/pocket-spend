/* ═══════════════════════════════════════════════════════════════
   transactions.js — Transaction list, add/edit, filters, CSV
═══════════════════════════════════════════════════════════════ */

import {
  fmtCurrency, fmtDate, fmtRelDate, escHtml, parseISO, todayISO,
  isEffective, effectiveType, isLiquid, buildCategoryOptions,
  buildAccountOptions, TX_TYPE_LABELS, typeBadgeClass, getCat,
} from './utils.js';

// ── STATE ─────────────────────────────────────────────────────
let filters = { search: '', status: 'all', type: '', category: '', account: '', person: '' };
let editingId = null;
let selectedIds = new Set();

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
        <button class="btn btn-ghost btn-sm" id="tx-export-btn">↓ CSV</button>
        <button class="btn btn-primary" id="tx-add-btn">+ Add transaction</button>
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
          ${Object.entries(TX_TYPE_LABELS).map(([k,v]) => `<option value="${k}"${filters.type===k?' selected':''}>${v}</option>`).join('')}
        </select>
        <select class="form-select" id="tx-filter-account" style="width:auto">
          <option value="">All accounts</option>
          ${state.accounts.filter(a=>!a.is_archived).map(a => `<option value="${a.id}"${filters.account===a.id?' selected':''}>${escHtml(a.name)}</option>`).join('')}
        </select>
        <select class="form-select" id="tx-filter-person" style="width:auto">
          <option value="">All people</option>
          ${state.profiles.map(p => `<option value="${p.id}"${filters.person===p.id?' selected':''}>${escHtml(p.display_name)}</option>`).join('')}
        </select>
        ${selectedIds.size ? `<button class="btn btn-danger btn-sm" id="tx-bulk-delete">Delete (${selectedIds.size})</button>` : ''}
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
  document.getElementById('tx-search').addEventListener('input', e => { filters.search = e.target.value; renderTable(state); });
  document.getElementById('tx-filter-type').addEventListener('change', e => { filters.type = e.target.value; renderTable(state); });
  document.getElementById('tx-filter-account').addEventListener('change', e => { filters.account = e.target.value; renderTable(state); });
  document.getElementById('tx-filter-person').addEventListener('change', e => { filters.person = e.target.value; renderTable(state); });
  document.getElementById('tx-clear-filters').addEventListener('click', () => {
    filters = { search: '', status: 'all', type: '', category: '', account: '', person: '' };
    render(state);
  });
  el.querySelectorAll('.tx-status-btn').forEach(btn => {
    btn.addEventListener('click', () => { filters.status = btn.dataset.status; render(state); });
  });
  document.getElementById('tx-bulk-delete')?.addEventListener('click', () => bulkDelete(state));

  renderTable(state);
}

// ── FILTER & RENDER TABLE ─────────────────────────────────────
function getFiltered(state) {
  const { transactions, categories, accounts, profiles } = state;
  const search = filters.search.toLowerCase();
  return transactions.filter(tx => {
    if (filters.status === 'confirmed' && tx.status !== 'confirmed') return false;
    if (filters.status === 'pending' && tx.status !== 'pending') return false;
    if (filters.type && tx.type !== filters.type) return false;
    if (filters.account && tx.account_id !== filters.account && tx.to_account_id !== filters.account) return false;
    if (filters.person && tx.user_id !== filters.person) return false;
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

  container.innerHTML = `<div class="table-wrap">
    <table class="table" id="tx-table">
      <thead><tr>
        <th style="width:32px"><input type="checkbox" id="tx-select-all" /></th>
        <th>Date</th>
        <th>Description</th>
        <th>Category</th>
        <th>Type</th>
        <th>Account</th>
        <th>Person</th>
        <th class="amount-col">Amount</th>
        <th>Status</th>
        <th style="width:80px"></th>
      </tr></thead>
      <tbody id="tx-tbody">
        ${filtered.map(tx => renderRow(tx, state, cur)).join('')}
      </tbody>
    </table>
  </div>`;

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
}

function renderRow(tx, state, cur) {
  const { categories, accounts, profiles } = state;
  const cat = categories.find(c => c.id === tx.category_id);
  const acc = accounts.find(a => a.id === tx.account_id);
  const person = profiles.find(p => p.id === tx.user_id);
  const isNeg = ['spend','savings','investment','transfer','debt_payment'].includes(tx.type);
  const isPending = tx.status === 'pending';
  const isEdit = editingId === tx.id;
  const checked = selectedIds.has(tx.id);

  if (isEdit) {
    return renderInlineEditRow(tx, state, cur);
  }

  return `<tr class="${isPending ? 'text-muted' : ''}" data-id="${tx.id}">
    <td><input type="checkbox" class="tx-select-cb" data-id="${tx.id}" ${checked ? 'checked' : ''} /></td>
    <td class="text-sm" style="white-space:nowrap">${fmtDate(tx.date, 'short')}</td>
    <td class="truncate" style="max-width:200px">
      ${escHtml(tx.description || '—')}
      ${tx.is_recurring ? '<span class="text-muted" title="Recurring">↻</span>' : ''}
    </td>
    <td class="text-sm">${cat ? escHtml(cat.icon + ' ' + cat.name) : '—'}</td>
    <td><span class="${typeBadgeClass(tx.type)}">${TX_TYPE_LABELS[tx.type] || tx.type}</span></td>
    <td class="text-sm text-muted">${acc ? escHtml(acc.name) : '—'}</td>
    <td class="text-sm text-muted">${person ? escHtml(person.display_name) : '—'}</td>
    <td class="amount-col text-mono ${isNeg ? 'negative' : 'positive'}">${isNeg ? '−' : '+'}${fmtCurrency(tx.amount, cur)}</td>
    <td>${isPending ? '<span class="badge badge-pending">Pending</span>' : '<span class="badge badge-green">✓</span>'}</td>
    <td>
      <div class="flex gap-1">
        ${isPending ? `<button class="btn btn-ghost btn-sm tx-row-confirm" data-id="${tx.id}" title="Confirm">✓</button>` : ''}
        <button class="btn btn-ghost btn-sm tx-row-edit" data-id="${tx.id}" title="Edit">✎</button>
        <button class="btn btn-ghost btn-sm tx-row-delete" data-id="${tx.id}" title="Delete">✕</button>
      </div>
    </td>
  </tr>`;
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
function renderInlineEditRow(tx, state, cur) {
  const { categories, accounts } = state;
  const needsCategory = !['transfer','adjustment'].includes(tx.type);
  const catOpts = buildCategoryOptions(categories, tx.category_id);
  const accOpts = buildAccountOptions(accounts, state.accountOrder, null, tx.account_id);
  const toAccOpts = buildAccountOptions(accounts, state.accountOrder, null, tx.to_account_id);
  const hasTwoAccounts = ['savings','investment','transfer','withdrawal','debt_payment'].includes(tx.type);

  return `<tr class="tx-inline-edit" data-id="${tx.id}">
    <td></td>
    <td><input class="form-input" type="date" id="ie-date" value="${tx.date}" style="width:130px" /></td>
    <td><input class="form-input" id="ie-desc" value="${escHtml(tx.description || '')}" placeholder="Description" style="width:200px" /></td>
    <td>
      ${needsCategory
        ? `<select class="form-select" id="ie-cat" style="width:150px">${catOpts}</select>`
        : '<span class="text-muted">—</span>'}
    </td>
    <td>
      <select class="form-select" id="ie-type" style="width:130px">
        ${Object.entries(TX_TYPE_LABELS).map(([k,v]) => `<option value="${k}"${tx.type===k?' selected':''}>${v}</option>`).join('')}
      </select>
    </td>
    <td>
      <select class="form-select" id="ie-acc" style="width:140px">${accOpts}</select>
      ${hasTwoAccounts ? `<div style="margin-top:.25rem"><select class="form-select" id="ie-to-acc" style="width:140px">${toAccOpts}</select></div>` : ''}
    </td>
    <td></td>
    <td class="amount-col"><input class="form-input text-mono" type="number" id="ie-amt" value="${tx.amount}" step="0.01" style="width:100px;text-align:right" /></td>
    <td>
      <select class="form-select" id="ie-status" style="width:110px">
        <option value="confirmed"${tx.status==='confirmed'?' selected':''}>Confirmed</option>
        <option value="pending"${tx.status==='pending'?' selected':''}>Pending</option>
      </select>
    </td>
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
    const type = document.getElementById('ie-type')?.value;
    const account_id = document.getElementById('ie-acc')?.value || null;
    const to_account_id = document.getElementById('ie-to-acc')?.value || null;
    const amount = parseFloat(document.getElementById('ie-amt')?.value);
    const status = document.getElementById('ie-status')?.value;

    if (!date || !description || isNaN(amount) || amount <= 0) {
      App.toast('Please fill in required fields', 'error');
      return;
    }

    const updates = { date, description, category_id, type, account_id, to_account_id, amount, status };
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

// ── ADD / EDIT MODAL ──────────────────────────────────────────
function openTxModal(state, tx = null) {
  const isEdit = !!tx;
  const { categories, accounts, profiles } = state;
  const cur = App.currency();
  const defaultType = tx?.type || 'spend';

  const html = `
    <form id="tx-form" autocomplete="off">
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label class="form-label">Category</label>
          <select class="form-select" id="tf-cat">
            <option value="">— None (transfer/adjustment) —</option>
            ${buildCategoryOptions(categories, tx?.category_id)}
          </select>
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">Type *</label>
          <select class="form-select" id="tf-type">
            ${Object.entries(TX_TYPE_LABELS).map(([k,v]) => `<option value="${k}"${defaultType===k?' selected':''}>${v}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label class="form-label">Date *</label>
          <input class="form-input" type="date" id="tf-date" value="${tx?.date || todayISO()}" />
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">Amount *</label>
          <input class="form-input text-mono" type="number" id="tf-amount" placeholder="0.00" step="0.01" min="0" value="${tx?.amount || ''}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input class="form-input" id="tf-desc" placeholder="Description" value="${escHtml(tx?.description || '')}" />
      </div>
      <div id="tf-account-fields"></div>
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label class="form-label">Person</label>
          <select class="form-select" id="tf-person">
            ${profiles.map(p => `<option value="${p.id}"${(tx?.user_id || App.state.user.id) === p.id ? ' selected' : ''}>${escHtml(p.display_name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label">Status</label>
          <select class="form-select" id="tf-status">
            <option value="confirmed"${tx?.status !== 'pending' ? ' selected' : ''}>Confirmed</option>
            <option value="pending"${tx?.status === 'pending' ? ' selected' : ''}>Pending</option>
          </select>
        </div>
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

  // Auto-set type from category
  document.getElementById('tf-cat')?.addEventListener('change', e => {
    const catId = e.target.value;
    const cat = categories.find(c => c.id === catId);
    if (cat?.default_tx_type) {
      document.getElementById('tf-type').value = cat.default_tx_type;
    }
    if (cat && !document.getElementById('tf-desc').value) {
      document.getElementById('tf-desc').value = cat.name;
    }
    renderTxAccountFields(state, tx);
  });

  document.getElementById('tf-type')?.addEventListener('change', () => renderTxAccountFields(state, tx));

  // Date → auto pending
  document.getElementById('tf-date')?.addEventListener('change', e => {
    const d = e.target.value;
    if (d > todayISO()) {
      document.getElementById('tf-status').value = 'pending';
    }
  });

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

  const needsFrom = ['spend','savings','investment','transfer','withdrawal','debt_payment'].includes(type);
  const needsTo   = ['savings','investment','transfer','withdrawal','debt_payment'].includes(type);
  const fromLabel = type === 'income' ? 'Account' : 'From account';

  const fromFilter = type === 'withdrawal'
    ? a => ['savings','investment'].includes(effectiveType(a))
    : a => !needsFrom || isLiquid(a);

  const toFilter = type === 'savings'
    ? a => effectiveType(a) === 'savings'
    : type === 'investment'
    ? a => effectiveType(a) === 'investment'
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
  const type        = document.getElementById('tf-type')?.value;
  const category_id = document.getElementById('tf-cat')?.value || null;
  const account_id  = document.getElementById('tf-acc')?.value || null;
  const to_account_id = document.getElementById('tf-to-acc')?.value || null;
  const user_id     = document.getElementById('tf-person')?.value || App.state.user.id;
  const status      = document.getElementById('tf-status')?.value || 'confirmed';
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
    day_of_month: new Date(tx.date + 'T00:00:00').getDate(),
    start_date: tx.date,
    is_active: true,
  });
}

function showErr(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}
