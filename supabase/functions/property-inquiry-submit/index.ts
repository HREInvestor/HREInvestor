import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://hreinvestor.com",
  "https://www.hreinvestor.com",
]);

function cors(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://hreinvestor.com",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...cors(request), "content-type": "application/json" },
  });
}

const asText = (value: unknown) => String(value ?? "").trim();
const escapeHtml = (value: unknown) =>
  asText(value).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]!)
  );

// Legacy processor retired 2026-11-01 (merchant account deactivated). Square is primary; optional Square link via RENTAL_APPLICATION_PAYMENT_URL, else HREI sends a Square link manually.
const FALLBACK_PAYMENT_URL = Deno.env.get("RENTAL_APPLICATION_PAYMENT_URL") || "";

async function getMicrosoftToken(connection: { refresh_token: string }) {
  const reqBody = new URLSearchParams({
    client_id: Deno.env.get("MICROSOFT_CLIENT_ID")!,
    client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET")!,
    refresh_token: connection.refresh_token,
    grant_type: "refresh_token",
    scope: "offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Send.Shared",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${Deno.env.get("MICROSOFT_TENANT_ID")!}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: reqBody,
    }
  );
  if (!response.ok) throw new Error("Microsoft mailbox token refresh failed.");
  return (await response.json()) as { access_token: string; refresh_token?: string };
}

async function sendNotificationEmail(
  supabase: ReturnType<typeof createClient>,
  subject: string,
  htmlContent: string,
  toAddresses: string[]
) {
  const { data: connection } = await supabase
    .from("microsoft_email_connections")
    .select("sender_email,refresh_token")
    .eq("id", true)
    .single();
  if (!connection?.refresh_token || !connection.sender_email) return false;
  const token = await getMicrosoftToken(connection);
  if (token.refresh_token) {
    await supabase
      .from("microsoft_email_connections")
      .update({ refresh_token: token.refresh_token })
      .eq("id", true);
  }
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: htmlContent },
        toRecipients: toAddresses.map((address) => ({ emailAddress: { address } })),
        from: { emailAddress: { address: connection.sender_email } },
      },
      saveToSentItems: true,
    }),
  });
  return res.ok;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
  if (request.method !== "POST") return json(request, { ok: false, error: "POST only" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await request.json(); } catch { return json(request, { ok: false, error: "Invalid request" }, 400); }
  if (asText(b.website)) return json(request, { ok: true }); // honeypot
  const name = asText(b.name).slice(0, 120);
  const email = asText(b.email).slice(0, 160).toLowerCase();
  const phone = asText(b.phone).slice(0, 40);
  const role = ["investor", "tenant", "employer"].includes(asText(b.role)) ? asText(b.role) : "investor";
  const message = asText(b.message).slice(0, 2000);
  const company = asText(b.company).slice(0, 160);
  if (!name || (!email && !phone)) return json(request, { ok: false, error: "Please add your name and an email or phone." }, 400);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(request, { ok: false, error: "Please check your email address." }, 400);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const tags = ["gay_st_featured_inquiry", `inquiry_${role}`, "website_inbound"];
  const { error } = await supabase.from("leads").insert({
    seller_name: company ? `${name} (${company})` : name,
    email: email || null, phone: phone || null,
    property_address: "3506 Gay St NW", city: "Huntsville", state: "AL", zip: "35810", zip_code: "35810",
    stage: "New Lead", source: `Website featured property inquiry (${role})`,
    contact_opt_out: false, email_opt_out: false, lead_tags: tags, tags: tags.join(";"),
    notes: `Inbound ${role} inquiry from hreinvestor.com/gay-street.html. ${company ? "Company: " + company + ". " : ""}Message: ${message || "(none)"}. NOT a seller lead; do not add to seller campaigns.`,
    source_data: { lane: "featured_property_inquiry", role, company, message, submitted_at: new Date().toISOString() },
  });
  if (error) { console.error(error); return json(request, { ok: false, error: "Could not save. Please call (256) 701-0912." }, 500); }
  try {
    await sendNotificationEmail(supabase, `New ${role} inquiry: 3506 Gay St NW (${name})`,
      `<div style="font-family:Arial,sans-serif"><h3>New ${escapeHtml(role)} inquiry: 3506 Gay St NW</h3><p><b>Name:</b> ${escapeHtml(name)}<br><b>Company:</b> ${escapeHtml(company || "-")}<br><b>Email:</b> ${escapeHtml(email || "-")}<br><b>Phone:</b> ${escapeHtml(phone || "-")}</p><p>${escapeHtml(message || "(no message)")}</p></div>`,
      ["office@hreinvestor.com"]);
  } catch (e) { console.error("notify failed", e); }
  return json(request, { ok: true });
});
