/* ═══════════════════════════════════════════════════════════════
   recurring.js — Recurring templates page
   Template table, create/edit modal, log now, pause/resume, delete
═══════════════════════════════════════════════════════════════ */

import {
  fmtCurrency, fmtDate, escHtml, parseISO, todayISO, toISO,
  buildCategoryOptions, buildAccountOptions, TX_TYPE_LABELS,
  effectiveType, isLiquid,
} from './utils.js';

const DOW_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── MAIN RENDER ───────────────────────────────────────────────
export function render(state) {
  const el = document.getElementById('page-recurring');
  const cur = App.currency();
  const { recurringTemplates, categories, accounts } = state;

  const active = recurringTemplates.filter(t => t.is_active);
  const paused = recurringTemplates.filter(t => !t.is_active);

  // Summary: expected this period + due not logged
  const period = App.cyclePeriod();
  const expectedThisPeriod = calcExpectedThisPeriod(state, period);
  const dueNotLogged = calcDueNotLogged(state);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Recurring</div>
        <div class="page-subtitle">${active.length} active · ${paused.length} paused</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="recur-add-btn">+ Create template</button>
      </div>
    </div>

    <!-- Summary cards -->
    <div class="stat-grid" style="grid-template-columns:repeat(2,1fr);max-width:500px">
      <div class="card card-sm">
        <div class="card-title text-muted text-sm">Expected this period</div>
        <div class="card-value text-mono">${fmtCurrency(expectedThisPeriod, cur)}</div>
      </div>
      <div class="card card-sm">
        <div class="card-title text-muted text-sm">Due not yet logged</div>
        <div class="card-value text-mono ${dueNotLogged > 0 ? 'c-amber' : ''}">${fmtCurrency(dueNotLogged, cur)}</div>
      </div>
    </div>

    <!-- Template table -->
    ${!recurringTemplates.length ? `<div class="empty-state" style="margin-top:2rem">
      <div style="font-size:2rem">↻</div>
      <p>No recurring templates yet. Create one for monthly bills, subscriptions, or regular income.</p>
    </div>` : `
    <div class="section">
      <div class="card" style="padding:0">
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th>Description</th>
              <th>Category</th>
              <th class="amount-col">Amount</th>
              <th>Frequency</th>
              <th>Next due</th>
              <th>Status</th>
              <th style="width:160px"></th>
            </tr></thead>
            <tbody>
              ${recurringTemplates.map(t => renderTemplateRow(t, state, cur)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`}
  `;

  document.getElementById('recur-add-btn')?.addEventListener('click', () => openTemplateModal(state));

  el.querySelectorAll('.recur-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = state.recurringTemplates.find(x => x.id === btn.dataset.id);
      if (t) openTemplateModal(state, t);
    });
  });
  el.querySelectorAll('.recur-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleTemplate(state, btn.dataset.id));
  });
  el.querySelectorAll('.recur-lognow-btn').forEach(btn => {
    btn.addEventListener('click', () => logNow(state, btn.dataset.id));
  });
  el.querySelectorAll('.recur-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteTemplate(state, btn.dataset.id));
  });
}

// ── TEMPLATE ROW ──────────────────────────────────────────────
function renderTemplateRow(t, state, cur) {
  const { categories, accounts, transactions } = state;
  const cat = categories.find(c => c.id === t.category_id);
  const acc = accounts.find(a => a.id === t.account_id);
  const nextDue = calcNextDue(t);
  const today = todayISO();
  const isDue = nextDue && nextDue <= today;

  return `<tr class="${t.is_active ? '' : 'text-muted'}">
    <td>
      <div class="fw-500">${escHtml(t.description)}</div>
      ${acc ? `<div class="text-sm text-muted">${escHtml(acc.name)}</div>` : ''}
    </td>
    <td class="text-sm">${cat ? escHtml(cat.icon + ' ' + cat.name) : '—'}</td>
    <td class="amount-col text-mono">${fmtCurrency(t.amount, cur)}</td>
    <td class="text-sm">${t.frequency}${freqDetail(t)}</td>
    <td class="text-sm ${isDue ? 'c-amber' : ''}">${nextDue ? fmtDate(nextDue) : '—'}</td>
    <td>${t.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-neutral">Paused</span>'}</td>
    <td>
      <div class="flex gap-1">
        ${t.is_active ? `<button class="btn btn-ghost btn-sm recur-lognow-btn" data-id="${t.id}" title="Log now">Log</button>` : ''}
        <button class="btn btn-ghost btn-sm recur-edit-btn" data-id="${t.id}">Edit</button>
        <button class="btn btn-ghost btn-sm recur-toggle-btn" data-id="${t.id}">${t.is_active ? 'Pause' : 'Resume'}</button>
        <button class="btn btn-ghost btn-sm btn-danger recur-delete-btn" data-id="${t.id}">✕</button>
      </div>
    </td>
  </tr>`;
}

function freqDetail(t) {
  if (t.frequency === 'weekly' || t.frequency === 'bi-weekly') {
    const dow = t.day_of_week ?? 0;
    return ` (${DOW_LABELS[dow]})`;
  }
  if (t.frequency === 'monthly') return t.day_of_month ? ` (day ${t.day_of_month})` : '';
  if (t.frequency === 'annually') return t.month_of_year ? ` (${MONTH_LABELS[t.month_of_year - 1]} ${t.day_of_month || 1})` : '';
  return '';
}

function calcNextDue(t) {
  if (!t.is_active || !t.start_date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(t.start_date + 'T00:00:00');

  try {
    if (t.frequency === 'weekly' || t.frequency === 'bi-weekly') {
      const step = t.frequency === 'weekly' ? 7 : 14;
      const targetDow = t.day_of_week ?? 0;
      let d = new Date(Math.max(start.getTime(), today.getTime()));
      // Advance to correct day of week
      while (((d.getDay() + 6) % 7) !== targetDow) d.setDate(d.getDate() + 1);
      return toISO(d);
    }
    if (t.frequency === 'monthly') {
      const dom = t.day_of_month || 1;
      const d = new Date(today);
      d.setDate(Math.min(dom, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      if (d < today) { d.setMonth(d.getMonth() + 1); d.setDate(Math.min(dom, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
      return toISO(d);
    }
    if (t.frequency === 'annually') {
      const dom = t.day_of_month || 1;
      const moy = (t.month_of_year || 1) - 1;
      let d = new Date(today.getFullYear(), moy, Math.min(dom, new Date(today.getFullYear(), moy + 1, 0).getDate()));
      if (d < today) d.setFullYear(d.getFullYear() + 1);
      return toISO(d);
    }
  } catch {}
  return null;
}

// ── SUMMARY COMPUTATIONS ──────────────────────────────────────
function calcExpectedThisPeriod(state, period) {
  const { recurringTemplates } = state;
  let total = 0;
  for (const t of recurringTemplates.filter(x => x.is_active)) {
    total += calcOccurrencesInPeriod(t, period) * Number(t.amount);
  }
  return total;
}

function calcOccurrencesInPeriod(t, period) {
  const { start, end } = period;
  let count = 0;
  const tStart = parseISO(t.start_date);
  if (!tStart || tStart > end) return 0;

  const effectiveStart = new Date(Math.max(tStart.getTime(), start.getTime()));

  if (t.frequency === 'weekly' || t.frequency === 'bi-weekly') {
    const step = t.frequency === 'weekly' ? 7 : 14;
    let d = new Date(effectiveStart);
    const targetDow = t.day_of_week ?? 0;
    while (((d.getDay() + 6) % 7) !== targetDow) d.setDate(d.getDate() + 1);
    while (d <= end) { if (d >= start) count++; d.setDate(d.getDate() + step); }
  } else if (t.frequency === 'monthly') {
    const dom = t.day_of_month || 1;
    for (let m = start.getMonth(), y = start.getFullYear(); new Date(y, m, 1) <= end; m++) {
      if (m > 11) { m = 0; y++; }
      const day = Math.min(dom, new Date(y, m + 1, 0).getDate());
      const d = new Date(y, m, day);
      if (d >= start && d <= end && d >= tStart) count++;
    }
  } else if (t.frequency === 'annually') {
    const dom = t.day_of_month || 1;
    const moy = (t.month_of_year || 1) - 1;
    for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
      const day = Math.min(dom, new Date(y, moy + 1, 0).getDate());
      const d = new Date(y, moy, day);
      if (d >= start && d <= end && d >= tStart) count++;
    }
  }
  return count;
}

function calcDueNotLogged(state) {
  const { recurringTemplates, transactions } = state;
  const today = new Date(); today.setHours(0,0,0,0);
  const existing = new Set(
    transactions.filter(tx => tx.recurring_template_id)
      .map(tx => `${tx.recurring_template_id}|${tx.date}`)
  );
  let total = 0;
  for (const t of recurringTemplates.filter(x => x.is_active)) {
    const nextDue = calcNextDue(t);
    if (nextDue && nextDue <= toISO(today)) {
      const key = `${t.id}|${nextDue}`;
      if (!existing.has(key)) total += Number(t.amount);
    }
  }
  return total;
}

// ── LOG NOW ───────────────────────────────────────────────────
async function logNow(state, id) {
  const t = state.recurringTemplates.find(x => x.id === id);
  if (!t) return;

  const todayStr = todayISO();
  const existing = state.transactions.find(tx =>
    tx.recurring_template_id === t.id && tx.date === todayStr
  );
  if (existing) { App.toast('Already logged today', 'info'); return; }

  const { data, error } = await App.supabase.from('transactions').insert({
    household_id: t.household_id,
    user_id: t.user_id,
    date: todayStr,
    description: t.description,
    amount: t.amount,
    type: t.type,
    status: 'confirmed',
    category_id: t.category_id,
    account_id: t.account_id,
    to_account_id: t.to_account_id,
    notes: t.notes,
    is_recurring: true,
    recur_freq: t.frequency,
    recurring_template_id: t.id,
  }).select().single();

  if (!error && data) {
    state.transactions.unshift(data);
    state.recentlyInserted?.add(data.id);
    setTimeout(() => state.recentlyInserted?.delete(data.id), 5000);
    App.toast('Transaction logged', 'success');
    render(state);
  } else {
    App.toast('Error: ' + (error?.message || 'unknown'), 'error');
  }
}

// ── TOGGLE ────────────────────────────────────────────────────
async function toggleTemplate(state, id) {
  const t = state.recurringTemplates.find(x => x.id === id);
  if (!t) return;
  const newVal = !t.is_active;
  const { error } = await App.supabase.from('recurring_templates')
    .update({ is_active: newVal }).eq('id', id).eq('household_id', App.state.household.id);
  if (!error) {
    t.is_active = newVal;
    App.toast(newVal ? 'Resumed' : 'Paused', 'success');
    render(state);
  } else {
    App.toast('Error: ' + error.message, 'error');
  }
}

// ── DELETE ────────────────────────────────────────────────────
async function deleteTemplate(state, id) {
  const ok = await App.openConfirm('Delete template', 'Future auto-logging will stop. Existing transactions are kept.');
  if (!ok) return;
  const { error } = await App.supabase.from('recurring_templates').delete().eq('id', id);
  if (!error) {
    state.recurringTemplates = state.recurringTemplates.filter(t => t.id !== id);
    App.toast('Template deleted', 'success');
    render(state);
  } else {
    App.toast('Error: ' + error.message, 'error');
  }
}

// ── CREATE / EDIT MODAL ───────────────────────────────────────
function openTemplateModal(state, tmpl = null) {
  const isEdit = !!tmpl;
  const { categories, accounts } = state;
  const defaultType = tmpl?.type || 'spend';
  const catOpts = buildCategoryOptions(categories, tmpl?.category_id);

  const html = `<form id="tmpl-form" autocomplete="off">
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">Category</label>
        <select class="form-select" id="tf2-cat">${catOpts}</select>
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Type *</label>
        <select class="form-select" id="tf2-type">
          ${Object.entries(TX_TYPE_LABELS).map(([k,v]) => `<option value="${k}"${defaultType===k?' selected':''}>${v}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">Description *</label>
        <input class="form-input" id="tf2-desc" value="${escHtml(tmpl?.description || '')}" placeholder="e.g. Netflix" />
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Amount *</label>
        <input class="form-input text-mono" type="number" id="tf2-amount" step="0.01" min="0.01" value="${tmpl?.amount || ''}" />
      </div>
    </div>
    <div id="tf2-account-fields"></div>
    <div class="form-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">Frequency *</label>
        <select class="form-select" id="tf2-freq">
          <option value="weekly"${tmpl?.frequency==='weekly'?' selected':''}>Weekly</option>
          <option value="bi-weekly"${tmpl?.frequency==='bi-weekly'?' selected':''}>Bi-weekly</option>
          <option value="monthly"${tmpl?.frequency==='monthly'||!tmpl?' selected':''}>Monthly</option>
          <option value="annually"${tmpl?.frequency==='annually'?' selected':''}>Annually</option>
        </select>
      </div>
      <div class="form-group" style="flex:1" id="tf2-day-group">
        <label class="form-label">Day</label>
        <input class="form-input" type="number" id="tf2-day" min="1" max="31" value="${tmpl?.day_of_month || tmpl?.day_of_week !== undefined ? (tmpl.frequency === 'weekly' || tmpl.frequency === 'bi-weekly' ? tmpl.day_of_week : tmpl.day_of_month) : new Date().getDate()}" />
      </div>
    </div>
    <div class="form-row" id="tf2-month-row" style="${tmpl?.frequency === 'annually' ? '' : 'display:none'}">
      <div class="form-group" style="flex:1">
        <label class="form-label">Month</label>
        <select class="form-select" id="tf2-month">
          ${MONTH_LABELS.map((m,i) => `<option value="${i+1}"${(tmpl?.month_of_year || new Date().getMonth() + 1) === i+1 ? ' selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Start date *</label>
      <input class="form-input" type="date" id="tf2-start" value="${tmpl?.start_date || todayISO()}" />
    </div>
    <div class="form-group">
      <label class="form-label">Notes</label>
      <textarea class="form-textarea" id="tf2-notes" rows="2">${escHtml(tmpl?.notes || '')}</textarea>
    </div>
    <div id="tf2-error" class="form-error hidden"></div>
    <div class="btn-row">
      <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Cancel</button>
      <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Create template'}</button>
    </div>
  </form>`;

  App.openModal(isEdit ? 'Edit Template' : 'Create Recurring Template', html);

  // Render account fields
  renderTmplAccountFields(state, tmpl);

  document.getElementById('tf2-type')?.addEventListener('change', () => renderTmplAccountFields(state, tmpl));
  document.getElementById('tf2-cat')?.addEventListener('change', e => {
    const cat = state.categories.find(c => c.id === e.target.value);
    if (cat?.default_tx_type) document.getElementById('tf2-type').value = cat.default_tx_type;
    if (cat && !document.getElementById('tf2-desc').value) document.getElementById('tf2-desc').value = cat.name;
    renderTmplAccountFields(state, tmpl);
  });
  document.getElementById('tf2-freq')?.addEventListener('change', e => {
    const freq = e.target.value;
    const dayGroup = document.getElementById('tf2-day-group');
    const monthRow = document.getElementById('tf2-month-row');
    if (dayGroup) {
      const dayLabel = dayGroup.querySelector('.form-label');
      if (freq === 'weekly' || freq === 'bi-weekly') {
        if (dayLabel) dayLabel.textContent = 'Day of week (0=Mon)';
        document.getElementById('tf2-day').max = 6;
      } else {
        if (dayLabel) dayLabel.textContent = 'Day of month';
        document.getElementById('tf2-day').max = 31;
      }
    }
    if (monthRow) monthRow.style.display = freq === 'annually' ? '' : 'none';
  });

  document.getElementById('tmpl-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    await saveTmpl(state, tmpl);
  });
}

function renderTmplAccountFields(state, tmpl = null) {
  const container = document.getElementById('tf2-account-fields');
  if (!container) return;
  const type = document.getElementById('tf2-type')?.value || 'spend';
  const { accounts } = state;
  const order = state.accountOrder;

  const hasTwoAccounts = ['savings','investment','transfer','withdrawal','debt_payment'].includes(type);
  const toFilter = type === 'savings' ? a => effectiveType(a) === 'savings'
    : type === 'investment' ? a => effectiveType(a) === 'investment'
    : type === 'withdrawal' ? a => isLiquid(a)
    : type === 'debt_payment' ? a => effectiveType(a) === 'loan'
    : null;
  const fromFilter = type === 'withdrawal' ? a => ['savings','investment'].includes(effectiveType(a)) : null;

  if (hasTwoAccounts) {
    const fromOpts = buildAccountOptions(accounts, order, fromFilter, tmpl?.account_id);
    const toOpts = buildAccountOptions(accounts, order, toFilter, tmpl?.to_account_id);
    container.innerHTML = `<div class="form-row">
      <div class="form-group" style="flex:1">
        <label class="form-label">From account</label>
        <select class="form-select" id="tf2-acc">${fromOpts}</select>
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">To account</label>
        <select class="form-select" id="tf2-to-acc">${toOpts}</select>
      </div>
    </div>`;
  } else {
    const label = type === 'income' ? 'Account' : 'Account';
    container.innerHTML = `<div class="form-group">
      <label class="form-label">${label}</label>
      <select class="form-select" id="tf2-acc">${buildAccountOptions(accounts, order, null, tmpl?.account_id)}</select>
    </div>`;
  }
}

async function saveTmpl(state, existing = null) {
  const errEl = document.getElementById('tf2-error');
  errEl.classList.add('hidden');

  const description = document.getElementById('tf2-desc')?.value.trim();
  const amount = parseFloat(document.getElementById('tf2-amount')?.value);
  const type = document.getElementById('tf2-type')?.value;
  const category_id = document.getElementById('tf2-cat')?.value || null;
  const account_id = document.getElementById('tf2-acc')?.value || null;
  const to_account_id = document.getElementById('tf2-to-acc')?.value || null;
  const frequency = document.getElementById('tf2-freq')?.value;
  const dayVal = parseInt(document.getElementById('tf2-day')?.value) || 1;
  const month_of_year = parseInt(document.getElementById('tf2-month')?.value) || null;
  const start_date = document.getElementById('tf2-start')?.value;
  const notes = document.getElementById('tf2-notes')?.value.trim() || null;

  if (!description) { errEl.textContent = 'Description is required'; errEl.classList.remove('hidden'); return; }
  if (isNaN(amount) || amount <= 0) { errEl.textContent = 'Enter a valid amount'; errEl.classList.remove('hidden'); return; }
  if (!start_date) { errEl.textContent = 'Start date is required'; errEl.classList.remove('hidden'); return; }

  const isWeekly = frequency === 'weekly' || frequency === 'bi-weekly';
  const payload = {
    household_id: App.state.household.id,
    user_id: App.state.user.id,
    description,
    amount,
    type,
    category_id,
    account_id,
    to_account_id,
    frequency,
    day_of_week: isWeekly ? dayVal : null,
    day_of_month: !isWeekly ? dayVal : null,
    month_of_year: frequency === 'annually' ? month_of_year : null,
    start_date,
    notes,
    is_active: existing?.is_active ?? true,
  };

  if (existing) {
    const { error } = await App.supabase.from('recurring_templates')
      .update(payload).eq('id', existing.id).eq('household_id', App.state.household.id);
    if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
    const idx = state.recurringTemplates.findIndex(t => t.id === existing.id);
    if (idx !== -1) state.recurringTemplates[idx] = { ...state.recurringTemplates[idx], ...payload };
    App.toast('Template updated', 'success');
  } else {
    const { data, error } = await App.supabase.from('recurring_templates').insert(payload).select().single();
    if (error) { errEl.textContent = error.message; errEl.classList.remove('hidden'); return; }
    state.recurringTemplates.push(data);
    App.toast('Template created', 'success');
    // Run processRecurringDue for new template
    if (data.start_date <= todayISO()) {
      await App.loadAllData();
    }
  }
  App.closeModal();
  render(state);
}
