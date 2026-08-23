(() => {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  const clean = value => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const digits = value => String(value ?? "").replace(/\D/g, "");
  const numeric = value => { const n = Number(String(value ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : null; };
  const integer = value => { const n = numeric(value); return n === null ? null : Math.round(n); };
  const yes = value => ["1","true","yes","y"].includes(clean(value));
  const dateIso = value => { const m = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? m[3] + "-" + m[1].padStart(2,"0") + "-" + m[2].padStart(2,"0") : null; };
  const aliases = {
    seller_name:["sellername","name","owner","ownername","fullname","contactname"],
    property_address:["propertyaddress","address","streetaddress","street"],
    city:["propertycity","city"], state:["propertystate","state"], zip:["propertypostalcode","zip","zipcode","postalcode"],
    phone:["phone","phonenumber","mobile","cell","cellphone","telephone","contact1phone1"],
    email:["email","emailaddress","contact1email1"], asking_price:["askingprice","price","amount","offerprice"],
    notes:["notes","note","comments","comment","details","description"]
  };
  let client, existing = [], reviewed = [];

  function parseCsv(text) {
    const rows = []; let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i], next = text[i + 1];
      if (char === '"' && quoted && next === '"') { cell += '"'; i++; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (char === "," && !quoted) { row.push(cell); cell = ""; continue; }
      if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") i++;
        row.push(cell); if (row.some(value => value.trim())) rows.push(row);
        row = []; cell = ""; continue;
      }
      cell += char;
    }
    row.push(cell); if (row.some(value => value.trim())) rows.push(row);
    if (rows.length < 2) return [];
    const headers = rows.shift().map(value => clean(value).replace(/[^a-z0-9]/g, ""));
    return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ""])));
  }

  async function readInputFile(file) {
    if (!file.name.toLowerCase().endsWith(".zip")) return file.text();
    if (!window.JSZip) throw new Error("ZIP support did not load. Refresh and try again.");
    const archive = await window.JSZip.loadAsync(file);
    const csv = Object.values(archive.files).find(entry => !entry.dir && /\.csv$/i.test(entry.name));
    if (!csv) throw new Error("This ZIP does not contain a CSV file.");
    return csv.async("text");
  }

  function readField(row, field) {
    for (const alias of aliases[field]) if (row[alias] !== undefined) return row[alias];
    return "";
  }
  function sellerName(raw) {
    const named = readField(raw, "seller_name");
    if (named) return named;
    return [raw.firstname, raw.lastname].filter(Boolean).join(" ").trim();
  }
  function collectContacts(raw) {
    const contacts = [];
    for (let contact = 1; contact <= 8; contact++) {
      const name = raw["contact" + contact + "name"] || "";
      const type = raw["contact" + contact + "type"] || "";
      for (let phoneIndex = 1; phoneIndex <= 3; phoneIndex++) {
        const prefix = "contact" + contact + "phone" + phoneIndex;
        const phone = raw[prefix] || "";
        const email = raw["contact" + contact + "email" + phoneIndex] || (phoneIndex === 1 ? raw["contact" + contact + "email1"] || "" : "");
        if (!name && !phone && !email) continue;
        contacts.push({
          name, contact_type:type, phone, phone_type:raw[prefix + "type"] || "",
          activity_score:raw[prefix + "activityscore"] || "", dnc:yes(raw[prefix + "dnc"]),
          litigator:yes(raw[prefix + "litigator"]), email
        });
      }
    }
    if (!contacts.length && (readField(raw, "phone") || readField(raw, "email"))) contacts.push({ name:sellerName(raw), contact_type:"", phone:readField(raw,"phone"), phone_type:"", activity_score:"", dnc:false, litigator:false, email:readField(raw,"email") });
    return contacts;
  }
  function signals(raw) {
    const definitions = [["Absentee Owner","absenteeowner"],["Cash Buyer","cashbuyer"],["Delinquent Tax","delinquenttaxactivity"],["Foreclosure Activity","foreclosureactivity"],["Free & Clear","freeandclear"],["High Equity","highequity"],["Long-Term Owner","longtermowner"],["Potentially Inherited","potentiallyinherited"],["Pre-Foreclosure","preforeclosure"],["Vacancy","vacancy"],["Deceased / Probate","deceasedprobate"]];
    return definitions.filter(([, field]) => yes(raw[field])).map(([label]) => label);
  }
  function normalizedRows(rawRows) {
    const stage = document.getElementById("stage").value, priority = document.getElementById("priority").value, source = document.getElementById("source").value.trim() || "CSV Import";
    return rawRows.map((raw, index) => {
      const contacts = collectContacts(raw);
      const safePhoneContact = contacts.find(contact => contact.phone && !contact.dnc && !contact.litigator);
      const safeEmailContact = contacts.find(contact => contact.email && !contact.dnc && !contact.litigator);
      const asking = numeric(readField(raw, "asking_price"));
      const tags = signals(raw);
      const row = {
        seller_name: sellerName(raw), property_address:readField(raw, "property_address"),
        city:readField(raw, "city"), state:(readField(raw, "state") || "AL").toUpperCase(), zip:readField(raw, "zip"),
        phone:safePhoneContact?.phone || "", email:(safeEmailContact?.email || "").toLowerCase(), asking_price:asking,
        notes:readField(raw, "notes") || null, stage, priority, source,
        mailing_address:raw.recipientaddress || null, mailing_city:raw.recipientcity || null, mailing_state:raw.recipientstate || null, mailing_zip:raw.recipientpostalcode || null,
        county:raw.county || null, latitude:numeric(raw.latitude), longitude:numeric(raw.longitude), property_type:raw.propertytype || null, owner_type:raw.ownertype || null,
        last_sale_date:dateIso(raw.lastsalesdate), last_sale_price:numeric(raw.lastsalesprice), price_per_sqft:numeric(raw.pricepersqft), square_feet:integer(raw.squarefootage),
        lot_size_sqft:numeric(raw.lotsizesqft), beds:numeric(raw.beds), baths:numeric(raw.baths), year_built:integer(raw.yearbuilt), subdivision:raw.subdivision || null,
        estimated_market_value:numeric(raw.marketvalue), estimated_wholesale_value:numeric(raw.wholesalevalue), rental_estimate_low:numeric(raw.rentalestimatelow), rental_estimate_high:numeric(raw.rentalestimatehigh), tax_amount:numeric(raw.taxamount),
        lead_tags:tags, contact_candidates:contacts, source_record_id:raw.id || raw.addresshash || null, source_data:raw,
        contact_opt_out:Boolean(contacts.some(contact => contact.phone) && !safePhoneContact)
      };
      const valid = Boolean(row.seller_name && (row.property_address || row.phone || row.email));
      const duplicate = existing.some(lead => {
        const sameEmail = row.email && clean(lead.email) === clean(row.email);
        const samePhone = digits(row.phone).length >= 7 && digits(lead.phone) === digits(row.phone);
        const sameNameAndAddress = clean(row.seller_name) && clean(row.property_address) && clean(lead.seller_name) === clean(row.seller_name) && clean(lead.property_address) === clean(row.property_address);
        const sameSourceRecord = row.source_record_id && lead.source_record_id && clean(row.source_record_id) === clean(lead.source_record_id);
        return sameEmail || samePhone || sameNameAndAddress || sameSourceRecord;
      });
      return { index:index + 2, row, valid, duplicate, contacts, archivedMatch: duplicate && existing.some(lead => lead.archived_at && ((row.email && clean(lead.email) === clean(row.email)) || (digits(row.phone).length >= 7 && digits(lead.phone) === digits(row.phone)) || (clean(row.seller_name) && clean(row.property_address) && clean(lead.seller_name) === clean(row.seller_name) && clean(lead.property_address) === clean(row.property_address)))) };
    });
  }
  function renderReview() {
    const skip = document.getElementById("skipDuplicates").checked;
    const valid = reviewed.filter(item => item.valid), duplicates = valid.filter(item => item.duplicate);
    const eligible = valid.filter(item => !skip || !item.duplicate);
    const noDirectPhone = valid.filter(item => !item.row.phone && item.contacts.some(contact => contact.phone)).length;
    document.getElementById("summary").textContent = reviewed.length + " row(s) found · " + valid.length + " ready · " + duplicates.length + " likely duplicate(s) · " + noDirectPhone + " with phone held for DNC/litigator review · " + eligible.length + " will import.";
    document.getElementById("import").disabled = !eligible.length;
    document.getElementById("preview").innerHTML = '<table class="min-w-full text-left text-sm"><thead><tr class="border-b text-slate-500"><th class="p-3">Row</th><th class="p-3">Seller</th><th class="p-3">Property / contacts</th><th class="p-3">Status</th></tr></thead><tbody>' + reviewed.slice(0,100).map(item => {
      const archivedMatch=item.duplicate&&item.archivedMatch; const status = !item.valid ? "Needs seller name plus contact or property" : archivedMatch ? "Archived match — blocked from outreach" : item.duplicate ? (skip ? "Duplicate — skipped" : "Duplicate — included") : item.row.contact_opt_out ? "Imported, but direct phone blocked for review" : "Ready";
      const style = !item.valid ? "text-red-700" : item.duplicate ? "text-amber-700" : item.row.contact_opt_out ? "text-amber-700" : "text-teal-800";
      return '<tr class="border-b"><td class="p-3">'+item.index+'</td><td class="p-3 font-bold">'+esc(item.row.seller_name || "—")+'</td><td class="p-3">'+esc([item.row.property_address,item.row.city,item.row.state].filter(Boolean).join(", ") || item.row.phone || item.row.email || "—")+'<span class="block text-xs text-slate-500">'+item.contacts.length+' contact option(s) · '+esc(item.row.property_type || "Property type not supplied")+'</span></td><td class="p-3 font-bold '+style+'">'+status+'</td></tr>';
    }).join("") + (reviewed.length > 100 ? '<tr><td colspan="4" class="p-3 text-slate-500">Showing the first 100 rows.</td></tr>' : "") + '</tbody></table>';
  }
  async function review() {
    const file = document.getElementById("file").files[0], message = document.getElementById("message");
    if (!file) { message.textContent = "Choose a CSV or ZIP file first."; return; }
    if (file.size > 8 * 1024 * 1024) { message.textContent = "Use a file smaller than 8 MB."; return; }
    try {
      const rawRows = parseCsv(await readInputFile(file));
      if (!rawRows.length) { message.textContent = "No usable data was found. Make sure the CSV has a header row."; return; }
      if (rawRows.length > 2000) { message.textContent = "For safety, import up to 2,000 rows at a time."; return; }
      reviewed = normalizedRows(rawRows); document.getElementById("reviewPanel").classList.remove("hidden"); renderReview();
      document.getElementById("reviewPanel").scrollIntoView({behavior:"smooth", block:"start"});
    } catch (error) { message.textContent = error.message || "Could not read this file."; }
  }
  async function importRows() {
    const skip = document.getElementById("skipDuplicates").checked;
    const rows = reviewed.filter(item => item.valid && (!skip || !item.duplicate)).map(item => item.row);
    if (!rows.length) return;
    if (!confirm("Add " + rows.length + " lead" + (rows.length === 1 ? "" : "s") + " to your CRM?")) return;
    const button = document.getElementById("import"), message = document.getElementById("message");
    button.disabled = true; button.textContent = "Importing…"; let done = 0;
    try {
      for (let i = 0; i < rows.length; i += 50) {
        const { error } = await client.from("leads").insert(rows.slice(i, i + 50));
        if (error) throw error;
        done += Math.min(50, rows.length - i); message.textContent = done + " of " + rows.length + " leads imported…";
      }
      message.textContent = done + " lead" + (done === 1 ? "" : "s") + " added to your CRM.";
      reviewed = []; document.getElementById("reviewPanel").classList.add("hidden"); document.getElementById("file").value = "";
      const { data } = await client.from("leads").select("*").order("created_at", {ascending:false}).limit(1000); existing = data || [];
    } catch (error) { message.textContent = "Import stopped: " + (error.message || "Could not add the leads.") + ". If this says a column is missing, run the Lead Enrichment migration first."; }
    finally { button.disabled = false; button.textContent = "Import reviewed leads"; }
  }
  function downloadTemplate() {
    const csv = "seller_name,property_address,city,state,zip,phone,email,asking_price,notes\nJane Smith,123 Main St,Huntsville,AL,35801,2565550123,jane@example.com,150000,Interested in a cash offer\n";
    const url = URL.createObjectURL(new Blob([csv], {type:"text/csv"})); const link = document.createElement("a");
    link.href = url; link.download = "hrei-lead-import-template.csv"; link.click(); URL.revokeObjectURL(url);
  }
  async function initialize(event) {
    if (initialize.started) return; initialize.started = true; document.body.style.visibility = "visible";
    client = event.detail.client;
    const { data, error } = await client.from("leads").select("*").order("created_at",{ascending:false}).limit(1000);
    if (error) document.getElementById("message").textContent = "Could not load existing CRM leads: " + error.message;
    existing = data || [];
    document.getElementById("review").onclick = review; document.getElementById("import").onclick = importRows;
    document.getElementById("template").onclick = downloadTemplate; document.getElementById("skipDuplicates").onchange = renderReview;
  }
  window.addEventListener("hrei:member-ready", initialize);
  function waitForMember(attempt=0) {
    if (initialize.started) return;
    if (window.currentMember) { initialize({detail:window.currentMember}); return; }
    if (attempt < 80) { setTimeout(() => waitForMember(attempt + 1), 100); return; }
    document.body.style.visibility = "visible"; document.getElementById("message").textContent = "Your member session did not finish loading. Refresh or sign in again.";
  }
  waitForMember();
  document.getElementById("out").onclick = async () => { await window.currentMember.client.auth.signOut(); location.replace("/login.html"); };
})();