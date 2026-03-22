-- ================================================================
-- POCKET SPEND TRACKER — COMPLETE SETUP SQL
-- Run this in Supabase SQL Editor to set up everything from scratch
-- WARNING: This drops and recreates all app tables
-- Users (auth.users) and your project URL/anon key are NOT affected
-- ================================================================

-- ================================================================
-- STEP 1: DROP EXISTING TABLES (in dependency order)
-- ================================================================
DROP TABLE IF EXISTS forecast_snapshots       CASCADE;
DROP TABLE IF EXISTS budget_snapshots         CASCADE;
DROP TABLE IF EXISTS budgets                  CASCADE;
DROP TABLE IF EXISTS transactions             CASCADE;
DROP TABLE IF EXISTS recurring_templates      CASCADE;
DROP TABLE IF EXISTS custom_account_types     CASCADE;
DROP TABLE IF EXISTS accounts                 CASCADE;
DROP TABLE IF EXISTS categories               CASCADE;
DROP TABLE IF EXISTS household_settings       CASCADE;
DROP TABLE IF EXISTS profiles                 CASCADE;
DROP TABLE IF EXISTS households               CASCADE;

-- ================================================================
-- STEP 2: DROP EXISTING FUNCTIONS & TYPES
-- ================================================================
DROP FUNCTION IF EXISTS get_my_household_id() CASCADE;

-- ================================================================
-- STEP 3: CREATE TABLES
-- ================================================================

-- households
CREATE TABLE households (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  invite_code  text NOT NULL UNIQUE,
  currency     text NOT NULL DEFAULT 'Kč'
);

-- profiles (one per auth user)
CREATE TABLE profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id uuid REFERENCES households(id) ON DELETE SET NULL,
  display_name text NOT NULL DEFAULT '',
  preferences  jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- household_settings (one per household)
CREATE TABLE household_settings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL UNIQUE REFERENCES households(id) ON DELETE CASCADE,
  theme         jsonb NOT NULL DEFAULT '{}'::jsonb,
  account_order jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- categories
CREATE TABLE categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES categories(id) ON DELETE CASCADE,
  name            text NOT NULL,
  icon            text NOT NULL DEFAULT '📦',
  color           text NOT NULL DEFAULT '#6aa84f',
  nature          text NOT NULL DEFAULT 'Variables'
                  CHECK (nature IN ('Income','Essentials','Variables','Savings','Investments','Debt')),
  spend_type      text NOT NULL DEFAULT 'Variable'
                  CHECK (spend_type IN ('Fixed','Variable','One-time')),
  default_tx_type text NOT NULL DEFAULT 'spend'
                  CHECK (default_tx_type IN ('spend','income','savings','investment','transfer','withdrawal','debt_payment')),
  sort_order      integer NOT NULL DEFAULT 0
);

-- custom_account_types (shared across household)
CREATE TABLE custom_account_types (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  label        text NOT NULL,
  base_type    text NOT NULL
                CHECK (base_type IN ('checking','savings','investment','credit','loan','cash')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- accounts
CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name            text NOT NULL,
  type            text NOT NULL DEFAULT 'checking'
                  CHECK (type IN ('checking','savings','investment','credit','loan','cash','custom')),
  custom_type     text,
  base_type       text
                  CHECK (base_type IN ('checking','savings','investment','credit','loan','cash')),
  opening_balance numeric NOT NULL DEFAULT 0,
  color           text NOT NULL DEFAULT '#2D5A3D',
  is_archived     boolean NOT NULL DEFAULT false,
  expected_rate   numeric
);

-- recurring_templates
CREATE TABLE recurring_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  description        text NOT NULL,
  amount             numeric NOT NULL CHECK (amount > 0),
  type               text NOT NULL
                     CHECK (type IN ('spend','income','savings','investment','transfer','withdrawal','debt_payment')),
  nature_override    text CHECK (nature_override IN ('Income','Essentials','Variables','Savings','Investments','Debt')),
  spend_type_override text CHECK (spend_type_override IN ('Fixed','Variable','One-time')),
  category_id        uuid REFERENCES categories(id) ON DELETE SET NULL,
  account_id         uuid REFERENCES accounts(id) ON DELETE SET NULL,
  to_account_id      uuid REFERENCES accounts(id) ON DELETE SET NULL,
  notes              text,
  frequency          text NOT NULL
                     CHECK (frequency IN ('weekly','bi-weekly','monthly','annually')),
  day_of_week        integer CHECK (day_of_week BETWEEN 0 AND 6),
  day_of_month       integer CHECK (day_of_month BETWEEN 1 AND 31),
  month_of_year      integer CHECK (month_of_year BETWEEN 1 AND 12),
  start_date         date NOT NULL DEFAULT current_date,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- transactions
CREATE TABLE transactions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id           uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  date                   date NOT NULL,
  description            text NOT NULL,
  amount                 numeric NOT NULL CHECK (amount > 0),
  type                   text NOT NULL
                         CHECK (type IN ('spend','income','savings','investment','transfer','withdrawal','debt_payment','adjustment')),
  status                 text NOT NULL DEFAULT 'confirmed'
                         CHECK (status IN ('confirmed','pending')),
  category_id            uuid REFERENCES categories(id) ON DELETE SET NULL,
  account_id             uuid REFERENCES accounts(id) ON DELETE SET NULL,
  to_account_id          uuid REFERENCES accounts(id) ON DELETE SET NULL,
  notes                  text,
  is_recurring           boolean NOT NULL DEFAULT false,
  recur_freq             text,
  recurring_template_id  uuid REFERENCES recurring_templates(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- budgets
CREATE TABLE budgets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id      uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  amount           numeric NOT NULL CHECK (amount > 0),
  period_type      text NOT NULL DEFAULT 'monthly'
                   CHECK (period_type IN ('monthly','quarterly','annually')),
  rollover_enabled boolean NOT NULL DEFAULT false,
  UNIQUE (household_id, category_id)
);

-- budget_snapshots
CREATE TABLE budget_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  budget_id    uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  base_limit   numeric NOT NULL,
  actual_spend numeric NOT NULL DEFAULT 0,
  rollover     numeric NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, period_start)
);

