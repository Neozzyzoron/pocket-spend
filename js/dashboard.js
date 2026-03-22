/* ═══════════════════════════════════════════════════════════════
   dashboard.js — Dashboard page
   TODO: implement stat cards, spending breakdown, cashflow chart, recent transactions
═══════════════════════════════════════════════════════════════ */

export function render(state) {
  const el = document.getElementById('page-dashboard');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-subtitle">Overview of your household finances</div>
      </div>
    </div>
    <div class="page-stub">
      <div class="page-stub-icon">◉</div>
      <h2>Dashboard coming soon</h2>
      <p>Stat cards, spending breakdown, cash flow chart and recent transactions will live here.</p>
    </div>
  `;
}
