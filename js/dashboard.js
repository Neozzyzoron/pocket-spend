/* ═══════════════════════════════════════════════════════════════
   dashboard.js — Dashboard page
   Sections: stat cards, spending breakdown, cashflow chart, recent tx
═══════════════════════════════════════════════════════════════ */

import {
  fmtCurrency, fmtRelDate, getPeriods,
  isEffective, effectiveType, isLiquid, calcAccountBalance,
  buildCategoryTree, escHtml, parseISO, todayDate, TX_TYPE_LABELS,
} from './utils.js';
import { openTxModal } from './transactions.js';

let cashflowChart = null;
let breakdownChart = null;
let allTxChart = null;

const CHART_COLORS = [
  '#3b82f6','#f59e0b','#22c55e','#ef4444','#a855f7',
  '#06b6d4','#f97316','#ec4899','#84cc16','#6366f1',
];

// Cross-hatch canvas pattern for balance bar
function crossHatch(color) {
  const sz = 8;
  const c = document.createElement('canvas');
  c.width = sz; c.height = sz;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = color; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(sz,sz); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sz,0); ctx.lineTo(0,sz); ctx.stroke();
  return ctx.createPattern(c, 'repeat');
}

// Shared color palette — used consistently across tiles, charts, nature breakdown
const CLR = {
  income:  '#22c55ebf',
  spend:   '#ef4444bf',
  debt:    '#dc2626bf',
  savings: '#3b82f6bf',
  invest:  '#8b5cf6bf',
  balance: '#f59e0bbf',
  neutral: '#6b7280bf',
  due:     '#b45309bf',
};

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
          <button class="toggle-group-btn breakdown-tab active" data-view="summary">Summary</button>
          <button class="toggle-group-btn breakdown-tab" data-view="nature">Nature</button>
          <button class="toggle-group-btn breakdown-tab" data-view="group">Group</button>
          <button class="toggle-group-btn breakdown-tab" data-view="sub">Subcategory</button>
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
    renderBreakdownRows(state, period, cur, 'summary');
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
  const debt_payments = sum('debt_payment');
  const total_expenses = direct_spend + debt_payments;
  // keep legacy aliases
  const spending     = direct_spend;
  const saved        = sum('savings');
  const invested     = sum('investment');
  const withdrawn    = sum('withdrawal');

  const activeAcc = accounts.filter(a => !a.is_archived && !a.is_excluded);
  const net_balance = activeAcc.filter(a => isLiquid(a))
    .reduce((s, a) => s + calcAccountBalance(a, transactions), 0);
  const net_worth = activeAcc
    .filter(a => ['checking','savings','investment','credit','cash','benefits'].includes(effectiveType(a)))
    .reduce((s, a) => s + calcAccountBalance(a, transactions), 0);
  const total_debt = activeAcc.filter(a => effectiveType(a) === 'loan')
    .reduce((s, a) => s + calcAccountBalance(a, transactions), 0);

  // Savings & investment — actual account balances
  const savings_balance    = activeAcc.filter(a => effectiveType(a) === 'savings')
    .reduce((s, a) => s + calcAccountBalance(a, transactions), 0);
  const investment_balance = activeAcc.filter(a => effectiveType(a) === 'investment')
    .reduce((s, a) => s + calcAccountBalance(a, transactions), 0);

  const savingsAccIds = new Set(activeAcc.filter(a => effectiveType(a) === 'savings').map(a => a.id));
  const investAccIds  = new Set(activeAcc.filter(a => effectiveType(a) === 'investment').map(a => a.id));

  const savings_withdrawn    = periodTx.filter(tx => tx.type === 'withdrawal' && savingsAccIds.has(tx.account_id))
    .reduce((s, tx) => s + Number(tx.amount), 0);
  const investment_withdrawn = periodTx.filter(tx => tx.type === 'withdrawal' && investAccIds.has(tx.account_id))
    .reduce((s, tx) => s + Number(tx.amount), 0);

  const pending = transactions.filter(tx =>
    tx.status === 'pending' && parseISO(tx.date) > today && parseISO(tx.date) <= end
  );
  const duePending = pending.filter(tx => ['spend','debt_payment'].includes(tx.type));
  const due_count  = duePending.length;
  const due_amount = duePending.reduce((s, tx) => s + Number(tx.amount), 0);
  const period_net    = income - total_expenses;
  const incl_savings  = period_net + (saved - savings_withdrawn);
  const expected_eop  = period_net - due_amount;

  const daysElapsed = Math.max(1, Math.floor((today - start) / 86400000) + 1);
  const dailySpend = spending / daysElapsed;
  const runway = dailySpend > 0 ? period_net / dailySpend : null;

  return { income, income_fixed, income_extra, incl_savings,
           total_expenses, direct_spend, debt_payments, period_net,
           spending, saved, invested, withdrawn,
           net_balance, net_worth, total_debt,
           savings_balance, savings_withdrawn,
           investment_balance, investment_withdrawn,
           due_count, due_amount, expected_eop, runway };
}

