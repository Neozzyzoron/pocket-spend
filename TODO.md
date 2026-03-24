# Pocket Spend — TODO & Product Spec

## How sessions should use this file
1. **Read this file in full at the start of every session** — it is the authoritative spec and task list
2. **Before implementing anything** — check the relevant spec section below
3. **After a task is confirmed complete by the user** — update status to `✅ DONE` and add a brief note
4. **Never implement a "NEEDS DESIGN DISCUSSION" item** without explicit user approval first
5. **One gap / one feature at a time** — stop and wait for user review between tasks

---

## Branch
`claude/read-docs-start-app-7Dyce`

---

## ACTIVE — Forecast Page Rework

Work one gap at a time. Stop after each and wait for user review.

### Gap 1 — Filters ✅ DONE
- ✅ View toggle (Nature / Group / Subcategory / Spend type)
- ✅ Category multiselect filter
- ✅ Cascading data filters (Nature / Group / Subcategory / Spend type — bidirectional, order-independent)
- ✅ Category breakdown table updated with correct columns (actual / projected remaining / projected total / variance)

### Gap 2 — Timeline chart
- [ ] Running balance line overlaid on bar chart (line dataset, right y-axis)
- [ ] Current period split: solid bars for actual portion, hatched fill for projected remainder
- [ ] Visual divider annotation at today

### Gap 3 — Period table
- [ ] Add Withdrawn row (currently missing)
- [ ] Add Net row (income + withdrawn − spending − saved − invested − debt)
- [ ] Add Balance row (running liquid balance)
- [ ] Add Average column
- [ ] Actuals / Projections / Both toggle

### Gap 4 — Category breakdown
- [ ] Two doughnut charts side by side (Actual vs Projected)
- [ ] Table columns: actual / projected remaining / projected total / variance (columns added in Gap 1 ✅)

### Gap 5 — Forecast accuracy
- [ ] Lower threshold from 2 completed periods to 1
- [ ] Accuracy % per category (not just per metric)
- [ ] Trend bias line on chart

---

## PENDING — Analytics Page (full build)

### Global filters (apply to all sections simultaneously)
- Period: 3 / 6 / 12 periods + custom date range
- Account: All / specific
- Person: All / User A / User B
- View toggle: Nature / Group / Subcategory / Spend type
- Data filters (cascading, bidirectional): Nature, Group, Subcategory, Spend type multiselect

### Sections to build
1. **Period summary cards** — Total Income, Spending, Saved, Invested, Withdrawn, Debt Payments, Net
2. **Cash flow chart** — grouped bars per period (Income / Spending / Saved / Invested / Withdrawn)
3. **Totals over time** — line chart, one line per metric, toggle lines via legend
4. **Net worth over time** — line chart, toggle: Total only / Individual accounts / Both
5. **Spending by person** — grouped bar chart per period
6. **Budget performance** — own 3/6/12 period selector (no custom range), respects cycle mode, bar chart actual vs budget, rollover history

---

## PENDING — Budgets Improvements

### Budget fields
- Category, amount (base limit per period), period_type (monthly/quarterly/annually), rollover_enabled toggle

### Rollover logic
- Effective limit = base limit + rollover from previous period
- Rollover = previous period limit − actual spend (positive = underspend, negative = overspend)
- Card sub-line: "↩ +2,400 Kč rolled over" or "↩ −800 Kč overspend"
- Calculated dynamically for current period
- Auto-snapshot generated at period end for history

### Budget period multiplier
| Budget type | 3 periods | 6 periods | 12 periods |
|---|---|---|---|
| Monthly | ×3 | ×6 | ×12 |
| Quarterly | ×1 | ×2 | ×4 |
| Annual | ×0.25 | ×0.5 | ×1 |

### Budget display
- Progress bar: green → amber at 80% → red at 100%+
- Views: Subcategory / Group / Nature
- Over time chart: actual vs limit line chart with overflow/underspend fills
- Respects active cycle mode

---

## PENDING — Accounts Page Improvements

