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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
  const squareToken = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";

  const url = new URL(request.url);

  if (request.method === "GET") {
    const slug = asText(url.searchParams.get("property_slug"));
    const verifyAppId = asText(url.searchParams.get("verify_app_id"));
    const confirmRedirect = url.searchParams.get("confirm_redirect") === "1";

    if (slug) {
      const { data: property, error } = await supabase
        .from("rental_properties")
        .select("slug,title,address,city,state,zip,monthly_rent,security_deposit,application_fee_cents,bedrooms,bathrooms,square_feet,lot_acres,is_occupied,lease_term,description")
        .eq("slug", slug)
        .maybeSingle();
      if (error || !property) return json(request, { ok: false, error: "Property not found." }, 404);
      return json(request, { ok: true, property });
    }

    if (verifyAppId) {
      const { data: app, error } = await supabase
        .from("rental_applications")
        .select("*")
        .eq("id", verifyAppId)
        .maybeSingle();
      if (error || !app) return json(request, { ok: false, error: "Application not found." }, 404);

      let isPaid = app.payment_status === "paid";

      if (!isPaid && app.square_order_id && squareToken) {
        try {
          const orderRes = await fetch(`https://connect.squareup.com/v2/orders/${app.square_order_id}`, {
            headers: {
              Authorization: `Bearer ${squareToken}`,
              "Content-Type": "application/json",
            },
          });
          if (orderRes.ok) {
            const orderJson = await orderRes.json();
            const order = orderJson?.order;
            const tenders = Array.isArray(order?.tenders) ? order.tenders : [];
            if (order?.state === "COMPLETED" || tenders.length > 0) {
              isPaid = true;
            }
          }
        } catch (err) {
          console.error("Square order check error:", err);
        }
      }

      if (!isPaid && confirmRedirect) {
        isPaid = true;
      }

      if (isPaid && app.payment_status !== "paid") {
        const nowIso = new Date().toISOString();
        await supabase
          .from("rental_applications")
          .update({
            payment_status: "paid",
            paid_at: nowIso,
            paid_notification_sent_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", app.id);

        try {
          const ownerHtml = `<div style="font-family:Arial,sans-serif;color:#1e293b;max-width:640px;margin:0 auto;padding:20px">
            <h2 style="color:#113d3b;margin-bottom:8px">✅ Rental Application Fee Paid ($50.00) — 3506 Gay Street NW</h2>
            <p><strong>Applicant:</strong> ${escapeHtml(app.full_name)}<br>
            <strong>Phone:</strong> ${escapeHtml(app.phone)}<br>
            <strong>Email:</strong> ${escapeHtml(app.email)}<br>
            <strong>Desired Move-In:</strong> ${escapeHtml(app.desired_move_in_date || "ASAP")}<br>
            <strong>Employer &amp; Role:</strong> ${escapeHtml(app.employer_name)} (${escapeHtml(app.job_title || "N/A")})<br>
            <strong>Monthly Gross Income:</strong> $${escapeHtml(app.monthly_gross_income)}<br>
            <strong>Current Address:</strong> ${escapeHtml(app.current_address)} (${escapeHtml(app.current_residence_duration || "")})<br>
            <strong>Current Landlord:</strong> ${escapeHtml(app.current_landlord_name || "N/A")} (${escapeHtml(app.current_landlord_phone || "N/A")})<br>
            <strong>Occupants:</strong> ${escapeHtml(app.occupants_count)} (${escapeHtml(app.occupants_details || "None listed")})<br>
            <strong>Pets:</strong> ${app.has_pets ? "Yes — " + escapeHtml(app.pets_details || "") : "No"}<br>
            <strong>History Disclosure:</strong> ${escapeHtml(app.prior_evictions_or_felonies || "None")}<br>
            <strong>Application ID:</strong> ${escapeHtml(app.id)}</p>
          </div>`;
          await sendNotificationEmail(
            supabase,
            `[PAID $50] Rental Application — ${app.full_name} (3506 Gay St NW)`,
            ownerHtml,
            ["office@hreinvestor.com"]
          );

          const applicantHtml = `<div style="font-family:Arial,sans-serif;color:#1e293b;max-width:640px;margin:0 auto;padding:20px">
            <h2 style="color:#113d3b">We received your rental application &amp; $50.00 application fee</h2>
            <p>Hi ${escapeHtml(app.full_name)},</p>
            <p>Thank you for applying for <strong>3506 Gay Street NW, Huntsville, AL 35810</strong>. Your application and $50.00 non-refundable application fee have been received by Huntsville Real Estate Investors LLC (HREI).</p>
            <p>Our leasing team is reviewing your application and will reach out to you shortly at ${escapeHtml(app.phone)} or ${escapeHtml(app.email)}. If you have any questions, call or text us at <strong>(256) 701-0912</strong> or reply to this email.</p>
            <p>Best regards,<br><strong>Huntsville Real Estate Investors LLC (HREI)</strong><br>(256) 701-0912 · offers@hreinvestor.com</p>
          </div>`;
          await sendNotificationEmail(
            supabase,
            "Rental Application Received — 3506 Gay Street NW, Huntsville, AL",
            applicantHtml,
            [app.email]
          );
        } catch (e) {
          console.error("Notification email error:", e);
        }
      }

      return json(request, {
        ok: true,
        application: {
          id: app.id,
          full_name: app.full_name,
          property_slug: app.property_slug,
          payment_status: isPaid ? "paid" : app.payment_status,
          checkout_url: app.checkout_url,
        },
      });
    }

    return json(request, { ok: false, error: "Missing query parameter." }, 400);
  }

  if (request.method !== "POST") return json(request, { ok: false, error: "Method not allowed." }, 405);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return json(request, { ok: false, error: "Invalid application payload." }, 400);
  }

  // Honeypot check
  if (asText(body.website) !== "") {
    return json(request, { ok: true, checkout_url: "https://hreinvestor.com/rentals.html?application_paid=1" });
  }

  const propertySlug = asText(body.property_slug || "3506-gay-st-nw");
  const fullName = asText(body.full_name);
  const email = asText(body.email).toLowerCase();
  const rawPhone = asText(body.phone);
  const desiredMoveInDate = asText(body.desired_move_in_date) || null;
  const currentAddress = asText(body.current_address);
  const currentResidenceDuration = asText(body.current_residence_duration);
  const currentLandlordName = asText(body.current_landlord_name);
  const currentLandlordPhone = asText(body.current_landlord_phone);
  const employerName = asText(body.employer_name);
  const jobTitle = asText(body.job_title);
  const monthlyGrossIncome = Number(body.monthly_gross_income);
  const supervisorOrHrContact = asText(body.supervisor_or_hr_contact);
  const occupantsCount = Math.max(1, parseInt(asText(body.occupants_count || "1"), 10) || 1);
  const occupantsDetails = asText(body.occupants_details);
  const hasPets = body.has_pets === true || asText(body.has_pets).toLowerCase() === "yes";
  const petsDetails = asText(body.pets_details);
  const priorEvictionsOrFelonies = asText(body.prior_evictions_or_felonies);
  const screeningConsent = body.screening_consent === true;
  const additionalNotes = asText(body.additional_notes);

  let digits = rawPhone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (fullName.length < 2) return json(request, { ok: false, error: "Please enter your full legal name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(request, { ok: false, error: "Please enter a valid email address." }, 400);
  if (digits.length !== 10) return json(request, { ok: false, error: "Please enter a valid 10-digit US phone number." }, 400);
  if (currentAddress.length < 5) return json(request, { ok: false, error: "Please enter your current street address." }, 400);
  if (employerName.length < 2) return json(request, { ok: false, error: "Please enter your current employer or income source." }, 400);
  if (!Number.isFinite(monthlyGrossIncome) || monthlyGrossIncome <= 0) {
    return json(request, { ok: false, error: "Please enter your monthly gross income." }, 400);
  }
  if (!screeningConsent) {
    return json(request, { ok: false, error: "Please authorize background, credit, and eviction screening to continue." }, 400);
  }

  // Verify property exists and is not occupied
  const { data: property, error: propErr } = await supabase
    .from("rental_properties")
    .select("*")
    .eq("slug", propertySlug)
    .maybeSingle();

  if (propErr || !property) {
    return json(request, { ok: false, error: "Rental property not found." }, 404);
  }
  if (property.is_occupied) {
    return json(request, { ok: false, error: "This property is currently occupied and is not accepting applications right now." }, 409);
  }

  const feeCents = Number(property.application_fee_cents || 5000);
  const e164Phone = "+1" + digits;

  // Insert application record
  const { data: app, error: insertErr } = await supabase
    .from("rental_applications")
    .insert({
      property_slug: propertySlug,
      full_name: fullName,
      email,
      phone: e164Phone,
      desired_move_in_date: desiredMoveInDate,
      current_address: currentAddress,
      current_residence_duration: currentResidenceDuration,
      current_landlord_name: currentLandlordName,
      current_landlord_phone: currentLandlordPhone,
      employer_name: employerName,
      job_title: jobTitle,
      monthly_gross_income: monthlyGrossIncome,
      supervisor_or_hr_contact: supervisorOrHrContact,
      occupants_count: occupantsCount,
      occupants_details: occupantsDetails,
      has_pets: hasPets,
      pets_details: petsDetails,
      prior_evictions_or_felonies: priorEvictionsOrFelonies,
      screening_consent: screeningConsent,
      additional_notes: additionalNotes,
      application_fee_cents: feeCents,
      payment_status: "pending_payment",
    })
    .select("*")
    .single();

  if (insertErr || !app) {
    console.error("Insert rental_applications error:", insertErr);
    return json(request, { ok: false, error: "Could not save your application. Please try again." }, 500);
  }

  // Create Square Checkout Payment Link ($50.00) if a live SQUARE_ACCESS_TOKEN is configured;
  // otherwise use RENTAL_APPLICATION_PAYMENT_URL (Square link) if set, else manual Square link.
  let checkoutUrl = "";
  let paymentLinkId = "";
  let squareOrderId = "";
  let paymentProvider = "square";

  if (squareToken) {
    const baseUrls = [
      "https://connect.squareup.com",
      "https://connect.squareupsandbox.com",
    ];
    for (const baseUrl of baseUrls) {
      if (checkoutUrl) break;
      try {
        const locRes = await fetch(`${baseUrl}/v2/locations`, {
          headers: {
            Authorization: `Bearer ${squareToken}`,
            "Content-Type": "application/json",
          },
        });
        const locJson = await locRes.json();
        const activeLoc = (locJson?.locations || []).find((l: any) => l.status === "ACTIVE") || locJson?.locations?.[0];
        const locationId = activeLoc?.id;

        if (locationId) {
          const redirectUrl = `https://hreinvestor.com/rentals.html?application_paid=1&app_id=${app.id}`;
          const linkRes = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${squareToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              idempotency_key: app.id,
              description: `Rental Application for ${property.address}, ${property.city}, ${property.state} (${fullName})`,
              quick_pay: {
                name: `Rental Application Fee — ${property.address}, ${property.city}, ${property.state}`,
                price_money: {
                  amount: feeCents,
                  currency: "USD",
                },
                location_id: locationId,
              },
              checkout_options: {
                redirect_url: redirectUrl,
                ask_for_shipping_address: false,
              },
              pre_populated_data: {
                buyer_email: email,
                buyer_phone_number: e164Phone,
              },
            }),
          });
          const linkJson = await linkRes.json();
          if (linkRes.ok && linkJson?.payment_link?.url) {
            checkoutUrl = linkJson.payment_link.url;
            paymentLinkId = linkJson.payment_link.id || "";
            squareOrderId = linkJson.payment_link.order_id || "";
          }
        }
      } catch (sqErr) {
        console.error("Square checkout attempt error:", sqErr);
      }
    }
  }

  if (!checkoutUrl && FALLBACK_PAYMENT_URL) {
    checkoutUrl = FALLBACK_PAYMENT_URL;
    paymentProvider = "square_static_link";
  } else if (!checkoutUrl) {
    paymentProvider = "manual_square_link";
  }

  const nowIso = new Date().toISOString();
  await supabase
    .from("rental_applications")
    .update({
      square_payment_link_id: paymentLinkId || null,
      square_order_id: squareOrderId || null,
      checkout_url: checkoutUrl,
      notification_sent_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", app.id);

  // Send immediate email notification to HREI that an application was started
  try {
    const html = `<div style="font-family:Arial,sans-serif;color:#1e293b;max-width:640px;margin:0 auto;padding:20px">
      <h2 style="color:#113d3b;margin-bottom:8px">New Rental Application Submitted — ${escapeHtml(property.address)}</h2>
      <p style="color:#475569;margin-top:0">${checkoutUrl ? `Applicant was sent to the $50.00 fee checkout: ${escapeHtml(checkoutUrl)}` : `<strong>ACTION: no automatic checkout. Send the applicant a $50.00 Square payment link.</strong>`}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;font-weight:bold;width:180px">Applicant Name:</td><td>${escapeHtml(fullName)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Phone / Email:</td><td>${escapeHtml(e164Phone)} · ${escapeHtml(email)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Desired Move-In:</td><td>${escapeHtml(desiredMoveInDate || "ASAP")}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Current Address:</td><td>${escapeHtml(currentAddress)} (${escapeHtml(currentResidenceDuration || "N/A")})</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Current Landlord:</td><td>${escapeHtml(currentLandlordName || "N/A")} (${escapeHtml(currentLandlordPhone || "N/A")})</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Employer &amp; Title:</td><td>${escapeHtml(employerName)} — ${escapeHtml(jobTitle || "N/A")}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Monthly Gross Income:</td><td>$${escapeHtml(monthlyGrossIncome)}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Supervisor / HR Contact:</td><td>${escapeHtml(supervisorOrHrContact || "N/A")}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Occupants:</td><td>${escapeHtml(occupantsCount)} (${escapeHtml(occupantsDetails || "Applicant only")})</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Pets:</td><td>${hasPets ? "Yes — " + escapeHtml(petsDetails || "") : "No"}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Evictions / Felonies:</td><td>${escapeHtml(priorEvictionsOrFelonies || "None reported")}</td></tr>
        <tr><td style="padding:6px 0;font-weight:bold">Notes:</td><td>${escapeHtml(additionalNotes || "None")}</td></tr>
      </table>
    </div>`;
    await sendNotificationEmail(
      supabase,
      `New Rental Application (Pending $50 Fee) — ${fullName} — 3506 Gay St NW`,
      html,
      ["office@hreinvestor.com"]
    );
  } catch (e) {
    console.error("Initial notification email failed:", e);
  }

  return json(request, {
    ok: true,
    application_id: app.id,
    checkout_url: checkoutUrl,
    payment_provider: paymentProvider,
    square_payment_link_id: paymentLinkId || null,
  });
});
