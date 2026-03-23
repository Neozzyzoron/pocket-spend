/* ═══════════════════════════════════════════════════════════════
   analytics.js — Analytics page
   Period summary, cash flow chart, net worth, spending by person, budget perf
═══════════════════════════════════════════════════════════════ */

import {
  fmtCurrency, fmtPct, escHtml, parseISO, isEffective,
  effectiveType, calcAccountBalance, getPeriods, isLiquid,
} from './utils.js';

let cfChart = null, nwChart = null, personChart = null, totChart = null, budPerfChart = null;

// ── MAIN RENDER ───────────────────────────────────────────────
export function render(state) {
  const el = document.getElementById('page-analytics');
  const cur = App.currency();

  const periodN = parseInt(el.dataset.periodN || '6');
  const accountFilter = el.dataset.accountFilter || '';
  const personFilter = el.dataset.personFilter || '';

  const pa = state.profiles[0]?.preferences?.salary_day;
  const pb = state.profiles[1]?.preferences?.salary_day;
  const prefsForCycle = { salary_day_a: pa, salary_day_b: pb };
  const mode = App.cycleMode();
  const periods = getPeriods(mode, prefsForCycle, periodN);
  const allTx = getFilteredTx(state, accountFilter, personFilter);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Analytics</div>
        <div class="page-subtitle">Trends and breakdowns</div>
      </div>
    </div>

    <!-- Global filters -->
    <div class="section" style="padding-bottom:0">
      <div class="flex gap-2 items-center" style="flex-wrap:wrap">
        <div class="toggle-group">
          ${[3,6,12].map(n => `<button class="toggle-group-btn analytics-period-btn${periodN===n?' active':''}" data-n="${n}">${n} periods</button>`).join('')}
        </div>
        <select class="form-select" id="analytics-acc-filter" style="width:auto">
          <option value="">All accounts</option>
          ${state.accounts.filter(a => !a.is_archived).map(a =>
            `<option value="${a.id}"${accountFilter === a.id ? ' selected' : ''}>${escHtml(a.name)}</option>`
          ).join('')}
        </select>
        <select class="form-select" id="analytics-person-filter" style="width:auto">
          <option value="">All people</option>
          ${state.profiles.map(p =>
            `<option value="${p.id}"${personFilter === p.id ? ' selected' : ''}>${escHtml(p.display_name)}</option>`
          ).join('')}
        </select>
      </div>
    </div>

    <!-- Period summary -->
    ${renderPeriodSummary(allTx, periods, cur)}

    <!-- Cash flow chart -->
    <div class="section">
      <div class="section-header"><div class="section-title">Cash Flow</div></div>
      <div class="card" style="position:relative;height:260px">
        <canvas id="analytics-cf-canvas"></canvas>
      </div>
    </div>

    <!-- Net worth over time -->
    <div class="section">
      <div class="section-header"><div class="section-title">Net Worth Over Time</div></div>
      <div class="card" style="position:relative;height:260px">
        <canvas id="analytics-nw-canvas"></canvas>
      </div>
    </div>

    <!-- Spending by person -->
    ${state.profiles.length > 1 ? `<div class="section">
      <div class="section-header"><div class="section-title">Spending by Person</div></div>
      <div class="card" style="position:relative;height:240px">
        <canvas id="analytics-person-canvas"></canvas>
      </div>
    </div>` : ''}

    <!-- Totals over time -->
    <div class="section">
      <div class="section-header"><div class="section-title">Totals Over Time</div></div>
      <div class="card" style="position:relative;height:260px">
        <canvas id="analytics-tot-canvas"></canvas>
      </div>
    </div>

    <!-- Budget performance -->
    ${state.budgets.length ? renderBudgetPerformance(state, periods, cur) : ''}

    <!-- Spending breakdown table -->
    ${renderBreakdownTable(allTx, periods, state.categories, cur)}
  `;

  // Wire filters
  el.querySelectorAll('.analytics-period-btn').forEach(btn => {
    btn.addEventListener('click', () => { el.dataset.periodN = btn.dataset.n; render(state); });
  });
  document.getElementById('analytics-acc-filter')?.addEventListener('change', e => {
    el.dataset.accountFilter = e.target.value; render(state);
  });
  document.getElementById('analytics-person-filter')?.addEventListener('change', e => {
    el.dataset.personFilter = e.target.value; render(state);
  });

  // Draw charts
  setTimeout(() => {
    drawCashflowChart(allTx, periods, cur);
    drawNetWorthChart(state, periods, cur);
    if (state.profiles.length > 1) drawPersonChart(allTx, periods, state.profiles, cur);
    drawTotalsChart(allTx, periods, cur);
    if (state.budgets.length) drawBudgetPerfChart(state, periods, cur);
  }, 50);
}

// ── FILTER ────────────────────────────────────────────────────
function getFilteredTx(state, accountFilter, personFilter) {
  return state.transactions.filter(tx => {
    if (accountFilter && tx.account_id !== accountFilter && tx.to_account_id !== accountFilter) return false;
    if (personFilter && tx.user_id !== personFilter) return false;
    return true;
  });
}

// ── PERIOD SUMMARY CARDS ──────────────────────────────────────
function renderPeriodSummary(allTx, periods, cur) {
  const pStart = periods[0].start;
  const pEnd = periods[periods.length - 1].end;

  const inRange = allTx.filter(tx =>
    isEffective(tx) && parseISO(tx.date) >= pStart && parseISO(tx.date) <= pEnd
  );

  const sum = (type) => inRange.filter(t => t.type === type).reduce((s, t) => s + Number(t.amount), 0);
  const income = sum('income'), spending = sum('spend'), saved = sum('savings'),
        invested = sum('investment'), withdrawn = sum('withdrawal'), debt = sum('debt_payment');
  const net = income - spending - saved - invested - debt + withdrawn;

  const cards = [
    { label: 'Income', val: income, cls: 'c-green' },
    { label: 'Spending', val: spending, cls: 'c-red' },
    { label: 'Saved', val: saved, cls: 'c-green' },
    { label: 'Invested', val: invested, cls: '' },
    { label: 'Withdrawn', val: withdrawn, cls: '' },
    { label: 'Debt Payments', val: debt, cls: 'c-red' },
    { label: 'Net', val: net, cls: net >= 0 ? 'c-green' : 'c-red' },
  ];

  return `<div class="section">
    <div class="section-header"><div class="section-title">Summary — all ${periods.length} periods</div></div>
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr)">
      ${cards.map(c => `<div class="card card-sm">
        <div class="card-title text-muted text-sm">${c.label}</div>
        <div class="card-value text-mono ${c.cls}">${fmtCurrency(c.val, App.currency())}</div>
      </div>`).join('')}
    </div>
  </div>`;
}

// ── CASH FLOW CHART ───────────────────────────────────────────
function drawCashflowChart(allTx, periods, cur) {
  const canvas = document.getElementById('analytics-cf-canvas');
  if (!canvas || !window.Chart) return;

  const labels = periods.map(p => p.label);
  const datasets = [
    { label: 'Income',   color: '#22c55e99', type: 'income' },
    { label: 'Spending', color: '#ef444499', type: 'spend' },
    { label: 'Saved',    color: '#3b82f699', type: 'savings' },
    { label: 'Invested', color: '#a855f799', type: 'investment' },
  ].map(({ label, color, type }) => ({
    label,
    backgroundColor: color,
    data: periods.map(p => allTx.filter(tx =>
      isEffective(tx) && tx.type === type &&
      parseISO(tx.date) >= p.start && parseISO(tx.date) <= p.end
    ).reduce((s, tx) => s + Number(tx.amount), 0)),
  }));

  if (cfChart) { cfChart.destroy(); cfChart = null; }
  cfChart = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: chartOptions(cur),
  });
}

// ── NET WORTH CHART ───────────────────────────────────────────
function drawNetWorthChart(state, periods, cur) {
  const canvas = document.getElementById('analytics-nw-canvas');
  if (!canvas || !window.Chart) return;

  const { accounts, transactions } = state;
  const activeAcc = accounts.filter(a => !a.is_archived);

  // For each period end, compute net worth
  const netWorthData = periods.map(p => {
    const txUpTo = transactions.filter(tx => isEffective(tx) && parseISO(tx.date) <= p.end);
    return activeAcc
      .filter(a => ['checking','savings','investment','credit','cash'].includes(effectiveType(a)))
      .reduce((s, a) => s + calcAccountBalance(a, txUpTo), 0);
  });

  const liquidData = periods.map(p => {
    const txUpTo = transactions.filter(tx => isEffective(tx) && parseISO(tx.date) <= p.end);
    return activeAcc.filter(a => isLiquid(a)).reduce((s, a) => s + calcAccountBalance(a, txUpTo), 0);
  });

  if (nwChart) { nwChart.destroy(); nwChart = null; }
  nwChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: periods.map(p => p.label),
      datasets: [
        { label: 'Net Worth', data: netWorthData, borderColor: '#22c55e', backgroundColor: '#22c55e22', tension: 0.3, fill: true },
        { label: 'Liquid Balance', data: liquidData, borderColor: '#3b82f6', backgroundColor: 'transparent', tension: 0.3, borderDash: [5,5] },
      ],
    },
    options: { ...chartOptions(cur), plugins: { ...chartOptions(cur).plugins } },
  });
}

// ── PERSON CHART ──────────────────────────────────────────────
function drawPersonChart(allTx, periods, profiles, cur) {
  const canvas = document.getElementById('analytics-person-canvas');
  if (!canvas || !window.Chart) return;

  const colors = ['#22c55e99', '#3b82f699', '#a855f799', '#ef444499'];
  const datasets = profiles.map((p, i) => ({
    label: p.display_name,
    backgroundColor: colors[i] || '#8b90a899',
    data: periods.map(period => allTx.filter(tx =>
      isEffective(tx) && tx.type === 'spend' && tx.user_id === p.id &&
      parseISO(tx.date) >= period.start && parseISO(tx.date) <= period.end
    ).reduce((s, tx) => s + Number(tx.amount), 0)),
  }));

  if (personChart) { personChart.destroy(); personChart = null; }
  personChart = new Chart(canvas, {
    type: 'bar',
    data: { labels: periods.map(p => p.label), datasets },
    options: chartOptions(cur),
  });
}

// ── BREAKDOWN TABLE ───────────────────────────────────────────
function renderBreakdownTable(allTx, periods, categories, cur) {
  const spendTx = allTx.filter(tx => isEffective(tx) && tx.type === 'spend');

  // Group by category
  const byCat = {};
  for (const tx of spendTx) {
    const cat = categories.find(c => c.id === tx.category_id);
    const key = cat ? `${cat.icon} ${cat.name}` : 'Uncategorised';
    if (!byCat[key]) byCat[key] = { name: key, periodAmts: periods.map(() => 0), total: 0 };
    const idx = periods.findIndex(p => parseISO(tx.date) >= p.start && parseISO(tx.date) <= p.end);
    if (idx !== -1) byCat[key].periodAmts[idx] += Number(tx.amount);
    byCat[key].total += Number(tx.amount);
  }

  const rows = Object.values(byCat).sort((a,b) => b.total - a.total);
  if (!rows.length) return '';

  return `<div class="section">
    <div class="section-header"><div class="section-title">Spending by Category</div></div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Category</th>
            ${periods.map(p => `<th class="amount-col">${escHtml(p.label)}</th>`).join('')}
            <th class="amount-col">Total</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td class="text-sm">${escHtml(r.name)}</td>
              ${r.periodAmts.map(a => `<td class="amount-col text-mono text-sm">${a > 0 ? fmtCurrency(a, App.currency()) : '—'}</td>`).join('')}
              <td class="amount-col text-mono fw-600">${fmtCurrency(r.total, App.currency())}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

