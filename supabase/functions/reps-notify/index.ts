// REPS tracker notifications (Web Push / VAPID).
// Actions (POST JSON {action}):
//   vapid  -> public VAPID key (no auth; public by design)
//   test   -> send a test push to the signed-in caller's own subscriptions (user JWT, allowlisted)
//   tick   -> scheduler run from pg_cron every 15 min (header x-reps-cron = vault secret)
//   force  -> {kind:'daily'|'weekly'|'monthly', user_id} immediate send for testing (cron secret only)
// Secrets live in Supabase Vault (reps_cron_secret, reps_vapid_public, reps_vapid_private),
// read through the service-role-only RPC reps_get_secrets(). VAPID keys are generated here on first use.
import { createClient } from "npm:@supabase/supabase-js@2.119.2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const VAPID_SUBJECT = "https://hreinvestor.com/reps/";

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  const ok = origin === "https://hreinvestor.com" || origin === "https://www.hreinvestor.com" ||
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : "https://hreinvestor.com",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  Response.json(body, { status, headers: { ...cors(req), "content-type": "application/json" } });

let secretsCache: Record<string, string> | null = null;
async function secrets(): Promise<Record<string, string>> {
  if (secretsCache) return secretsCache;
  const { data, error } = await admin.rpc("reps_get_secrets");
  if (error) throw new Error("secrets: " + error.message);
  const s: Record<string, string> = {};
  for (const r of data ?? []) s[r.name] = r.secret;
  if (!s.reps_vapid_public || !s.reps_vapid_private) {
    const k = webpush.generateVAPIDKeys();
    for (const [n, v] of [["reps_vapid_public", k.publicKey], ["reps_vapid_private", k.privateKey]]) {
      const { error: e } = await admin.rpc("reps_set_secret", { p_name: n, p_value: v });
      if (e) throw new Error("set secret: " + e.message);
    }
    s.reps_vapid_public = k.publicKey;
    s.reps_vapid_private = k.privateKey;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, s.reps_vapid_public, s.reps_vapid_private);
  secretsCache = s;
  return s;
}

function timingSafeEq(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

type Payload = { title: string; body: string; url?: string; tag?: string };

async function pushToUser(userId: string, p: Payload, kind: string) {
  await secrets();
  const { data: subs } = await admin.from("reps_push_subscriptions").select("*").eq("user_id", userId);
  let sent = 0, failed = 0;
  const errors: string[] = [];
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(p),
        { TTL: 60 * 60 * 12, urgency: "normal" },
      );
      sent++;
      await admin.from("reps_push_subscriptions").update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq("id", s.id);
    } catch (e) {
      failed++;
      const code = (e as { statusCode?: number }).statusCode;
      errors.push(String(code ?? (e as Error).message).slice(0, 120));
      if (code === 404 || code === 410) await admin.from("reps_push_subscriptions").delete().eq("id", s.id);
      else await admin.from("reps_push_subscriptions").update({ failure_count: (s.failure_count ?? 0) + 1 }).eq("id", s.id);
    }
  }
  await admin.from("reps_notification_log").insert({ user_id: userId, kind, sent, failed, detail: errors.join("; ") || p.body.slice(0, 200) });
  return { sent, failed, subscriptions: subs?.length ?? 0, errors };
}

function localParts(tz: string, d = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, dow: dows.indexOf(p.weekday), year: +p.year, month: +p.month, day: +p.day };
}
const hm = (t: string) => String(t).slice(0, 5);
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function weeklySummary(userId: string, st: Record<string, unknown>, today: string, dow: number): Promise<Payload> {
  const year = Number(st.tax_year) || 2027, goal = Number(st.goal_hours) || 750, target = Number(st.target_hours) || 900;
  const { data } = await admin.from("reps_entries").select("work_date,duration_minutes,qualifying,person")
    .eq("user_id", userId).is("deleted_at", null).gte("work_date", `${year}-01-01`).lte("work_date", `${year}-12-31`);
  const rows = (data ?? []).filter((r) => r.person === "self" && r.qualifying);
  const ytd = rows.reduce((a, r) => a + r.duration_minutes, 0) / 60;
  const weekStart = addDays(today, -((dow + 6) % 7)); // Monday
  const week = rows.filter((r) => r.work_date >= weekStart && r.work_date <= today).reduce((a, r) => a + r.duration_minutes, 0) / 60;
  const start = Date.parse(`${year}-01-01T00:00:00Z`), end = Date.parse(`${year + 1}-01-01T00:00:00Z`), now = Date.parse(today + "T23:59:59Z");
  if (now < start) {
    const weeks = Math.ceil((start - now) / 6048e5);
    return { title: "REPS weekly check-in", body: `${year} tracking starts in ${weeks} week(s). Plan ~${(goal / 52).toFixed(1)}–${(target / 52).toFixed(1)} h/week. Practice entries are fine now.`, url: "/reps/#dash", tag: "reps-weekly" };
  }
  const frac = Math.min(1, (now - start) / (end - start));
  const expected = goal * frac;
  const weeksLeft = Math.max(1, (end - now) / 6048e5);
  const need = Math.max(0, (goal - ytd) / weeksLeft);
  const status = ytd >= expected ? `on pace (+${(ytd - expected).toFixed(1)} h)` : `BEHIND by ${(expected - ytd).toFixed(1)} h`;
  return { title: "REPS weekly summary", body: `This week ${week.toFixed(1)} h. ${year} YTD ${ytd.toFixed(1)} of ${goal} h, ${status}. Need ${need.toFixed(1)} h/week from here.`, url: "/reps/#dash", tag: "reps-weekly" };
}