// ── SUMMARY TILES ─────────────────────────────────────────────
function renderSummaryTiles(stats, cur) {
  const {
    income, income_fixed, income_extra,
    total_expenses, direct_spend, debt_payments, period_net, incl_savings,
    net_worth,
    savings_balance, saved, savings_withdrawn,
    investment_balance, invested, investment_withdrawn,
    total_debt,
    due_count, due_amount, expected_eop, runway,
  } = stats;

  const netColor = period_net > 0 ? CLR.income : period_net < 0 ? CLR.spend : 'var(--text)';
  const eopColor = expected_eop > 0 ? CLR.income : expected_eop < 0 ? CLR.spend : 'var(--text2)';
  const mode = App.cycleMode();
  const dueLabel = mode === 'month' ? 'Due till end of month' : 'Due till next cycle';

  const subStyle = 'display:flex;justify-content:space-between;font-size:1.2rem;color:var(--text2)';
  const sub     = (label, value) => `<div style="${subStyle}"><span>${label}</span><span class="text-mono">${fmtCurrency(value, cur)}</span></div>`;
  const subColored = sub;
  const subText = (label, text) => `<div style="${subStyle}"><span>${label}</span><span class="text-mono">${text}</span></div>`;

  const tiles = [
    `<div class="card card-sm" style="border-left:3px solid ${CLR.income}">
      <div class="card-title text-sm" style="color:${CLR.income}">Income</div>
      <div class="card-value text-mono" style="color:${CLR.income}">${fmtCurrency(income, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${sub('Fixed', income_fixed)}
        ${sub('Extra', income_extra)}
      </div>
    </div>`,

    `<div class="card card-sm" style="border-left:3px solid ${CLR.spend}">
      <div class="card-title text-sm" style="color:${CLR.spend}">Spend</div>
      <div class="card-value text-mono" style="color:${CLR.spend}">${fmtCurrency(total_expenses, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${sub('Direct spend', direct_spend)}
        ${sub('Debt pmts', debt_payments)}
      </div>
    </div>`,

    `<div class="card card-sm" style="border-left:3px solid ${CLR.neutral}">
      <div class="card-title text-sm" style="color:${CLR.neutral}">Net Balance</div>
      <div class="card-value text-mono" style="color:${netColor}">${fmtCurrency(period_net, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${subColored('Incl. savings', incl_savings)}
        ${sub('Net worth', net_worth)}
      </div>
    </div>`,

    `<div class="card card-sm" style="border-left:3px solid ${CLR.due}">
      <div class="card-title text-sm" style="color:${CLR.due}">${dueLabel}</div>
      <div class="card-value text-mono" style="color:${CLR.due}">${fmtCurrency(due_amount, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${subColored('Exp. balance', expected_eop)}
        ${runway !== null ? subText('Runway', `${Math.round(runway)}d`) : ''}
      </div>
    </div>`,

    `<div class="card card-sm" style="border-left:3px solid ${CLR.savings}">
      <div class="card-title text-sm" style="color:${CLR.savings}">Savings</div>
      <div class="card-value text-mono" style="color:${CLR.savings}">${fmtCurrency(savings_balance, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${sub('Contributed', saved)}
        ${sub('Withdrawn', savings_withdrawn)}
      </div>
    </div>`,

    `<div class="card card-sm" style="border-left:3px solid ${CLR.invest}">
      <div class="card-title text-sm" style="color:${CLR.invest}">Investments</div>
      <div class="card-value text-mono" style="color:${CLR.invest}">${fmtCurrency(investment_balance, cur)}</div>
      <div style="margin-top:.5rem;padding-top:.4rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:.15rem">
        ${sub('Contributed', invested)}
        ${sub('Withdrawn', investment_withdrawn)}
      </div>
    </div>`,

  ];

  return `<div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">${tiles.join('')}</div>`;
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
  savings: 'Savings', investment: 'Investments', debt_payment: 'Debt',
  income: 'Income',
};
const NATURE_COLORS = {
  'Income':        CLR.income,
  'Debt':          CLR.debt,
  'Essentials':    '#b45309',
  'Variables':     '#d97706bf',
  'Discretionary': '#f59e0bbf',
  'Savings':       CLR.savings,
  'Investments':   CLR.invest,
};
const EXPENSE_TYPES = ['spend','savings','investment','debt_payment'];
const ALL_TYPES     = ['income','spend','savings','investment','debt_payment','withdrawal'];

