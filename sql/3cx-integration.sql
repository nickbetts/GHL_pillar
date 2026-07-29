-- 3CX server-side CRM integration (Database PostgreSQL template).
--
-- These objects live in Neon and power caller-ID lookup, screen-pop, search,
-- and (optional) call journaling for the 3CX Admin Console CRM integration.
-- They are SECURITY DEFINER so the dedicated `threecx` login role needs only
-- EXECUTE on these functions — never direct table access.
--
-- Safe to re-run (idempotent). Run as the database owner (neondb_owner).
-- The `threecx` role password is NOT stored here — set it out of band.

-- ── Lookup by phone number (caller-ID + screen-pop) ─────────────────────────
CREATE OR REPLACE FUNCTION threecx_lookup(p_number text)
RETURNS TABLE(contactid text, firstname text, lastname text, companyname text, title text, email text, phonebusiness text, phonemobile text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT id::text, first_name, last_name, company_name, title, email, phone, phone
  FROM queue_leads
  WHERE length(regexp_replace(COALESCE(p_number,''),'[^0-9]','','g')) >= 6
    AND RIGHT(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),9)
      = RIGHT(regexp_replace(COALESCE(p_number,''),'[^0-9]','','g'),9)
  ORDER BY updated_at DESC
  LIMIT 1;
$fn$;

-- ── Lookup by email ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION threecx_lookup_email(p_email text)
RETURNS TABLE(contactid text, firstname text, lastname text, companyname text, title text, email text, phonebusiness text, phonemobile text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT id::text, first_name, last_name, company_name, title, email, phone, phone
  FROM queue_leads
  WHERE p_email IS NOT NULL AND p_email <> '' AND lower(email) = lower(p_email)
  ORDER BY updated_at DESC
  LIMIT 1;
$fn$;

-- ── Search contacts (name / company / email / phone digits) ─────────────────
CREATE OR REPLACE FUNCTION threecx_search(p_text text)
RETURNS TABLE(contactid text, firstname text, lastname text, companyname text, title text, email text, phonebusiness text, phonemobile text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT id::text, first_name, last_name, company_name, title, email, phone, phone
  FROM queue_leads
  WHERE p_text IS NOT NULL AND p_text <> '' AND (
    name ILIKE '%'||p_text||'%'
    OR company_name ILIKE '%'||p_text||'%'
    OR email ILIKE '%'||p_text||'%'
    OR ( regexp_replace(p_text,'[^0-9]','','g') <> ''
         AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g') LIKE '%'||regexp_replace(p_text,'[^0-9]','','g')||'%' )
  )
  ORDER BY updated_at DESC
  LIMIT 25;
$fn$;

-- ── Optional call journaling (currently disabled in 3CX; our app logs calls) ─
CREATE OR REPLACE FUNCTION threecx_journal(p_contactid text, p_direction text, p_number text, p_agent text, p_duration text, p_recording text, p_callid text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE lid bigint;
BEGIN
  lid := NULLIF(regexp_replace(COALESCE(p_contactid,''),'[^0-9]','','g'),'')::bigint;
  IF lid IS NULL AND COALESCE(p_number,'') <> '' THEN
    SELECT id INTO lid FROM queue_leads
    WHERE RIGHT(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),9) = RIGHT(regexp_replace(p_number,'[^0-9]','','g'),9)
    ORDER BY updated_at DESC LIMIT 1;
  END IF;
  IF lid IS NULL THEN RETURN 'no-match'; END IF;
  INSERT INTO queue_events(lead_id, event_type, owner_name, meta)
  VALUES (lid, 'call', NULLIF(p_agent,''), jsonb_build_object(
    'provider','3cx-journal',
    'direction', lower(NULLIF(p_direction,'')),
    'from', NULLIF(p_number,''),
    'to', NULLIF(p_number,''),
    'agent', NULLIF(p_agent,''),
    'durationSec', NULLIF(regexp_replace(COALESCE(p_duration,''),'[^0-9]','','g'),'')::int,
    'recordingUrl', NULLIF(p_recording,''),
    'callId', NULLIF(p_callid,'')
  ));
  UPDATE queue_leads SET last_touch_at=now(), updated_at=now() WHERE id=lid;
  RETURN 'ok';
END; $fn$;

-- ── Lock down: only the dedicated role may execute these ─────────────────────
REVOKE EXECUTE ON FUNCTION threecx_lookup(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION threecx_lookup_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION threecx_search(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION threecx_journal(text,text,text,text,text,text,text) FROM PUBLIC;

-- ── Dedicated login role for 3CX (set a real password before running) ───────
-- DO $$ BEGIN
--   IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='threecx') THEN
--     CREATE ROLE threecx LOGIN PASSWORD 'CHANGE-ME';
--   END IF;
-- END $$;
-- GRANT CONNECT ON DATABASE neondb TO threecx;
-- GRANT USAGE ON SCHEMA public TO threecx;
-- GRANT EXECUTE ON FUNCTION
--   threecx_lookup(text), threecx_lookup_email(text),
--   threecx_search(text), threecx_journal(text,text,text,text,text,text,text)
-- TO threecx;