async function isAllowedUser(userId: string) {
  const { data } = await admin.auth.admin.getUserById(userId);
  const email = data?.user?.email;
  if (!email) return false;
  const { data: ok } = await admin.rpc("reps_is_allowed", { p_email: email });
  return !!ok;
}

async function buildPayload(kind: string, userId: string, st: Record<string, unknown>, lp: ReturnType<typeof localParts>): Promise<Payload> {
  if (kind === "daily") return { title: "REPS: log today's hours", body: "Nothing logged for today yet. Take 60 seconds to record what you worked on while it's fresh.", url: "/reps/#log", tag: "reps-daily" };
  if (kind === "monthly") return { title: "REPS: export your monthly package", body: "New month. Export last month's records package (CSV + PDF + evidence) and save it somewhere safe.", url: "/reps/#export", tag: "reps-monthly" };
  return await weeklySummary(userId, st, lp.date, lp.dow);
}

async function tick() {
  const { data: rows, error } = await admin.from("reps_settings").select("*");
  if (error) throw error;
  const results: unknown[] = [];
  for (const st of rows ?? []) {
    const lp = localParts(st.timezone || "America/Chicago");
    const due: string[] = [];
    if (st.daily_enabled && lp.hm >= hm(st.daily_time) && st.last_daily_sent !== lp.date) due.push("daily");
    if (st.weekly_enabled && lp.dow === st.weekly_dow && lp.hm >= hm(st.weekly_time) && st.last_weekly_sent !== lp.date) due.push("weekly");
    if (st.monthly_enabled && lp.day === st.monthly_day && lp.hm >= hm(st.monthly_time) && st.last_monthly_sent !== lp.date) due.push("monthly");
    if (!due.length) continue;
    if (!(await isAllowedUser(st.user_id))) continue;
    const upd: Record<string, string> = {};
    for (const kind of due) {
      upd[`last_${kind}_sent`] = lp.date;
      if (kind === "daily") {
        const { count } = await admin.from("reps_entries").select("id", { count: "exact", head: true })
          .eq("user_id", st.user_id).eq("work_date", lp.date).eq("person", "self").is("deleted_at", null);
        if ((count ?? 0) > 0) { results.push({ user: st.user_id, kind, skipped: "already logged" }); continue; }
      }
      const p = await buildPayload(kind, st.user_id, st, lp);
      results.push({ user: st.user_id, kind, ...(await pushToUser(st.user_id, p, kind)) });
    }
    await admin.from("reps_settings").update(upd).eq("user_id", st.user_id);
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action || new URL(req.url).searchParams.get("action") || "vapid";
    const s = await secrets();

    if (action === "vapid") return json(req, { publicKey: s.reps_vapid_public });

    if (action === "tick" || action === "force") {
      if (!timingSafeEq(req.headers.get("x-reps-cron") || "", s.reps_cron_secret || "")) return json(req, { error: "forbidden" }, 403);
      if (action === "tick") return json(req, { ok: true, results: await tick() });
      const kind = String(body.kind || "daily");
      if (!["daily", "weekly", "monthly"].includes(kind) || !body.user_id) return json(req, { error: "bad request" }, 400);
      const { data: st } = await admin.from("reps_settings").select("*").eq("user_id", body.user_id).maybeSingle();
      const lp = localParts(st?.timezone || "America/Chicago");
      return json(req, { ok: true, ...(await pushToUser(body.user_id, await buildPayload(kind, body.user_id, st ?? {}, lp), "force_" + kind)) });
    }

    if (action === "test") {
      const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u, error } = await admin.auth.getUser(token);
      if (error || !u?.user?.email) return json(req, { error: "sign in required" }, 401);
      const { data: ok } = await admin.rpc("reps_is_allowed", { p_email: u.user.email });
      if (!ok) return json(req, { error: "not allowed" }, 403);
      const r = await pushToUser(u.user.id, { title: "REPS test notification", body: "Notifications are working on this device.", url: "/reps/#settings", tag: "reps-test" }, "test");
      return json(req, { ok: true, ...r });
    }
    return json(req, { error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json(req, { error: (e as Error).message }, 500);
  }
});
