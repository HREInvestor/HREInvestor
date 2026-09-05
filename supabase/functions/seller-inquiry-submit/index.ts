import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://hreinvestor.com", "https://www.hreinvestor.com"]);
const asText = (value: unknown) => String(value ?? "").trim();
const escapeHtml = (value: unknown) => asText(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[character]!));

function cors(request: Request) {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://hreinvestor.com",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...cors(request), "content-type": "application/json" } });
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function getMicrosoftToken(connection: { refresh_token: string }) {
  const request = new URLSearchParams({
    client_id: Deno.env.get("MICROSOFT_CLIENT_ID")!,
    client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET")!,
    refresh_token: connection.refresh_token,
    grant_type: "refresh_token",
    scope: "offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Send.Shared",
  });
  const response = await fetch(`https://login.microsoftonline.com/${Deno.env.get("MICROSOFT_TENANT_ID")!}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: request,
  });
  if (!response.ok) throw new Error("Microsoft mailbox connection needs to be reconnected.");
  return await response.json() as { access_token: string; refresh_token?: string };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("", { headers: cors(request) });
  if (request.method !== "POST") return json(request, { message: "Method not allowed." }, 405);
  if (!allowedOrigins.has(request.headers.get("origin") || "")) return json(request, { message: "Request origin not allowed." }, 403);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json(request, { message: "Please complete the form and try again." }, 400);

  const sellerName = asText(body.seller_name);
  const propertyAddress = asText(body.property_address);
  const city = asText(body.city);
  const state = asText(body.state).toUpperCase();
  const zip = asText(body.zip);
  const phone = asText(body.phone);
  const email = asText(body.email).toLowerCase();
  const privacyAcknowledged = body.privacy_acknowledged === true;
  const contactConsent = body.contact_consent === true;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!sellerName || !propertyAddress || !city || !/^[A-Z]{2}$/.test(state) || !zip || !phone || !validEmail || !privacyAcknowledged || !contactConsent) {
    return json(request, { message: "Please complete each required field and acknowledge the privacy notice." }, 400);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const requester = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  const requestKey = await sha256(`${requester}|${email}|${propertyAddress.toLowerCase()}|${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`);
  const { data: priorAttempt } = await supabase.from("website_form_rate_limits").select("last_submitted_at").eq("request_key", requestKey).maybeSingle();
  if (priorAttempt && Date.now() - new Date(priorAttempt.last_submitted_at).getTime() < 15 * 60 * 1000) {
    return json(request, { message: "We already received this request. We will be in touch shortly." });
  }
  const now = new Date().toISOString();
  const { error: rateError } = await supabase.from("website_form_rate_limits").upsert({ request_key: requestKey, last_submitted_at: now });
  if (rateError) return json(request, { message: "We could not submit your request. Please try again." }, 503);

  const askingPriceText = asText(body.asking_price);
  const askingPrice = askingPriceText ? Number(askingPriceText) : null;
  const details = [
    asText(body.condition) && `Condition: ${asText(body.condition)}`,
    asText(body.timeline) && `Timeline: ${asText(body.timeline)}`,
    asText(body.notes),
    "Website seller inquiry: privacy notice acknowledged and permission to contact about this inquiry recorded.",
  ].filter(Boolean).join(" | ");

  const { data: lead, error: leadError } = await supabase.from("leads").insert({
    seller_name: sellerName, property_address: propertyAddress, city, state, zip, phone, email,
    asking_price: typeof askingPrice === "number" && Number.isFinite(askingPrice) && askingPrice >= 0 ? askingPrice : null,
    notes: details, stage: "New Lead", source: "Website - Sell Fast Form",
    website_inquiry_at: now, website_contact_consent_at: now, website_privacy_policy_version: "2026-09-05",
  }).select("id").single();
  if (leadError || !lead) return json(request, { message: "We could not save your request. Please call us directly." }, 503);

  let confirmationSent = false;
  try {
    const { data: connection } = await supabase.from("microsoft_email_connections").select("sender_email,refresh_token").eq("id", true).single();
    if (!connection?.refresh_token || !connection.sender_email) throw new Error("Mailbox is not connected.");
    const token = await getMicrosoftToken(connection);
    if (token.refresh_token) await supabase.from("microsoft_email_connections").update({ refresh_token: token.refresh_token }).eq("id", true);
    const address = [propertyAddress, city, state, zip].filter(Boolean).join(", ");
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#334155;line-height:1.6;max-width:640px;margin:0 auto;padding:24px"><h1 style="font-size:22px;color:#073c40">We received your property request</h1><p>Hi ${escapeHtml(sellerName)},</p><p>Thank you for contacting Huntsville Real Estate Investors LLC about <strong>${escapeHtml(address)}</strong>.</p><p>We received your request and will review the information you provided. If the property may be a fit, we will contact you by phone or email to discuss next steps. This confirmation is not an offer to purchase and does not create an agreement.</p><p>If you did not submit this request, please reply to this email or contact us at office@hreinvestor.com.</p><p>Huntsville Real Estate Investors LLC<br>119 Terry Drake Road<br>Owens Cross Roads, AL 35763<br>(256) 242-8207</p></div>`;
    const sent = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { subject: "We received your property request", body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: email } }], from: { emailAddress: { address: connection.sender_email } } }, saveToSentItems: true }),
    });
    if (!sent.ok) throw new Error("Microsoft did not accept the confirmation.");
    confirmationSent = true;
    await supabase.from("leads").update({ automated_confirmation_sent_at: now }).eq("id", lead.id);
    await supabase.from("lead_contact_log").insert({ lead_id: lead.id, channel: "email", outcome: "sent", notes: "Automated website inquiry confirmation" });
  } catch (error) {
    console.error("Seller confirmation email failed", error instanceof Error ? error.message : "unknown error");
  }

  return json(request, { message: "Request received.", confirmation_sent: confirmationSent });
});
