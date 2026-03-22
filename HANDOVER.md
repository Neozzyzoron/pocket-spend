# Pocket Spend Tracker — Full Handover Document

## Overview
A household spend tracker for 2 users. Single `index.html` file hosted on GitHub Pages, Supabase backend. No build step. Everything confirmed through extended design sessions — do not deviate from this spec without explicit confirmation.

---

## 1. Stack & Infrastructure

### Frontend
- Single `index.html` — no build step, no framework, vanilla JS
- Hosted on GitHub Pages
- CDN dependencies only:
  - Supabase JS v2
  - Chart.js 4.4.1
  - Google Fonts: DM Sans, DM Mono

### Backend
- Supabase (PostgreSQL + Auth + Realtime)
- Project URL: `https://icyoamczvdqretolrdgg.supabase.co`
- Anon key hardcoded in file (safe — RLS protects all data)
- Row Level Security on every table via `get_my_household_id()` helper function

### Auth
- Email + password only
- Email confirmation disabled
- Session persisted via Supabase localStorage — no login required on refresh
- On page load: `getSession()` → if valid session exists go straight to app, never show login screen
- Only show login screen on genuine auth failure, never on data loading errors

### Users
- 2 users sharing one household
- Household created by User A
- User B joins with a 6-digit invite code stored on the household record

### Realtime
- Enabled on `transactions`, `categories`, `accounts`, `recurring_templates`
- Deduplication: `recentlyInserted` Set with 5s TTL prevents double-adding rows we just inserted ourselves

### Session & Navigation Persistence
- Active page saved to `localStorage` key `pocket_last_page` on every navigation
- On boot: restore to last active page after auth check
- Falls back to dashboard if stored page no longer exists

---

## 2. Database Schema

