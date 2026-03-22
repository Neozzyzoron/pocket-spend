/* ═══════════════════════════════════════════════════════════════
   budgets.js — Budgets page
   Budget cards with progress bars, rollover, period selector
═══════════════════════════════════════════════════════════════ */

import {
  fmtCurrency, escHtml, parseISO, isEffective,
  buildCategoryOptions, getPeriods,
} from './utils.js';

// ── MAIN RENDER ───────────────────────────────────────────────
export function render(state) {
  const el = document.getElementById('page-budgets');
  const cur = App.currency();
  const { budgets } = state;
  const period = App.cyclePeriod();
  const periodsN = parseInt(el.dataset.periods || '1');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Budgets</div>
        <div class="page-subtitle">${budgets.length} budget${budgets.length !== 1 ? 's' : ''} · ${escHtml(period.label)}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="budget-add-btn">+ Add budget</button>
      </div>
    </div>

    <div class="section" style="padding-bottom:0">
      <div class="flex gap-2 items-center">
        <span class="text-sm text-muted">Show:</span>
        <div class="toggle-group">
          ${[1,3,6,12].map(n => `<button class="toggle-group-btn budget-periods-btn${periodsN===n?' active':''}" data-n="${n}">${n} period${n>1?'s':''}</button>`).join('')}
        </div>
      </div>
    </div>

    ${!budgets.length ? `<div class="empty-state" style="margin-top:2rem">
      <div style="font-size:2rem">◎</div>
      <p>No budgets yet. Add one to start tracking spending limits.</p>
    </div>` : `<div class="section">
      <div class="stat-grid" style="grid-template-columns:repeat(${Math.min(budgets.length, 3)},1fr)">
        ${budgets.map(b => renderBudgetCard(b, state, period, cur, periodsN)).join('')}
      </div>
    </div>`}
  `;

  document.getElementById('budget-add-btn')?.addEventListener('click', () => openBudgetModal(state));

  el.querySelectorAll('.budget-periods-btn').forEach(btn => {
    btn.addEventListener('click', () => { el.dataset.periods = btn.dataset.n; render(state); });
  });
  el.querySelectorAll('.budget-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const b = state.budgets.find(x => x.id === btn.dataset.id);
      if (b) openBudgetModal(state, b);
    });
  });
  el.querySelectorAll('.budget-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await App.openConfirm('Delete budget', 'This will delete the budget and all snapshots.');
      if (!ok) return;
      const { error } = await App.supabase.from('budgets').delete().eq('id', btn.dataset.id);
      if (!error) {
        state.budgets = state.budgets.filter(b => b.id !== btn.dataset.id);
        state.budgetSnapshots = state.budgetSnapshots.filter(s => s.budget_id !== btn.dataset.id);
        App.toast('Budget deleted', 'success');
        render(state);
      } else {
        App.toast('Error: ' + error.message, 'error');
      }
    });
  });
}

// ── BUDGET CARD ───────────────────────────────────────────────
function renderBudgetCard(budget, state, period, cur, periodsN) {
  const { transactions, categories, budgetSnapshots } = state;
  const cat = categories.find(c => c.id === budget.category_id);
  const baseLimit = Number(budget.amount);
  const multiplier = periodMultiplier(budget.period_type, periodsN);
  let effectiveLimit = baseLimit * multiplier;

  // Rollover (single period only)
  let rolloverAmt = 0;
  if (budget.rollover_enabled && periodsN === 1) {
    const prevSnap = findPrevSnapshot(budgetSnapshots, budget.id, period.start);
    if (prevSnap) {
      rolloverAmt = Number(prevSnap.base_limit) - Number(prevSnap.actual_spend);
      effectiveLimit += rolloverAmt;
    }
  }

  // Calculate spend across N periods
  let totalSpend = 0;
  if (periodsN === 1) {
    totalSpend = calcPeriodSpend(transactions, budget.category_id, period);
  } else {
    const pa = state.profiles[0]?.preferences?.salary_day;
    const pb = state.profiles[1]?.preferences?.salary_day;
    const plist = getPeriods(App.cycleMode(), { salary_day_a: pa, salary_day_b: pb }, periodsN);
    totalSpend = plist.reduce((s, p) => s + calcPeriodSpend(transactions, budget.category_id, p), 0);
  }

  const pct = effectiveLimit > 0 ? (totalSpend / effectiveLimit * 100) : 0;
  const isOver = totalSpend > effectiveLimit;
  const barColor = pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--green)';

  return `<div class="card">
    <div class="card-header">
      <div>
        <div class="card-title">${cat ? escHtml(cat.icon + ' ' + cat.name) : '<span class="text-muted">—</span>'}</div>
        <div class="text-sm text-muted">${budget.period_type}${budget.rollover_enabled ? ' · rollover' : ''}</div>
      </div>
      <div class="flex gap-1">
        <button class="btn btn-ghost btn-sm budget-edit-btn" data-id="${budget.id}">Edit</button>
        <button class="btn btn-ghost btn-sm btn-danger budget-delete-btn" data-id="${budget.id}">✕</button>
      </div>
    </div>

    ${budget.rollover_enabled && rolloverAmt !== 0 ? `
      <div class="text-sm ${rolloverAmt >= 0 ? 'c-green' : 'c-red'}" style="margin-bottom:.4rem">
        ↩ ${rolloverAmt >= 0 ? '+' : ''}${fmtCurrency(rolloverAmt, cur)} ${rolloverAmt >= 0 ? 'rolled over' : 'overspend'}
      </div>
    ` : ''}

    <div class="progress-bar" style="margin:.6rem 0 .3rem">
      <div class="progress-fill" style="width:${Math.min(pct, 100).toFixed(1)}%;background:${barColor}"></div>
    </div>

    <div class="flex justify-between text-sm" style="margin-bottom:.2rem">
      <span class="${isOver ? 'c-red fw-500' : ''}">${fmtCurrency(totalSpend, cur)} spent</span>
      <span class="text-muted">${fmtCurrency(effectiveLimit, cur)} limit</span>
    </div>

    <div class="text-sm ${isOver ? 'c-red' : 'text-muted'}">
      ${isOver
        ? `Over by ${fmtCurrency(totalSpend - effectiveLimit, cur)}`
        : `${fmtCurrency(effectiveLimit - totalSpend, cur)} remaining`}
    </div>
  </div>`;
}

function calcPeriodSpend(transactions, categoryId, period) {
  return transactions.filter(tx =>
    isEffective(tx) && tx.type === 'spend' && tx.category_id === categoryId &&
    parseISO(tx.date) >= period.start && parseISO(tx.date) <= period.end
  ).reduce((s, tx) => s + Number(tx.amount), 0);
}

function findPrevSnapshot(snapshots, budgetId, currentStart) {
  // Find most recent snapshot before current period
  return snapshots
    .filter(s => s.budget_id === budgetId && new Date(s.period_end + 'T00:00:00') < currentStart)
    .sort((a, b) => b.period_start.localeCompare(a.period_start))[0] || null;
}

function periodMultiplier(periodType, n) {
  if (periodType === 'monthly') return n;
  if (periodType === 'quarterly') return n === 12 ? 4 : n === 6 ? 2 : 1;
  if (periodType === 'annually') return n === 12 ? 1 : n === 6 ? 0.5 : 0.25;
  return 1;
}

// ── ADD / EDIT MODAL ──────────────────────────────────────────
function openBudgetModal(state, budget = null) {
  const isEdit = !!budget;
  const catOpts = buildCategoryOptions(state.categories, budget?.category_id);

  const html = `<form id="budget-form">
    <div class="form-group">
      <label class="form-label">Category *</label>
      <select class="form-select" id="bf-cat">${catOpts}</select>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">Limit per period *</label>
        <input class="form-input text-mono" type="number" id="bf-amount" step="0.01" min="0.01" value="${budget?.amount || ''}" placeholder="0.00" />
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Period type</label>
        <select class="form-select" id="bf-period">
          <option value="monthly"${budget?.period_type === 'monthly' ? ' selected' : ''}>Monthly</option>
          <option value="quarterly"${budget?.period_type === 'quarterly' ? ' selected' : ''}>Quarterly</option>
          <option value="annually"${budget?.period_type === 'annually' ? ' selected' : ''}>Annually</option>
        </select>
      </div>
    </div>
    <div class="form-check" style="margin-bottom:1rem">
      <label>
        <input type="checkbox" id="bf-rollover" ${budget?.rollover_enabled ? 'checked' : ''} />
        Enable rollover (carry underspend/overspend to next period)
      </label>
    </div>
    <div id="bf-error" class="form-error hidden"></div>
    <div class="btn-row">
      <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Cancel</button>
      <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Add budget'}</button>
    </div>
  </form>`;

  App.openModal(isEdit ? 'Edit Budget' : 'Add Budget', html);

  document.getElementById('budget-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('bf-error');
    errEl.classList.add('hidden');

    const category_id = document.getElementById('bf-cat')?.value;
    const amount = parseFloat(document.getElementById('bf-amount')?.value);
    const period_type = document.getElementById('bf-period')?.value;
    const rollover_enabled = document.getElementById('bf-rollover')?.checked || false;

    if (!category_id) { errEl.textContent = 'Select a category'; errEl.classList.remove('hidden'); return; }
    if (isNaN(amount) || amount <= 0) { errEl.textContent = 'Enter a valid amount'; errEl.classList.remove('hidden'); return; }

    const payload = { category_id, amount, period_type, rollover_enabled, household_id: App.state.household.id };

    if (isEdit) {
      const { error } = await App.supabase.from('budgets')
        .update(payload).eq('id', budget.id).eq('household_id', App.state.household.id);
      if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
      const idx = state.budgets.findIndex(b => b.id === budget.id);
      if (idx !== -1) state.budgets[idx] = { ...state.budgets[idx], ...payload };
      App.toast('Budget updated', 'success');
    } else {
      const { data, error } = await App.supabase.from('budgets').insert(payload).select().single();
      if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
      state.budgets.push(data);
      App.toast('Budget added', 'success');
    }
    App.closeModal();
    render(state);
  });
}
