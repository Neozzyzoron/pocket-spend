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
let breakdownChart = null;
let allTxChart = null;

const CHART_COLORS = [
  '#3b82f6','#f59e0b','#22c55e','#ef4444','#a855f7',
  '#06b6d4','#f97316','#ec4899','#84cc16','#6366f1',
];

// ── MAIN RENDER ───────────────────────────────────────────────
export function render(state) {
  const el = document.getElementById('page-dashboard');
  const cur = App.currency();
  const period = App.cyclePeriod();
  const prefs = state.prefs;
  const stats = computeStats(state, period);
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

    ${renderSummaryTiles(stats, cur)}

    ${sections.breakdown ? `<div class="section">
      <div class="section-header">
        <div class="section-title">Breakdown</div>
        <div class="toggle-group">
          <button class="toggle-group-btn breakdown-tab active" data-view="nature">Nature</button>
          <button class="toggle-group-btn breakdown-tab" data-view="group">Group</button>
          <button class="toggle-group-btn breakdown-tab" data-view="sub">Subcategory</button>
          <button class="toggle-group-btn breakdown-tab" data-view="all">All</button>
        </div>
      </div>
      <div id="breakdown-rows" style="display:flex;gap:1rem;flex-wrap:wrap"></div>
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

    ${sections.recent ? renderRecentSection(state, cur, period) : ''}
  `;

  document.getElementById('dash-add-tx-btn')?.addEventListener('click', () => openTxModal(state));
  document.getElementById('dash-customize-btn')?.addEventListener('click', () =>
    openDashCustomize(state, sections)
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
  const incomeTx     = periodTx.filter(tx => tx.type === 'income');
  const income       = incomeTx.reduce((s, tx) => s + Number(tx.amount), 0);
  const income_fixed = incomeTx.filter(tx => tx.is_recurring).reduce((s, tx) => s + Number(tx.amount), 0);
  const income_extra = income - income_fixed;
  const direct_spend  = sum('spend');
  const commitments   = sum('savings') + sum('investment') + sum('debt_payment');
  const total_expenses = direct_spend + commitments;
  // keep legacy aliases for cashflow chart & other sections
  const spending     = direct_spend;
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

  // Savings & investment balances — derived from transactions only (no opening_balance)
  const savingsAccIds = new Set(activeAcc.filter(a => effectiveType(a) === 'savings').map(a => a.id));
  const investAccIds  = new Set(activeAcc.filter(a => effectiveType(a) === 'investment').map(a => a.id));

  const allEffective = transactions.filter(tx => isEffective(tx));
  const savings_balance = allEffective.reduce((s, tx) => {
    if (tx.type === 'savings') return s + Number(tx.amount);
    if (tx.type === 'withdrawal' && savingsAccIds.has(tx.account_id)) return s - Number(tx.amount);
    return s;
  }, 0);
  const investment_balance = allEffective.reduce((s, tx) => {
    if (tx.type === 'investment') return s + Number(tx.amount);
    if (tx.type === 'withdrawal' && investAccIds.has(tx.account_id)) return s - Number(tx.amount);
    return s;
  }, 0);

  const savings_withdrawn    = periodTx.filter(tx => tx.type === 'withdrawal' && savingsAccIds.has(tx.account_id))
    .reduce((s, tx) => s + Number(tx.amount), 0);
  const investment_withdrawn = periodTx.filter(tx => tx.type === 'withdrawal' && investAccIds.has(tx.account_id))
    .reduce((s, tx) => s + Number(tx.amount), 0);

  const pending = transactions.filter(tx =>
    tx.status === 'pending' && parseISO(tx.date) > today && parseISO(tx.date) <= end
  );
  const duePending = pending.filter(tx => ['spend','debt_payment','savings','investment'].includes(tx.type));
  const due_count  = duePending.length;
  const due_amount = duePending.reduce((s, tx) => s + Number(tx.amount), 0);
  const period_net    = income - total_expenses;
  const expected_eop  = period_net - due_amount;

  const daysElapsed = Math.max(1, Math.floor((today - start) / 86400000) + 1);
  const dailySpend = spending / daysElapsed;
  const runway = dailySpend > 0 ? period_net / dailySpend : null;

  return { income, income_fixed, income_extra,
           total_expenses, direct_spend, commitments, period_net,
           spending, saved, invested, withdrawn, debt_payments,
           net_balance, net_worth, total_debt,
           savings_balance, savings_withdrawn,
           investment_balance, investment_withdrawn,
           due_count, due_amount, expected_eop, runway };
}

// ── SUMMARY TILES ─────────────────────────────────────────────
function renderSummaryTiles(stats, cur) {
  const {
    income, income_fixed, income_extra,
    total_expenses, direct_spend, commitments, period_net,
    net_worth,
    savings_balance, saved, savings_withdrawn,
    investment_balance, invested, investment_withdrawn,
    debt_payments, total_debt,
    due_count, due_amount, expected_eop, runway,
  } = stats;

  const netColor  = period_net > 0 ? '#16a34a' : period_net < 0 ? '#dc2626' : 'var(--text)';
  const netBorder = period_net > 0 ? '#16a34a' : period_net < 0 ? '#dc2626' : 'var(--border)';
  const eopColor  = expected_eop > 0 ? '#4ade80' : expected_eop < 0 ? '#f87171' : 'var(--text2)';
  const mode = App.cycleMode();
  const dueLabel = mode === 'month' ? 'Due till end of month' : 'Due till next cycle';

  function sub(label, value) {
    return `<div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--text2)">
      <span>${label}</span><span class="text-mono">${fmtCurrency(value, cur)}</span>
    </div>`;
  }
  function subColored(label, value, color) {
    return `<div style="display:flex;justify-content:space-between;font-size:.72rem">
      <span style="color:var(--text2)">${label}</span>
      <span class="text-mono" style="color:${color}">${fmtCurrency(value, cur)}</span>
    </div>`;
  }
  function subText(label, text, color) {
    return `<div style="display:flex;justify-content:space-between;font-size:.72rem">
      <span style="color:var(--text2)">${label}</span>
      <span class="text-mono" style="color:${color || 'var(--text2)'}">${text}</span>
    </div>`;
  }

  const tiles = [
    // Income — dark green
    `<div class="card card-sm" style="border-left:3px solid #166534">
      <div class="card-title text-sm" style="color:#166534">Income</div>
      <div class="card-value text-mono" style="color:#166534">${fmtCurrency(income, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${sub('Fixed', income_fixed)}
        ${sub('Extra', income_extra)}
      </div>
    </div>`,

    // Expenses — dark orange
    `<div class="card card-sm" style="border-left:3px solid #c2410c">
      <div class="card-title text-sm" style="color:#c2410c">Expenses</div>
      <div class="card-value text-mono" style="color:#c2410c">${fmtCurrency(total_expenses, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${sub('Direct spend', direct_spend)}
        ${sub('Commitments', commitments)}
      </div>
    </div>`,

    // Net Balance — period income minus all expenses
    `<div class="card card-sm" style="border-left:3px solid ${netBorder}">
      <div class="card-title text-sm text-muted">Net Balance</div>
      <div class="card-value text-mono" style="color:${netColor}">${fmtCurrency(period_net, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${sub('Net worth', net_worth)}
      </div>
    </div>`,

    // Due Till Next Cycle — amber
    `<div class="card card-sm" style="border-left:3px solid #d97706">
      <div class="card-title text-sm" style="color:#d97706">${dueLabel}</div>
      <div class="card-value text-mono" style="color:#d97706">${fmtCurrency(due_amount, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${subText('Transactions due', `${due_count} tx`, 'var(--text2)')}
        ${subColored('Exp. balance', expected_eop, eopColor)}
        ${runway !== null ? subText('Runway', `${Math.round(runway)}d`, runway > 14 ? '#4ade80' : runway > 7 ? '#fbbf24' : '#f87171') : ''}
      </div>
    </div>`,

    // Savings — blue
    `<div class="card card-sm" style="border-left:3px solid #1d4ed8">
      <div class="card-title text-sm" style="color:#1d4ed8">Savings</div>
      <div class="card-value text-mono" style="color:#1d4ed8">${fmtCurrency(savings_balance, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${sub('Contributed', saved)}
        ${sub('Withdrawn', savings_withdrawn)}
      </div>
    </div>`,

    // Investments — purple
    `<div class="card card-sm" style="border-left:3px solid #7c3aed">
      <div class="card-title text-sm" style="color:#7c3aed">Investments</div>
      <div class="card-value text-mono" style="color:#7c3aed">${fmtCurrency(investment_balance, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${sub('Contributed', invested)}
        ${sub('Withdrawn', investment_withdrawn)}
      </div>
    </div>`,

    // Debt Payments — dark red
    `<div class="card card-sm" style="border-left:3px solid #991b1b">
      <div class="card-title text-sm" style="color:#991b1b">Debt Payments</div>
      <div class="card-value text-mono" style="color:#991b1b">${fmtCurrency(debt_payments, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${sub('Total debt', total_debt)}
      </div>
    </div>`,
  ];

  return `<div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">${tiles.join('')}</div>`;
}

// ── DASHBOARD CUSTOMIZE ───────────────────────────────────────
function openDashCustomize(state, sections) {
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
      <div class="btn-row">
        <button type="button" class="btn btn-ghost" onclick="App.closeModal()">Cancel</button>
        <button type="button" class="btn btn-primary" id="dash-customize-save">Save</button>
      </div>
    </div>`;

  App.openModal('Customize Dashboard', html);

  document.getElementById('dash-customize-save')?.addEventListener('click', async () => {
    const newSections = {};
    document.querySelectorAll('.dash-section-toggle').forEach(cb => { newSections[cb.dataset.section] = cb.checked; });

    const dash = { ...state.prefs.dash, sections: newSections };
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
const NATURE_LABEL = {
  savings: 'Savings', investment: 'Investments', debt_payment: 'Debt Payments',
  income: 'Income', withdrawal: 'Withdrawal',
};
const EXPENSE_TYPES = ['spend','savings','investment','debt_payment'];
const ALL_TYPES     = ['income','spend','savings','investment','debt_payment','withdrawal'];

function buildRows(txList, view, categories) {
  if (view === 'nature') {
    const map = {};
    for (const tx of txList) {
      const key = NATURE_LABEL[tx.type] || (categories.find(c => c.id === tx.category_id)?.nature) || 'Uncategorised';
      map[key] = (map[key] || 0) + Number(tx.amount);
    }
    return Object.entries(map).sort((a,b) => b[1]-a[1]);
  }
  if (view === 'group') {
    const map = {};
    for (const tx of txList) {
      const cat = categories.find(c => c.id === tx.category_id);
      const key = cat
        ? (() => { const g = cat.parent_id ? (categories.find(c => c.id === cat.parent_id) || cat) : cat; return `${g.icon||''} ${g.name}`.trim(); })()
        : (NATURE_LABEL[tx.type] || 'Uncategorised');
      map[key] = (map[key] || 0) + Number(tx.amount);
    }
    return Object.entries(map).sort((a,b) => b[1]-a[1]);
  }
  if (view === 'all') {
    return txList.sort((a,b) => b.amount - a.amount).map(tx => {
      const cat = categories.find(c => c.id === tx.category_id);
      const name = `${tx.description || ''}${cat ? ' · '+(cat.icon||'')+' '+cat.name : ''}`.trim();
      return [name || '—', Number(tx.amount)];
    });
  }
  // subcategory
  const map = {};
  for (const tx of txList) {
    const cat = categories.find(c => c.id === tx.category_id);
    const key = cat ? `${cat.icon||''} ${cat.name}`.trim() : (NATURE_LABEL[tx.type] || 'Uncategorised');
    map[key] = (map[key] || 0) + Number(tx.amount);
  }
  return Object.entries(map).sort((a,b) => b[1]-a[1]);
}

function renderPanel(html, canvasId, rows, total, cur, getChart, setChart) {
  html; // rendered in caller
  setTimeout(() => {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    const existing = getChart();
    if (existing) { existing.destroy(); }
    const colors = rows.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
    setChart(new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: rows.map(([name]) => name),
        datasets: [{ data: rows.map(([,amt]) => amt), backgroundColor: colors, borderWidth: 2, borderColor: 'var(--surface)' }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmtCurrency(ctx.raw, cur)} (${(ctx.raw/total*100).toFixed(1)}%)` }},
        },
      },
    }));
  }, 50);
}

