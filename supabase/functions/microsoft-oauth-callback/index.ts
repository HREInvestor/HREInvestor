import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const encoder = new TextEncoder();
const b64url = (value: string) => btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
async function sign(value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(Deno.env.get("MICROSOFT_OAUTH_STATE_SECRET")!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)))));
}
const page = (title: string, body: string) => new Response("<!doctype html><title>" + title + "</title><main style='font:16px system-ui;max-width:600px;margin:60px auto;padding:24px'><h1>" + title + "</h1><p>" + body + "</p><p><a href='https://hreinvestor.com/members/outreach.html'>Return to Owner Outreach</a></p></main>", { headers: { "content-type": "text/html; charset=utf-8" } });

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (!code || !state) return page("Connection not completed", "Microsoft did not return an authorization code.");
  const [payload, signature] = state.split(".");
  if (!payload || !signature || signature !== await sign(payload)) return page("Connection not completed", "The sign-in request expired or was invalid.");
  let stateData: { uid: string; exp: number };
  try { stateData = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/"))); } catch { return page("Connection not completed", "The sign-in request was invalid."); }
  if (stateData.exp < Date.now()) return page("Connection not completed", "The sign-in request expired. Please try again.");

  const tokenRequest = new URLSearchParams({
    client_id: Deno.env.get("MICROSOFT_CLIENT_ID")!,
    client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET")!,
    code,
    redirect_uri: Deno.env.get("MICROSOFT_REDIRECT_URI")!,
    grant_type: "authorization_code",
    scope: "offline_access https://graph.microsoft.com/Mail.Send",
  });
  const response = await fetch("https://login.microsoftonline.com/" + Deno.env.get("MICROSOFT_TENANT_ID")! + "/oauth2/v2.0/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: tokenRequest });
  if (!response.ok) return page("Connection not completed", "Microsoft could not authorize the mailbox. Please try again.");
  const token = await response.json();
  if (!token.refresh_token) return page("Connection not completed", "Microsoft did not provide a secure refresh token.");

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: profile } = await supabase.from("member_profiles").select("role").eq("id", stateData.uid).single();
  if (profile?.role !== "owner") return page("Connection not completed", "Owner access is required.");
  const { error } = await supabase.from("microsoft_email_connections").upsert({
    id: true, sender_email: Deno.env.get("MICROSOFT_SENDER_EMAIL")!, refresh_token: token.refresh_token,
    token_expires_at: token.ext_expires_in ? new Date(Date.now() + Number(token.ext_expires_in) * 1000).toISOString() : null, connected_by: stateData.uid,
  });
  if (error) return page("Connection not completed", "The connection could not be saved.");
  return page("Microsoft 365 connected", "The HREI CRM is now authorized to send from offers@hreinvestor.com. No campaign emails have been sent.");
});
