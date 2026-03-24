# Pocket Spend Tracker — Claude Code Instructions

## IMPORTANT: Read at session start
1. **Read TODO.md in full** — it is the authoritative spec AND the task list
2. **Check what is already done** (marked ✅) before implementing anything
3. **After confirming a task is complete with the user** — update TODO.md: mark it ✅ DONE, add a brief note
4. **Never implement a "NEEDS DESIGN DISCUSSION" item** from TODO.md without explicit user sign-off
5. **Work one gap / one feature at a time** — stop and wait for user review between tasks

---

## What this project is
A household spend tracker for 2 users. Multi-file vanilla JS frontend hosted on GitHub Pages, Supabase backend. No build step. No framework.

## Project structure
```
pocket-spend/
├── CLAUDE.md          ← you are here
├── TODO.md            ← authoritative spec + task list — READ THIS FIRST
├── setup.sql          ← full DB schema and RLS policies
├── index.html         ← app shell, auth screens, sidebar, modals
├── css/
│   └── styles.css     ← complete design system, CSS variables, all components
└── js/
    ├── utils.js       ← Supabase client, formatters, date helpers, shared logic
    ├── app.js         ← boot, auth, routing, realtime, processRecurringDue
    ├── dashboard.js   ← Dashboard page
    ├── transactions.js← Transactions page
    ├── accounts.js    ← Accounts page
    ├── budgets.js     ← Budgets page
    ├── analytics.js   ← Analytics page
    ├── forecast.js    ← Forecast page
    ├── recurring.js   ← Recurring templates page
    └── settings.js    ← Settings page
```

## Before implementing any feature
1. Read TODO.md — check what's done, what's next, and the relevant spec section
2. Read `utils.js` to understand shared helpers already available
3. Read `app.js` to understand global state (`window.App.state`) and APIs

## Global state (window.App.state)
Available in every page module:
```js
state.user              // current auth user
state.profile           // current user's profile row
state.household         // household row (has .currency)
state.profiles          // all household members (sorted)
state.settings          // household_settings row
state.accounts          // all accounts
state.categories        // all categories
state.transactions      // all transactions (newest first)
state.recurringTemplates// all recurring templates
state.budgets           // all budgets
state.budgetSnapshots   // all budget snapshots
state.prefs             // current user merged preferences
state.accountOrder      // array of account ids for sort order
state.currentPage       // active page name
```

## Global APIs (window.App)
```js
App.toast(msg, type)           // 'success' | 'error' | 'info' | 'warning'
App.openModal(title, html)     // opens modal (desktop) or bottom sheet (mobile)
App.closeModal()               // closes modal or sheet
App.openConfirm(title, msg)    // returns Promise<boolean>
App.navigate(page)             // navigate to page
App.currency()                 // household currency symbol e.g. 'Kč'
App.cycleMode()                // 'month' | 'user_a' | 'user_b'
App.cyclePeriod()              // { start: Date, end: Date, label: string }
App.supabase                   // supabase client
App.loadAllData()              // reload all data from DB
App.refreshCurrentPage()       // re-render current page
App.renderSidebarNav()         // update sidebar nav
App.renderCycleToggle()        // update cycle toggle
App.renderUserPill()           // update user pill
```

## Shared utilities (import from ./utils.js)
```js
fmtCurrency(amount, currency)  // format as currency string
fmtDate(d, style)              // 'short' | 'medium' | 'long'
fmtRelDate(d)                  // 'Today', 'Yesterday', '5 Mar'
fmtPct(value)                  // '12.5%'
todayISO()                     // 'YYYY-MM-DD'
toISO(date)                    // Date → 'YYYY-MM-DD'
parseISO(str)                  // 'YYYY-MM-DD' → Date
isEffective(tx)                // confirmed OR date <= today
calcCycle(mode, prefs)         // { start, end, label }
buildCategoryTree(categories)  // { groups, subsByParent }
buildCategoryOptions(cats, selectedId) // <option> HTML
buildAccountOptions(accounts, order, filterFn, selectedId) // <option> HTML
calcAccountBalance(account, transactions) // numeric balance
effectiveType(account)         // resolves 'custom' to base_type
isLiquid(account)              // checking | credit | cash
escHtml(str)                   // XSS-safe string
TX_TYPE_LABELS                 // { spend: 'Spend', income: 'Income', ... }
```

