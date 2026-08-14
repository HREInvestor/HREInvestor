import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "https://hreinvestor.com", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
const encoder = new TextEncoder();
const b64url = (value: string) => btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
async function sign(value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(Deno.env.get("MICROSOFT_OAUTH_STATE_SECRET")!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)))));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("", { headers: cors });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return new Response("Sign in required", { status: 401, headers: cors });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user } } = await supabase.auth.getUser(auth.slice(7));
  if (!user) return new Response("Sign in required", { status: 401, headers: cors });

  const { data: profile } = await supabase.from("member_profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "owner") return new Response("Owner access required", { status: 403, headers: cors });

  const payload = b64url(JSON.stringify({ uid: user.id, exp: Date.now() + 10 * 60 * 1000, nonce: crypto.randomUUID() }));
  const state = payload + "." + await sign(payload);
  const query = new URLSearchParams({
    client_id: Deno.env.get("MICROSOFT_CLIENT_ID")!,
    response_type: "code",
    redirect_uri: Deno.env.get("MICROSOFT_REDIRECT_URI")!,
    response_mode: "query",
    scope: "offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Send.Shared",
    state,
    prompt: "consent",
  });
  const tenant = Deno.env.get("MICROSOFT_TENANT_ID")!;
  return Response.json({ authorize_url: "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/authorize?" + query }, { headers: cors });
});