### Account card
- Color bar, name, type label, balance (large)
- Loan: balance = amount owed, red until zero, ✓ when paid off
- Sub-line: tx count · opening balance · base type if custom
- Savings/Investment only: return metrics (contributed, growth, growth%, annualised%, projected monthly if expected_rate set)
- Actions: Edit · Adjust balance · Archive · Delete

### Archive behaviour
- Archive: hidden from UI and dropdowns, balance excluded from calculations, transactions still count everywhere
- Delete: permanent, transactions remain but unlinked from account

### Account ordering
- Draggable on accounts page and settings
- Same order in all dropdowns everywhere

### Custom account types
- When type=custom: dropdown of saved custom_account_types (label + base_type)
- Can create new → saves for reuse

---

## NEEDS DESIGN DISCUSSION — (do not implement without user sign-off)

### Themes — per-user isolation
- Bug: changing theme for User B also changes for User A — theme must be user-scoped, not household-scoped
- Need to decide which settings are per-user vs per-household

### Colors / palette
- Define a proper palette
- 3–6 predefined themes
- Rethink how theme colors are derived (CSS variables, token system, etc.)

### Icons / Emoji
- Default to a single curated emoji set, or manual add + picker
- Option to load proper icon sets (custom or multiple sets)

### Display tiles — layout and drag
- Fine-tune ordering and column splits
- Explore drag-and-resize tiles directly on tabs
- If drag-resize introduced: consider separate tab for categories, remove from settings (or keep settings for quick edits)

---

## PRODUCT SPEC — Reference

Read the relevant section before implementing. This replaces HANDOVER.md.

### Transaction types — complete behaviour

| Type | From/To | Category required | Counts as | Stat card |
|---|---|---|---|---|
| spend | Single (source) | ✓ | Spending | Spending |
| income | Single (destination) | ✓ | Income | Income |
| savings | From liquid → To savings | ✓ | Saved | Saved |
| investment | From liquid → To investment | ✓ | Invested | Invested |
| transfer | From → To (any) | ✗ | Nothing | — |
| withdrawal | From savings/investment → To liquid | ✓ | Withdrawn | Withdrawn |
| debt_payment | From liquid → To loan | ✓ | Spending + reduces loan | Debt Payments |
| adjustment | Single | ✗ | Nothing | — |

Account field layout per type:

| Type | Account fields |
|---|---|
| spend | Single account (source) |
| income | Single account (destination) |
| savings | From (liquid) + To (savings accounts only) |
| investment | From (liquid) + To (investment accounts only) |
| transfer | From (any) + To (any) |
| withdrawal | From (savings/investment only) + To (liquid only) |
| debt_payment | From (liquid) + To (loan accounts only) |
| adjustment | Single account |

Balance effects:

| Type | account_id | to_account_id |
|---|---|---|
| income | + amount | — |
| spend | − amount | — |
| savings | − amount | + amount |
| investment | − amount | + amount |
| transfer | − amount | + amount |
| withdrawal | − amount | + amount |
| debt_payment | − amount | − amount (loan decreases) |
| adjustment | + amount (can be negative) | — |

### Pending transactions
- Any transaction with date > today saved as status = `pending`
- `isEffective(t)` = `t.status === 'confirmed'` OR `t.date <= today`
- No pre-generation of pending from templates — pending only from manual user input
- Templates never create future-dated transactions

| Location | Pending included |
|---|---|
| Transaction list | ✓ (muted row, PENDING badge, confirm button) |
| Dashboard recent transactions | ✗ |
| Account balances | ✗ |
| Dashboard stat cards | ✗ |
| Spending breakdown | ✗ |
| Budget progress | ✗ |
| Due till end of period tile | ✓ |
| Expected end of period balance tile | ✓ |
| Forecast page | ✓ |
| CSV export | ✓ (status column included) |

### Categories
- Groups (`parent_id = null`) are always selectable in transaction form
- If a group has subcategories, it shows as optgroup header AND selectable option at top
- Subcategories always selectable
- `sort_order` applies independently within groups and within subcategories of each group
- Subcategories inherit icon/color/nature/spend_type/default_tx_type from parent as defaults

Category fields: `nature` (Income / Essentials / Variables / Savings / Investments / Debt), `spend_type` (Fixed / Variable / One-time), `default_tx_type`

