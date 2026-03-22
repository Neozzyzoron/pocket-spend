/* ═══════════════════════════════════════════════════════════════
   settings.js — Settings page
   TODO: household, display, theme, accounts table, categories tree, recurring, account section
═══════════════════════════════════════════════════════════════ */

export function render(state) {
  const el = document.getElementById('page-settings');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Settings</div>
        <div class="page-subtitle">Household · Display · Theme · Accounts · Categories</div>
      </div>
    </div>
    <div class="page-stub">
      <div class="page-stub-icon">⚙</div>
      <h2>Settings coming soon</h2>
      <p>Household details, theme customisation, account management, category tree, and more.</p>
    </div>
  `;
}
