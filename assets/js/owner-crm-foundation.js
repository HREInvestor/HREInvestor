(() => {
  const stages = ["New Lead", "Contacted", "Offer Sent", "Under Contract", "Closed", "Not a Fit"];
  const priorities = ["hot", "warm", "cold"];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  const dateValue = value => value ? String(value).slice(0, 10) : "";
  const prettyDate = value => value ? new Date(value + "T12:00:00").toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"}) : "No date";
  const prettyActivity = value => new Date(value).toLocaleString("en-US", {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"});
  const leadName = lead => lead.seller_name || "Unnamed seller";
  const activityText = activity => activity.description || activity.event_type.replace(/_/g, " ");
  const today = new Date().toISOString().slice(0, 10);

  window.addEventListener("hrei:member-ready", async event => {
    const client = event.detail.client;
    const target = document.getElementById("leads");
    if (!target) return;

    const [leadResult, taskResult, activityResult, contactResult] = await Promise.all([
      client.from("leads").select("*").order("created_at", {ascending:false}).limit(1000),
      client.from("lead_tasks").select("*").order("due_on", {ascending:true}),
      client.from("lead_activities").select("*").order("created_at", {ascending:false}),
      client.from("lead_contact_log").select("*").order("created_at", {ascending:false})
    ]);

    if (leadResult.error || taskResult.error || activityResult.error || contactResult.error) {
      target.insertAdjacentHTML("beforebegin", '<p class="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">The CRM command center needs its database update before it can load. Run the new CRM foundation migration in Supabase, then refresh.</p>');
      return;
    }

    let leads = leadResult.data || [];
    let tasks = taskResult.data || [];
    let activities = activityResult.data || [];
    const contacts = contactResult.data || [];
    let search = "";
    let stageFilter = "all";
    let priorityFilter = "all";
    let followUpFilter = "all";

    const panel = document.createElement("section");
    panel.id = "crmCommandCenter";
    panel.className = "mt-8 rounded-2xl bg-white p-6 shadow";
    document.getElementById("duplicatePanel").before(panel);

    const logActivity = async (leadId, eventType, description) => {
      const { data, error } = await client.from("lead_activities").insert({
        lead_id: Number(leadId), event_type: eventType, description, created_by: event.detail.user.id
      }).select().single();
      if (!error && data) activities.unshift(data);
      return error;
    };

    const filteredLeads = () => leads.filter(lead => {
      const haystack = [lead.seller_name, lead.phone, lead.email, lead.property_address, lead.city, lead.state, lead.zip, lead.notes].join(" ").toLowerCase();
      const matchSearch = !search || haystack.includes(search.toLowerCase());
      const matchStage = stageFilter === "all" || lead.stage === stageFilter;
      const matchPriority = priorityFilter === "all" || lead.priority === priorityFilter;
      const openTasks = tasks.filter(task => String(task.lead_id) === String(lead.id) && task.status === "open");
      const hasDue = (lead.next_follow_up_on && lead.next_follow_up_on <= today) || openTasks.some(task => task.due_on && task.due_on <= today);
      const matchFollowUp = followUpFilter === "all" || (followUpFilter === "due" && hasDue) || (followUpFilter === "scheduled" && (lead.next_follow_up_on || openTasks.length));
      return matchSearch && matchStage && matchPriority && matchFollowUp;
    });

    const render = () => {
      const visible = filteredLeads();
      const stageCounts = stages.map(stage => ({stage, count: leads.filter(lead => lead.stage === stage).length}));
      const dueCount = leads.filter(lead => lead.next_follow_up_on && lead.next_follow_up_on <= today).length +
        tasks.filter(task => task.status === "open" && task.due_on && task.due_on <= today).length;

      panel.innerHTML = `
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div><p class="text-sm font-bold uppercase tracking-wider text-teal-800">CRM Command Center</p><h2 class="mt-1 text-2xl font-extrabold">Pipeline & follow-up</h2><p class="mt-1 text-sm text-slate-600">Organize every conversation and keep the next action visible.</p></div>
          <div class="rounded-xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">${dueCount} follow-up${dueCount === 1 ? "" : "s"} due</div>
        </div>
        <div class="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          ${stageCounts.map(item => `<button type="button" data-pipeline-stage="${esc(item.stage)}" class="rounded-xl border p-3 text-left hover:border-teal-700"><span class="block text-2xl font-extrabold text-teal-800">${item.count}</span><span class="text-xs font-bold text-slate-600">${esc(item.stage)}</span></button>`).join("")}
        </div>
        <div class="mt-6 grid gap-3 md:grid-cols-4">
          <input id="crmSearch" value="${esc(search)}" placeholder="Search seller, address, phone, or email" class="rounded-lg border p-3 md:col-span-2">
          <select id="crmStageFilter" class="rounded-lg border p-3"><option value="all">All stages</option>${stages.map(value => `<option value="${esc(value)}" ${stageFilter === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select>
          <select id="crmPriorityFilter" class="rounded-lg border p-3"><option value="all">All priorities</option>${priorities.map(value => `<option value="${value}" ${priorityFilter === value ? "selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}</select>
          <select id="crmFollowUpFilter" class="rounded-lg border p-3"><option value="all">All follow-ups</option><option value="due" ${followUpFilter === "due" ? "selected" : ""}>Due now</option><option value="scheduled" ${followUpFilter === "scheduled" ? "selected" : ""}>Scheduled</option></select>
          <button id="crmClearFilters" type="button" class="rounded-lg border px-4 py-3 text-sm font-bold">Clear filters</button>
          <p class="self-center text-sm text-slate-600 md:col-span-2">${visible.length} of ${leads.length} lead${leads.length === 1 ? "" : "s"} shown</p>
        </div>
        <div id="crmLeadList" class="mt-6 space-y-4"></div>`;

      const list = panel.querySelector("#crmLeadList");
      list.innerHTML = visible.length ? visible.map(lead => {
        const leadTasks = tasks.filter(task => String(task.lead_id) === String(lead.id));
        const openTasks = leadTasks.filter(task => task.status === "open");
        const history = [
          ...activities.filter(item => String(item.lead_id) === String(lead.id)).map(item => ({at:item.created_at, text:activityText(item)})),
          ...contacts.filter(item => String(item.lead_id) === String(lead.id)).map(item => ({at:item.created_at, text:`${item.channel} — ${item.outcome}${item.notes ? ": " + item.notes : ""}`}))
        ].sort((a,b) => String(b.at).localeCompare(String(a.at))).slice(0, 4);
        const priorityStyle = lead.priority === "hot" ? "bg-red-100 text-red-800" : lead.priority === "cold" ? "bg-slate-200 text-slate-700" : "bg-amber-100 text-amber-800";
        return `<article class="rounded-xl border border-slate-200 p-4">
          <div class="flex flex-wrap justify-between gap-3">
            <div><div class="flex flex-wrap items-center gap-2"><b class="text-lg">${esc(leadName(lead))}</b><span class="rounded-full px-2 py-1 text-xs font-bold ${priorityStyle}">${esc(lead.priority || "warm")}</span></div>
            <p class="mt-1 text-sm text-slate-600">${esc(lead.phone || "No phone")} · ${esc(lead.email || "No email")}</p>
            <p class="mt-1 text-sm">${esc([lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ") || "No property address yet")}</p></div>
            <div class="text-right text-sm"><b>${esc(lead.stage || "New Lead")}</b><p class="mt-1 text-slate-600">Follow up: ${prettyDate(lead.next_follow_up_on)}</p></div>
          </div>
          <div class="mt-4 grid gap-3 md:grid-cols-4">
            <label class="text-xs font-bold text-slate-600">Stage<select data-stage="${lead.id}" class="mt-1 w-full rounded-lg border p-2 text-sm">${stages.map(value => `<option ${lead.stage === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select></label>
            <label class="text-xs font-bold text-slate-600">Priority<select data-priority="${lead.id}" class="mt-1 w-full rounded-lg border p-2 text-sm">${priorities.map(value => `<option value="${value}" ${(lead.priority || "warm") === value ? "selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}</select></label>
            <label class="text-xs font-bold text-slate-600">Next follow-up<input data-followup="${lead.id}" value="${dateValue(lead.next_follow_up_on)}" type="date" class="mt-1 w-full rounded-lg border p-2 text-sm"></label>
            <button type="button" data-save-lead="${lead.id}" class="self-end rounded-lg bg-teal-800 px-3 py-2 text-sm font-bold text-white">Save lead plan</button>
          </div>
          <div class="mt-4 rounded-lg bg-slate-50 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2"><b class="text-sm">Tasks</b><span class="text-xs text-slate-600">${openTasks.length} open</span></div>
            ${leadTasks.length ? `<div class="mt-2 space-y-2">${leadTasks.map(task => `<label class="flex items-center gap-2 text-sm"><input data-complete-task="${task.id}" type="checkbox" ${task.status === "completed" ? "checked" : ""}><span class="${task.status === "completed" ? "line-through text-slate-400" : ""}">${esc(task.title)}${task.due_on ? " · due " + prettyDate(task.due_on) : ""}</span></label>`).join("")}</div>` : '<p class="mt-2 text-sm text-slate-500">No tasks yet.</p>'}
            <div class="mt-3 flex flex-wrap gap-2"><input data-task-title="${lead.id}" placeholder="Add a follow-up task" class="min-w-48 flex-1 rounded-lg border p-2 text-sm"><input data-task-date="${lead.id}" type="date" class="rounded-lg border p-2 text-sm"><button type="button" data-add-task="${lead.id}" class="rounded-lg border border-teal-800 px-3 py-2 text-sm font-bold text-teal-800">Add task</button></div>
          </div>
          <div class="mt-4 grid gap-3 md:grid-cols-2">
            <div><b class="text-sm">Recent activity</b>${history.length ? `<ul class="mt-2 space-y-1 text-sm text-slate-600">${history.map(item => `<li>• ${esc(activityText({description:item.text}))} <span class="text-xs text-slate-400">${prettyActivity(item.at)}</span></li>`).join("")}</ul>` : '<p class="mt-2 text-sm text-slate-500">No recorded activity yet.</p>'}</div>
            <div><label class="text-sm font-bold">Add a private note<textarea data-note="${lead.id}" rows="2" placeholder="What happened or what is next?" class="mt-2 w-full rounded-lg border p-2 text-sm"></textarea></label><button type="button" data-save-note="${lead.id}" class="mt-2 rounded-lg border px-3 py-2 text-sm font-bold">Save note</button></div>
          </div>
        </article>`;
      }).join("") : '<p class="rounded-xl bg-slate-50 p-5 text-slate-500">No leads match these filters.</p>';

      panel.querySelector("#crmSearch").oninput = input => { search = input.target.value; render(); };
      panel.querySelector("#crmStageFilter").onchange = input => { stageFilter = input.target.value; render(); };
      panel.querySelector("#crmPriorityFilter").onchange = input => { priorityFilter = input.target.value; render(); };
      panel.querySelector("#crmFollowUpFilter").onchange = input => { followUpFilter = input.target.value; render(); };
      panel.querySelector("#crmClearFilters").onclick = () => { search = ""; stageFilter = "all"; priorityFilter = "all"; followUpFilter = "all"; render(); };
      panel.querySelectorAll("[data-pipeline-stage]").forEach(button => button.onclick = () => { stageFilter = button.dataset.pipelineStage; render(); });
      panel.querySelectorAll("[data-save-lead]").forEach(button => button.onclick = async () => {
        const id = button.dataset.saveLead;
        const stage = panel.querySelector(`[data-stage="${id}"]`).value;
        const priority = panel.querySelector(`[data-priority="${id}"]`).value;
        const followUp = panel.querySelector(`[data-followup="${id}"]`).value || null;
        const previous = leads.find(lead => String(lead.id) === String(id));
        button.disabled = true;
        const {error} = await client.from("leads").update({stage, priority, next_follow_up_on: followUp}).eq("id", id);
        if (error) { alert("Could not save this lead plan: " + error.message); button.disabled = false; return; }
        if (previous.stage !== stage) await logActivity(id, "stage_changed", "Stage changed from " + (previous.stage || "New Lead") + " to " + stage);
        if ((previous.priority || "warm") !== priority) await logActivity(id, "priority_changed", "Priority changed to " + priority);
        if ((previous.next_follow_up_on || null) !== followUp) await logActivity(id, "follow_up_set", followUp ? "Follow-up scheduled for " + prettyDate(followUp) : "Follow-up date cleared");
        Object.assign(previous, {stage, priority, next_follow_up_on: followUp});
        render();
      });
      panel.querySelectorAll("[data-add-task]").forEach(button => button.onclick = async () => {
        const id = button.dataset.addTask;
        const title = panel.querySelector(`[data-task-title="${id}"]`).value.trim();
        const dueOn = panel.querySelector(`[data-task-date="${id}"]`).value || null;
        if (!title) return alert("Give this follow-up task a short name.");
        button.disabled = true;
        const {data, error} = await client.from("lead_tasks").insert({lead_id:Number(id), title, due_on:dueOn, created_by:event.detail.user.id}).select().single();
        if (error) { alert("Could not add the task: " + error.message); button.disabled = false; return; }
        tasks.push(data); await logActivity(id, "task_created", "Task added: " + title + (dueOn ? " (due " + prettyDate(dueOn) + ")" : "")); render();
      });
      panel.querySelectorAll("[data-complete-task]").forEach(box => box.onchange = async () => {
        const status = box.checked ? "completed" : "open";
        const update = {status, completed_at: box.checked ? new Date().toISOString() : null};
        const {error} = await client.from("lead_tasks").update(update).eq("id", box.dataset.completeTask);
        if (error) { alert("Could not update the task: " + error.message); box.checked = !box.checked; return; }
        Object.assign(tasks.find(task => task.id === box.dataset.completeTask), update); render();
      });
      panel.querySelectorAll("[data-save-note]").forEach(button => button.onclick = async () => {
        const id = button.dataset.saveNote;
        const note = panel.querySelector(`[data-note="${id}"]`).value.trim();
        if (!note) return alert("Write a note first.");
        button.disabled = true;
        const error = await logActivity(id, "note", note);
        if (error) { alert("Could not save the note: " + error.message); button.disabled = false; return; }
        render();
      });
    };
    render();
  });
})();