### Helper function (required for RLS)
```sql
CREATE OR REPLACE FUNCTION get_my_household_id()
RETURNS uuid AS $$
  SELECT household_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

---

### Table: `households`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| name | text | |
| invite_code | text | 6-digit, auto-generated on creation |
| currency | text | symbol e.g. "Kč", "$", "£" |

---

### Table: `profiles`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | = auth.users.id |
| household_id | uuid FK → households | |
| display_name | text | |
| preferences | jsonb | see preferences schema below |

**`preferences` jsonb structure:**
```json
{
  "columns": ["date","description","category","type","amount","account","person","recurring"],
  "dash": {
    "cards": {"income": true, "spending": true, ...},
    "cardOrder": ["income","spending","saved",...],
    "sections": {"breakdown": true, "cashflow": true, "recent": true}
  },
  "salary_day": 25,
  "cycle_mode": "month",
  "nav_order": ["dashboard","transactions","budgets","analytics","forecast","recurring","accounts","settings"],
  "forecast_avg_window": 3
}
```

---

### Table: `categories`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| household_id | uuid FK | |
| parent_id | uuid FK → categories | null = top-level group |
| name | text | |
| icon | text | emoji |
| color | text | hex |
| nature | text | Income / Essentials / Variables / Savings / Investments / Debt |
| spend_type | text | Fixed / Variable / One-time |
| default_tx_type | text | see transaction types |
| sort_order | integer | drag-to-reorder within level |

**Notes:**
- Groups (parent_id = null) are always selectable in transaction form
- If a group has subcategories, it shows as optgroup header AND selectable option at top of that group
- Subcategories always selectable
- sort_order applies independently within groups and within subcategories of each group
- Subcategories inherit icon/color/nature/spend_type/default_tx_type from parent as defaults when created

---

### Table: `accounts`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| household_id | uuid FK | |
| name | text | |
| type | text | checking / savings / investment / credit / loan / cash / custom |
| custom_type | text | display label when type = custom e.g. "Stavební spoření" |
| base_type | text | for custom accounts — which core type it behaves as |
| opening_balance | numeric | for loan: amount owed (positive). For others: starting balance |
| color | text | hex |
| is_archived | boolean | default false |
| expected_rate | numeric | % p.a. for savings/investment projection only |

**`effectiveType(account)` function:**
```
if account.type != 'custom' → account.type
if account.type == 'custom' → account.base_type
```
Used everywhere for grouping logic.

**Account groupings:**
- Liquid: effectiveType IN (checking, credit, cash)
- Wealth: effectiveType IN (checking, savings, investment, credit, cash)
- Debt: effectiveType IN (loan)
- Savings/Investment (return metrics): effectiveType IN (savings, investment)

**Archived accounts:**
- Hidden from all dropdowns and account cards
- Balance excluded from Net Balance, Net Worth, Total Debt
- Historical transactions still count in all stats, spending breakdown, budgets, export

---

### Table: `custom_account_types`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| household_id | uuid FK | shared across household |
| label | text | e.g. "Stavební spoření" |
| base_type | text | checking / savings / investment / credit / loan / cash |
| created_at | timestamptz | |

When creating a custom account: pick from saved custom types (auto-fills label + base_type) or create new (saves to this table for future reuse).

---

### Table: `transactions`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| household_id | uuid FK | |
| user_id | uuid FK → auth.users | |
| date | date | |
| description | text | |
| amount | numeric | always positive |
| type | text | see transaction types |
| status | text | confirmed / pending — default confirmed |
| category_id | uuid FK → categories | null for transfer and adjustment |
| account_id | uuid FK → accounts | source account |
| to_account_id | uuid FK → accounts | destination — savings/investment/transfer/withdrawal/debt_payment |
| notes | text | nullable |
| is_recurring | boolean | true = auto-logged from a template (read-only stamp) |
| recur_freq | text | stamped from template frequency (read-only stamp) |
| recurring_template_id | uuid FK → recurring_templates | links to source template |
| created_at | timestamptz | |

---

### Table: `recurring_templates`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| household_id | uuid FK | |
| user_id | uuid FK | |
| description | text | |
| amount | numeric | fixed amount logged per occurrence |
| type | text | same enum as transactions.type |
| nature_override | text | optional — overrides category nature |
| spend_type_override | text | optional — overrides category spend_type |
| category_id | uuid FK | null for transfer |
| account_id | uuid FK | source account |
| to_account_id | uuid FK | destination account |
| notes | text | nullable |
| frequency | text | weekly / bi-weekly / monthly / annually |
| day_of_week | integer | 0–6 (0=Mon) — for weekly and bi-weekly |
| day_of_month | integer | 1–31 — for monthly and annually |
| month_of_year | integer | 1–12 — for annually only |
| start_date | date | |
| is_active | boolean | default true |
| created_at | timestamptz | |

**Frequency rules:**
- weekly: every 7 days, lands on day_of_week
- bi-weekly: every 14 days, lands on day_of_week
- monthly: on day_of_month each month. If day > days in month → last day of month
- annually: on day_of_month of month_of_year each year. Same last-day rule applies

---

### Table: `budgets`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| household_id | uuid FK | |
| category_id | uuid FK | |
| amount | numeric | base limit per period |
| period_type | text | monthly / quarterly / annually |
| rollover_enabled | boolean | default false |

---

### Table: `budget_snapshots`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| household_id | uuid FK | |
| budget_id | uuid FK → budgets | |
| period_start | date | |
| period_end | date | |
| base_limit | numeric | what the budget was set to |
| actual_spend | numeric | confirmed transactions in that period |
| rollover | numeric | positive = underspend carried forward, negative = overspend |
| created_at | timestamptz | |

Unique constraint on `(budget_id, period_start)`.

Auto-generated on app load: for each budget, check if previous period has a snapshot. If not, calculate from transactions and insert. Idempotent — never duplicates.

**Budget period multiplier (for multi-period display):**
- Monthly budget × N periods selected
- Quarterly budget: 3 periods=×1, 6 periods=×2, 12 periods=×4
- Annual budget: 3 periods=×0.25, 6 periods=×0.5, 12 periods=×1

---

### Table: `household_settings`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| household_id | uuid FK | |
| theme | jsonb | accent/bg/surface/sidebar/border/text colors |
| account_order | jsonb | array of account ids for custom sort order |

---

### Table: `forecast_snapshots`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| household_id | uuid FK | |
| period_start | date | |
| period_end | date | |
| category_id | uuid FK | null = household total |
| projected_income | numeric | |
| projected_spend | numeric | |
| projected_saved | numeric | |
| projected_invested | numeric | |
| projected_debt_payments | numeric | |
| actual_income | numeric | filled at period end |
| actual_spend | numeric | filled at period end |
| actual_saved | numeric | filled at period end |
| actual_invested | numeric | filled at period end |
| actual_debt_payments | numeric | filled at period end |
| created_at | timestamptz | |

Unique constraint on `(household_id, period_start, category_id)`.

---

## 3. Transaction Types — Complete Behaviour

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

**Account field layout per type:**

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

**Balance effect per type:**

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

---

## 4. Pending Transactions

- Any transaction with date > today saved as `status = 'pending'`
- `isEffective(t)` = `t.status === 'confirmed' OR t.date <= today`
- No pre-generation of pending from templates — pending only from manual user input
- Templates never create future-dated transactions

**Where pending appears:**

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

---

## 5. Recurring Templates

**Two creation paths:**

1. **Template modal** (from Recurring page or Settings) — creates template only. No transaction logged unless start_date ≤ today (processRecurringDue fires after save).

2. **Transaction form** — "Create recurring template" checkbox. On save: logs transaction AND creates template. Transaction stamped with recurring_template_id.

**processRecurringDue() — runs on every app load:**
- Loops active templates only
- Calculates all due dates from start_date up to today
- For each due date: checks if transaction with recurring_template_id + date already exists
- If not: inserts confirmed transaction stamped with is_recurring=true, recur_freq, recurring_template_id
- Always inserts as confirmed regardless of how old the date is
- Idempotent — never creates duplicates

**Edit template:** Only affects future auto-logged transactions. Already-logged transactions never touched.

**Delete template:** Stops future auto-logging. Existing transactions untouched.

**Pause/Resume:** Toggles is_active. Paused templates skipped by processRecurringDue.

---

## 6. Dashboard

### Stat cards
12 toggleable, draggable cards. Order saved to `profiles.preferences.dash.cardOrder`.

| Card ID | Label | Period-aware |
|---|---|---|
| income | Income | — |
| spending | Spending | — |
| saved | Saved | — |
| invested | Invested | — |
| withdrawn | Withdrawn | — |
| debt_payments | Debt Payments | — |
| net_balance | Net Balance | — |
| net_worth | Net Worth | — |
| total_debt | Total Debt | — |
| due_eop | Due till end of month / Due till next salary | ✓ |
| expected_eop | Expected end of month balance / Expected end of cycle balance | ✓ |
| runway | Salary runway (hidden in monthly mode) | ✓ |

**Balanced grid layout:**
1→1col, 2→2, 3→3, 4→4, 5→3+2, 6→3+3, 7→4+3, 8→4+4, 9→3+3+3, 10→5+5, 11→4+4+3, 12→4+4+4

### Cycle mode toggle
Lives in sidebar, always visible if any salary_day is set.
Three states: Monthly / [User A name] cycle / [User B name] cycle
- Each user's salary_day stored in their own `profiles.preferences.salary_day`
- Both salary days settable by either user in Settings
- Global state: `profiles.preferences.cycle_mode` ('month' / 'user_a' / 'user_b')
- Changing on any page updates everywhere simultaneously

**Salary cycle calculation:**
- Cycle start = salary_day this month (or last month if we haven't reached it yet)
- Cycle end = day before salary_day next month
- If day > days in month → use last day

**Salary runway:**
```
days_elapsed = today − cycle_start
daily_spend = confirmed_spend_this_cycle ÷ days_elapsed
runway = net_balance ÷ daily_spend
```
Green > 14 days, amber 7–14, red < 7.

### Dashboard sections (toggleable)
- Spending breakdown (Nature / Group / Subcategory / All tabs)
- Cash flow chart (6 periods, respects cycle mode)
- Recent transactions (confirmed only, last 7)

---

## 7. Transaction List

### Views
Flat / Nature / Group / Subcategory / Hybrid

### Columns (all toggleable, saved to preferences)
Date, Description, Parent group, Category, Nature, Spend type, Transaction type, Status, Recurring (↻ freq or —), Amount, Account, Running balance*, Person, Notes

*Running balance only available as column option when single account filter is active.

### Filters
**Always visible:** Search (description + notes), Status (All/Confirmed/Pending)

**Dynamic filter chips (Option B):**
- "+ Add filter" button → pick column → pick value(s) → removable chip
- Available: Type, Category (multiselect), Account, Person, Month
- "Clear all" when any filter active
- Cascading multiselect: selecting a value narrows options in other filters bidirectionally

### Inline row editing (desktop only)
- Click edit → cells become inputs in-place
- Editable: Date, Description, Category, Type, Account(s), Amount, Notes, Status
- Read-only inline: Parent group, Nature, Spend type, Recurring, Person, Running balance
- Enter saves, Escape cancels
- Clicking edit on different row discards current edit
- Mobile: bottom sheet modal instead

### Bulk actions
Checkbox per row + select all → bulk delete → count shown in action bar

### CSV export
Exports current filtered view. Includes all visible columns + Status + Recurring frequency. BOM included for Excel.

---

## 8. Category Structure

**Two levels only:** Group (parent) → Subcategory (child)

**Groups:**
- Always selectable in transaction form
- If has subcategories: shows as optgroup header AND selectable option at top of group
- Draggable to reorder (sort_order)

**Subcategories:**
- Always selectable
- Draggable to reorder within their group (sort_order)
- Inherit parent defaults on creation

**Category fields:** name, icon, emoji, color, nature, spend_type, default_tx_type, sort_order

**Category modal — auto-populate flow:**
Picking a category in transaction form:
1. Auto-sets transaction type from default_tx_type
2. Shows/hides correct account fields
3. Pre-fills description with category name (editable)
4. Nature and spend_type auto-populate (overridable)

**Category required** for all types except transfer and adjustment.

---

## 9. Accounts Page

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
Draggable on accounts page and settings. Same order in all dropdowns everywhere.

### Custom account types
When type=custom: dropdown of saved custom_account_types (label + base_type). Can create new → saves for reuse.

---

## 10. Budgets

### Budget fields
Category, amount (base limit per period), period_type (monthly/quarterly/annually), rollover_enabled toggle

### Rollover
When enabled:
- Effective limit = base limit + rollover from previous period
- Rollover = previous period limit − actual spend (positive=underspend, negative=overspend)
- Shown on card: "↩ +2,400 Kč rolled over" or "↩ −800 Kč overspend"
- Calculated dynamically for current period
- Auto-snapshot generated at period end for history

### Budget period multiplier
Monthly×N, Quarterly: 3→×1, 6→×2, 12→×4, Annual: 3→×0.25, 6→×0.5, 12→×1

### Budget display
- Progress bar: green → amber at 80% → red at 100%+
- Views: Subcategory / Group / Nature
- Over time chart: actual vs limit line chart with overflow/underspend fills
- Respects active cycle mode

---

## 11. Analytics Page

### Global filters (apply to all sections simultaneously)
- Period: 3 / 6 / 12 periods + custom date range
- Account: All / specific
- Person: All / User A / User B
- View toggle: Nature / Group / Subcategory / Spend type (display grouping — separate from data filters)
- Data filters (cascading, bidirectional, order-independent): Nature multiselect, Group multiselect, Subcategory multiselect, Spend type multiselect

### Sections
1. **Period summary cards** — same style as dashboard: Total Income, Spending, Saved, Invested, Withdrawn, Debt Payments, Net
2. **Cash flow chart** — grouped bars per period (Income/Spending/Saved/Invested/Withdrawn)
3. **Totals over time** — line chart, one line per metric, toggle lines via legend
4. **Net worth over time** — line chart, toggle: Total only / Individual accounts / Both
5. **Spending by person** — grouped bar chart per period
6. **Budget performance** — own 3/6/12 period selector (no custom range), respects cycle mode, bar chart actual vs budget, rollover history

---

## 12. Forecast Page

### Global filters
- History window: 1 / 3 / 6 / 12 periods back (default 3)
- Forecast window: 1 / 3 / 6 / 12 periods forward (default 3)
- Person: All / User A / User B
- Category: multiselect
- View toggle: Nature / Group / Subcategory / Spend type
- Cascading data filters (same as analytics): Nature / Group / Subcategory / Spend type

All filters affect all sections simultaneously.

### Sections

**1. Forecast summary cards**
Scoped to forecast window (forward only). Projected: Income, Spending, Saved, Invested, Debt Payments, Expected closing balance. `~` prefix on all projected figures.

**2. Timeline chart**
- Past periods: solid bars (actuals)
- Current period: split (solid actual + hatched projection)
- Future periods: hatched (projections)
- Running balance line overlaid
- Clear visual divider at today

**3. Period table**
Covers full window (history + forecast):
- Rows: Income, Spending, Saved, Invested, Withdrawn, Debt Payments, Net, Balance
- Columns: one per period
- Past=normal, Current=highlighted, Future=muted+italic+~ prefix
- Totals column (sticky right) + Average column
- Row labels sticky left
- Toggle: Actuals only / Projections only / Both

**4. Category breakdown**
Always visible. Two charts side by side:
- Left: Actual spend so far (confirmed transactions)
- Right: Projected spend for forecast window
Both as doughnut/pie. Below: comparison table (actual / projected remaining / projected total / variance).

**5. Forecast accuracy**
Shown as soon as 1 completed period snapshot exists.
- Projected vs actual variance per metric
- Accuracy % per category
- Trend line: "projections consistently X% high/low"

### Projection logic
| Spend type | Method |
|---|---|
| Fixed (template) | exact template amount |
| Variable (template) | template amount blended with rolling average |
| Variable (no template) | rolling average of past N periods |
| One-time | not projected |
| Income (template) | exact template amount |
| Income (no template) | rolling average |

Rolling average window: user-selectable 3/6/12, saved to `profiles.preferences.forecast_avg_window`.

---

## 13. Recurring Page

### Layout
- "+ Create template" button → dedicated template modal
- Summary card: Expected this period / Due not yet logged
- Template table: Description, Category, Account, Amount, Frequency, Day, Next due, This period status

### Template row actions
Log now · Edit · Pause/Resume · Delete

### Template modal fields
Category (auto-sets type + nature + spend_type), Amount, Description, Account fields (adapt to type), Frequency, Day of week (weekly/bi-weekly), Day of month (monthly/annually), Month of year (annually), Start date, Notes, Transaction type override, Nature override, Spend type override

---

## 14. Settings Page

### Sections (in order)
1. **Household** — name, invite code, members
2. **Display** — currency symbol, User A salary day, User B salary day, nav tab order (draggable)
3. **Theme** — 4 color areas (accent/bg/surface/sidebar), 32-color palette each, live preview
4. **Accounts** — full table, drag reorder, edit/archive/delete, import/export CSV, bulk delete
5. **Categories** — collapsible tree, drag reorder groups and subcategories independently, edit/delete, bulk delete, import/export CSV
6. **Recurring** — template list, "+ Create template" button
7. **Account** — display name, sign out

---

## 15. Navigation

### Default tab order
1. Dashboard
2. Transactions
3. Budgets
4. Analytics
5. Forecast
6. Recurring
7. Accounts
8. Settings

User can reorder in Settings → Display. Order saved to `profiles.preferences.nav_order`. Settings always accessible.

### Sidebar (desktop)
- Full nav list
- Cycle mode toggle (Monthly / User A cycle / User B cycle) — only shown if at least one salary_day set
- User pill (name, household) at bottom
- Sign out button

### Mobile
- Hamburger button top left
- Sidebar slides in as overlay
- Cycle toggle in sidebar
- Bottom sheet modals for all forms
- Tab bar or hamburger only — no persistent sidebar

---

## 16. Mobile Layout

### Breakpoints
- Desktop: > 768px
- Tablet: 481–768px
- Mobile: ≤ 480px

### Transaction list on mobile
- Table hidden → card list shown
- Each card: date, description, category, amount, type badge, pending badge
- Tap card → bottom sheet edit modal

### Dashboard on mobile
- 2-column stat grid (1 column < 380px)
- Sections stack vertically

### Filters on mobile
- Search always visible full width
- Status always visible
- "+ Add filter" opens bottom sheet
- Active chips shown below search, horizontally scrollable

### Forms on mobile
- Full width bottom sheet
- Type selector: 2×3 grid
- From/To selectors stack vertically
- Save button sticky bottom

### Analytics/Forecast on mobile
- Charts full width
- Tables scroll horizontally, first column sticky
- Global filters in collapsible panel (collapsed by default)

### Categories on mobile
- Actions always visible (no hover)
- Drag handles hidden — reorder via up/down buttons

---

## 17. Key UX Rules

1. **Category-first transaction form** — category at top, auto-sets type, pre-fills description
2. **Category always required** except transfer and adjustment
3. **All dropdowns respect sort order** set in settings — categories (sort_order), accounts (account_order)
4. **Inline edit on desktop, modal on mobile** for transactions
5. **Pending = future date** — auto-set, no extra toggle needed
6. **Templates never appear in transaction list** — only generated transactions do
7. **Archive ≠ delete** — archived accounts hide from UI but transactions preserved
8. **Cycle mode is global** — changing on any page updates everywhere
9. **Cascading filters are bidirectional** — selecting any filter narrows all others, order-independent
10. **Refresh stays on current page** — localStorage persistence
11. **No logout on refresh** — Supabase session auto-restored

---

## 18. Colour System (CSS Variables)

```css
--green, --green-l (accent)
--blue, --blue-l
--red, --red-l  
--amber, --amber-l
--surface, --surface2
--border
--text, --text2, --text3
--bg
--sidebar-bg
```

Theme customisable per household, saved to `household_settings.theme`. Applied on load.

---

## 19. What NOT to do

- Do not use `is_recurring = true` as a template marker — templates live in `recurring_templates` table only
- Do not pre-generate future pending transactions from templates
- Do not break `processRecurringDue` idempotency — always check before inserting
- Do not use modal for transaction editing on desktop — inline row edit only
- Do not allow category filter to conflict (use cascading logic)
- Do not reset session on data load errors — only on auth errors
- Do not ignore sort_order — all dropdowns must respect user-defined order
- Do not hardcode cycle mode — always read from `profiles.preferences.cycle_mode`
