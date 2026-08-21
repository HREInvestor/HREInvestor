(() => {
  const qs = (s) => document.querySelector(s);
  const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const money = (v) => v === null || v === undefined || v === "" ? "—" : new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", maximumFractionDigits:0 }).format(Number(v));
  const list = (values) => Array.isArray(values) && values.length ? values.map(esc).join(", ") : "—";
  const statusOptions = ["new","active","vetted","priority","inactive","opted_out"];
  let buyers = [];
  let client;

  function setMessage(text, bad = false) {
    const el = qs("#message");
    el.textContent = text || "";
    el.className = "mt-4 text-sm font-medium " + (bad ? "text-red-700" : "text-teal-800");
  }

  function render() {
    const term = qs("#search").value.trim().toLowerCase();
    const status = qs("#statusFilter").value;
    const county = qs("#countyFilter").value;
    const filtered = buyers.filter((b) => {
      const haystack = [b.full_name,b.company_name,b.email,b.phone,b.cities_or_zips,b.buy_box,...(b.counties || []),...(b.strategies || []),...(b.property_types || [])].filter(Boolean).join(" ").toLowerCase();
      return (!term || haystack.includes(term)) && (!status || b.status === status) && (!county || (b.counties || []).includes(county));
    });
    qs("#totalCount").textContent = buyers.length;
    qs("#newCount").textContent = buyers.filter((b) => b.status === "new").length;
    qs("#vettedCount").textContent = buyers.filter((b) => b.status === "vetted").length;
    qs("#priorityCount").textContent = buyers.filter((b) => b.status === "priority").length;
    const root = qs("#buyers");
    if (!filtered.length) {
      root.innerHTML = '<div class="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 lg:col-span-2">No cash buyers match these filters yet.</div>';
      return;
    }
    root.innerHTML = filtered.map((b) => {
      const contact = [b.phone ? '<a class="text-teal-800 underline" href="tel:' + esc(b.phone.replace(/[^+\d]/g, "")) + '">' + esc(b.phone) + '</a>' : "", b.email ? '<a class="text-teal-800 underline" href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a>' : ""].filter(Boolean).join(" · ");
      const selected = statusOptions.map((s) => '<option value="' + s + '"' + (b.status === s ? " selected" : "") + '>' + esc(s.replace("_", " ")) + "</option>").join("");
      return '<article class="rounded-xl border border-slate-200 p-5">' +
        '<div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-lg font-extrabold">' + esc(b.full_name) + '</h2><p class="text-sm text-slate-600">' + esc(b.company_name || "Independent buyer") + '</p><p class="mt-2 text-sm">' + (contact || "No contact information") + '</p></div><label class="text-sm font-semibold">Status<select data-status="' + b.id + '" class="mt-1 block rounded-lg border border-slate-300 px-2 py-1 font-normal">' + selected + '</select></label></div>' +
        '<dl class="mt-4 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2"><div><dt class="font-semibold text-slate-500">Markets</dt><dd>' + list(b.counties) + (b.cities_or_zips ? "<br>" + esc(b.cities_or_zips) : "") + '</dd></div><div><dt class="font-semibold text-slate-500">Strategy / property</dt><dd>' + list(b.strategies) + "<br>" + list(b.property_types) + '</dd></div><div><dt class="font-semibold text-slate-500">Purchase range</dt><dd>' + money(b.min_purchase_price) + " – " + money(b.max_purchase_price) + '</dd></div><div><dt class="font-semibold text-slate-500">Experience</dt><dd>' + (b.purchases_last_12_months ?? "—") + " bought in last 12 mo. · " + (b.lifetime_purchases ?? "—") + " lifetime</dd></div><div><dt class="font-semibold text-slate-500">Funding / close</dt><dd>' + list(b.funding_sources) + "<br>" + (b.typical_close_days ? esc(b.typical_close_days) + " typical days to close" : "—") + '</dd></div><div><dt class="font-semibold text-slate-500">Proof of funds</dt><dd>' + esc((b.proof_of_funds_status || "available_on_request").replaceAll("_", " ")) + '</dd></div></dl>' +
        (b.buy_box ? '<p class="mt-4 rounded-lg bg-slate-50 p-3 text-sm"><b>Buy box:</b> ' + esc(b.buy_box) + "</p>" : "") +
        '<label class="mt-4 block text-sm font-semibold">Private CRM notes<textarea data-notes="' + b.id + '" class="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" rows="3" placeholder="Notes only your team can see">' + esc(b.internal_notes || "") + '</textarea></label>' +
        '<div class="mt-3 flex flex-wrap gap-2"><button data-save="' + b.id + '" class="rounded-lg bg-teal-700 px-3 py-2 text-sm font-bold text-white hover:bg-teal-800">Save changes</button><button data-contact="' + b.id + '" class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50">Mark contacted</button><button data-optout="' + b.id + '" class="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Do not contact</button></div>' +
        '</article>';
    }).join("");
  }

  async function updateBuyer(id, updates, successText) {
    setMessage("Saving…");
    const { error } = await client.from("cash_buyers").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { setMessage(error.message, true); return; }
    const local = buyers.find((b) => b.id === id);
    if (local) Object.assign(local, updates);
    setMessage(successText);
    render();
  }

  function connectEvents() {
    qs("#search").addEventListener("input", render);
    qs("#statusFilter").addEventListener("change", render);
    qs("#countyFilter").addEventListener("change", render);
    qs("#copyLink").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(qs("#intakeLink").value); qs("#linkMessage").textContent = "Intake link copied."; }
      catch { qs("#intakeLink").select(); document.execCommand("copy"); qs("#linkMessage").textContent = "Intake link copied."; }
    });
    qs("#buyers").addEventListener("click", (event) => {
      const target = event.target;
      const save = target.dataset.save;
      const contact = target.dataset.contact;
      const optout = target.dataset.optout;
      if (save) {
        const status = qs('[data-status="' + save + '"]').value;
        const notes = qs('[data-notes="' + save + '"]').value.trim();
        updateBuyer(Number(save), { status, internal_notes: notes }, "Buyer profile saved.");
      }
      if (contact) updateBuyer(Number(contact), { last_contacted_at: new Date().toISOString() }, "Contact activity recorded.");
      if (optout && confirm("Mark this buyer as do not contact? No messages will be sent from the CRM.")) updateBuyer(Number(optout), { contact_opt_out:true, status:"opted_out" }, "Buyer marked do not contact.");
    });
  }

  async function load() {
    qs("#intakeLink").value = location.origin + "/buyer-intake.html";
    try {
      const { data, error } = await client.from("cash_buyers").select("*").order("created_at", { ascending:false });
      if (error) throw error;
      buyers = data || [];
      render();
    } catch (error) {
      setMessage("The Cash Buyer CRM needs its database update before it can load. Run the cash buyer migration in Supabase, then refresh.", true);
      qs("#buyers").innerHTML = "";
    }
  }

  async function start() {
    const member = window.currentMember;
    if (!member?.client) return;
    client = member.client;
    document.body.style.visibility = "visible";
    connectEvents();
    await load();
    qs("#signOut").onclick = async () => { await client.auth.signOut(); location.replace("/login.html"); };
  }

  window.addEventListener("hrei:member-ready", start, { once:true });
  setTimeout(start, 900);
})();