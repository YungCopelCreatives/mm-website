// submit-form: public website forms (contact, business inquiry, driver application,
// laundromat partner application) written to Supabase with the service role.
//
// TO MOVE INTO THE APP REPO: copy this folder to supabase/functions/submit-form/ and apply
// supabase-functions-to-add/migrations/20261019000000_website_forms.sql.
// Deploy with `supabase functions deploy submit-form --no-verify-jwt` (anonymous visitors
// submit these forms; abuse is limited by App Check, a honeypot and per-IP rate limits).
//
// Request: POST { form, fields: {...}, consent: true, website: "" (honeypot), page? }
// Optional Authorization: Bearer <Firebase ID token> links the submission to the user.
// Response: { success: true, id } | { success: false, error }
import { adminClient, json, corsHeaders, requireFirebaseUser, verifyAppCheck } from "../_shared/http.ts";

const APP_CHECK_ENFORCE = Deno.env.get("APP_CHECK_ENFORCE") === "true";
const RATE_LIMIT_PER_HOUR = Number(Deno.env.get("FORM_RATE_LIMIT_PER_HOUR") ?? "8");
const RATE_LIMIT_PER_EMAIL_PER_DAY = 5;

type Rule = { max: number; required?: boolean; pattern?: RegExp; oneOf?: string[]; min?: number };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ()-]{9,20}$/;

const FORMS: Record<string, { table: string; rules: Record<string, Rule> }> = {
  contact: {
    table: "contact_messages",
    rules: {
      name: { max: 100, required: true },
      email: { max: 254, required: true, pattern: EMAIL },
      phone: { max: 20, pattern: PHONE },
      topic: { max: 20, required: true, oneOf: ["general", "order", "business", "warranty", "feedback"] },
      order_number: { max: 32, pattern: /^[A-Za-z0-9-]+$/ },
      message: { max: 2000, min: 10, required: true },
    },
  },
  business_inquiry: {
    table: "business_inquiries",
    rules: {
      company_name: { max: 120, required: true },
      contact_name: { max: 100, required: true },
      email: { max: 254, required: true, pattern: EMAIL },
      phone: { max: 20, required: true, pattern: PHONE },
      industry: { max: 20, required: true, oneOf: ["rental", "hotel", "restaurant", "wellness", "medical", "office", "other"] },
      weekly_volume: { max: 10, required: true, oneOf: ["1-5", "6-15", "16-40", "40+"] },
      notes: { max: 2000 },
    },
  },
  driver_application: {
    table: "driver_applications",
    rules: {
      full_name: { max: 100, required: true },
      email: { max: 254, required: true, pattern: EMAIL },
      phone: { max: 20, required: true, pattern: PHONE },
      city: { max: 100, required: true },
      vehicle_type: { max: 20, required: true, oneOf: ["hatchback", "sedan", "bakkie", "van", "ev"] },
    },
  },
  laundromat_application: {
    table: "laundromat_applications",
    rules: {
      business_name: { max: 120, required: true },
      contact_name: { max: 100, required: true },
      email: { max: 254, required: true, pattern: EMAIL },
      phone: { max: 20, required: true, pattern: PHONE },
      address: { max: 300, required: true },
      machines: { max: 10, required: true, oneOf: ["1-9", "10-20", "21-40", "40+"] },
    },
  },
};

// Strip control characters; keep newlines only in long free-text fields.
const clean = (v: string, multiline: boolean) =>
  v.replace(multiline ? /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, "").trim();