function rowColor(row, i) {
  return row[2] || CHART_COLORS[i % CHART_COLORS.length];
}

// Returns [name, amount, color|null] tuples
function buildRows(txList, view, categories) {
  if (view === 'summary') {
    const BUCKET = {
      income:       ['Income', CLR.income ],
      spend:        ['Spend',  CLR.spend  ],
      debt_payment: ['Debt',   CLR.debt   ],
      savings:      ['S&I',    CLR.savings],
      investment:   ['S&I',    CLR.invest ],
      withdrawal:   ['S&I',    CLR.savings],
    };
    const map = {}, colorMap = {};
    for (const tx of txList) {
      const b = BUCKET[tx.type];
      if (!b) continue; // skip transfer, adjustment
      const [label, color] = b;
      map[label] = (map[label] || 0) + Number(tx.amount);
      if (!colorMap[label]) colorMap[label] = color;
    }
    return Object.entries(map).sort((a,b) => b[1]-a[1]).map(([n,v]) => [n, v, colorMap[n]]);
  }
  if (view === 'nature') {
    const map = {}, colorMap = {};
    for (const tx of txList) {
      const key = NATURE_LABEL[tx.type] || (categories.find(c => c.id === tx.category_id)?.nature) || 'Uncategorised';
      map[key] = (map[key] || 0) + Number(tx.amount);
      if (!colorMap[key]) colorMap[key] = NATURE_COLORS[key] || null;
    }
    return Object.entries(map).sort((a,b) => b[1]-a[1]).map(([n,v]) => [n, v, colorMap[n]]);
  }
  if (view === 'group') {
    const map = {}, colorMap = {};
    for (const tx of txList) {
      const cat = categories.find(c => c.id === tx.category_id);
      let key, color;
      if (cat) {
        const g = cat.parent_id ? (categories.find(c => c.id === cat.parent_id) || cat) : cat;
        key = `${g.icon||''} ${g.name}`.trim();
        color = g.color || null;
      } else {
        key = NATURE_LABEL[tx.type] || 'Uncategorised';
        color = NATURE_COLORS[key] || null;
      }
      map[key] = (map[key] || 0) + Number(tx.amount);
      if (color && !colorMap[key]) colorMap[key] = color;
    }
    return Object.entries(map).sort((a,b) => b[1]-a[1]).map(([n,v]) => [n, v, colorMap[n] || null]);
  }
  if (view === 'all') {
    return txList.sort((a,b) => b.amount - a.amount).map(tx => {
      const cat = categories.find(c => c.id === tx.category_id);
      const name = `${tx.description || ''}${cat ? ' · '+(cat.icon||'')+' '+cat.name : ''}`.trim();
      return [name || '—', Number(tx.amount), null];
    });
  }
  // subcategory
  const map = {}, colorMap = {};
  for (const tx of txList) {
    const cat = categories.find(c => c.id === tx.category_id);
    let key, color;
    if (cat) {
      key = `${cat.icon||''} ${cat.name}`.trim();
      color = cat.color || null;
    } else {
      key = NATURE_LABEL[tx.type] || 'Uncategorised';
      color = NATURE_COLORS[key] || null;
    }
    map[key] = (map[key] || 0) + Number(tx.amount);
    if (color && !colorMap[key]) colorMap[key] = color;
  }
  return Object.entries(map).sort((a,b) => b[1]-a[1]).map(([n,v]) => [n, v, colorMap[n] || null]);
}

