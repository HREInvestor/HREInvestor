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


// Extra screening answers stored in rental_applications.application_details (jsonb). [key, label]
const DETAIL_FIELDS: [string, string][] = [
  ["date_of_birth", "Date of birth"],
  ["adult_occupants", "Other adults 18+ (names)"],
  ["adults_count", "Number of adults 18+"],
  ["minors_count", "Number of minors under 18"],
  ["lease_length", "Desired lease length"],
  ["has_voucher", "Housing voucher (HCV/Section 8)"],
  ["voucher_bedrooms", "Voucher bedroom size"],
  ["housing_authority", "Housing authority"],
  ["caseworker", "Caseworker name & contact"],
  ["voucher_amount", "Voucher payment amount"],
  ["current_rent", "Current monthly rent"],
  ["reason_for_leaving", "Reason for leaving"],
  ["prior_address", "Prior address & dates"],
  ["prior_landlord", "Prior landlord name & phone"],
  ["employment_length", "Time at employer"],
  ["employer_phone_address", "Employer phone/address"],
  ["other_income", "Other income (source & monthly)"],
  ["eviction_ever", "Ever evicted / eviction filed"],
  ["broken_lease", "Ever broken a lease"],
  ["owe_landlord", "Owe a landlord money"],
  ["criminal_history", "Criminal conviction disclosure"],
  ["criminal_details", "Conviction details / mitigation"],
  ["bankruptcy", "Bankruptcy (last 7 yrs)"],
  ["pet_type_breed", "Pet type/breed"],
  ["pet_weight", "Pet weight(s)"],
  ["pet_count", "Number of pets"],
  ["assistance_animal", "Assistance animal (no fee/deposit)"],
  ["smoking", "Smoker in household"],
  ["vehicles_count", "Number of vehicles"],
  ["vehicle_details", "Vehicle make/model/plate"],
  ["emergency_contact", "Emergency contact (name, relation, phone)"],
  ["heard_about", "How heard about us"],
];

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
  const url = new URL(request.url);

  if (request.method === "GET") {
    const slug = asText(url.searchParams.get("property_slug"));
    if (slug) {
      const { data: property, error } = await supabase
        .from("rental_properties")
        .select("slug,title,address,city,state,zip,monthly_rent,security_deposit,bedrooms,bathrooms,square_feet,lot_acres,is_occupied,lease_term,description")
        .eq("slug", slug)
        .maybeSingle();
      if (error || !property) return json(request, { ok: false, error: "Property not found." }, 404);
      return json(request, { ok: true, property });
    }
    return json(request, { ok: false, error: "Missing query parameter." }, 400);
  }

  if (request.method !== "POST") return json(request, { ok: false, error: "Method not allowed." }, 405);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return json(request, { ok: false, error: "Invalid application payload." }, 400);
  }

  // Honeypot
  if (asText(body.website) !== "") return json(request, { ok: true });

  const dryRun = body.dry_run === true;
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
  const truthCertified = body.truth_certification === true;
  const additionalNotes = asText(body.additional_notes);

  // Extra screening answers -> application_details jsonb (whitelisted, text-capped)
  const rawDetails = (body.details && typeof body.details === "object") ? body.details as Record<string, unknown> : {};
  const details: Record<string, string> = {};
  for (const [label] of DETAIL_FIELDS) {
    const v = asText(rawDetails[label]).slice(0, 2000);
    if (v) details[label] = v;
  }

  let digits = rawPhone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (fullName.length < 2) return json(request, { ok: false, error: "Please enter your full legal name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(request, { ok: false, error: "Please enter a valid email address." }, 400);
  if (digits.length !== 10) return json(request, { ok: false, error: "Please enter a valid 10-digit US phone number." }, 400);
  if (currentAddress.length < 5) return json(request, { ok: false, error: "Please enter your current street address." }, 400);
  if (employerName.length < 2) return json(request, { ok: false, error: "Please enter your current employer or income source." }, 400);
  if (!Number.isFinite(monthlyGrossIncome) || monthlyGrossIncome < 0) {
    return json(request, { ok: false, error: "Please enter your monthly gross income." }, 400);
  }
  if (!screeningConsent || !truthCertified) {
    return json(request, { ok: false, error: "Please check both authorization boxes to submit." }, 400);
  }

  const { data: property, error: propErr } = await supabase
    .from("rental_properties").select("*").eq("slug", propertySlug).maybeSingle();
  if (propErr || !property) return json(request, { ok: false, error: "Rental property not found." }, 404);
  if (property.is_occupied) {
    return json(request, { ok: false, error: "This property is currently occupied and is not accepting applications right now." }, 409);
  }

  const e164Phone = "+1" + digits;
  if (dryRun) return json(request, { ok: true, dry_run: true, would_store: { full_name: fullName, details } });

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
      application_details: details,
      application_fee_cents: 0,
      payment_status: "not_required",
    })
    .select("id")
    .single();

  if (insertErr || !app) {
    console.error("Insert rental_applications error:", insertErr);
    return json(request, { ok: false, error: "Could not save your application. Please try again." }, 500);
  }

  try {
    const row = (k: string, v: unknown) =>
      `<tr><td style="padding:5px 8px 5px 0;font-weight:bold;vertical-align:top;width:230px">${escapeHtml(k)}</td><td style="padding:5px 0">${escapeHtml(v || "—")}</td></tr>`;
    const detailRows = DETAIL_FIELDS.filter(([k]) => details[k]).map(([k, label]) => row(label, details[k])).join("");
    const html = `<div style="font-family:Arial,sans-serif;color:#1e293b;max-width:720px;margin:0 auto;padding:20px">
      <h2 style="color:#113d3b;margin-bottom:8px">New Rental Application — ${escapeHtml(property.address)}</h2>
      <p style="color:#475569;margin-top:0">No application fee (free application).</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${row("Applicant", fullName)}
        ${row("Phone / Email", e164Phone + " · " + email)}
        ${row("Desired move-in", desiredMoveInDate || "ASAP")}
        ${row("Current address", currentAddress + " (" + (currentResidenceDuration || "N/A") + ")")}
        ${row("Current landlord", (currentLandlordName || "N/A") + " (" + (currentLandlordPhone || "N/A") + ")")}
        ${row("Employer & title", employerName + " — " + (jobTitle || "N/A"))}
        ${row("Monthly gross income", "$" + monthlyGrossIncome)}
        ${row("Supervisor / HR", supervisorOrHrContact)}
        ${row("Occupants (total)", occupantsCount + " — " + (occupantsDetails || "Applicant only"))}
        ${row("Pets", hasPets ? "Yes — " + petsDetails : "No")}
        ${row("Eviction/criminal summary", priorEvictionsOrFelonies)}
        ${detailRows}
        ${row("Notes", additionalNotes)}
        ${row("Application ID", app.id)}
      </table></div>`;
    await sendNotificationEmail(supabase, `New Rental Application — ${fullName} — ${property.address}`, html, ["office@hreinvestor.com"]);
    await supabase.from("rental_applications").update({ notification_sent_at: new Date().toISOString() }).eq("id", app.id);
  } catch (e) {
    console.error("Notification email failed:", e);
  }

  return json(request, { ok: true, application_id: app.id });
});