function validate(form: string, input: unknown): { ok: true; data: Record<string, string> } | { ok: false; error: string } {
  const spec = FORMS[form];
  if (!spec) return { ok: false, error: "Unknown form" };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Missing form fields" };
  const raw = input as Record<string, unknown>;
  const data: Record<string, string> = {};
  for (const [key, rule] of Object.entries(spec.rules)) {
    const v = raw[key];
    if (v === undefined || v === null || v === "") {
      if (rule.required) return { ok: false, error: `Please fill in ${key.replace(/_/g, " ")}` };
      continue;
    }
    if (typeof v !== "string") return { ok: false, error: `Invalid ${key.replace(/_/g, " ")}` };
    const s = clean(v, rule.max > 300);
    if (!s && rule.required) return { ok: false, error: `Please fill in ${key.replace(/_/g, " ")}` };
    if (s.length > rule.max) return { ok: false, error: `${key.replace(/_/g, " ")} is too long` };
    if (rule.min && s.length < rule.min) return { ok: false, error: `${key.replace(/_/g, " ")} is too short` };
    if (rule.pattern && s && !rule.pattern.test(s)) return { ok: false, error: `Please check the ${key.replace(/_/g, " ")}` };
    if (rule.oneOf && !rule.oneOf.includes(s)) return { ok: false, error: `Invalid ${key.replace(/_/g, " ")}` };
    if (s) data[key] = key === "email" ? s.toLowerCase() : s;
  }
  // unknown keys are ignored (never stored)
  return { ok: true, data };
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { success: false, error: "Method not allowed" }, 405);

  try {
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > 16_384) return json(req, { success: false, error: "Request too large" }, 413);

    const appCheckOk = await verifyAppCheck(req);
    if (!appCheckOk && APP_CHECK_ENFORCE) return json(req, { success: false, error: "Please refresh the page and try again" }, 401);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json(req, { success: false, error: "Invalid request" }, 400);
    const { form, fields, consent, website, page } = body as Record<string, unknown>;

    // Honeypot: pretend success so bots learn nothing.
    if (typeof website === "string" && website.trim() !== "") return json(req, { success: true, id: null });

    // POPIA: explicit consent is mandatory for every form.
    if (consent !== true) return json(req, { success: false, error: "Please confirm that you agree to the privacy policy" }, 400);

    if (typeof form !== "string") return json(req, { success: false, error: "Unknown form" }, 400);
    const result = validate(form, fields);
    if (!result.ok) return json(req, { success: false, error: result.error }, 400);

    // Optional signed-in user (never required for these forms).
    let uid: string | null = null;
    if ((req.headers.get("Authorization") ?? "").startsWith("Bearer ey")) {
      const user = await requireFirebaseUser(req).catch(() => null);
      uid = user?.uid ?? null;
    }

    const db = adminClient();

    // Rate limit per IP (hashed, never stored raw) and per email address.
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
    const ipHash = await sha256(`${Deno.env.get("FORM_IP_SALT") ?? "mm"}:${ip}`);
    const emailHash = await sha256(`email:${result.data.email ?? ""}`);
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const [{ count: ipCount }, { count: emailCount }] = await Promise.all([
      db.from("form_submission_log").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", hourAgo),
      db.from("form_submission_log").select("id", { count: "exact", head: true }).eq("email_hash", emailHash).gte("created_at", dayAgo),
    ]);
    if ((ipCount ?? 0) >= RATE_LIMIT_PER_HOUR || (emailCount ?? 0) >= RATE_LIMIT_PER_EMAIL_PER_DAY) {
      return new Response(JSON.stringify({ success: false, error: "Too many submissions. Please try again later." }), {
        status: 429, headers: { ...corsHeaders(req), "Content-Type": "application/json", "Retry-After": "3600" },
      });
    }

    const { table } = FORMS[form];
    const { data: row, error } = await db.from(table).insert({
      ...result.data,
      user_id: uid,
      consent_given_at: new Date().toISOString(),
      consent_text_version: "website-2026-10",
      source_page: typeof page === "string" ? page.slice(0, 100) : null,
      app_check_verified: appCheckOk,
    }).select("id").single();
    if (error) {
      console.error(`[submit-form] insert into ${table} failed: ${error.message}`);
      return json(req, { success: false, error: "We could not save this. Please try again." }, 500);
    }

    await db.from("form_submission_log").insert({ form, ip_hash: ipHash, email_hash: emailHash });

    return json(req, { success: true, id: row.id });
  } catch (err) {
    console.error("[submit-form] unexpected error:", (err as Error)?.message);
    return json(req, { success: false, error: "Something went wrong. Please try again." }, 500);
  }
});
