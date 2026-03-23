/* ═══════════════════════════════════════════════════════════════
   forecast.js — Forecast page
   Summary cards, timeline chart, period table, category breakdown
═══════════════════════════════════════════════════════════════ */

import {
  fmtCurrency, fmtPct, escHtml, parseISO, toISO, isEffective,
  effectiveType, calcAccountBalance, isLiquid, getPeriods,
  buildCategoryTree,
} from './utils.js';

let timelineChart = null;

// ── MAIN RENDER ───────────────────────────────────────────────
export function render(state) {
  const el = document.getElementById('page-forecast');
  const cur = App.currency();

  const historyN = parseInt(el.dataset.historyN || '3');
  const forecastN = parseInt(el.dataset.forecastN || '3');
  const personFilter = el.dataset.personFilter || '';
  const avgWindow = state.prefs.forecast_avg_window || 3;

  const pa = state.profiles[0]?.preferences?.salary_day;
  const pb = state.profiles[1]?.preferences?.salary_day;
  const prefsForCycle = { salary_day_a: pa, salary_day_b: pb };
  const mode = App.cycleMode();

  // Build periods: historyN past + current + forecastN future
  const allPeriods = buildForecastPeriods(mode, prefsForCycle, historyN, forecastN);
  const today = new Date(); today.setHours(0,0,0,0);
  const currentPeriod = App.cyclePeriod();

  // Compute projections
  const projections = computeProjections(state, allPeriods, currentPeriod, avgWindow, personFilter);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Forecast</div>
        <div class="page-subtitle">Projected income and spending</div>
      </div>
    </div>

    <!-- Filters -->
    <div class="section" style="padding-bottom:0">
      <div class="flex gap-2 items-center" style="flex-wrap:wrap">
        <span class="text-sm text-muted">History:</span>
        <div class="toggle-group">
          ${[1,3,6,12].map(n => `<button class="toggle-group-btn fc-history-btn${historyN===n?' active':''}" data-n="${n}">${n}</button>`).join('')}
        </div>
        <span class="text-sm text-muted">Forecast:</span>
        <div class="toggle-group">
          ${[1,3,6,12].map(n => `<button class="toggle-group-btn fc-forecast-btn${forecastN===n?' active':''}" data-n="${n}">${n}</button>`).join('')}
        </div>
        <select class="form-select" id="fc-person-filter" style="width:auto">
          <option value="">All people</option>
          ${state.profiles.map(p => `<option value="${p.id}"${personFilter === p.id ? ' selected' : ''}>${escHtml(p.display_name)}</option>`).join('')}
        </select>
        <span class="text-sm text-muted">Avg window:</span>
        <div class="toggle-group">
          ${[1,3,6,12].map(n => `<button class="toggle-group-btn fc-avg-btn${avgWindow===n?' active':''}" data-n="${n}">${n}</button>`).join('')}
        </div>
      </div>
    </div>

    <!-- Summary cards (forecast window only) -->
    ${renderForecastSummary(projections, allPeriods, currentPeriod, forecastN, state, cur)}

    <!-- Timeline chart -->
    <div class="section">
      <div class="section-header">
        <div class="section-title">Timeline</div>
        <div class="text-sm text-muted">Solid = actuals · Hatched = projected</div>
      </div>
      <div class="card" style="position:relative;height:280px">
        <canvas id="fc-timeline-canvas"></canvas>
      </div>
    </div>

    <!-- Period table -->
    ${renderPeriodTable(projections, allPeriods, currentPeriod, cur, state)}

    <!-- Category breakdown -->
    ${renderCategoryBreakdown(state, allPeriods, currentPeriod, forecastN, cur)}

    <!-- Forecast accuracy -->
    ${renderForecastAccuracy(state, allPeriods, cur)}
  `;

  // Wire filters
  el.querySelectorAll('.fc-history-btn').forEach(btn => {
    btn.addEventListener('click', () => { el.dataset.historyN = btn.dataset.n; render(state); });
  });
  el.querySelectorAll('.fc-forecast-btn').forEach(btn => {
    btn.addEventListener('click', () => { el.dataset.forecastN = btn.dataset.n; render(state); });
  });
  el.querySelectorAll('.fc-avg-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const n = parseInt(btn.dataset.n);
      state.prefs.forecast_avg_window = n;
      await App.supabase.from('profiles').update({ preferences: state.prefs }).eq('id', App.state.user.id);
      render(state);
    });
  });
  document.getElementById('fc-person-filter')?.addEventListener('change', e => {
    el.dataset.personFilter = e.target.value; render(state);
  });
  el.querySelectorAll('.fc-table-view-btn').forEach(btn => {
    btn.addEventListener('click', () => { el.dataset.tableView = btn.dataset.view; render(state); });
  });

  setTimeout(() => drawTimelineChart(projections, allPeriods, currentPeriod, cur), 50);
}

// ── PERIOD BUILDING ───────────────────────────────────────────
function buildForecastPeriods(mode, prefs, historyN, forecastN) {
  // Get past N periods
  const past = getPeriods(mode, prefs, historyN + 1); // includes current
  const current = past[past.length - 1];

  // Build future periods
  const future = [];
  let prevEnd = current.end;
  for (let i = 0; i < forecastN; i++) {
    const start = new Date(prevEnd);
    start.setDate(start.getDate() + 1);
    const end = getNextPeriodEnd(mode, prefs, start);
    const label = mode === 'month'
      ? start.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
      : `${toISO(start).slice(5)} – ${toISO(end).slice(5)}`;
    future.push({ start, end, label, isFuture: true });
    prevEnd = end;
  }

  // Tag past periods
  const tagged = past.map((p, i) => ({ ...p, isFuture: false, isCurrent: i === past.length - 1 }));
  return [...tagged, ...future];
}

function getNextPeriodEnd(mode, prefs, start) {
  if (mode === 'month') {
    return new Date(start.getFullYear(), start.getMonth() + 1, 0);
  }
  // salary cycle: end is day before salary day next month
  const salaryDay = mode === 'user_a' ? (prefs.salary_day_a || 1) : (prefs.salary_day_b || 1);
  const nextM = start.getMonth() + 1;
  const nextY = start.getFullYear() + (nextM > 11 ? 1 : 0);
  const m = nextM > 11 ? 0 : nextM;
  const daysInMonth = new Date(nextY, m + 1, 0).getDate();
  const day = Math.min(salaryDay, daysInMonth) - 1;
  return new Date(nextY, m, day > 0 ? day : daysInMonth);
}

// ── PROJECTIONS ───────────────────────────────────────────────
function computeProjections(state, periods, currentPeriod, avgWindow, personFilter) {
  const { transactions, recurringTemplates, categories } = state;
  const today = new Date(); today.setHours(0,0,0,0);

  // Historical periods for rolling average
  const histPeriods = periods.filter(p => !p.isFuture && !p.isCurrent);
  const histWindow = histPeriods.slice(-avgWindow);

  // Filter transactions
  const txFilter = (tx) => {
    if (!isEffective(tx)) return false;
    if (personFilter && tx.user_id !== personFilter) return false;
    return true;
  };

  const projections = periods.map(period => {
    const pTx = transactions.filter(tx => txFilter(tx) && parseISO(tx.date) >= period.start && parseISO(tx.date) <= period.end);

    const actual = {
      income: pTx.filter(t => t.type === 'income').reduce((s,t) => s + Number(t.amount), 0),
      spending: pTx.filter(t => t.type === 'spend').reduce((s,t) => s + Number(t.amount), 0),
      saved: pTx.filter(t => t.type === 'savings').reduce((s,t) => s + Number(t.amount), 0),
      invested: pTx.filter(t => t.type === 'investment').reduce((s,t) => s + Number(t.amount), 0),
      withdrawn: pTx.filter(t => t.type === 'withdrawal').reduce((s,t) => s + Number(t.amount), 0),
      debt: pTx.filter(t => t.type === 'debt_payment').reduce((s,t) => s + Number(t.amount), 0),
    };

    let projected = null;
    if (period.isFuture || period.isCurrent) {
      // Project from templates + rolling average
      const recurring = computeRecurringProjection(recurringTemplates, period, personFilter);

      // Rolling average for variable/no-template
      const avg = computeRollingAvg(transactions, histWindow, txFilter);

      projected = {
        income: recurring.income || avg.income,
        spending: (recurring.spending + avg.variableSpend),
        saved: recurring.saved || avg.saved,
        invested: recurring.invested || avg.invested,
        withdrawn: recurring.withdrawn || avg.withdrawn,
        debt: recurring.debt || avg.debt,
      };

      // For current period, blend actual so far with projection for remainder
      if (period.isCurrent) {
        projected = {
          income: Math.max(actual.income, projected.income),
          spending: Math.max(actual.spending, projected.spending),
          saved: Math.max(actual.saved, projected.saved),
          invested: Math.max(actual.invested, projected.invested),
          withdrawn: Math.max(actual.withdrawn, projected.withdrawn),
          debt: Math.max(actual.debt, projected.debt),
        };
      }
    }

    return { period, actual, projected };
  });

  return projections;
}

function computeRecurringProjection(templates, period, personFilter) {
  let income = 0, spending = 0, saved = 0, invested = 0, withdrawn = 0, debt = 0;

  for (const t of templates.filter(x => x.is_active)) {
    if (personFilter && t.user_id !== personFilter) continue;
    const count = calcOccurrences(t, period);
    const amt = Number(t.amount) * count;
    if (t.type === 'income') income += amt;
    else if (t.type === 'spend') spending += amt;
    else if (t.type === 'savings') saved += amt;
    else if (t.type === 'investment') invested += amt;
    else if (t.type === 'withdrawal') withdrawn += amt;
    else if (t.type === 'debt_payment') debt += amt;
  }

  return { income, spending, saved, invested, withdrawn, debt };
}

function calcOccurrences(t, period) {
  if (!t.start_date) return 0;
  const tStart = parseISO(t.start_date);
  if (!tStart || tStart > period.end) return 0;
  const effectiveStart = tStart > period.start ? tStart : period.start;

  let count = 0;
  if (t.frequency === 'weekly' || t.frequency === 'bi-weekly') {
    const step = t.frequency === 'weekly' ? 7 : 14;
    let d = new Date(effectiveStart);
    while (((d.getDay() + 6) % 7) !== (t.day_of_week ?? 0)) d.setDate(d.getDate() + 1);
    while (d <= period.end) { if (d >= period.start) count++; d.setDate(d.getDate() + step); }
  } else if (t.frequency === 'monthly') {
    const dom = t.day_of_month || 1;
    for (let m = effectiveStart.getMonth(), y = effectiveStart.getFullYear(); ; m++) {
      if (m > 11) { m = 0; y++; }
      const day = Math.min(dom, new Date(y, m + 1, 0).getDate());
      const d = new Date(y, m, day);
      if (d > period.end) break;
      if (d >= period.start && d >= tStart) count++;
      if (new Date(y, m + 1, 1) > period.end) break;
    }
  } else if (t.frequency === 'annually') {
    const dom = t.day_of_month || 1;
    const moy = (t.month_of_year || 1) - 1;
    for (let y = effectiveStart.getFullYear(); y <= period.end.getFullYear() + 1; y++) {
      const day = Math.min(dom, new Date(y, moy + 1, 0).getDate());
      const d = new Date(y, moy, day);
      if (d > period.end) break;
      if (d >= period.start && d >= tStart) count++;
    }
  }
  return count;
}

function computeRollingAvg(transactions, histPeriods, txFilter) {
  if (!histPeriods.length) return { income: 0, variableSpend: 0, saved: 0, invested: 0, debt: 0 };

  const sums = histPeriods.map(p => {
    const ptx = transactions.filter(tx => txFilter(tx) && parseISO(tx.date) >= p.start && parseISO(tx.date) <= p.end);
    return {
      income: ptx.filter(t => t.type === 'income' && !t.is_recurring).reduce((s,t) => s + Number(t.amount), 0),
      variableSpend: ptx.filter(t => t.type === 'spend').reduce((s,t) => s + Number(t.amount), 0),
      saved: ptx.filter(t => t.type === 'savings' && !t.is_recurring).reduce((s,t) => s + Number(t.amount), 0),
      invested: ptx.filter(t => t.type === 'investment' && !t.is_recurring).reduce((s,t) => s + Number(t.amount), 0),
      withdrawn: ptx.filter(t => t.type === 'withdrawal' && !t.is_recurring).reduce((s,t) => s + Number(t.amount), 0),
      debt: ptx.filter(t => t.type === 'debt_payment' && !t.is_recurring).reduce((s,t) => s + Number(t.amount), 0),
    };
  });

  const avg = k => sums.reduce((s, x) => s + x[k], 0) / sums.length;
  return {
    income: avg('income'),
    variableSpend: avg('variableSpend'),
    saved: avg('saved'),
    invested: avg('invested'),
    withdrawn: avg('withdrawn'),
    debt: avg('debt'),
  };
}

// ── FORECAST SUMMARY CARDS ────────────────────────────────────
function renderForecastSummary(projections, periods, currentPeriod, forecastN, state, cur) {
  const futurePeriods = projections.filter(p => p.period.isFuture);
  if (!futurePeriods.length) return '';

  const sumProjected = k => futurePeriods.reduce((s, p) => s + (p.projected?.[k] || 0), 0);

  const income = sumProjected('income'), spending = sumProjected('spending'),
        saved = sumProjected('saved'), invested = sumProjected('invested'),
        debt = sumProjected('debt');

  // Expected closing balance
  const curBal = state.accounts.filter(a => !a.is_archived && isLiquid(a))
    .reduce((s, a) => s + calcAccountBalance(a, state.transactions), 0);
  const expectedBalance = curBal + income - spending;

  const cards = [
    { label: '~ Income', val: income, cls: 'c-green' },
    { label: '~ Spending', val: spending, cls: 'c-red' },
    { label: '~ Saved', val: saved, cls: '' },
    { label: '~ Invested', val: invested, cls: '' },
    { label: '~ Debt Payments', val: debt, cls: 'c-red' },
    { label: '~ Expected Balance', val: expectedBalance, cls: expectedBalance >= 0 ? 'c-green' : 'c-red' },
  ];

  return `<div class="section">
    <div class="section-header">
      <div class="section-title">Forecast — next ${forecastN} period${forecastN > 1 ? 's' : ''}</div>
      <div class="text-sm text-muted">~ = projected</div>
    </div>
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
      ${cards.map(c => `<div class="card card-sm">
        <div class="card-title text-muted text-sm">${c.label}</div>
        <div class="card-value text-mono ${c.cls}">${fmtCurrency(c.val, cur)}</div>
      </div>`).join('')}
    </div>
  </div>`;
}

// ── TIMELINE CHART ────────────────────────────────────────────
function drawTimelineChart(projections, periods, currentPeriod, cur) {
  const canvas = document.getElementById('fc-timeline-canvas');
  if (!canvas || !window.Chart) return;

  const labels = projections.map(p => p.period.label);
  const actualSpend = projections.map(p => p.actual.spending);
  const projSpend = projections.map(p => p.period.isFuture ? (p.projected?.spending || 0) : null);
  const actualIncome = projections.map(p => p.actual.income);
  const projIncome = projections.map(p => p.period.isFuture ? (p.projected?.income || 0) : null);

  if (timelineChart) { timelineChart.destroy(); timelineChart = null; }
  timelineChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Income (actual)', data: actualIncome, backgroundColor: '#22c55e99' },
        { label: 'Income (projected)', data: projIncome, backgroundColor: '#22c55e44', borderColor: '#22c55e', borderWidth: 1, borderDash: [5,5] },
        { label: 'Spending (actual)', data: actualSpend, backgroundColor: '#ef444499' },
        { label: 'Spending (projected)', data: projSpend, backgroundColor: '#ef444444', borderColor: '#ef4444', borderWidth: 1 },
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
        y: { ticks: { color: '#8b90a8', callback: v => fmtCurrency(v, cur) }, grid: { color: '#2a2e3f40' } },
      },
    },
  });
}

// ── PERIOD TABLE ──────────────────────────────────────────────
function renderPeriodTable(projections, periods, currentPeriod, cur, state) {
  const el = document.getElementById('page-forecast');
  const tableView = el?.dataset.tableView || 'both';

  const rows = [
    { key: 'income',    label: 'Income' },
    { key: 'spending',  label: 'Spending' },
    { key: 'saved',     label: 'Saved' },
    { key: 'invested',  label: 'Invested' },
    { key: 'withdrawn', label: 'Withdrawn' },
    { key: 'debt',      label: 'Debt Payments' },
  ];

  // Get the display value for a projection+key based on current tableView
  const getVal = (p, key) => {
    if (tableView === 'actuals') return p.actual[key] ?? 0;
    if (tableView === 'projected') return p.projected?.[key] ?? null;
    // 'both': actual for past, projected for current+future
    return (p.period.isFuture || p.period.isCurrent) ? (p.projected?.[key] ?? null) : (p.actual[key] ?? 0);
  };

  const isProjectedCell = (p) =>
    tableView === 'projected' || (tableView === 'both' && (p.period.isFuture || p.period.isCurrent));

  const fmt = (val, proj) => {
    if (val === null || val === undefined) return '—';
    const s = fmtCurrency(val, cur);
    return proj ? `<span class="text-muted" style="font-style:italic">~ ${s}</span>` : s;
  };

  // Net = income + withdrawn - spending - saved - invested - debt
  const netVal = (p) => {
    const income = getVal(p, 'income');
    if (income === null) return null;
    return (income || 0) + (getVal(p, 'withdrawn') || 0)
      - (getVal(p, 'spending') || 0) - (getVal(p, 'saved') || 0)
      - (getVal(p, 'invested') || 0) - (getVal(p, 'debt') || 0);
  };

  // Running liquid balance anchored at current period end = current liquid balance
  const currentLiquidBal = state.accounts
    .filter(a => !a.is_archived && isLiquid(a))
    .reduce((s, a) => s + calcAccountBalance(a, state.transactions), 0);

  const currentIdx = projections.findIndex(p => p.period.isCurrent);
  const balances = projections.map(() => null);
  if (currentIdx >= 0) {
    balances[currentIdx] = currentLiquidBal;
    for (let i = currentIdx + 1; i < projections.length; i++) {
      balances[i] = balances[i-1] + (netVal(projections[i]) || 0);
    }
    for (let i = currentIdx - 1; i >= 0; i--) {
      balances[i] = balances[i+1] - (netVal(projections[i+1]) || 0);
    }
  }

  const totalFor = key => projections.reduce((s, p) => s + (getVal(p, key) || 0), 0);
  const avgFor = key => {
    const vals = projections.map(p => getVal(p, key)).filter(v => v !== null);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  };

  const netVals = projections.map(p => netVal(p));
  const totalNet = netVals.reduce((s, v) => s + (v || 0), 0);
  const validNets = netVals.filter(v => v !== null);
  const avgNet = validNets.length ? totalNet / validNets.length : 0;

  const fmtNet = (net, proj) => {
    if (net === null) return '—';
    const cls = net >= 0 ? 'c-green' : 'c-red';
    const s = (net < 0 ? '−' : '') + fmtCurrency(Math.abs(net), cur);
    return proj ? `<span class="${cls}" style="font-style:italic">~ ${s}</span>` : `<span class="${cls}">${s}</span>`;
  };

  return `<div class="section">
    <div class="section-header">
      <div class="section-title">Period Table</div>
      <div class="toggle-group">
        <button class="toggle-group-btn fc-table-view-btn${tableView==='both'?' active':''}" data-view="both">Both</button>
        <button class="toggle-group-btn fc-table-view-btn${tableView==='actuals'?' active':''}" data-view="actuals">Actuals</button>
        <button class="toggle-group-btn fc-table-view-btn${tableView==='projected'?' active':''}" data-view="projected">Projections</button>
      </div>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th style="position:sticky;left:0;background:var(--surface);z-index:1">Metric</th>
            ${projections.map(p => `<th class="amount-col${p.period.isCurrent ? ' fw-600' : p.period.isFuture ? ' text-muted' : ''}">${escHtml(p.period.label)}</th>`).join('')}
            <th class="amount-col fw-600">Total</th>
            <th class="amount-col text-muted">Avg</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => {
              const total = totalFor(r.key);
              const avg = avgFor(r.key);
              return `<tr>
                <td style="position:sticky;left:0;background:var(--surface)">${r.label}</td>
                ${projections.map(p => {
                  const val = getVal(p, r.key);
                  const proj = isProjectedCell(p) && val !== null;
                  return `<td class="amount-col text-mono text-sm">${fmt(val, proj)}</td>`;
                }).join('')}
                <td class="amount-col text-mono fw-600">${fmtCurrency(total, cur)}</td>
                <td class="amount-col text-mono text-muted">${fmtCurrency(avg, cur)}</td>
              </tr>`;
            }).join('')}
            <tr style="border-top:2px solid var(--border)">
              <td style="position:sticky;left:0;background:var(--surface);font-weight:600">Net</td>
              ${projections.map((p, i) => {
                const net = netVals[i];
                const proj = isProjectedCell(p) && net !== null;
                return `<td class="amount-col text-mono text-sm fw-600">${fmtNet(net, proj)}</td>`;
              }).join('')}
              <td class="amount-col text-mono fw-600">${fmtNet(totalNet, false)}</td>
              <td class="amount-col text-mono text-muted">${fmtNet(avgNet, false)}</td>
            </tr>
            ${currentIdx >= 0 ? `<tr>
              <td style="position:sticky;left:0;background:var(--surface);font-weight:600">Balance</td>
              ${projections.map((p, i) => {
                const bal = balances[i];
                if (bal === null) return `<td class="amount-col text-mono text-sm text-muted">—</td>`;
                const cls = bal >= 0 ? 'c-green' : 'c-red';
                const s = fmtCurrency(bal, cur);
                return `<td class="amount-col text-mono text-sm ${cls}">${p.period.isFuture ? `<span style="font-style:italic">~ </span>` : ''}${s}</td>`;
              }).join('')}
              <td class="amount-col" colspan="2"></td>
            </tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

// ── FORECAST ACCURACY ────────────────────────────────────────
function renderForecastAccuracy(state, allPeriods, cur) {
  // Only completed past (non-current, non-future) periods can be evaluated
  const completedPast = allPeriods.filter(p => !p.isFuture && !p.isCurrent);
  if (completedPast.length < 2) {
    return `<div class="section">
      <div class="section-header"><div class="section-title">Forecast Accuracy</div></div>
      <div class="card">
        <p class="text-muted text-sm">Not enough history yet — accuracy metrics will appear after at least 2 completed periods.</p>
      </div>
    </div>`;
  }

  const { transactions } = state;
  const metrics = ['income','spending','saved','invested','debt'];
  const metricLabels = { income:'Income', spending:'Spending', saved:'Saved', invested:'Invested', debt:'Debt Payments' };
  const typeMap = { income:'income', spending:'spend', saved:'savings', invested:'investment', debt:'debt_payment' };

  // For each period (from 2nd onward), compute projection from all prior periods, then compare to actual
  const evalPeriods = completedPast.slice(1); // need at least 1 prior period as history

  const rows = evalPeriods.map(period => {
    const priorPeriods = completedPast.filter(p => p.end < period.start);
    const avgN = Math.min(3, priorPeriods.length);
    const histWindow = priorPeriods.slice(-avgN);

    const projected = {};
    const actual = {};
    for (const m of metrics) {
      const actuals = histWindow.map(p =>
        transactions.filter(tx => isEffective(tx) && tx.type === typeMap[m] &&
          parseISO(tx.date) >= p.start && parseISO(tx.date) <= p.end
        ).reduce((s, tx) => s + Number(tx.amount), 0)
      );
      projected[m] = actuals.length ? actuals.reduce((s,v) => s+v, 0) / actuals.length : 0;

      actual[m] = transactions.filter(tx => isEffective(tx) && tx.type === typeMap[m] &&
        parseISO(tx.date) >= period.start && parseISO(tx.date) <= period.end
      ).reduce((s, tx) => s + Number(tx.amount), 0);
    }
    return { label: period.label, projected, actual };
  });

  // Compute overall accuracy per metric
  const metricAccuracy = metrics.map(m => {
    const vals = rows.map(r => {
      if (r.projected[m] === 0 && r.actual[m] === 0) return null;
      if (r.projected[m] === 0) return null;
      return 1 - Math.abs(r.actual[m] - r.projected[m]) / r.projected[m];
    }).filter(v => v !== null);
    const avg = vals.length ? vals.reduce((s,v) => s+v, 0) / vals.length : null;
    const bias = rows.reduce((s, r) => s + (r.actual[m] - r.projected[m]), 0) / rows.length;
    return { m, avg, bias };
  });

  return `<div class="section">
    <div class="section-header">
      <div class="section-title">Forecast Accuracy</div>
      <div class="text-sm text-muted">Projected vs actual for completed periods</div>
    </div>

    <!-- Accuracy summary cards -->
    <div class="stat-grid" style="grid-template-columns:repeat(${Math.min(metrics.length,5)},1fr);margin-bottom:1rem">
      ${metricAccuracy.map(({ m, avg, bias }) => {
        const pct = avg !== null ? Math.round(avg * 100) : null;
        const cls = pct === null ? 'text-muted' : pct >= 85 ? 'c-green' : pct >= 70 ? 'c-amber' : 'c-red';
        const biasDir = bias > 50 ? '▲ over' : bias < -50 ? '▼ under' : '≈ on track';
        return `<div class="card card-sm">
          <div class="card-title text-muted text-sm">${metricLabels[m]}</div>
          <div class="card-value text-mono ${cls}">${pct !== null ? pct + '%' : '—'}</div>
          <div class="text-sm text-muted">${biasDir}</div>
        </div>`;
      }).join('')}
    </div>

    <!-- Period comparison table -->
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Period</th>
            ${metrics.map(m => `<th class="amount-col">${metricLabels[m]}<br/><span class="text-muted" style="font-weight:400;font-size:.75rem">proj / actual</span></th>`).join('')}
          </tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td class="text-sm" style="white-space:nowrap">${escHtml(r.label)}</td>
              ${metrics.map(m => {
                const p = r.projected[m], a = r.actual[m];
                const variance = a - p;
                const cls = Math.abs(variance) < p * 0.1 ? '' : variance > 0 ? 'c-red' : 'c-green';
                return `<td class="amount-col text-sm">
                  <span class="text-muted">${fmtCurrency(p, cur)}</span> /
                  <span class="${cls}">${fmtCurrency(a, cur)}</span>
                </td>`;
              }).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

// ── CATEGORY BREAKDOWN ────────────────────────────────────────
function renderCategoryBreakdown(state, periods, currentPeriod, forecastN, cur) {
  const { transactions, categories, recurringTemplates } = state;

  // Actual spend from confirmed transactions
  const actualSpend = {};
  for (const tx of transactions.filter(tx => isEffective(tx) && tx.type === 'spend')) {
    const key = tx.category_id || 'uncategorised';
    actualSpend[key] = (actualSpend[key] || 0) + Number(tx.amount);
  }

  // Projected spend for future periods
  const futurePeriods = periods.filter(p => p.isFuture).slice(0, forecastN);
  const projSpend = {};
  for (const period of futurePeriods) {
    for (const t of recurringTemplates.filter(x => x.is_active && x.type === 'spend')) {
      const count = calcOccurrences(t, period);
      const key = t.category_id || 'uncategorised';
      projSpend[key] = (projSpend[key] || 0) + Number(t.amount) * count;
    }
  }

  const allKeys = new Set([...Object.keys(actualSpend), ...Object.keys(projSpend)]);
  if (!allKeys.size) return '';

  const rows = [...allKeys].map(key => {
    const cat = categories.find(c => c.id === key);
    return {
      name: cat ? `${cat.icon} ${cat.name}` : 'Uncategorised',
      actual: actualSpend[key] || 0,
      projected: projSpend[key] || 0,
    };
  }).sort((a, b) => (b.actual + b.projected) - (a.actual + a.projected));

  return `<div class="section">
    <div class="section-header">
      <div class="section-title">Category Breakdown</div>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Category</th>
            <th class="amount-col">Actual (all time)</th>
            <th class="amount-col">Projected (next ${forecastN} periods)</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td class="text-sm">${escHtml(r.name)}</td>
              <td class="amount-col text-mono">${r.actual > 0 ? fmtCurrency(r.actual, cur) : '—'}</td>
              <td class="amount-col text-mono text-muted" style="font-style:italic">${r.projected > 0 ? `~ ${fmtCurrency(r.projected, cur)}` : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}
