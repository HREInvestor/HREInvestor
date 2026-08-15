(() => {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  window.addEventListener("hrei:member-ready", async event => {
    const root = document.getElementById("members");
    if (!root) return;
    const {data: members, error} = await event.detail.client
      .from("member_profiles")
      .select("id,email,role,access_status,created_at")
      .order("created_at", {ascending:false});
    if (error) { root.innerHTML = '<p class="text-sm text-amber-700">Run the manual member-approval update in Supabase, then refresh.</p>'; return; }

    const render = () => {
      root.innerHTML = members.map(member => '<article class="rounded-xl border p-4"><div class="flex flex-wrap items-start justify-between gap-3"><div><b>'+esc(member.email)+'</b><p class="mt-1 text-sm text-slate-600">Created '+new Date(member.created_at).toLocaleDateString()+'</p></div><span class="rounded-full px-2 py-1 text-xs font-bold '+(member.access_status==="approved"?"bg-emerald-100 text-emerald-800":member.access_status==="suspended"?"bg-red-100 text-red-800":"bg-amber-100 text-amber-800")+'">'+esc(member.access_status)+'</span></div>'+
        (member.role === "owner" ? '<p class="mt-4 text-sm font-bold text-teal-800">Owner account</p>' :
          '<div class="mt-4 grid gap-2 sm:grid-cols-3"><select data-role="'+member.id+'" class="rounded-lg border p-2 text-sm"><option value="investor" '+(member.role==="investor"?"selected":"")+'>Investor</option><option value="contractor" '+(member.role==="contractor"?"selected":"")+'>Contractor</option></select><select data-status="'+member.id+'" class="rounded-lg border p-2 text-sm"><option value="pending" '+(member.access_status==="pending"?"selected":"")+'>Pending</option><option value="approved" '+(member.access_status==="approved"?"selected":"")+'>Approved</option><option value="suspended" '+(member.access_status==="suspended"?"selected":"")+'>Suspended</option></select><button type="button" data-save-member="'+member.id+'" class="rounded-lg bg-teal-800 px-3 py-2 text-sm font-bold text-white">Save access</button></div>')+
      '</article>').join("") || '<p class="text-slate-500">No member accounts yet.</p>';
      root.querySelectorAll("[data-save-member]").forEach(button => button.onclick = async () => {
        const id = button.dataset.saveMember;
        const role = root.querySelector('[data-role="'+id+'"]').value;
        const accessStatus = root.querySelector('[data-status="'+id+'"]').value;
        button.disabled = true;
        const {error} = await event.detail.client.from("member_profiles").update({
          role, access_status: accessStatus, subscription_status: "not_required"
        }).eq("id", id);
        if (error) { alert("Could not update this account: " + error.message); button.disabled = false; return; }
        const member = members.find(item => item.id === id);
        Object.assign(member, {role, access_status: accessStatus});
        render();
      });
    };
    render();
  });
})();