import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://hreinvestor.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const text = (value: unknown) => String(value ?? "");
const escapeHtml = (value: unknown) => text(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]!));
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, "content-type": "application/json" } });
const errorText = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  return text(body?.error?.message || body?.error_description || body?.message || response.statusText || "Email provider request failed.");
};

async function getMicrosoftToken(connection: { refresh_token: string }) {
  const request = new URLSearchParams({
    client_id: Deno.env.get("MICROSOFT_CLIENT_ID")!,
    client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET")!,
    refresh_token: connection.refresh_token,
    grant_type: "refresh_token",
    scope: "offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Send.Shared",
  });
  const response = await fetch("https://login.microsoftonline.com/" + Deno.env.get("MICROSOFT_TENANT_ID")! + "/oauth2/v2.0/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: request,
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
  const requestedIds = [...new Set(Array.isArray(payload.recipient_ids) ? payload.recipient_ids.map(text).filter(Boolean) : [])];
  if (!campaignId || !requestedIds.length) return json({ message: "Choose a campaign and at least one investor." }, 400);
  if (requestedIds.length > 100) return json({ message: "A campaign can send to at most 100 investors at a time." }, 400);

  const { data: campaign } = await supabase.from("dispo_campaigns").select("id,property_id,subject,message,properties(title,status)").eq("id", campaignId).single();
  if (!campaign) return json({ message: "Campaign was not found." }, 404);
  const property = Array.isArray(campaign.properties) ? campaign.properties[0] : campaign.properties;
  if (!property || property.status !== "available") return json({ message: "Publish the property as Available to investors before sending a deal alert." }, 400);

  const { data: connection } = await supabase.from("microsoft_email_connections").select("sender_email,refresh_token").eq("id", true).single();
  if (!connection?.refresh_token || !connection.sender_email) return json({ message: "Connect the HREI Microsoft 365 mailbox on Owner Outreach before sending." }, 400);

  const { data: members } = await supabase.from("member_profiles").select("id,email,role,access_status").in("id", requestedIds).eq("role", "investor").eq("access_status", "approved");
  const { data: preferences } = await supabase.from("member_email_preferences").select("member_id,deal_alerts_enabled").in("member_id", requestedIds);
  const disabled = new Set((preferences || []).filter(row => !row.deal_alerts_enabled).map(row => row.member_id));
  const recipients = (members || []).filter(member => !disabled.has(member.id) && member.email);

  const byId = new Map((members || []).map(member => [member.id, member]));
  const skipped = requestedIds.filter(id => !recipients.some(member => member.id === id)).map(id => ({
    campaign_id: campaignId, member_id: id, recipient_email: byId.get(id)?.email || "Unavailable", status: "skipped",
    error_message: disabled.has(id) ? "Deal alerts disabled by investor." : "Account is not an approved investor.",
  }));
  if (skipped.length) await supabase.from("dispo_campaign_recipients").upsert(skipped, { onConflict: "campaign_id,member_id" });

  let token: { access_token: string; refresh_token?: string };
  try {
    token = await getMicrosoftToken(connection);
    if (token.refresh_token) await supabase.from("microsoft_email_connections").update({ refresh_token: token.refresh_token }).eq("id", true);
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : "Microsoft mailbox connection failed." }, 502);
  }

  const dealUrl = "https://hreinvestor.com/members/deal.html?id=" + encodeURIComponent(campaign.property_id);
  const html = "<p>" + escapeHtml(campaign.message).replace(/\n/g, "<br>") + "</p>" +
    "<p><a href=\"" + dealUrl + "\">Open the secure HREI deal room</a></p>" +
    "<hr><p style=\"font-size:12px;color:#64748b\">You are receiving this because your approved HREI Investor account has deal alerts enabled. <a href=\"https://hreinvestor.com/members/preferences.html\">Manage deal alerts</a>.</p>";

  let sent = 0, failed = 0;
  for (const recipient of recipients) {
    const record = { campaign_id: campaignId, member_id: recipient.id, recipient_email: recipient.email };
    const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { authorization: "Bearer " + token.access_token, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: campaign.subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: recipient.email } }],
          from: { emailAddress: { address: connection.sender_email } },
        },
        saveToSentItems: true,
      }),
    });
    if (response.ok) {
      sent++;
      await supabase.from("dispo_campaign_recipients").upsert({ ...record, status: "sent", error_message: null, sent_at: new Date().toISOString() }, { onConflict: "campaign_id,member_id" });
    } else {
      failed++;
      await supabase.from("dispo_campaign_recipients").upsert({ ...record, status: "failed", error_message: (await errorText(response)).slice(0, 500) }, { onConflict: "campaign_id,member_id" });
    }
  }
  const status = failed ? (sent ? "partially_sent" : "failed") : "sent";
  await supabase.from("dispo_campaigns").update({ status, sent_count: sent, sent_at: new Date().toISOString() }).eq("id", campaignId);
  return json({ message: "Campaign complete.", sent, failed, skipped: skipped.length, deal_url: dealUrl });
});