// ── TOTALS OVER TIME ──────────────────────────────────────────
function drawTotalsChart(allTx, periods, cur) {
  const canvas = document.getElementById('analytics-tot-canvas');
  if (!canvas || !window.Chart) return;
  if (totChart) { totChart.destroy(); totChart = null; }

  const labels = periods.map(p => p.label);
  const metrics = [
    { label: 'Income',        type: 'income',       color: '#22c55e' },
    { label: 'Spending',      type: 'spend',         color: '#ef4444' },
    { label: 'Saved',         type: 'savings',       color: '#3b82f6' },
    { label: 'Invested',      type: 'investment',    color: '#a855f7' },
    { label: 'Withdrawn',     type: 'withdrawal',    color: '#f59e0b' },
    { label: 'Debt Payments', type: 'debt_payment',  color: '#06b6d4' },
  ];

  const datasets = metrics.map(m => ({
    label: m.label,
    data: periods.map(p =>
      allTx.filter(tx => isEffective(tx) && tx.type === m.type &&
        parseISO(tx.date) >= p.start && parseISO(tx.date) <= p.end
      ).reduce((s, tx) => s + Number(tx.amount), 0)
    ),
    borderColor: m.color,
    backgroundColor: 'transparent',
    tension: 0.2,
    pointRadius: 3,
  }));

  totChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: chartOptions(cur),
  });
}

