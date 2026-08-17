(() => {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  const money = value => value == null || value === "" || Number.isNaN(Number(value)) ? "—" : new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value));
  const number = value => value == null || value === "" || Number.isNaN(Number(value)) ? "—" : new Intl.NumberFormat("en-US",{maximumFractionDigits:0}).format(Number(value));
  const decimal = value => value == null || value === "" || Number.isNaN(Number(value)) ? "—" : new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(Number(value));
  const asNumber = value => value === "" || value == null ? null : Number(value);
  const app = document.getElementById("app");
  let client, ownerId, analyses = [], selected = null, comps = [];

  const addressText = row => [row.subject_address,row.city,row.state,row.zip].filter(Boolean).join(", ");
  const newAnalysis = () => ({title:"",subject_address:"",city:"",state:"AL",zip:"",bedrooms:"",bathrooms:"",square_feet:"",repair_estimate:0,target_profit:0,offer_rule_percent:70,notes:""});

  const calculation = () => {
    const priced = comps.filter(comp => Number(comp.sale_price) > 0);
    const ppsfRows = priced.filter(comp => Number(comp.square_feet) > 0);
    const averagePrice = priced.length ? priced.reduce((sum, comp) => sum + Number(comp.sale_price), 0) / priced.length : null;
    const averagePpsf = ppsfRows.length ? ppsfRows.reduce((sum, comp) => sum + Number(comp.sale_price) / Number(comp.square_feet), 0) / ppsfRows.length : null;
    const subjectSqft = Number(selected?.square_feet) || null;
    const arv = subjectSqft && averagePpsf ? subjectSqft * averagePpsf : averagePrice;
    const repairs = Number(selected?.repair_estimate) || 0;
    const profit = Number(selected?.target_profit) || 0;
    const rule = Number(selected?.offer_rule_percent) || 70;
    const ruleOffer = arv == null ? null : arv * (rule / 100) - repairs;
    const profitOffer = arv == null ? null : arv - repairs - profit;
    const recommended = ruleOffer == null ? null : Math.min(ruleOffer, profit ? profitOffer : ruleOffer);
    return {priced,ppsfRows,averagePrice,averagePpsf,arv,repairs,profit,rule,ruleOffer,profitOffer,recommended};
  };

  const render = () => {
    const row = selected || newAnalysis();
    const result = calculation();
    const saved = analyses.map(item => '<button type="button" data-open-analysis="'+esc(item.id)+'" class="w-full rounded-xl border p-4 text-left hover:border-teal-700 '+(selected?.id === item.id ? 'border-teal-700 bg-teal-50' : 'border-slate-200 bg-white')+'"><b>'+esc(item.title)+'</b><p class="mt-1 text-sm text-slate-600">'+esc(addressText(item) || "No address")+'</p><p class="mt-2 text-xs font-bold text-teal-800">'+new Date(item.updated_at || item.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})+'</p></button>').join("") || '<p class="rounded-xl bg-white p-4 text-sm text-slate-500">No saved analyses yet.</p>';
    const compRows = comps.map(comp => '<tr class="border-t"><td class="p-3 font-semibold">'+esc(comp.address)+'</td><td class="p-3">'+money(comp.sale_price)+'</td><td class="p-3">'+number(comp.square_feet)+'</td><td class="p-3">'+(Number(comp.square_feet) ? money(Number(comp.sale_price)/Number(comp.square_feet)) : "—")+'</td><td class="p-3">'+esc(comp.sale_date || "—")+'</td><td class="p-3 text-right"><button type="button" data-delete-comp="'+esc(comp.id)+'" class="text-sm font-bold text-red-700">Remove</button></td></tr>').join("") || '<tr><td colspan="6" class="p-5 text-center text-slate-500">Add recent nearby sales to calculate the estimate.</td></tr>';
    app.innerHTML =
      '<div class="grid gap-6 lg:grid-cols-[280px_1fr]">'+
        '<aside><div class="rounded-2xl bg-white p-5 shadow"><div class="flex items-center justify-between gap-3"><h2 class="text-lg font-extrabold">Saved analyses</h2><button id="newAnalysis" type="button" class="rounded-lg bg-teal-800 px-3 py-2 text-sm font-bold text-white">New</button></div><div class="mt-4 space-y-3">'+saved+'</div></div></aside>'+
        '<div class="space-y-6">'+
          '<section class="rounded-2xl bg-white p-6 shadow"><div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-2xl font-extrabold">'+(selected?.id ? "Edit analysis" : "New analysis")+'</h2><p class="mt-1 text-sm text-slate-600">Save the subject property first, then add comparable sales.</p></div>'+(selected?.id ? '<button id="deleteAnalysis" type="button" class="text-sm font-bold text-red-700">Delete analysis</button>' : '')+'</div>'+
          '<form id="analysisForm" class="mt-6 grid gap-3 md:grid-cols-2">'+
            '<label class="md:col-span-2 text-sm font-bold">Analysis name<input name="title" required value="'+esc(row.title)+'" placeholder="Example: 123 Main St — purchase analysis" class="mt-1 w-full rounded-lg border p-3 font-normal"></label>'+
            '<label class="md:col-span-2 text-sm font-bold">Subject address<input name="subject_address" value="'+esc(row.subject_address)+'" placeholder="Street address" class="mt-1 w-full rounded-lg border p-3 font-normal"></label>'+
            '<label class="text-sm font-bold">City<input name="city" value="'+esc(row.city)+'" placeholder="City" class="mt-1 w-full rounded-lg border p-3 font-normal"></label>'+
            '<div class="grid grid-cols-2 gap-3"><label class="text-sm font-bold">State<input name="state" value="'+esc(row.state || "AL")+'" maxlength="2" class="mt-1 w-full rounded-lg border p-3 font-normal"></label><label class="text-sm font-bold">ZIP<input name="zip" value="'+esc(row.zip)+'" inputmode="numeric" class="mt-1 w-full rounded-lg border p-3 font-normal"></label></div>'+
            '<div class="grid grid-cols-3 gap-3 md:col-span-2"><label class="text-sm font-bold">Beds<input name="bedrooms" value="'+esc(row.bedrooms)+'" type="number" min="0" step="0.5" class="mt-1 w-full rounded-lg border p-3 font-normal"></label><label class="text-sm font-bold">Baths<input name="bathrooms" value="'+esc(row.bathrooms)+'" type="number" min="0" step="0.5" class="mt-1 w-full rounded-lg border p-3 font-normal"></label><label class="text-sm font-bold">Sq. ft.<input name="square_feet" value="'+esc(row.square_feet)+'" type="number" min="0" class="mt-1 w-full rounded-lg border p-3 font-normal"></label></div>'+
            '<div class="grid grid-cols-3 gap-3 md:col-span-2"><label class="text-sm font-bold">Repair estimate<input name="repair_estimate" value="'+esc(row.repair_estimate)+'" type="number" min="0" step="100" class="mt-1 w-full rounded-lg border p-3 font-normal"></label><label class="text-sm font-bold">Target profit<input name="target_profit" value="'+esc(row.target_profit)+'" type="number" min="0" step="100" class="mt-1 w-full rounded-lg border p-3 font-normal"></label><label class="text-sm font-bold">Rule %<input name="offer_rule_percent" value="'+esc(row.offer_rule_percent || 70)+'" type="number" min="1" max="100" step="1" class="mt-1 w-full rounded-lg border p-3 font-normal"></label></div>'+
            '<label class="md:col-span-2 text-sm font-bold">Notes<textarea name="notes" rows="3" placeholder="Condition, neighborhood notes, or buying assumptions" class="mt-1 w-full rounded-lg border p-3 font-normal">'+esc(row.notes)+'</textarea></label>'+
            '<div class="md:col-span-2 flex flex-wrap items-center gap-3"><button class="rounded-lg bg-teal-800 px-4 py-3 font-bold text-white">Save analysis</button><p id="analysisMessage" class="text-sm text-slate-600"></p></div>'+
          '</form></section>'+
          '<section class="rounded-2xl bg-white p-6 shadow">'+
            '<div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-2xl font-extrabold">Comparable sales</h2><p class="mt-1 text-sm text-slate-600">Use sold, nearby, similar properties. Enter a sale price for each comparable.</p></div><span class="rounded-full bg-teal-50 px-3 py-1 text-sm font-bold text-teal-800">'+comps.length+' comp'+(comps.length===1 ? "" : "s")+'</span></div>'+
            (selected?.id ? '<form id="compForm" class="mt-6 grid gap-3 md:grid-cols-4"><input name="address" required placeholder="Comp address" class="rounded-lg border p-3 md:col-span-2"><input name="sale_price" required type="number" min="1" step="100" placeholder="Sale price" class="rounded-lg border p-3"><input name="sale_date" type="date" class="rounded-lg border p-3"><input name="square_feet" type="number" min="1" placeholder="Sq. ft. (optional)" class="rounded-lg border p-3"><input name="bedrooms" type="number" min="0" step="0.5" placeholder="Beds" class="rounded-lg border p-3"><input name="bathrooms" type="number" min="0" step="0.5" placeholder="Baths" class="rounded-lg border p-3"><input name="distance_miles" type="number" min="0" step="0.1" placeholder="Distance (miles)" class="rounded-lg border p-3"><textarea name="notes" rows="2" placeholder="Why this is a good comp (optional)" class="rounded-lg border p-3 md:col-span-3"></textarea><button class="rounded-lg bg-teal-800 px-4 py-3 font-bold text-white">Add comp</button></form>' : '<p class="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Save the subject analysis before adding comparable sales.</p>')+
            '<div class="mt-6 overflow-x-auto"><table class="min-w-full text-left text-sm"><thead class="bg-slate-50 text-slate-600"><tr><th class="p-3">Address</th><th class="p-3">Sale price</th><th class="p-3">Sq. ft.</th><th class="p-3">$/sq. ft.</th><th class="p-3">Sale date</th><th class="p-3"></th></tr></thead><tbody>'+compRows+'</tbody></table></div>'+
          '</section>'+
          '<section class="rounded-2xl bg-white p-6 shadow"><div><p class="text-sm font-bold uppercase tracking-wider text-teal-800">Offer snapshot</p><h2 class="mt-1 text-2xl font-extrabold">Calculated from your comps</h2></div>'+
          (result.arv == null ? '<p class="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">Add at least one comparable sale with a price to see the estimate.</p>' :
            '<div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div class="rounded-xl bg-teal-800 p-5 text-white"><p class="text-sm font-bold text-teal-100">Estimated ARV</p><p class="mt-2 text-3xl font-extrabold">'+money(result.arv)+'</p><p class="mt-2 text-xs text-teal-100">'+(result.averagePpsf && selected?.square_feet ? decimal(result.averagePpsf)+" average $/sq. ft. × "+number(selected.square_feet)+" sq. ft." : "Average comp sale price")+'</p></div><div class="rounded-xl bg-slate-100 p-5"><p class="text-sm font-bold text-slate-500">Average comp price</p><p class="mt-2 text-2xl font-extrabold">'+money(result.averagePrice)+'</p><p class="mt-2 text-xs text-slate-500">'+result.priced.length+' priced comp'+(result.priced.length===1 ? "" : "s")+'</p></div><div class="rounded-xl bg-slate-100 p-5"><p class="text-sm font-bold text-slate-500">'+result.rule+'% rule maximum offer</p><p class="mt-2 text-2xl font-extrabold">'+money(result.ruleOffer)+'</p><p class="mt-2 text-xs text-slate-500">ARV × '+result.rule+'% − repairs</p></div><div class="rounded-xl bg-amber-50 p-5"><p class="text-sm font-bold text-amber-900">Recommended ceiling</p><p class="mt-2 text-2xl font-extrabold text-amber-950">'+money(result.recommended)+'</p><p class="mt-2 text-xs text-amber-900">'+(result.profit ? "Lower of rule offer and target-profit offer" : "Based on your rule percentage")+'</p></div></div>'+
            (result.profit ? '<p class="mt-4 text-sm text-slate-600">Target-profit maximum: '+money(result.profitOffer)+' (ARV − repairs − '+money(result.profit)+').</p>' : '')+
            '<p class="mt-4 text-xs leading-5 text-slate-500">This is an internal planning estimate, not an appraisal, purchase offer, or guarantee of value. Review condition, dates, distance, and market changes before relying on it.</p>')+
          '</section>'+
        '</div>'+
      '</div>';

    document.getElementById("newAnalysis").onclick = () => { selected = null; comps = []; render(); };
    app.querySelectorAll("[data-open-analysis]").forEach(button => button.onclick = async () => {
      selected = analyses.find(item => item.id === button.dataset.openAnalysis) || null;
      await loadComps();
      render();
    });
    const analysisForm = document.getElementById("analysisForm");
    analysisForm.onsubmit = async event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(analysisForm));
      ["bedrooms","bathrooms","square_feet","repair_estimate","target_profit","offer_rule_percent"].forEach(key => values[key] = asNumber(values[key]));
      values.state = String(values.state || "AL").toUpperCase();
      let response;
      if (selected?.id) response = await client.from("comp_analyses").update({...values,updated_at:new Date().toISOString()}).eq("id",selected.id).select().single();
      else { values.created_by = ownerId; response = await client.from("comp_analyses").insert(values).select().single(); }
      const message = document.getElementById("analysisMessage");
      if (response.error) { message.textContent = "Could not save: " + response.error.message; return; }
      selected = response.data;
      await loadAnalyses();
      message.textContent = "Saved.";
      render();
    };
    const compForm = document.getElementById("compForm");
    if (compForm) compForm.onsubmit = async event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(compForm));
      ["sale_price","square_feet","bedrooms","bathrooms","distance_miles"].forEach(key => values[key] = asNumber(values[key]));
      values.sale_date = values.sale_date || null;
      values.analysis_id = selected.id;
      const response = await client.from("comp_sales").insert(values);
      if (response.error) { alert("Could not add this comp: " + response.error.message); return; }
      await loadComps();
      render();
    };
    app.querySelectorAll("[data-delete-comp]").forEach(button => button.onclick = async () => {
      if (!confirm("Remove this comparable sale from the analysis?")) return;
      const response = await client.from("comp_sales").delete().eq("id",button.dataset.deleteComp);
      if (response.error) { alert("Could not remove this comp: " + response.error.message); return; }
      await loadComps();
      render();
    });
    const deleteAnalysis = document.getElementById("deleteAnalysis");
    if (deleteAnalysis) deleteAnalysis.onclick = async () => {
      if (!confirm("Permanently delete this analysis and all of its comps?")) return;
      const response = await client.from("comp_analyses").delete().eq("id",selected.id);
      if (response.error) { alert("Could not delete this analysis: " + response.error.message); return; }
      selected = null; comps = []; await loadAnalyses(); render();
    };
  };

  const loadAnalyses = async () => {
    const response = await client.from("comp_analyses").select("*").order("updated_at",{ascending:false});
    if (response.error) throw response.error;
    analyses = response.data || [];
  };
  const loadComps = async () => {
    if (!selected?.id) { comps = []; return; }
    const response = await client.from("comp_sales").select("*").eq("analysis_id",selected.id).order("sale_date",{ascending:false});
    if (response.error) throw response.error;
    comps = response.data || [];
  };

  window.addEventListener("hrei:member-ready", async event => {
    document.body.style.visibility = "visible";
    client = event.detail.client;
    ownerId = event.detail.user.id;
    try {
      await loadAnalyses();
      if (analyses.length) { selected = analyses[0]; await loadComps(); }
      render();
    } catch (error) {
      app.innerHTML = '<p class="rounded-2xl bg-amber-50 p-6 text-amber-900 shadow">The Comping Tool needs its database update before it can load. Run the new comping-tool migration in Supabase, then refresh.</p>';
    }
  });
  document.getElementById("out").onclick = async () => { await window.currentMember.client.auth.signOut(); location.replace("/login.html"); };
})();