/* ═══════════════════════════════════════════════════════════════
   accounts.js — Accounts page
   Account cards, balance, savings metrics, CRUD, archive
═══════════════════════════════════════════════════════════════ */

import {
  fmtCurrency, fmtPct, escHtml, effectiveType, isLiquid,
  calcAccountBalance, buildAccountOptions, parseISO, isEffective,
} from './utils.js';

// ── MAIN RENDER ───────────────────────────────────────────────
export function render(state) {
  const el = document.getElementById('page-accounts');
  const cur = App.currency();
  const { accounts, transactions } = state;

  const active = accounts.filter(a => !a.is_archived);
  const archived = accounts.filter(a => a.is_archived);

  // Group active accounts
  const liquid = active.filter(a => isLiquid(a));
  const savings = active.filter(a => effectiveType(a) === 'savings');
  const investment = active.filter(a => effectiveType(a) === 'investment');
  const loans = active.filter(a => effectiveType(a) === 'loan');
  const other = active.filter(a => !isLiquid(a) && !['savings','investment','loan'].includes(effectiveType(a)));

  const groups = [
    { label: 'Liquid Accounts', accs: liquid },
    { label: 'Savings', accs: savings },
    { label: 'Investments', accs: investment },
    { label: 'Loans & Debt', accs: loans },
    { label: 'Other', accs: other },
  ].filter(g => g.accs.length > 0);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Accounts</div>
        <div class="page-subtitle">${active.length} active account${active.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="acc-add-btn">+ Add account</button>
      </div>
    </div>

    ${groups.map(g => `
      <div class="section">
        <div class="section-header"><div class="section-title">${g.label}</div></div>
        <div class="stat-grid" style="grid-template-columns:repeat(${Math.min(g.accs.length, 3)},1fr)">
          ${g.accs.map(a => renderAccountCard(a, state, cur)).join('')}
        </div>
      </div>
    `).join('')}

    ${archived.length ? `
      <div class="section">
        <div class="section-header">
          <div class="section-title text-muted">Archived Accounts</div>
        </div>
        <div class="stat-grid" style="grid-template-columns:repeat(${Math.min(archived.length, 3)},1fr)">
          ${archived.map(a => renderAccountCard(a, state, cur)).join('')}
        </div>
      </div>
    ` : ''}

    ${!active.length && !archived.length ? `
      <div class="empty-state">
        <div style="font-size:2rem">▣</div>
        <p>No accounts yet. Add your first account to get started.</p>
      </div>
    ` : ''}
  `;

  document.getElementById('acc-add-btn')?.addEventListener('click', () => openAccountModal(state));

  el.querySelectorAll('.acc-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const acc = state.accounts.find(a => a.id === btn.dataset.id);
      if (acc) openAccountModal(state, acc);
    });
  });
  el.querySelectorAll('.acc-archive-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); toggleArchive(state, btn.dataset.id); });
  });
  el.querySelectorAll('.acc-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteAccount(state, btn.dataset.id); });
  });
  el.querySelectorAll('.acc-adjust-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const acc = state.accounts.find(a => a.id === btn.dataset.id);
      if (acc) openAdjustModal(state, acc);
    });
  });
}

// ── ACCOUNT CARD ──────────────────────────────────────────────
function renderAccountCard(a, state, cur) {
  const { transactions } = state;
  const et = effectiveType(a);
  const balance = calcAccountBalance(a, transactions);
  const isLoan = et === 'loan';
  const isArchived = a.is_archived;

  const txCount = transactions.filter(tx =>
    isEffective(tx) && (tx.account_id === a.id || tx.to_account_id === a.id)
  ).length;

  // Return metrics for savings/investment
  let returnMetrics = '';
  if (['savings','investment'].includes(et) && !isArchived) {
    const contributed = transactions.filter(tx =>
      isEffective(tx) && tx.to_account_id === a.id && ['savings','investment'].includes(tx.type)
    ).reduce((s, tx) => s + Number(tx.amount), 0);
    const growth = balance - (Number(a.opening_balance) || 0) - contributed;
    const growthPct = contributed > 0 ? (growth / contributed * 100) : 0;

    returnMetrics = `<div class="divider"></div>
      <div class="flex justify-between text-sm text-muted">
        <span>Contributed</span><span class="text-mono">${fmtCurrency(contributed, cur)}</span>
      </div>
      <div class="flex justify-between text-sm ${growth >= 0 ? 'c-green' : 'c-red'}">
        <span>Growth</span>
        <span class="text-mono">${growth >= 0 ? '+' : ''}${fmtCurrency(growth, cur)} (${fmtPct(growthPct)})</span>
      </div>`;
  }

  const typeLabel = a.type === 'custom' ? (a.custom_type || a.base_type) : et;

  return `<div class="card" style="border-left:4px solid ${a.color || 'var(--accent)'};${isArchived ? 'opacity:.55' : ''}">
    <div class="card-header">
      <div>
        <div class="card-title">${escHtml(a.name)}</div>
        <div class="text-sm text-muted">${escHtml(typeLabel)}</div>
      </div>
      ${isLoan && balance <= 0 ? '<span class="badge badge-green">Paid off ✓</span>' : ''}
    </div>
    <div class="card-value text-mono ${isLoan ? 'c-red' : balance < 0 ? 'c-red' : ''}">
      ${fmtCurrency(balance, cur)}
    </div>
    <div class="card-meta text-muted text-sm">
      ${txCount} tx · Opening: ${fmtCurrency(a.opening_balance || 0, cur)}
      ${a.type === 'custom' && a.base_type ? ` · ${a.base_type}` : ''}
    </div>
    ${returnMetrics}
    <div class="divider"></div>
    <div class="flex gap-1" style="flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm acc-edit-btn" data-id="${a.id}">Edit</button>
      <button class="btn btn-ghost btn-sm acc-adjust-btn" data-id="${a.id}">Adjust</button>
      <button class="btn btn-ghost btn-sm acc-archive-btn" data-id="${a.id}">${isArchived ? 'Unarchive' : 'Archive'}</button>
      <button class="btn btn-ghost btn-sm btn-danger acc-delete-btn" data-id="${a.id}">Delete</button>
    </div>
  </div>`;
}

// ── ADD / EDIT MODAL ──────────────────────────────────────────
function openAccountModal(state, acc = null) {
  const isEdit = !!acc;
  const et = acc ? effectiveType(acc) : '';
  const savedTypes = state.customAccountTypes || [];

  // For edit: find matching saved type by label
  const matchedSaved = acc?.type === 'custom'
    ? savedTypes.find(t => t.label === acc.custom_type) : null;

  const baseTypeOptions = (sel) => ['checking','savings','investment','credit','loan','cash']
    .map(bt => `<option value="${bt}"${sel===bt?' selected':''}>${bt}</option>`).join('');

  const savedTypeOptions = savedTypes.map(t =>
    `<option value="${t.id}" data-label="${escHtml(t.label)}" data-base="${t.base_type}"
      ${matchedSaved?.id === t.id ? ' selected' : ''}>${escHtml(t.label)} (${t.base_type})</option>`
  ).join('');

  // Show new-type inputs if no saved match (or no saved types at all)
  const showNew = !matchedSaved;

  const html = `<form id="acc-form" autocomplete="off">
    <div class="form-group">
      <label class="form-label">Account name *</label>
      <input class="form-input" id="af-name" value="${escHtml(acc?.name || '')}" placeholder="e.g. Main Checking" />
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">Type *</label>
        <select class="form-select" id="af-type">
          <option value="checking"${et==='checking'?' selected':''}>Checking</option>
          <option value="savings"${et==='savings'?' selected':''}>Savings</option>
          <option value="investment"${et==='investment'?' selected':''}>Investment</option>
          <option value="credit"${et==='credit'?' selected':''}>Credit</option>
          <option value="loan"${et==='loan'?' selected':''}>Loan</option>
          <option value="cash"${et==='cash'?' selected':''}>Cash</option>
          <option value="custom"${acc?.type==='custom'?' selected':''}>Custom</option>
        </select>
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Color</label>
        <input class="form-input" type="color" id="af-color" value="${acc?.color || '#22c55e'}" style="height:38px;padding:2px 4px" />
      </div>
    </div>
    <div id="af-custom-fields" class="${acc?.type === 'custom' ? '' : 'hidden'}">
      ${savedTypes.length ? `
        <div class="form-group">
          <label class="form-label">Saved custom type</label>
          <select class="form-select" id="af-custom-select">
            <option value="">— New custom type —</option>
            ${savedTypeOptions}
          </select>
          <div class="form-hint">Select a saved type or create a new one below</div>
        </div>
      ` : ''}
      <div id="af-custom-new-row" class="${showNew ? '' : 'hidden'}">
        <div class="form-row">
          <div class="form-group" style="flex:1">
            <label class="form-label">Label</label>
            <input class="form-input" id="af-custom-label" value="${escHtml(showNew ? (acc?.custom_type || '') : '')}" placeholder="e.g. Stavební spoření" />
          </div>
          <div class="form-group" style="flex:1">
            <label class="form-label">Behaves as</label>
            <select class="form-select" id="af-base-type">
              ${baseTypeOptions(showNew ? acc?.base_type : '')}
            </select>
          </div>
        </div>
        <div class="form-hint">New types are saved automatically for future accounts</div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">Opening balance</label>
        <input class="form-input text-mono" type="number" id="af-opening" step="0.01" value="${acc?.opening_balance || 0}" />
        <div class="form-hint">For loans: amount owed (positive)</div>
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Expected rate % p.a.</label>
        <input class="form-input text-mono" type="number" id="af-rate" step="0.01" value="${acc?.expected_rate || ''}" placeholder="e.g. 3.5" />
        <div class="form-hint">Savings/investment only</div>
      </div>
    </div>
    <div id="af-error" class="form-error hidden"></div>
    <div class="btn-row">
      <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Cancel</button>
      <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Add account'}</button>
    </div>
  </form>`;

  App.openModal(isEdit ? 'Edit Account' : 'Add Account', html);

  document.getElementById('af-type')?.addEventListener('change', e => {
    document.getElementById('af-custom-fields').classList.toggle('hidden', e.target.value !== 'custom');
  });

  document.getElementById('af-custom-select')?.addEventListener('change', e => {
    const sel = e.target;
    const opt = sel.options[sel.selectedIndex];
    const newRow = document.getElementById('af-custom-new-row');
    if (sel.value) {
      document.getElementById('af-custom-label').value = opt.dataset.label || '';
      document.getElementById('af-base-type').value    = opt.dataset.base  || '';
      newRow.classList.add('hidden');
    } else {
      document.getElementById('af-custom-label').value = '';
      newRow.classList.remove('hidden');
    }
  });

  document.getElementById('acc-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('af-error');
    errEl.classList.add('hidden');

    const name    = document.getElementById('af-name')?.value.trim();
    const type    = document.getElementById('af-type')?.value;
    const color   = document.getElementById('af-color')?.value;
    const opening_balance = parseFloat(document.getElementById('af-opening')?.value) || 0;
    const expected_rate   = parseFloat(document.getElementById('af-rate')?.value) || null;

    if (!name) { errEl.textContent = 'Name is required'; errEl.classList.remove('hidden'); return; }

    let custom_type = null, base_type = null;
    if (type === 'custom') {
      const selectEl = document.getElementById('af-custom-select');
      if (selectEl?.value) {
        // Using a saved type
        const opt = selectEl.options[selectEl.selectedIndex];
        custom_type = opt.dataset.label || null;
        base_type   = opt.dataset.base  || null;
      } else {
        // New type from inputs
        custom_type = document.getElementById('af-custom-label')?.value.trim() || null;
        base_type   = document.getElementById('af-base-type')?.value || null;
        // Auto-save new type for future reuse
        if (custom_type && base_type) {
          const alreadySaved = (state.customAccountTypes || []).some(t => t.label === custom_type);
          if (!alreadySaved) {
            const { data: newType } = await App.supabase.from('custom_account_types')
              .insert({ household_id: App.state.household.id, label: custom_type, base_type })
              .select().single();
            if (newType) {
              state.customAccountTypes = [...(state.customAccountTypes || []), newType]
                .sort((a, b) => a.label.localeCompare(b.label));
            }
          }
        }
      }
    }

    const payload = { name, type, color, opening_balance, expected_rate,
                      custom_type: type === 'custom' ? custom_type : null,
                      base_type:   type === 'custom' ? base_type   : null,
                      household_id: App.state.household.id };

    if (isEdit) {
      const { error } = await App.supabase.from('accounts').update(payload).eq('id', acc.id).eq('household_id', App.state.household.id);
      if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
      const idx = state.accounts.findIndex(a => a.id === acc.id);
      if (idx !== -1) state.accounts[idx] = { ...state.accounts[idx], ...payload };
      App.toast('Account updated', 'success');
    } else {
      const { data, error } = await App.supabase.from('accounts').insert(payload).select().single();
      if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
      state.accounts.push(data);
      App.toast('Account added', 'success');
    }
    App.closeModal();
    render(state);
  });
}

// ── ADJUST BALANCE ────────────────────────────────────────────
function openAdjustModal(state, acc) {
  const cur = App.currency();
  const balance = calcAccountBalance(acc, state.transactions);

  const html = `<div>
    <p class="text-muted" style="margin-bottom:1rem">Current balance: <strong class="text-mono">${fmtCurrency(balance, cur)}</strong></p>
    <div class="form-group">
      <label class="form-label">Adjustment amount</label>
      <input class="form-input text-mono" type="number" id="adj-amount" step="0.01" placeholder="+500 or -200" />
      <div class="form-hint">Positive = add, negative = subtract</div>
    </div>
    <div class="form-group">
      <label class="form-label">Note</label>
      <input class="form-input" id="adj-note" placeholder="Reason for adjustment" />
    </div>
    <div id="adj-error" class="form-error hidden"></div>
    <div class="btn-row">
      <button class="btn btn-ghost" onclick="App.closeModal()">Cancel</button>
      <button class="btn btn-primary" id="adj-save-btn">Apply adjustment</button>
    </div>
  </div>`;

  App.openModal('Adjust Balance — ' + acc.name, html);

  document.getElementById('adj-save-btn')?.addEventListener('click', async () => {
    const errEl = document.getElementById('adj-error');
    errEl.classList.add('hidden');
    const amount = parseFloat(document.getElementById('adj-amount')?.value);
    const note = document.getElementById('adj-note')?.value.trim();
    if (isNaN(amount) || amount === 0) {
      errEl.textContent = 'Enter a non-zero amount'; errEl.classList.remove('hidden'); return;
    }

    // amount must be positive per schema CHECK; encode direction in notes field
    const absAmount = Math.abs(amount);
    const { data, error } = await App.supabase.from('transactions').insert({
      household_id: App.state.household.id,
      user_id: App.state.user.id,
      date: new Date().toISOString().split('T')[0],
      description: note || `Balance adjustment — ${acc.name}`,
      amount: absAmount,
      type: 'adjustment',
      status: 'confirmed',
      account_id: acc.id,
      notes: amount < 0 ? 'subtract' : 'add',
    }).select().single();

    if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }

    state.transactions.unshift(data);
    App.toast('Balance adjusted', 'success');
    App.closeModal();
    render(state);
  });
}

// ── ARCHIVE / DELETE ──────────────────────────────────────────
async function toggleArchive(state, id) {
  const acc = state.accounts.find(a => a.id === id);
  if (!acc) return;
  const newVal = !acc.is_archived;
  const { error } = await App.supabase.from('accounts')
    .update({ is_archived: newVal })
    .eq('id', id).eq('household_id', App.state.household.id);
  if (!error) {
    acc.is_archived = newVal;
    App.toast(newVal ? 'Account archived' : 'Account unarchived', 'success');
    render(state);
  } else {
    App.toast('Error: ' + error.message, 'error');
  }
}

async function deleteAccount(state, id) {
  const ok = await App.openConfirm('Delete account', 'The account will be deleted. Transactions remain but will be unlinked.');
  if (!ok) return;
  const { error } = await App.supabase.from('accounts').delete().eq('id', id).eq('household_id', App.state.household.id);
  if (!error) {
    state.accounts = state.accounts.filter(a => a.id !== id);
    App.toast('Account deleted', 'success');
    render(state);
  } else {
    App.toast('Error: ' + error.message, 'error');
  }
}
