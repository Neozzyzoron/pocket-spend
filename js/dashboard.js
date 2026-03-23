/* ═══════════════════════════════════════════════════════════════
   dashboard.js — Dashboard page
   Sections: stat cards, spending breakdown, cashflow chart, recent tx
═══════════════════════════════════════════════════════════════ */

import {
  fmtCurrency, fmtRelDate, getPeriods,
  isEffective, effectiveType, isLiquid, calcAccountBalance,
  buildCategoryTree, escHtml, parseISO, todayDate,
} from './utils.js';
import { openTxModal } from './transactions.js';

let cashflowChart = null;

const DEFAULT_CARD_ORDER = [
  'income','spending','saved','invested','withdrawn','debt_payments',
  'net_balance','net_worth','total_debt','due_eop','expected_eop','runway',
];

// ── MAIN RENDER ───────────────────────────────────────────────
export function render(state) {
  const el = document.getElementById('page-dashboard');
  const cur = App.currency();
  const period = App.cyclePeriod();
  const prefs = state.prefs;
  const stats = computeStats(state, period);

  const cardOrder = prefs.dash?.cardOrder?.length ? prefs.dash.cardOrder : DEFAULT_CARD_ORDER;
  const cardVisibility = prefs.dash?.cards || {};
  const visibleCards = cardOrder.filter(id => {
    if (cardVisibility[id] === false) return false;
    if (id === 'runway' && App.cycleMode() === 'month') return false;
    return true;
  });
  const sections = prefs.dash?.sections || { breakdown: true, cashflow: true, recent: true };

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-subtitle">${escHtml(period.label)}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" id="dash-customize-btn">⚙ Customize</button>
        <button class="btn btn-primary" id="dash-add-tx-btn">+ Add transaction</button>
      </div>
    </div>

    ${renderStatGrid(visibleCards, stats, cur)}

    ${sections.breakdown ? `<div class="section">
      <div class="section-header">
        <div class="section-title">Spending Breakdown</div>
        <div class="toggle-group">
          <button class="toggle-group-btn breakdown-tab active" data-view="nature">Nature</button>
          <button class="toggle-group-btn breakdown-tab" data-view="group">Group</button>
          <button class="toggle-group-btn breakdown-tab" data-view="sub">Subcategory</button>
          <button class="toggle-group-btn breakdown-tab" data-view="all">All</button>
        </div>
      </div>
      <div class="card" style="padding:0"><div id="breakdown-rows"></div></div>
    </div>` : ''}

    ${sections.cashflow ? `<div class="section">
      <div class="section-header">
        <div class="section-title">Cash Flow</div>
        <div class="text-sm text-muted">Last 6 periods</div>
      </div>
      <div class="card" style="position:relative;height:240px">
        <canvas id="cashflow-canvas"></canvas>
      </div>
    </div>` : ''}

    ${sections.recent ? renderRecentSection(state, cur) : ''}
  `;

  document.getElementById('dash-add-tx-btn')?.addEventListener('click', () => openTxModal(state));
  document.getElementById('dash-customize-btn')?.addEventListener('click', () =>
    openDashCustomize(state, cardOrder, cardVisibility, sections)
  );

  if (sections.breakdown) {
    renderBreakdownRows(state, period, cur, 'nature');
    el.querySelectorAll('.breakdown-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        el.querySelectorAll('.breakdown-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderBreakdownRows(state, period, cur, tab.dataset.view);
      });
    });
  }

  if (sections.cashflow) {
    setTimeout(() => drawCashflowChart(state, cur), 50);
  }
}

// ── STAT COMPUTATIONS ─────────────────────────────────────────
function computeStats(state, period) {
  const { transactions, accounts } = state;
  const { start, end } = period;
  const today = todayDate();

  const periodTx = transactions.filter(tx => {
    if (!isEffective(tx)) return false;
    const d = parseISO(tx.date);
    return d >= start && d <= end;
  });

  const sum = (type) => periodTx.filter(tx => tx.type === type).reduce((s, tx) => s + Number(tx.amount), 0);
  const income       = sum('income');
  const spending     = sum('spend');
  const saved        = sum('savings');
  const invested     = sum('investment');
  const withdrawn    = sum('withdrawal');
  const debt_payments = sum('debt_payment');

  const activeAcc = accounts.filter(a => !a.is_archived);
  const net_balance = activeAcc.filter(a => isLiquid(a))
    .reduce((s, a) => s + calcAccountBalance(a, transactions), 0);
  const net_worth = activeAcc
    .filter(a => ['checking','savings','investment','credit','cash'].includes(effectiveType(a)))
    .reduce((s, a) => s + calcAccountBalance(a, transactions), 0);
  const total_debt = activeAcc.filter(a => effectiveType(a) === 'loan')
    .reduce((s, a) => s + calcAccountBalance(a, transactions), 0);

  const pending = transactions.filter(tx =>
    tx.status === 'pending' && parseISO(tx.date) > today && parseISO(tx.date) <= end
  );
  const due_eop = pending
    .filter(tx => ['spend','debt_payment','savings','investment'].includes(tx.type))
    .reduce((s, tx) => s + Number(tx.amount), 0);
  const expected_eop = net_balance
    + pending.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0)
    - pending.filter(t => ['spend','debt_payment'].includes(t.type)).reduce((s, t) => s + Number(t.amount), 0);

  const daysElapsed = Math.max(1, Math.floor((today - start) / 86400000) + 1);
  const dailySpend = spending / daysElapsed;
  const runway = dailySpend > 0 ? net_balance / dailySpend : null;

  return { income, spending, saved, invested, withdrawn, debt_payments,
           net_balance, net_worth, total_debt, due_eop, expected_eop, runway };
}

// ── STAT GRID ─────────────────────────────────────────────────
const CARD_META = {
  income:        { label: 'Income' },
  spending:      { label: 'Spending' },
  saved:         { label: 'Saved' },
  invested:      { label: 'Invested' },
  withdrawn:     { label: 'Withdrawn' },
  debt_payments: { label: 'Debt Payments' },
  net_balance:   { label: 'Net Balance' },
  net_worth:     { label: 'Net Worth' },
  total_debt:    { label: 'Total Debt' },
  due_eop:       { label: null }, // dynamic
  expected_eop:  { label: null }, // dynamic
  runway:        { label: 'Salary Runway' },
};

function gridCols(n) {
  if (n <= 3) return n;
  if (n === 4) return 2;  // 2+2 — symmetric
  if (n <= 6)  return 3;  // 3+2 or 3+3
  if (n <= 8)  return 4;  // 4+3 or 4+4
  if (n === 9) return 3;  // 3+3+3
  return 4;
}

function renderStatGrid(visibleCards, stats, cur) {
  if (!visibleCards.length) return '';
  const n = visibleCards.length;
  const cols = gridCols(n);
  const mode = App.cycleMode();

  const cards = visibleCards.map(id => {
    const val = stats[id];
    let label = CARD_META[id]?.label || id;
    let display, colorClass = '';

    if (id === 'runway') {
      if (val === null) { display = '—'; colorClass = 'text-muted'; }
      else {
        const days = Math.round(val);
        display = `${days}d`;
        colorClass = days > 14 ? 'c-green' : days > 7 ? 'c-amber' : 'c-red';
      }
    } else if (id === 'due_eop') {
      label = mode === 'month' ? 'Due till end of month' : 'Due till next salary';
      display = fmtCurrency(val, cur);
      colorClass = 'c-amber';
    } else if (id === 'expected_eop') {
      label = mode === 'month' ? 'Expected end of month' : 'Expected end of cycle';
      display = fmtCurrency(val, cur);
      colorClass = val >= 0 ? 'c-green' : 'c-red';
    } else if (id === 'spending' || id === 'debt_payments' || id === 'total_debt') {
      display = fmtCurrency(val, cur);
      colorClass = val > 0 ? 'c-red' : '';
    } else if (id === 'income' || id === 'saved') {
      display = fmtCurrency(val, cur);
      colorClass = val > 0 ? 'c-green' : '';
    } else if (id === 'net_balance' || id === 'net_worth') {
      display = fmtCurrency(val, cur);
      colorClass = val < 0 ? 'c-red' : '';
    } else {
      display = fmtCurrency(val, cur);
    }

    return `<div class="card card-sm">
      <div class="card-title text-muted text-sm">${escHtml(label)}</div>
      <div class="card-value text-mono ${colorClass}">${display}</div>
    </div>`;
  });

  return `<div class="stat-grid" style="grid-template-columns:repeat(${cols},1fr)">${cards.join('')}</div>`;
}

// ── DASHBOARD CUSTOMIZE ───────────────────────────────────────
function openDashCustomize(state, cardOrder, cardVisibility, sections) {
  const html = `
    <div style="display:flex;flex-direction:column;gap:1rem">
      <div>
        <div class="form-label" style="margin-bottom:.5rem">Sections</div>
        <div style="display:flex;flex-direction:column;gap:.4rem">
          ${[['breakdown','Spending Breakdown'],['cashflow','Cash Flow Chart'],['recent','Recent Transactions']].map(([k,l]) =>
            `<label class="form-check" style="display:flex;align-items:center;gap:.5rem;cursor:pointer">
              <input type="checkbox" class="dash-section-toggle" data-section="${k}" ${sections[k] !== false ? 'checked' : ''} />
              ${l}
            </label>`
          ).join('')}
        </div>
      </div>
      <div>
        <div class="form-label" style="margin-bottom:.5rem">Stat tiles — drag to reorder, toggle to show/hide</div>
        <div id="dash-tile-list" style="display:flex;flex-direction:column;gap:3px">
          ${cardOrder.map(id => {
            const label = CARD_META[id]?.label || id;
            const on = cardVisibility[id] !== false;
            return `<div class="dash-tile-row" data-id="${id}"
              style="display:flex;align-items:center;gap:.5rem;padding:.4rem .6rem;
                     border:1px solid var(--border);border-radius:var(--radius);
                     background:var(--surface);cursor:default">
              <span style="cursor:grab;color:var(--text-muted);user-select:none">⠿</span>
              <label style="flex:1;display:flex;align-items:center;gap:.5rem;cursor:pointer;margin:0">
                <input type="checkbox" data-id="${id}" ${on ? 'checked' : ''} style="margin:0" />
                ${escHtml(label)}
              </label>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Cancel</button>
        <button type="button" class="btn btn-primary" id="dash-customize-save">Save</button>
      </div>
    </div>`;

  App.openModal('Customize Dashboard', html);

  // Wire tile drag reorder
  const tileList = document.getElementById('dash-tile-list');
  if (tileList) {
    let src = null;
    tileList.querySelectorAll('.dash-tile-row').forEach(row => {
      row.setAttribute('draggable', 'true');
      row.addEventListener('dragstart', e => {
        src = row; e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => { if (src) src.style.opacity = '0.4'; }, 0);
      });
      row.addEventListener('dragend', () => { if (src) src.style.opacity = '1'; src = null; });
      row.addEventListener('dragover', e => {
        if (!src || src === row) return;
        e.preventDefault();
        const mid = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
        if (e.clientY < mid) tileList.insertBefore(src, row);
        else row.after(src);
      });
    });
  }

  document.getElementById('dash-customize-save')?.addEventListener('click', async () => {
    const newOrder = [...tileList.querySelectorAll('.dash-tile-row')].map(r => r.dataset.id);
    const cards = {};
    tileList.querySelectorAll('input[type="checkbox"]').forEach(cb => { cards[cb.dataset.id] = cb.checked; });
    const newSections = {};
    document.querySelectorAll('.dash-section-toggle').forEach(cb => { newSections[cb.dataset.section] = cb.checked; });

    const dash = { cardOrder: newOrder, cards, sections: newSections };
    const newPrefs = { ...state.prefs, dash };
    const { error } = await App.supabase.from('profiles')
      .update({ preferences: newPrefs }).eq('id', state.user.id);
    if (!error) {
      state.prefs.dash = dash;
      App.closeModal();
      App.refreshCurrentPage();
      App.toast('Dashboard saved', 'success');
    } else {
      App.toast('Error: ' + error.message, 'error');
    }
  });
}

// ── SPENDING BREAKDOWN ────────────────────────────────────────
function renderBreakdownRows(state, period, cur, view) {
  const container = document.getElementById('breakdown-rows');
  if (!container) return;

  const { transactions, categories } = state;
  const { start, end } = period;

  const spendTx = transactions.filter(tx =>
    isEffective(tx) && tx.type === 'spend' &&
    parseISO(tx.date) >= start && parseISO(tx.date) <= end
  );
  const total = spendTx.reduce((s, tx) => s + Number(tx.amount), 0);

  if (total === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:2rem">No spending this period</div>`;
    return;
  }

  let rows = [];

  if (view === 'nature') {
    const map = {};
    for (const tx of spendTx) {
      const cat = categories.find(c => c.id === tx.category_id);
      const key = cat?.nature || 'Uncategorised';
      map[key] = (map[key] || 0) + Number(tx.amount);
    }
    rows = Object.entries(map).sort((a,b) => b[1] - a[1]);

  } else if (view === 'group') {
    const map = {};
    for (const tx of spendTx) {
      const cat = categories.find(c => c.id === tx.category_id);
      if (!cat) { map['Uncategorised'] = (map['Uncategorised'] || 0) + Number(tx.amount); continue; }
      const group = cat.parent_id ? (categories.find(c => c.id === cat.parent_id) || cat) : cat;
      const key = `${group.icon || ''} ${group.name}`.trim();
      map[key] = (map[key] || 0) + Number(tx.amount);
    }
    rows = Object.entries(map).sort((a,b) => b[1] - a[1]);

  } else if (view === 'all') {
    // Every individual transaction
    rows = spendTx
      .sort((a, b) => b.amount - a.amount)
      .map(tx => {
        const cat = categories.find(c => c.id === tx.category_id);
        const name = `${tx.description || ''}${cat ? ' · ' + (cat.icon || '') + ' ' + cat.name : ''}`.trim();
        return [name || '—', Number(tx.amount)];
      });
  } else {
    const map = {};
    for (const tx of spendTx) {
      const cat = categories.find(c => c.id === tx.category_id);
      const key = cat ? `${cat.icon || ''} ${cat.name}`.trim() : 'Uncategorised';
      map[key] = (map[key] || 0) + Number(tx.amount);
    }
    rows = Object.entries(map).sort((a,b) => b[1] - a[1]);
  }

  container.innerHTML = rows.map(([name, amt]) => {
    const pct = (amt / total * 100).toFixed(1);
    return `<div style="padding:.65rem 1rem;border-bottom:1px solid var(--border)">
      <div class="flex justify-between items-center" style="margin-bottom:.3rem">
        <span class="text-sm">${escHtml(name)}</span>
        <span class="text-mono text-sm">${fmtCurrency(amt, cur)}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${pct}%;background:var(--accent)"></div>
      </div>
    </div>`;
  }).join('') + `<div class="flex justify-between items-center" style="padding:.65rem 1rem;font-weight:600">
    <span>Total</span><span class="text-mono">${fmtCurrency(total, cur)}</span>
  </div>`;
}

// ── CASHFLOW CHART ────────────────────────────────────────────
function drawCashflowChart(state, cur) {
  const canvas = document.getElementById('cashflow-canvas');
  if (!canvas || !window.Chart) return;

  const { transactions, profiles } = state;
  const pa = profiles[0]?.preferences?.salary_day;
  const pb = profiles[1]?.preferences?.salary_day;
  const periods = getPeriods(App.cycleMode(), { salary_day_a: pa, salary_day_b: pb }, 6);

  const labels = periods.map(p => p.label);
  const incomeData = [], spendData = [], savedData = [];

  for (const p of periods) {
    const ptx = transactions.filter(tx =>
      isEffective(tx) && parseISO(tx.date) >= p.start && parseISO(tx.date) <= p.end
    );
    incomeData.push(ptx.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount), 0));
    spendData.push(ptx.filter(t => t.type === 'spend').reduce((s,t) => s + Number(t.amount), 0));
    savedData.push(ptx.filter(t => t.type === 'savings').reduce((s,t) => s + Number(t.amount), 0));
  }

  if (cashflowChart) { cashflowChart.destroy(); cashflowChart = null; }

  cashflowChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income',   data: incomeData, backgroundColor: '#22c55e99' },
        { label: 'Spending', data: spendData,  backgroundColor: '#ef444499' },
        { label: 'Saved',    data: savedData,  backgroundColor: '#3b82f699' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#8b90a8', font: { family: 'DM Sans' } } },
        tooltip: { callbacks: { label: ctx => ` ${fmtCurrency(ctx.raw, cur)}` } },
      },
      scales: {
        x: { ticks: { color: '#8b90a8' }, grid: { color: '#2a2e3f40' } },
        y: {
          ticks: { color: '#8b90a8', callback: v => fmtCurrency(v, cur) },
          grid: { color: '#2a2e3f40' },
        },
      },
    },
  });
}