-- forecast_snapshots
CREATE TABLE forecast_snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id          uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  category_id           uuid REFERENCES categories(id) ON DELETE SET NULL,
  projected_income      numeric NOT NULL DEFAULT 0,
  projected_spend       numeric NOT NULL DEFAULT 0,
  projected_saved       numeric NOT NULL DEFAULT 0,
  projected_invested    numeric NOT NULL DEFAULT 0,
  projected_debt_payments numeric NOT NULL DEFAULT 0,
  actual_income         numeric,
  actual_spend          numeric,
  actual_saved          numeric,
  actual_invested       numeric,
  actual_debt_payments  numeric,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, period_start, category_id)
);

-- ================================================================
-- STEP 4: INDEXES (performance)
-- ================================================================
CREATE INDEX idx_transactions_household    ON transactions(household_id);
CREATE INDEX idx_transactions_date         ON transactions(date DESC);
CREATE INDEX idx_transactions_template     ON transactions(recurring_template_id);
CREATE INDEX idx_transactions_status       ON transactions(status);
CREATE INDEX idx_categories_household      ON categories(household_id);
CREATE INDEX idx_categories_parent         ON categories(parent_id);
CREATE INDEX idx_categories_sort           ON categories(household_id, sort_order);
CREATE INDEX idx_accounts_household        ON accounts(household_id);
CREATE INDEX idx_recurring_household       ON recurring_templates(household_id);
CREATE INDEX idx_budgets_household         ON budgets(household_id);
CREATE INDEX idx_budget_snapshots_budget   ON budget_snapshots(budget_id);
CREATE INDEX idx_forecast_snapshots_hh     ON forecast_snapshots(household_id, period_start);
CREATE INDEX idx_profiles_household        ON profiles(household_id);

-- ================================================================
-- STEP 5: RLS HELPER FUNCTION
-- ================================================================
CREATE OR REPLACE FUNCTION get_my_household_id()
RETURNS uuid AS $$
  SELECT household_id FROM profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ================================================================
-- STEP 6: ENABLE ROW LEVEL SECURITY
-- ================================================================
ALTER TABLE households          ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_account_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_snapshots  ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- STEP 7: RLS POLICIES
-- ================================================================

-- households
CREATE POLICY "households_select" ON households FOR SELECT
  USING (id = get_my_household_id());
CREATE POLICY "households_insert" ON households FOR INSERT
  WITH CHECK (true);
CREATE POLICY "households_update" ON households FOR UPDATE
  USING (id = get_my_household_id())
  WITH CHECK (id = get_my_household_id());

-- profiles
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  USING (household_id = get_my_household_id() OR id = auth.uid());
CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update" ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- household_settings
CREATE POLICY "household_settings_all" ON household_settings
  USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- categories
CREATE POLICY "categories_all" ON categories
  USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- custom_account_types
CREATE POLICY "custom_account_types_all" ON custom_account_types
  USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- accounts
CREATE POLICY "accounts_all" ON accounts
  USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- recurring_templates
CREATE POLICY "recurring_templates_all" ON recurring_templates
  USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- transactions
CREATE POLICY "transactions_all" ON transactions
  USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- budgets
CREATE POLICY "budgets_all" ON budgets
  USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- budget_snapshots
CREATE POLICY "budget_snapshots_all" ON budget_snapshots
  USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- forecast_snapshots
CREATE POLICY "forecast_snapshots_all" ON forecast_snapshots
  USING (household_id = get_my_household_id())
  WITH CHECK (household_id = get_my_household_id());

-- ================================================================
-- STEP 8: GRANTS (required for RLS to work via API)
-- ================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ================================================================
-- STEP 9: REALTIME
-- ================================================================
-- Enable realtime on key tables (run if not already set in dashboard)
-- ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
-- ALTER PUBLICATION supabase_realtime ADD TABLE categories;
-- ALTER PUBLICATION supabase_realtime ADD TABLE accounts;
-- ALTER PUBLICATION supabase_realtime ADD TABLE recurring_templates;
-- Uncomment the lines above if realtime is not already configured
-- in your Supabase dashboard under Database → Replication

-- ================================================================
-- DONE
-- ================================================================
-- All tables, indexes, RLS policies and helper function are set up.
-- Your auth.users, project URL and anon key are completely untouched.
-- Next step: run the app and create your household via the UI.
-- ================================================================
