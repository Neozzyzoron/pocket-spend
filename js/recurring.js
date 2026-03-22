/* ═══════════════════════════════════════════════════════════════
   recurring.js — Recurring templates page
   TODO: template table, create/edit modal, log now, pause/resume, delete
═══════════════════════════════════════════════════════════════ */

export function render(state) {
  const el = document.getElementById('page-recurring');
  const active = state.recurringTemplates.filter(t => t.is_active);
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Recurring</div>
        <div class="page-subtitle">${active.length} active template${active.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="alert('Coming soon')">+ Create template</button>
      </div>
    </div>
    <div class="page-stub">
      <div class="page-stub-icon">↻</div>
      <h2>Recurring coming soon</h2>
      <p>Manage automatic transaction templates — monthly bills, income, subscriptions.</p>
    </div>
  `;
}