// ── BUDGET PERFORMANCE ────────────────────────────────────────
function renderBudgetPerformance(state, periods, cur) {
  return `<div class="section">
    <div class="section-header"><div class="section-title">Budget Performance</div></div>
    <div class="card" style="position:relative;height:260px">
      <canvas id="analytics-budperf-canvas"></canvas>
    </div>
  </div>`;
}

function drawBudgetPerfChart(state, periods, cur) {
  const canvas = document.getElementById('analytics-budperf-canvas');
  if (!canvas || !window.Chart) return;
  if (budPerfChart) { budPerfChart.destroy(); budPerfChart = null; }

  const { budgets, categories, transactions } = state;
  const labels = periods.map(p => p.label);
  const palette = ['#22c55e','#3b82f6','#f59e0b','#ef4444','#a855f7','#06b6d4'];

  const datasets = [];
  budgets.forEach((b, i) => {
    const cat = categories.find(c => c.id === b.category_id);
    const color = palette[i % palette.length];
    const name = cat ? (cat.icon || '') + ' ' + cat.name : 'Budget';
    const actualData = periods.map(p =>
      transactions.filter(tx =>
        isEffective(tx) && tx.type === 'spend' && tx.category_id === b.category_id &&
        parseISO(tx.date) >= p.start && parseISO(tx.date) <= p.end
      ).reduce((s, tx) => s + Number(tx.amount), 0)
    );
    const limitPerPeriod = Number(b.amount);

    datasets.push({
      label: name + ' (actual)',
      data: actualData,
      backgroundColor: color + 'aa',
      stack: 'actual_' + i,
      type: 'bar',
    });
    datasets.push({
      label: name + ' (limit)',
      data: labels.map(() => limitPerPeriod),
      borderColor: color,
      backgroundColor: 'transparent',
      borderDash: [4, 3],
      type: 'line',
      tension: 0,
      pointRadius: 0,
    });
  });

  budPerfChart = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      ...chartOptions(cur),
      plugins: {
        ...chartOptions(cur).plugins,
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
      },
    },
  });
}

// ── CHART OPTIONS ─────────────────────────────────────────────
function chartOptions(cur) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#8b90a8', font: { family: 'DM Sans' } } },
      tooltip: { callbacks: { label: ctx => ` ${fmtCurrency(ctx.raw, cur)}` } },
    },
    scales: {
      x: { ticks: { color: '#8b90a8' }, grid: { color: '#2a2e3f40' } },
      y: { ticks: { color: '#8b90a8', callback: v => fmtCurrency(v, cur) }, grid: { color: '#2a2e3f40' } },
    },
  };
}
