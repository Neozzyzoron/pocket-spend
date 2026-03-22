/* ═══════════════════════════════════════════════════════════════
   budgets.js — Budgets page
   TODO: budget cards, progress bars, rollover, over-time chart
═══════════════════════════════════════════════════════════════ */

export function render(state) {
  const el = document.getElementById('page-budgets');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Budgets</div>
        <div class="page-subtitle">${state.budgets.length} budget${state.budgets.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="alert('Coming soon')">+ Add budget</button>
      </div>
    </div>
    <div class="page-stub">
      <div class="page-stub-icon">◎</div>
      <h2>Budgets coming soon</h2>
      <p>Budget progress, rollover tracking, and period-over-period charts.</p>
    </div>
  `;
}