function renderPanel(html, canvasId, rows, total, cur, getChart, setChart) {
  html; // rendered in caller
  setTimeout(() => {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    const existing = getChart();
    if (existing) { existing.destroy(); }
    const colors = rows.map((row, i) => rowColor(row, i));
    const colorsOpaque = colors.map(c => c.length === 7 ? c + 'bf' : c);
    setChart(new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: rows.map(([name]) => name),
        datasets: [{ data: rows.map(([,amt]) => amt), backgroundColor: colorsOpaque, borderWidth: 0 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            bodyFont: { family: 'DM Sans, sans-serif' },
            callbacks: { label: ctx => ` ${ctx.label}: ${fmtCurrency(ctx.raw, cur)} (${(ctx.raw/total*100).toFixed(1)}%)` },
          },
        },
      },
    }));
  }, 50);
}

function panelHtml(rows, total, cur, canvasId) {
  return `<div style="display:flex;align-items:center;gap:1rem;padding:.75rem;flex-wrap:wrap">
    <div style="position:relative;width:160px;height:160px;flex-shrink:0"><canvas id="${canvasId}"></canvas></div>
    <div style="flex:1;min-width:150px;display:flex;flex-direction:column">
      ${rows.map((row, i) => {
        const [name, amt] = row;
        const c = rowColor(row, i);
        return `<div style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border)">
          <span style="width:8px;height:8px;border-radius:50%;background:${c};flex-shrink:0"></span>
          <span class="text-sm" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(name)}">${escHtml(name)}</span>
          <span class="text-mono text-sm">${fmtCurrency(amt,cur)}</span>
          <span class="text-muted" style="font-size:.65rem;width:3rem;text-align:right">${(amt/total*100).toFixed(1)}%</span>
        </div>`;
      }).join('')}
      <div style="display:flex;justify-content:space-between;padding:.4rem 0;font-weight:600;font-size:.8rem">
        <span>Total</span><span class="text-mono">${fmtCurrency(total,cur)}</span>
      </div>
    </div>
  </div>`;
}

function stackedBarPanelHtml(canvasId) {
  return `<div style="position:relative;height:160px;padding:.75rem"><canvas id="${canvasId}"></canvas></div>`;
}