## Page module pattern
Every page file must export a render function:
```js
export function render(state) {
  const el = document.getElementById('page-pagename');
  el.innerHTML = `...`;
  // attach event listeners after setting innerHTML
}
```

## CSS design system
Use existing CSS classes — do NOT add inline styles or new CSS unless absolutely necessary.
Key classes:
- Layout: `.page-header`, `.page-title`, `.page-actions`, `.section`, `.section-header`
- Cards: `.card`, `.card-sm`, `.card-header`, `.card-title`, `.card-value`, `.card-meta`
- Grids: `.stat-grid` (use grid-template-columns in inline style for column count)
- Tables: `.table-wrap`, `.table`, `.amount-col`, `.positive`, `.negative`
- Buttons: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.btn-icon`
- Forms: `.form-group`, `.form-label`, `.form-input`, `.form-select`, `.form-textarea`, `.form-row`, `.form-check`, `.form-error`, `.form-hint`
- Badges: `.badge`, `.badge-green`, `.badge-red`, `.badge-amber`, `.badge-blue`, `.badge-neutral`
- Type badges: `.badge-spend`, `.badge-income`, `.badge-savings`, `.badge-investment`, `.badge-transfer`, `.badge-withdrawal`, `.badge-debt_payment`, `.badge-pending`
- Misc: `.toggle-group`, `.toggle-group-btn`, `.chip`, `.progress-bar`, `.progress-fill`, `.empty-state`, `.drag-handle`, `.divider`
- Utilities: `.hidden`, `.truncate`, `.text-mono`, `.text-muted`, `.text-sm`, `.c-green`, `.c-red`, `.c-amber`

## Supabase patterns
Always filter by household_id. Never chain .select() after UPDATE (causes RLS issues).

```js
// Correct UPDATE pattern
const { error } = await App.supabase
  .from('table')
  .update({ field: value })
  .eq('id', row.id)
  .eq('household_id', App.state.household.id);

// Correct INSERT pattern
const { data, error } = await App.supabase
  .from('table')
  .insert({ ...fields, household_id: App.state.household.id })
  .select()
  .single();

// After mutation: patch local state immediately, don't re-fetch
if (!error) {
  const idx = App.state.items.findIndex(i => i.id === row.id);
  if (idx !== -1) App.state.items[idx] = { ...App.state.items[idx], field: value };
}
```

## Key rules (never violate)
- Category required for all tx types EXCEPT transfer and adjustment
- Pending = any transaction with date > today (status = 'pending')
- `isEffective(tx)` determines if tx counts in stats/balances
- `effectiveType(account)` must be used for all account type checks
- Archived accounts hidden from dropdowns, balance excluded from stats
- Sort order: categories by `sort_order`, accounts by `account_order` array
- Never re-fetch after mutations — patch local state immediately
- Never show modal for tx editing on desktop — inline row edit only
- Cycle mode is global — always read from `state.prefs.cycle_mode`

## Supabase credentials
URL:  https://blnxkxhwllawdzghvwyy.supabase.co
Key:  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsbnhreGh3bGxhd2R6Z2h2d3l5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NzYzNzgsImV4cCI6MjA4OTQ1MjM3OH0.jPe8eFxKHCrSRr-m6QU8iQvg2OZ0r4bQr6i1NPtnd_w
(Already hardcoded in js/utils.js — do not change)

## GitHub
Repo: https://github.com/neozzyzoron/pocket-spend
Live: https://neozzyzoron.github.io/pocket-spend/
