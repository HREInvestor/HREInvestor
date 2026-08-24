(()=>{
  const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  let client, leads=[], selectedIds=new Set();
  const selected=()=>leads.filter(lead=>selectedIds.has(String(lead.id)));
  const renderRecipients=()=>{
    const root=document.getElementById("recipients"),rows=selected();
    document.getElementById("count").textContent=rows.length+" of "+leads.length+" eligible lead"+(leads.length===1?"":"s")+" selected";
    root.innerHTML=leads.length?leads.map(lead=>'<label class="flex items-start gap-3 rounded-xl border p-3"><input data-lead="'+lead.id+'" type="checkbox" '+(selectedIds.has(String(lead.id))?"checked ":"")+'class="mt-1 h-4 w-4"><span><b>'+esc(lead.seller_name||"Unnamed lead")+'</b><span class="block text-sm text-slate-600">'+esc(lead.email)+'</span><span class="block text-xs text-slate-500">'+esc([lead.property_address,lead.city,lead.state].filter(Boolean).join(", ")||"No property address")+'</span></span></label>').join(""):'<p class="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No eligible recipients. Leads that are archived, opted out, or missing an email are excluded.</p>';
    document.querySelectorAll("[data-lead]").forEach(box=>box.onchange=()=>{
      if(box.checked) selectedIds.add(box.dataset.lead); else selectedIds.delete(box.dataset.lead);
      renderRecipients();
    });
  };
  const load=async()=>{
    const [leadR,campaignR]=await Promise.all([
      client.from("leads").select("id,seller_name,email,property_address,city,state").is("archived_at",null).eq("contact_opt_out",false).eq("email_opt_out",false).not("email","is",null).order("created_at",{ascending:false}).limit(1000),
      client.from("email_campaigns").select("id,name,subject,status,sent_count,failed_count,created_at,sent_at").order("created_at",{ascending:false}).limit(20)
    ]);
    if(leadR.error){document.getElementById("result").textContent="Could not load recipients: "+leadR.error.message;return}
    leads=(leadR.data||[]).filter(lead=>String(lead.email||"").trim());
    renderRecipients();
    const rows=campaignR.data||[];
    document.getElementById("history").innerHTML=rows.length?rows.map(row=>'<article class="rounded-xl border p-4"><div class="flex flex-wrap justify-between gap-2"><b>'+esc(row.name)+'</b><span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">'+esc(row.status)+'</span></div><p class="mt-1 text-sm text-slate-600">'+esc(row.subject)+' · '+Number(row.sent_count||0)+' sent · '+Number(row.failed_count||0)+' failed · '+new Date(row.created_at).toLocaleString()+'</p></article>').join(""):'<p class="text-sm text-slate-500">No campaigns yet.</p>';
  };
  window.addEventListener("hrei:member-ready",async event=>{
    client=event.detail.client;
    document.body.style.visibility="visible";
    await load();
    document.getElementById("all").onclick=()=>{
      if(selectedIds.size!==leads.length) leads.forEach(lead=>selectedIds.add(String(lead.id))); else selectedIds.clear();
      renderRecipients();
    };
    document.getElementById("campaignForm").onsubmit=async submitEvent=>{
      submitEvent.preventDefault();
      const recipients=selected(),result=document.getElementById("result");
      if(!recipients.length)return result.textContent="Select at least one eligible recipient.";
      if(recipients.length>100)return result.textContent="Choose no more than 100 recipients for one send.";
      if(!confirm("Send this marketing email individually from offers@hreinvestor.com to "+recipients.length+" selected lead"+(recipients.length===1?"?":"s?")+" The footer and unsubscribe link will be included."))return;
      const button=submitEvent.target.querySelector("button");
      button.disabled=true;button.textContent="Sending…";
      try{
        const row={name:document.getElementById("name").value.trim(),subject:document.getElementById("subject").value.trim(),message:document.getElementById("message").value.trim(),created_by:event.detail.user.id};
        const {data:campaign,error:campaignError}=await client.from("email_campaigns").insert(row).select("id").single();
        if(campaignError)throw campaignError;
        const {data:{session}}=await client.auth.getSession();
        if(!session)throw new Error("Your session expired. Please sign in again.");
        const {data,error}=await client.functions.invoke("marketing-campaign-send",{body:{campaign_id:campaign.id,lead_ids:recipients.map(lead=>lead.id)},headers:{Authorization:"Bearer "+session.access_token}});
        if(error)throw new Error(error.message||"Could not send the campaign.");
        if(data?.message!=="Campaign complete.")throw new Error(data?.message||"The campaign could not be completed.");
        result.textContent="Sent: "+data.sent+". Failed: "+data.failed+". Skipped: "+data.skipped+".";
        selectedIds.clear();submitEvent.target.reset();await load();
      }catch(error){result.textContent=error.message||"Could not send the campaign."}
      finally{button.disabled=false;button.textContent="Review & send"}
    };
    document.getElementById("out").onclick=async()=>{await client.auth.signOut();location.replace("/login.html")};
  });
})();
