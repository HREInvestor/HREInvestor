import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const squareAccessToken = Deno.env.get("SQUARE_ACCESS_TOKEN")!;
const squareSignatureKey = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY")!;
const notificationUrl = Deno.env.get("SQUARE_WEBHOOK_NOTIFICATION_URL")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function isValidSignature(body: string, signature: string | null) {
  if (!signature || !squareSignatureKey || !notificationUrl) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(squareSignatureKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(notificationUrl + body),
  );
  const digest = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return constantTimeEqual(digest, signature);
}

async function customerEmail(customerId: string) {
  const response = await fetch(`https://connect.squareup.com/v2/customers/${customerId}`, {
    headers: { Authorization: `Bearer ${squareAccessToken}`, "Square-Version": "2026-07-15" },
  });
  if (!response.ok) throw new Error("Square customer lookup failed.");
  const { customer } = await response.json();
  return customer?.email_address?.toLowerCase() || null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const body = await request.text();
  if (!(await isValidSignature(body, request.headers.get("x-square-hmacsha256-signature")))) {
    return new Response("Invalid Square signature", { status: 401 });
  }

  const event = JSON.parse(body);
  const subscription = event?.data?.object?.subscription;
  const invoice = event?.data?.object?.invoice;

  if (subscription) {
    const email = await customerEmail(subscription.customer_id);
    if (!email) return new Response("Customer email is required", { status: 422 });

    const active = subscription.status === "ACTIVE";
    const { error } = await supabase
      .from("member_profiles")
      .update({
        role: active ? "contractor" : "investor",
        subscription_status: active ? "active" : "canceled",
        square_customer_id: subscription.customer_id,
        square_subscription_id: subscription.id,
      })
      .eq("email", email);

    if (error) throw error;
  }

  if (invoice && event.type === "invoice.payment_failed" && invoice.subscription_id) {
    const { error } = await supabase
      .from("member_profiles")
      .update({ subscription_status: "past_due" })
      .eq("square_subscription_id", invoice.subscription_id);
    if (error) throw error;
  }

  return new Response("ok", { status: 200 });
});