function panelHtml(rows, total, cur, canvasId) {
  const colors = rows.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
  return `<div style="display:flex;align-items:center;gap:1rem;padding:.75rem;flex-wrap:wrap">
    <div style="position:relative;width:160px;height:160px;flex-shrink:0"><canvas id="${canvasId}"></canvas></div>
    <div style="flex:1;min-width:150px;display:flex;flex-direction:column">
      ${rows.map(([name,amt],i) => `<div style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border)">
          <span style="width:8px;height:8px;border-radius:50%;background:${colors[i]};flex-shrink:0"></span>
          <span class="text-sm" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(name)}">${escHtml(name)}</span>
          <span class="text-mono text-sm">${fmtCurrency(amt,cur)}</span>
          <span class="text-muted" style="font-size:.65rem;width:3rem;text-align:right">${(amt/total*100).toFixed(1)}%</span>
        </div>`).join('')}
      <div style="display:flex;justify-content:space-between;padding:.4rem 0;font-weight:600;font-size:.8rem">
        <span>Total</span><span class="text-mono">${fmtCurrency(total,cur)}</span>
      </div>
    </div>
  </div>`;
}

function renderBreakdownRows(state, period, cur, view) {
  const container = document.getElementById('breakdown-rows');
  if (!container) return;

  const { transactions, categories } = state;
  const { start, end } = period;

  const inPeriod = (tx) => isEffective(tx) && parseISO(tx.date) >= start && parseISO(tx.date) <= end;
  const expenseTx = transactions.filter(tx => inPeriod(tx) && EXPENSE_TYPES.includes(tx.type));
  const allTx     = transactions.filter(tx => inPeriod(tx) && ALL_TYPES.includes(tx.type));

  const expenseTotal = expenseTx.reduce((s,tx) => s + Number(tx.amount), 0);
  const allTotal     = allTx.reduce((s,tx) => s + Number(tx.amount), 0);

  if (expenseTotal === 0 && allTotal === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:2rem">No transactions this period</div>`;
    return;
  }

  const expenseRows = expenseTotal > 0 ? buildRows(expenseTx, view, categories) : [];
  const allRows     = allTotal > 0     ? buildRows(allTx,     view, categories) : [];

  container.innerHTML = `
    <div class="card" style="flex:1;min-width:280px;padding:0">
      <div style="padding:.6rem 1rem .3rem;font-weight:600;font-size:.8rem;color:var(--text2);border-bottom:1px solid var(--border)">Expenses</div>
      ${expenseRows.length ? panelHtml(expenseRows, expenseTotal, cur, 'breakdown-canvas') : '<div class="empty-state" style="padding:1.5rem">No expenses</div>'}
    </div>
    <div class="card" style="flex:1;min-width:280px;padding:0">
      <div style="padding:.6rem 1rem .3rem;font-weight:600;font-size:.8rem;color:var(--text2);border-bottom:1px solid var(--border)">All Transactions</div>
      ${allRows.length ? panelHtml(allRows, allTotal, cur, 'alltx-canvas') : '<div class="empty-state" style="padding:1.5rem">No transactions</div>'}
    </div>`;

  if (expenseRows.length) renderPanel('', 'breakdown-canvas', expenseRows, expenseTotal, cur, () => breakdownChart, c => { breakdownChart = c; });
  if (allRows.length)     renderPanel('', 'alltx-canvas',     allRows,     allTotal,     cur, () => allTxChart,     c => { allTxChart = c; });
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

// ── PERIOD TRANSACTIONS ───────────────────────────────────────
function renderRecentSection(state, cur, period) {
  const { transactions, categories } = state;
  const { start, end } = period;

  const periodTx = transactions.filter(tx => {
    const d = parseISO(tx.date);
    return d >= start && d <= end;
  }).slice(0, 50); // cap at 50 rows

  if (!periodTx.length) {
    return `<div class="section">
      <div class="section-header"><div class="section-title">This Period</div></div>
      <div class="card"><div class="empty-state">No transactions this period</div></div>
    </div>`;
  }

  return `<div class="section">
    <div class="section-header">
      <div class="section-title">This Period</div>
      <button class="btn btn-ghost btn-sm" onclick="App.navigate('transactions')">View all →</button>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Date</th><th>Description</th><th>Category</th><th>Type</th><th class="amount-col">Amount</th>
          </tr></thead>
          <tbody>
            ${periodTx.map(tx => {
              const cat = categories.find(c => c.id === tx.category_id);
              const isNeg = ['spend','savings','investment','transfer','debt_payment'].includes(tx.type);
              const isPending = tx.status === 'pending';
              return `<tr class="${isPending ? 'text-muted' : ''}">
                <td class="text-sm" style="white-space:nowrap">${fmtRelDate(tx.date)}</td>
                <td class="truncate" style="max-width:200px">${escHtml(tx.description || '—')}${isPending ? ' <span class="badge badge-pending" style="font-size:.65rem">Pending</span>' : ''}</td>
                <td class="text-sm text-muted">${cat ? escHtml((cat.icon || '') + ' ' + cat.name) : '<span class="text-muted">—</span>'}</td>
                <td class="text-sm text-muted">${tx.type}</td>
                <td class="amount-col text-mono ${isNeg ? 'negative' : 'positive'}">${isNeg ? '−' : '+'}${fmtCurrency(tx.amount, cur)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}
