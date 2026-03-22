/* ═══════════════════════════════════════════════════════════════
   analytics.js — Analytics page
   TODO: global filters, period summary cards, cash flow, net worth, spending by person
═══════════════════════════════════════════════════════════════ */

export function render(state) {
  const el = document.getElementById('page-analytics');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Analytics</div>
        <div class="page-subtitle">Trends and breakdowns</div>
      </div>
    </div>
    <div class="page-stub">
      <div class="page-stub-icon">∿</div>
      <h2>Analytics coming soon</h2>
      <p>Cash flow charts, spending breakdowns, net worth over time, and budget performance.</p>
    </div>
  `;
}