function renderStackedBarPanel(canvasId, incomeRows, expenseRows, savingsNet, investNet, cur, getChart, setChart) {
  setTimeout(() => {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !window.Chart) return;
    const existing = getChart();
    if (existing) existing.destroy();

    const incomeTotal  = incomeRows.reduce((s, r) => s + r[1], 0);
    const expenseTotal = expenseRows.reduce((s, r) => s + r[1], 0);
    const toColor = (row, i) => { const c = rowColor(row, i); return c.length === 7 ? c + 'bf' : c; };

    const hasSavInv = savingsNet !== 0 || investNet !== 0;
    const labels = ['Income', 'Spend'];
    if (hasSavInv) labels.push('Savings & Inv.');
    const n = labels.length;
    const pad = (val, idx) => Array.from({length: n}, (_, j) => j === idx ? val : 0);

    const datasets = [
      ...incomeRows.map((row, i) => ({
        label: row[0], data: pad(row[1], 0),
        backgroundColor: toColor(row, i), borderWidth: 0, borderRadius: 4,
      })),
      ...expenseRows.map((row, i) => ({
        label: row[0], data: pad(row[1], 1),
        backgroundColor: toColor(row, i + incomeRows.length), borderWidth: 0, borderRadius: 4,
      })),
    ];
    if (savingsNet !== 0) datasets.push({
      label: 'Savings', data: pad(savingsNet, 2),
      backgroundColor: CLR.savings, borderWidth: 0, borderRadius: 4,
    });
    if (investNet !== 0) datasets.push({
      label: 'Investments', data: pad(investNet, 2),
      backgroundColor: CLR.invest, borderWidth: 0, borderRadius: 4,
    });

    const totals = { Income: incomeTotal, Spend: expenseTotal, 'Savings & Inv.': savingsNet + investNet };

    setChart(new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            bodyFont: { family: 'DM Sans, sans-serif' },
            callbacks: {
              label: ctx => ctx.raw > 0 ? ` ${ctx.dataset.label}: ${fmtCurrency(ctx.raw, cur)}` : null,
              footer: items => `Total: ${fmtCurrency(totals[items[0]?.label] ?? 0, cur)}`,
            },
            filter: item => item.raw > 0,
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#8b90a8', font: { family: 'DM Sans' }, callback: v => fmtCurrency(v, cur) },
            grid: { color: '#2a2e3f40' },
          },
          y: {
            stacked: true,
            ticks: { color: '#8b90a8', font: { family: 'DM Sans' } },
            grid: { display: false },
          },
        },
      },
    }));
  }, 50);
}

function renderBreakdownRows(state, period, cur, view) {
  const container = document.getElementById('breakdown-rows');
  if (!container) return;

  const { transactions, categories, accounts } = state;
  const { start, end } = period;

  const inPeriod = (tx) => isEffective(tx) && parseISO(tx.date) >= start && parseISO(tx.date) <= end;
  const periodTx  = transactions.filter(inPeriod);
  const expenseTx = periodTx.filter(tx => tx.type === 'spend' || tx.type === 'debt_payment');

  const expenseTotal = expenseTx.reduce((s,tx) => s + Number(tx.amount), 0);

  // Savings / investments net delta (contributed minus withdrawn)
  const activeAcc    = accounts.filter(a => !a.is_archived && !a.is_excluded);
  const savingsIds   = new Set(activeAcc.filter(a => effectiveType(a) === 'savings').map(a => a.id));
  const investIds    = new Set(activeAcc.filter(a => effectiveType(a) === 'investment').map(a => a.id));
  const sumAmt       = arr => arr.reduce((s, tx) => s + Number(tx.amount), 0);
  const savingsNet   = sumAmt(periodTx.filter(tx => tx.type === 'savings'))
                     - sumAmt(periodTx.filter(tx => tx.type === 'withdrawal' && savingsIds.has(tx.account_id)));
  const investNet    = sumAmt(periodTx.filter(tx => tx.type === 'investment'))
                     - sumAmt(periodTx.filter(tx => tx.type === 'withdrawal' && investIds.has(tx.account_id)));

  // All Transactions bar: income vs pure spend+debt_payment (no savings/investment/withdrawal)
  const allIncomeTx  = periodTx.filter(tx => tx.type === 'income');
  const allExpTx     = periodTx.filter(tx => tx.type === 'spend' || tx.type === 'debt_payment');
  const allIncomeRows = allIncomeTx.length > 0 ? buildRows(allIncomeTx, view, categories) : [];
  const allExpRows    = allExpTx.length    > 0 ? buildRows(allExpTx,    view, categories) : [];
  const hasAllTx = allIncomeRows.length > 0 || allExpRows.length > 0 || savingsNet !== 0 || investNet !== 0;

  if (expenseTotal === 0 && !hasAllTx) {
    container.innerHTML = `<div class="empty-state" style="padding:2rem">No transactions this period</div>`;
    return;
  }

  const expenseRows = expenseTotal > 0 ? buildRows(expenseTx, view, categories) : [];

  container.innerHTML = `
    <div class="card" style="flex:1;min-width:280px;padding:0">
      <div style="padding:.6rem 1rem .3rem;font-weight:600;font-size:.8rem;color:var(--text2);border-bottom:1px solid var(--border)">Spend</div>
      ${expenseRows.length ? panelHtml(expenseRows, expenseTotal, cur, 'breakdown-canvas') : '<div class="empty-state" style="padding:1.5rem">No expenses</div>'}
    </div>
    <div class="card" style="flex:1;min-width:280px;padding:0">
      <div style="padding:.6rem 1rem .3rem;font-weight:600;font-size:.8rem;color:var(--text2);border-bottom:1px solid var(--border)">All Transactions</div>
      ${hasAllTx ? stackedBarPanelHtml('alltx-canvas') : '<div class="empty-state" style="padding:1.5rem">No transactions</div>'}
    </div>`;

  if (expenseRows.length) renderPanel('', 'breakdown-canvas', expenseRows, expenseTotal, cur, () => breakdownChart, c => { breakdownChart = c; });
  if (hasAllTx) renderStackedBarPanel('alltx-canvas', allIncomeRows, allExpRows, savingsNet, investNet, cur, () => allTxChart, c => { allTxChart = c; });
}

