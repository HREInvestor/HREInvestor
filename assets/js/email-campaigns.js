(()=>{
  const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  const sender={name:"Joshua Cornelius",company:"Huntsville Real Estate Investors LLC",phone:"(256) 701-0912",address:"119 Terry Drake Rd, Owens Cross Rds, AL 35763",email:"offers@hreinvestor.com"};
  let client,leads=[],selectedIds=new Set(),draftId=null;
  const selected=()=>leads.filter(lead=>selectedIds.has(String(lead.id)));
  const firstName=lead=>{
    const name=String(lead.seller_name||"").trim();
    if(!name)return "there";
    return /\b(llc|inc|trust|properties|investments|homes|builders)\b/i.test(name)?name:name.split(/\s+/)[0];
  };
  const propertyAddress=lead=>[lead.property_address,lead.city,lead.state,lead.zip_code].filter(Boolean).join(", ")||"your property";
  const merge=(value,lead)=>String(value||"")
    .replaceAll("[First Name]",firstName(lead))
    .replaceAll("[Property Address]",propertyAddress(lead))
    .replaceAll("[Your Name]",sender.name)
    .replaceAll("[Company Name]",sender.company)
    .replaceAll("[Phone Number]",sender.phone)
    .replaceAll("[Mailing Address]",sender.address);
  const values=()=>({name:document.getElementById("name").value.trim(),subject:document.getElementById("subject").value.trim(),message:document.getElementById("message").value.trim()});
  const renderRecipients=()=>{
    const root=document.getElementById("recipients"),rows=selected();
    document.getElementById("count").textContent=rows.length+" of "+leads.length+" eligible lead"+(leads.length===1?"":"s")+" selected";
    root.innerHTML=leads.length?leads.map(lead=>'<label class="flex items-start gap-3 rounded-xl border p-3"><input data-lead="'+lead.id+'" type="checkbox" '+(selectedIds.has(String(lead.id))?"checked ":"")+'class="mt-1 h-4 w-4"><span><b>'+esc(lead.seller_name||"Unnamed lead")+'</b><span class="block text-sm text-slate-600">'+esc(lead.email)+'</span><span class="block text-xs text-slate-500">'+esc(propertyAddress(lead))+"</span></span></label>").join(""):'<p class="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No eligible recipients. Leads that are archived, opted out, or missing an email are excluded.</p>';
    document.querySelectorAll("[data-lead]").forEach(box=>box.onchange=()=>{
      if(box.checked)selectedIds.add(box.dataset.lead);else selectedIds.delete(box.dataset.lead);
      draftId=null;renderRecipients();
    });
  };
  const showPreview=()=>{
    const result=document.getElementById("result"),lead=selected()[0],row=values();
    if(!lead)return result.textContent="Select at least one eligible contact to preview.";
    if(!row.name||!row.subject||!row.message)return result.textContent="Add the campaign name, subject, and message before previewing.";
    document.getElementById("previewContact").textContent=lead.seller_name+" · "+lead.email;
    document.getElementById("previewFrom").textContent=sender.name+" <"+sender.email+">";
    document.getElementById("previewReply").textContent=sender.email;
    document.getElementById("previewSubject").textContent=merge(row.subject,lead);
    document.getElementById("previewBody").textContent=merge(row.message,lead);
    document.getElementById("preview").hidden=false;
    document.getElementById("preview").scrollIntoView({behavior:"smooth",block:"start"});
    result.textContent="Preview ready. Nothing has been sent.";
  };
  const saveDraft=async userId=>{
    const recipients=selected(),row=values();
    if(!recipients.length)throw new Error("Select at least one eligible recipient.");
    if(!row.name||!row.subject||!row.message)throw new Error("Complete the campaign name, subject, and message first.");
    if(draftId)return draftId;
    const {data:campaign,error:campaignError}=await client.from("email_campaigns").insert({...row,created_by:userId,status:"draft"}).select("id").single();
    if(campaignError)throw campaignError;
    const {error:recipientError}=await client.from("email_campaign_recipients").insert(recipients.map(lead=>({campaign_id:campaign.id,lead_id:lead.id,recipient_email:lead.email,status:"queued"})));
    if(recipientError){await client.from("email_campaigns").delete().eq("id",campaign.id);throw recipientError;}
    draftId=campaign.id;return draftId;
  };
  const load=async()=>{
    const [leadR,campaignR]=await Promise.all([
      client.from("leads").select("id,seller_name,email,property_address,city,state,zip_code").is("archived_at",null).eq("contact_opt_out",false).eq("email_opt_out",false).not("email","is",null).order("created_at",{ascending:false}).limit(1000),
      client.from("email_campaigns").select("id,name,subject,status,sent_count,failed_count,created_at,sent_at").order("created_at",{ascending:false}).limit(20)
    ]);
    if(leadR.error){document.getElementById("result").textContent="Could not load recipients: "+leadR.error.message;return;}
    leads=(leadR.data||[]).filter(lead=>String(lead.email||"").trim());renderRecipients();
    const rows=campaignR.data||[];
    document.getElementById("history").innerHTML=rows.length?rows.map(row=>'<article class="rounded-xl border p-4"><div class="flex flex-wrap justify-between gap-2"><b>'+esc(row.name)+'</b><span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">'+esc(row.status)+'</span></div><p class="mt-1 text-sm text-slate-600">'+esc(row.subject)+" · "+Number(row.sent_count||0)+" sent · "+Number(row.failed_count||0)+" failed · "+new Date(row.created_at).toLocaleString()+"</p></article>").join(""):'<p class="text-sm text-slate-500">No campaigns yet.</p>';
  };
  window.addEventListener("hrei:member-ready",async event=>{
    client=event.detail.client;document.body.style.visibility="visible";await load();
    document.getElementById("all").onclick=()=>{if(selectedIds.size!==leads.length)leads.forEach(lead=>selectedIds.add(String(lead.id)));else selectedIds.clear();draftId=null;renderRecipients();};
    document.getElementById("previewButton").onclick=showPreview;
    document.getElementById("campaignForm").onsubmit=async submitEvent=>{
      submitEvent.preventDefault();const result=document.getElementById("result"),button=submitEvent.submitter;
      button.disabled=true;
      try{
        const id=await saveDraft(event.detail.user.id);showPreview();result.textContent="Draft saved for "+selected().length+" recipients. Nothing has been sent.";
        document.getElementById("draftStatus").textContent="Draft saved. Campaign ID: "+id;
        await load();
      }catch(error){result.textContent=error.message||"Could not save the draft.";}
      finally{button.disabled=false;}
    };
    document.getElementById("out").onclick=async()=>{await client.auth.signOut();location.replace("/login.html");};
  });
})();
