/* ═══════════════════════════════════════════════════════════════
   transactions.js — Transaction list page
   TODO: table/card views, filters, inline editing, bulk actions, CSV export
═══════════════════════════════════════════════════════════════ */

export function render(state) {
  const el = document.getElementById('page-transactions');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Transactions</div>
        <div class="page-subtitle">${state.transactions.length} transactions</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="alert('Coming soon')">+ Add transaction</button>
      </div>
    </div>
    <div class="page-stub">
      <div class="page-stub-icon">↕</div>
      <h2>Transactions coming soon</h2>
      <p>Full transaction table with filters, inline editing, and CSV export.</p>
    </div>
  `;
}
