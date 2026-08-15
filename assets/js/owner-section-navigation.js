(() => {
  const storageKey = "hrei-owner-section-open:";
  const addHeader = (card, title, key, openByDefault) => {
    if (!card || card.dataset.hreiCollapsible) return null;
    card.dataset.hreiCollapsible = "true";
    card.classList.add("relative");
    const content = document.createElement("div");
    content.className = "mt-4";
    const originalTitle = card.querySelector("h2");
    if (originalTitle) originalTitle.remove();
    while (card.firstChild) content.append(card.firstChild);
    const header = document.createElement("div");
    header.className = "flex flex-wrap items-center justify-between gap-3";
    header.innerHTML = '<h2 class="text-xl font-extrabold">'+title+'</h2>';
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rounded-lg border border-teal-800 px-3 py-2 text-sm font-bold text-teal-800";
    header.append(button);
    card.append(header, content);
    const saved = localStorage.getItem(storageKey + key);
    let open = saved === null ? openByDefault : saved === "true";
    const setOpen = value => {
      open = value;
      content.hidden = !open;
      button.textContent = open ? "Hide section ▲" : "Open section ▼";
      button.setAttribute("aria-expanded", String(open));
      localStorage.setItem(storageKey + key, String(open));
    };
    button.onclick = () => setOpen(!open);
    setOpen(open);
    return {card, open: () => setOpen(true)};
  };

  const addStandaloneHeader = (panel, title, key, openByDefault) => {
    if (!panel || panel.dataset.hreiStandalone) return null;
    panel.dataset.hreiStandalone = "true";
    const header = document.createElement("div");
    header.className = "mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-5 shadow";
    header.innerHTML = '<div><p class="text-sm font-bold uppercase tracking-wider text-teal-800">Owner workspace</p><h2 class="mt-1 text-xl font-extrabold">'+title+'</h2></div>';
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rounded-lg border border-teal-800 px-3 py-2 text-sm font-bold text-teal-800";
    header.append(button);
    panel.before(header);
    const saved = localStorage.getItem(storageKey + key);
    let open = saved === null ? openByDefault : saved === "true";
    const setOpen = value => {
      open = value;
      panel.hidden = !open;
      button.textContent = open ? "Hide section ▲" : "Open section ▼";
      button.setAttribute("aria-expanded", String(open));
      localStorage.setItem(storageKey + key, String(open));
    };
    button.onclick = () => setOpen(!open);
    setOpen(open);
    return {card:header, open: () => setOpen(true)};
  };

  window.addEventListener("hrei:member-ready", () => {
    const publisher = document.getElementById("propertyForm")?.closest("article");
    if (publisher) publisher.id = "owner-publish-property";

    const sections = [
      addHeader(publisher, "Add property / publish a deal", "publish", true),
      addStandaloneHeader(document.getElementById("crmCommandCenter"), "Pipeline & follow-up", "pipeline", false),
      addHeader(document.getElementById("leads")?.closest("article"), "Seller leads", "leads", false),
      addHeader(document.getElementById("properties")?.closest("article"), "Available properties", "properties", false),
      addHeader(document.getElementById("jobForm")?.closest("article"), "Contractor jobs", "jobs", false),
      addHeader(document.getElementById("members")?.closest("section"), "Members", "members", false)
    ].filter(Boolean);

    const intro = [...document.querySelectorAll("main > section")].find(section => section.querySelector("h1")?.textContent === "CRM & Operations");
    if (!intro || document.getElementById("ownerSectionJump")) return;
    const jump = document.createElement("div");
    jump.id = "ownerSectionJump";
    jump.className = "mt-6 rounded-xl bg-teal-50 p-4";
    jump.innerHTML = '<label for="ownerJumpSelect" class="text-sm font-bold text-teal-900">Jump to a section</label><select id="ownerJumpSelect" class="ml-3 rounded-lg border border-teal-200 bg-white p-2 text-sm"><option value="">Choose a section…</option>'+sections.map((section,index)=>'<option value="'+index+'">'+section.card.querySelector("h2")?.textContent+'</option>').join("")+'</select>';
    intro.after(jump);
    jump.querySelector("select").onchange = event => {
      if (event.target.value === "") return;
      const section = sections[Number(event.target.value)];
      section.open();
      section.card.scrollIntoView({behavior:"smooth", block:"start"});
      event.target.value = "";
    };
  });
})();