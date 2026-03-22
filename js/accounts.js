/* ═══════════════════════════════════════════════════════════════
   accounts.js — Accounts page
   TODO: account cards, balance calc, savings metrics, archive/delete, adjust balance
═══════════════════════════════════════════════════════════════ */

export function render(state) {
  const el = document.getElementById('page-accounts');
  const active = state.accounts.filter(a => !a.is_archived);
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Accounts</div>
        <div class="page-subtitle">${active.length} active account${active.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="alert('Coming soon')">+ Add account</button>
      </div>
    </div>
    <div class="page-stub">
      <div class="page-stub-icon">▣</div>
      <h2>Accounts coming soon</h2>
      <p>Account cards with balances, savings metrics, and management tools.</p>
    </div>
  `;
}