// ── RECENT TRANSACTIONS ───────────────────────────────────────
function renderRecentSection(state, cur) {
  const { transactions, categories } = state;
  const recent = transactions.filter(tx => tx.status === 'confirmed').slice(0, 7);

  if (!recent.length) {
    return `<div class="section">
      <div class="section-header"><div class="section-title">Recent Transactions</div></div>
      <div class="card"><div class="empty-state">No confirmed transactions yet</div></div>
    </div>`;
  }

  return `<div class="section">
    <div class="section-header">
      <div class="section-title">Recent Transactions</div>
      <button class="btn btn-ghost btn-sm" onclick="App.navigate('transactions')">View all →</button>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Date</th><th>Description</th><th>Category</th><th class="amount-col">Amount</th>
          </tr></thead>
          <tbody>
            ${recent.map(tx => {
              const cat = categories.find(c => c.id === tx.category_id);
              const isNeg = ['spend','savings','investment','transfer','debt_payment'].includes(tx.type);
              return `<tr>
                <td class="text-muted text-sm" style="white-space:nowrap">${fmtRelDate(tx.date)}</td>
                <td class="truncate" style="max-width:200px">${escHtml(tx.description || '—')}</td>
                <td class="text-sm text-muted">${cat ? escHtml(cat.icon + ' ' + cat.name) : '<span class="badge badge-neutral">—</span>'}</td>
                <td class="amount-col text-mono ${isNeg ? 'negative' : 'positive'}">${isNeg ? '−' : '+'}${fmtCurrency(tx.amount, cur)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}