// ── CASHFLOW CHART ────────────────────────────────────────────
function drawCashflowChart(state, cur) {
  const canvas = document.getElementById('cashflow-canvas');
  if (!canvas || !window.Chart) return;

  const { transactions, profiles } = state;
  const pa = profiles[0]?.preferences?.salary_day;
  const pb = profiles[1]?.preferences?.salary_day;
  const periods = getPeriods(App.cycleMode(), { salary_day_a: pa, salary_day_b: pb }, 3);

  const activeAcc  = state.accounts.filter(a => !a.is_archived && !a.is_excluded);
  const savingsIds = new Set(activeAcc.filter(a => effectiveType(a) === 'savings').map(a => a.id));
  const investIds  = new Set(activeAcc.filter(a => effectiveType(a) === 'investment').map(a => a.id));

  const labels = periods.map(p => p.label);
  const incomeData = [], spendData = [], netSavingsData = [], balanceData = [];

  for (const p of periods) {
    const ptx = transactions.filter(tx =>
      isEffective(tx) && parseISO(tx.date) >= p.start && parseISO(tx.date) <= p.end
    );
    const sum = type => ptx.filter(t => t.type === type).reduce((s,t) => s + Number(t.amount), 0);
    incomeData.push(sum('income'));
    spendData.push(sum('spend') + sum('debt_payment'));
    const withdrawn = ptx.filter(t => t.type === 'withdrawal' && (savingsIds.has(t.account_id) || investIds.has(t.account_id)))
      .reduce((s,t) => s + Number(t.amount), 0);
    netSavingsData.push(sum('savings') + sum('investment') - withdrawn);
    // period net balance: income minus spend for this period only
    balanceData.push(sum('income') - sum('spend') - sum('debt_payment'));
  }

  if (cashflowChart) { cashflowChart.destroy(); cashflowChart = null; }

  cashflowChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income',                    data: incomeData,     backgroundColor: CLR.income  },
        { label: 'Spend',                     data: spendData,      backgroundColor: CLR.spend   },
        { label: 'Net Savings & Investments', data: netSavingsData, backgroundColor: CLR.savings },
        {
          label: 'Balance',
          data: balanceData,
          backgroundColor: crossHatch(CLR.balance),
          borderWidth: 0, borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#8b90a8', font: { family: 'DM Sans' } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtCurrency(ctx.raw, cur)}` } },
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
