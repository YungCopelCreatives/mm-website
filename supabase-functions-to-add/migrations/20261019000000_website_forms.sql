-- Website form submissions (written only by the submit-form edge function with the service role).
-- RLS is enabled with NO client policies: anon/authenticated cannot read or write these tables.
-- Admins read them from the dashboard / SQL editor (or add an is_admin() SELECT policy if the
-- admin app should list them). Idempotent.
BEGIN;

CREATE TABLE IF NOT EXISTS contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(name) <= 100),
  email TEXT NOT NULL CHECK (length(email) <= 254),
  phone TEXT CHECK (length(phone) <= 20),
  topic TEXT NOT NULL CHECK (topic IN ('general','order','business','warranty','feedback')),
  order_number TEXT CHECK (length(order_number) <= 32),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 10 AND 2000),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','closed')),
  consent_given_at TIMESTAMPTZ NOT NULL,
  consent_text_version TEXT NOT NULL,
  source_page TEXT,
  app_check_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL CHECK (length(company_name) <= 120),
  contact_name TEXT NOT NULL CHECK (length(contact_name) <= 100),
  email TEXT NOT NULL CHECK (length(email) <= 254),
  phone TEXT NOT NULL CHECK (length(phone) <= 20),
  industry TEXT NOT NULL,
  weekly_volume TEXT NOT NULL,
  notes TEXT CHECK (length(notes) <= 2000),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','won','lost')),
  consent_given_at TIMESTAMPTZ NOT NULL,
  consent_text_version TEXT NOT NULL,
  source_page TEXT,
  app_check_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL CHECK (length(full_name) <= 100),
  email TEXT NOT NULL CHECK (length(email) <= 254),
  phone TEXT NOT NULL CHECK (length(phone) <= 20),
  city TEXT NOT NULL CHECK (length(city) <= 100),
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('hatchback','sedan','bakkie','van','ev')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','screening','approved','rejected')),
  consent_given_at TIMESTAMPTZ NOT NULL,
  consent_text_version TEXT NOT NULL,
  source_page TEXT,
  app_check_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS laundromat_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  business_name TEXT NOT NULL CHECK (length(business_name) <= 120),
  contact_name TEXT NOT NULL CHECK (length(contact_name) <= 100),
  email TEXT NOT NULL CHECK (length(email) <= 254),
  phone TEXT NOT NULL CHECK (length(phone) <= 20),
  address TEXT NOT NULL CHECK (length(address) <= 300),
  machines TEXT NOT NULL CHECK (machines IN ('1-9','10-20','21-40','40+')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','screening','approved','rejected')),
  consent_given_at TIMESTAMPTZ NOT NULL,
  consent_text_version TEXT NOT NULL,
  source_page TEXT,
  app_check_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rate-limit log: hashes only (no raw IPs or emails), pruned after 7 days.
CREATE TABLE IF NOT EXISTS form_submission_log (
  id BIGSERIAL PRIMARY KEY,
  form TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_form_log_ip ON form_submission_log (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_form_log_email ON form_submission_log (email_hash, created_at);

ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE laundromat_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submission_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contact_messages, business_inquiries, driver_applications, laundromat_applications, form_submission_log FROM anon, authenticated;

-- Admins may review submissions from the admin app.
DROP POLICY IF EXISTS contact_messages_admin ON contact_messages;
CREATE POLICY contact_messages_admin ON contact_messages FOR SELECT TO authenticated USING (is_admin());
DROP POLICY IF EXISTS business_inquiries_admin ON business_inquiries;
CREATE POLICY business_inquiries_admin ON business_inquiries FOR SELECT TO authenticated USING (is_admin());
DROP POLICY IF EXISTS driver_applications_admin ON driver_applications;
CREATE POLICY driver_applications_admin ON driver_applications FOR SELECT TO authenticated USING (is_admin());
DROP POLICY IF EXISTS laundromat_applications_admin ON laundromat_applications;
CREATE POLICY laundromat_applications_admin ON laundromat_applications FOR SELECT TO authenticated USING (is_admin());
GRANT SELECT ON contact_messages, business_inquiries, driver_applications, laundromat_applications TO authenticated;

-- POPIA retention: drop rate-limit hashes after 7 days (schedule with pg_cron if available).
CREATE OR REPLACE FUNCTION prune_form_submission_log() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM form_submission_log WHERE created_at < NOW() - INTERVAL '7 days'
$$;
REVOKE ALL ON FUNCTION prune_form_submission_log() FROM PUBLIC, anon, authenticated;

COMMIT;