### Accounts
- `effectiveType(account)`: if `type != 'custom'` → `type`; if `type == 'custom'` → `base_type`
- Use `effectiveType` everywhere for grouping logic
- Liquid: effectiveType IN (checking, credit, cash)
- Wealth: effectiveType IN (checking, savings, investment, credit, cash)
- Debt: effectiveType IN (loan)
- Archived: hidden from dropdowns, balance excluded from Net Balance / Net Worth / Total Debt, historical transactions still count everywhere

### Recurring templates
Frequency rules:
- `weekly`: every 7 days, lands on `day_of_week`
- `bi-weekly`: every 14 days, lands on `day_of_week`
- `monthly`: on `day_of_month` each month — if day > days in month → last day
- `annually`: on `day_of_month` of `month_of_year` — same last-day rule

### Database tables (summary)

| Table | Key columns |
|---|---|
| households | id, name, invite_code, currency |
| profiles | id (= auth.users.id), household_id, display_name, preferences jsonb |
| categories | id, household_id, parent_id, name, icon, color, nature, spend_type, default_tx_type, sort_order |
| accounts | id, household_id, name, type, custom_type, base_type, opening_balance, color, is_archived, expected_rate |
| custom_account_types | id, household_id, label, base_type |
| transactions | id, household_id, user_id, date, description, amount, type, status, category_id, account_id, to_account_id, notes, is_recurring, recur_freq, recurring_template_id |
| recurring_templates | id, household_id, user_id, description, amount, type, category_id, account_id, to_account_id, frequency, day_of_week, day_of_month, month_of_year, start_date, is_active |
| budgets | id, household_id, category_id, amount, period_type, rollover_enabled |
| budget_snapshots | id, household_id, budget_id, period_start, period_end, base_limit, actual_spend, rollover |
| household_settings | id, household_id, theme jsonb, account_order jsonb |
| forecast_snapshots | id, household_id, period_start, period_end, category_id, projected_income/spend/saved/invested/debt_payments, actual_income/spend/saved/invested/debt_payments |

`profiles.preferences` jsonb shape:
```json
{
  "columns": ["date","description","category","type","amount","account","person","recurring"],
  "dash": {
    "cards": {"income": true, "spending": true},
    "cardOrder": ["income","spending","saved"],
    "sections": {"breakdown": true, "cashflow": true, "recent": true}
  },
  "salary_day": 25,
  "cycle_mode": "month",
  "nav_order": ["dashboard","transactions","budgets","analytics","forecast","recurring","accounts","settings"],
  "forecast_avg_window": 3
}
```

RLS helper (required):
```sql
CREATE OR REPLACE FUNCTION get_my_household_id() RETURNS uuid AS $$
  SELECT household_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### Key UX rules (do not violate)
1. Category-first transaction form — category at top, auto-sets type, pre-fills description
2. Category always required except transfer and adjustment
3. All dropdowns respect sort order — categories (`sort_order`), accounts (`account_order`)
4. Inline edit on desktop, modal on mobile for transactions
5. Pending = future date — auto-set, no extra toggle
6. Templates never appear in transaction list — only generated transactions do
7. Archive ≠ delete — archived accounts hide from UI but transactions preserved
8. Cycle mode is global — changing on any page updates everywhere
9. Cascading filters are bidirectional — selecting any filter narrows all others, order-independent
10. Refresh stays on current page — localStorage persistence
11. No logout on refresh — Supabase session auto-restored

### What NOT to do
- Do not use `is_recurring = true` as a template marker — templates live in `recurring_templates` only
- Do not pre-generate future pending transactions from templates
- Do not break `processRecurringDue` idempotency — always check before inserting
- Do not use modal for transaction editing on desktop — inline row edit only
- Do not allow category filter to conflict (use cascading logic)
- Do not reset session on data load errors — only on auth errors
- Do not ignore `sort_order` — all dropdowns must respect user-defined order
- Do not hardcode cycle mode — always read from `profiles.preferences.cycle_mode`
- Never chain `.select()` after UPDATE (causes RLS issues)
- Always filter by `household_id` on every query
