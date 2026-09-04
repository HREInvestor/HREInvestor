import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://hreinvestor.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const text = (value: unknown) => String(value ?? "");
const escapeHtml = (value: unknown) => text(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]!));
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, "content-type": "application/json" } });
const errorText = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  return text(body?.error?.message || body?.error_description || body?.message || response.statusText || "Email provider request failed.");
};
const sender = {
  name: "Joshua Cornelius",
  company: "Huntsville Real Estate Investors LLC",
  phone: "(256) 701-0912",
  address: "119 Terry Drake Rd, Owens Cross Rds, AL 35763",
};
const firstName = (name: unknown) => {
  const value = text(name).trim();
  if (!value) return "there";
  return /\b(llc|inc|trust|properties|investments|homes|builders)\b/i.test(value) ? value : value.split(/\s+/)[0];
};
const propertyAddress = (lead: Record<string, unknown>) =>
  [lead.property_address, lead.city, lead.state, lead.zip_code].filter(Boolean).map(text).join(", ") || "your property";
const merge = (value: unknown, lead: Record<string, unknown>) => text(value)
  .replaceAll("[First Name]", firstName(lead.seller_name))
  .replaceAll("[Property Address]", propertyAddress(lead))
  .replaceAll("[Your Name]", sender.name)
  .replaceAll("[Company Name]", sender.company)
  .replaceAll("[Phone Number]", sender.phone)
  .replaceAll("[Mailing Address]", sender.address);

async function getMicrosoftToken(connection: { refresh_token: string }) {
  const request = new URLSearchParams({
    client_id: Deno.env.get("MICROSOFT_CLIENT_ID")!,
    client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET")!,
    refresh_token: connection.refresh_token,
    grant_type: "refresh_token",
    scope: "offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Send.Shared",
  });
  const response = await fetch("https://login.microsoftonline.com/" + Deno.env.get("MICROSOFT_TENANT_ID")! + "/oauth2/v2.0/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: request,
  });
  if (!response.ok) throw new Error("Microsoft mailbox connection needs to be reconnected: " + await errorText(response));
  return await response.json() as { access_token: string; refresh_token?: string };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("", { headers: cors });
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return json({ message: "Sign in required." }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user } } = await supabase.auth.getUser(auth.slice(7));
  if (!user) return json({ message: "Sign in required." }, 401);
  const { data: profile } = await supabase.from("member_profiles").select("role,access_status").eq("id", user.id).single();
  if (profile?.role !== "owner" || profile.access_status !== "approved") return json({ message: "Owner access required." }, 403);

  const payload = await request.json().catch(() => ({}));
  const campaignId = text(payload.campaign_id);
  const requestedIds = [...new Set(Array.isArray(payload.lead_ids) ? payload.lead_ids.map(Number).filter(Number.isFinite) : [])];
  if (!campaignId || !requestedIds.length) return json({ message: "Choose a campaign and at least one lead." }, 400);
  if (requestedIds.length > 250) return json({ message: "Send to at most 250 recipients at a time." }, 400);

  const { data: campaign } = await supabase.from("email_campaigns").select("id,subject,message,status").eq("id", campaignId).single();
  if (!campaign) return json({ message: "Campaign was not found." }, 404);
  if (campaign.status !== "draft") return json({ message: "This campaign has already been sent or is in progress." }, 409);

  const { data: connection } = await supabase.from("microsoft_email_connections").select("sender_email,refresh_token").eq("id", true).single();
  if (!connection?.refresh_token || !connection.sender_email) return json({ message: "Connect offers@hreinvestor.com on Owner Outreach before sending." }, 400);

  const { data: rows } = await supabase.from("leads")
    .select("id,email,seller_name,property_address,city,state,zip_code,email_opt_out,contact_opt_out,archived_at")
    .in("id", requestedIds);
  const eligible = (rows || []).filter(row => row.email && !row.email_opt_out && !row.contact_opt_out && !row.archived_at);
  if (!eligible.length) return json({ message: "None of the selected leads are eligible for email." }, 400);

  await supabase.from("email_campaigns").update({ status: "sending" }).eq("id", campaignId);
  let token: { access_token: string; refresh_token?: string };
  try {
    token = await getMicrosoftToken(connection);
    if (token.refresh_token) await supabase.from("microsoft_email_connections").update({ refresh_token: token.refresh_token }).eq("id", true);
  } catch (error) {
    await supabase.from("email_campaigns").update({ status: "failed" }).eq("id", campaignId);
    return json({ message: error instanceof Error ? error.message : "Microsoft mailbox connection failed." }, 502);
  }

  let sent = 0, failed = 0, skipped = requestedIds.length - eligible.length;
  for (const lead of eligible) {
    const record = { campaign_id: campaignId, lead_id: lead.id, recipient_email: lead.email! };
    const { data: recipient, error: recipientError } = await supabase.from("email_campaign_recipients")
      .upsert(record, { onConflict: "campaign_id,lead_id" }).select("id").single();
    if (recipientError || !recipient?.id) { failed++; continue; }
    const unsubscribeUrl = "https://lmivqwscebdupfxxwfcc.supabase.co/functions/v1/marketing-unsubscribe?recipient_id=" + encodeURIComponent(recipient.id);
    const html = "<div style=\"margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b\">" +
      "<div style=\"max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:34px 32px;box-sizing:border-box\">" +
      "<div style=\"padding-bottom:20px;border-bottom:3px solid #0f766e;font-size:14px;font-weight:700;letter-spacing:.04em;color:#0f766e\">HREI</div>" +
      "<div style=\"padding:26px 0 24px;font-size:16px;line-height:1.65;color:#334155\">" + escapeHtml(merge(campaign.message, lead)).replace(/\n/g, "<br>") + "</div>" +
      "<div style=\"border-top:1px solid #e2e8f0;padding-top:18px;font-size:12px;line-height:1.55;color:#64748b\">" +
      "Huntsville Real Estate Investors LLC is contacting you about a possible property purchase.<br>" +
      escapeHtml(sender.address) + "<br><a style=\"color:#0f766e\" href=\"" + unsubscribeUrl + "\">Unsubscribe from future emails</a>" +
      "</div></div></div>";
    const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { authorization: "Bearer " + token.access_token, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: merge(campaign.subject, lead),
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: lead.email } }],
          from: { emailAddress: { address: connection.sender_email } },
        }, saveToSentItems: true,
      }),
    });
    if (response.ok) {
      sent++;
      await supabase.from("email_campaign_recipients").update({ status: "sent", sent_at: new Date().toISOString(), error_message: null }).eq("id", recipient.id);
      await supabase.from("lead_contact_log").insert({ lead_id: lead.id, channel: "email", outcome: "sent", notes: "Campaign: " + campaign.subject, created_by: user.id });
    } else {
      failed++;
      await supabase.from("email_campaign_recipients").update({ status: "failed", error_message: (await errorText(response)).slice(0, 500) }).eq("id", recipient.id);
    }
  }
  const status = failed ? (sent ? "partially_sent" : "failed") : "sent";
  await supabase.from("email_campaigns").update({ status, sent_count: sent, failed_count: failed, sent_at: new Date().toISOString() }).eq("id", campaignId);
  return json({ message: "Campaign complete.", sent, failed, skipped });
});
