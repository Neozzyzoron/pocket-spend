/* ═══════════════════════════════════════════════════════════════
   forecast.js — Forecast page
   TODO: projection logic, timeline chart, period table, category breakdown, accuracy
═══════════════════════════════════════════════════════════════ */

export function render(state) {
  const el = document.getElementById('page-forecast');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Forecast</div>
        <div class="page-subtitle">Projected income and spending</div>
      </div>
    </div>
    <div class="page-stub">
      <div class="page-stub-icon">◈</div>
      <h2>Forecast coming soon</h2>
      <p>Forward projections based on recurring templates and spending history.</p>
    </div>
  `;
}
