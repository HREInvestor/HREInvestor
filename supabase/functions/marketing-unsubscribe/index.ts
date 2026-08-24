import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const page = (title: string, message: string) => new Response(
  "<!doctype html><title>" + title + "</title><main style='font:16px system-ui;max-width:600px;margin:60px auto;padding:24px'><h1>" + title + "</h1><p>" + message + "</p></main>",
  { headers: { "content-type": "text/html; charset=utf-8" } },
);

Deno.serve(async request => {
  const recipientId = new URL(request.url).searchParams.get("recipient_id");
  if (!recipientId) return page("Unable to unsubscribe", "This email link is invalid.");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: recipient } = await supabase.from("email_campaign_recipients").select("id,lead_id,recipient_email").eq("id", recipientId).maybeSingle();
  if (!recipient) return page("Unable to unsubscribe", "This email link is invalid or has expired.");
  const now = new Date().toISOString();
  const { error: recipientError } = await supabase.from("email_campaign_recipients").update({ status: "unsubscribed", unsubscribed_at: now }).eq("id", recipient.id);
  const { error: leadError } = await supabase.from("leads").update({ email_opt_out: true, email_opt_out_at: now }).eq("id", recipient.lead_id);
  if (recipientError || leadError) return page("Unable to unsubscribe", "We could not complete your request. Please try the link again later.");
  return page("You are unsubscribed", "You will not receive future HREI marketing emails from this list.");
});
