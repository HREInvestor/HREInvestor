(() => {
  window.addEventListener("hrei:member-ready", () => {
    const form = document.getElementById("propertyForm");
    if (!form || document.getElementById("dealRoomFields")) return;
    const fields = document.createElement("div");
    fields.id = "dealRoomFields";
    fields.className = "space-y-3";
    fields.innerHTML = '<p class="pt-2 text-sm font-bold text-teal-800">Investor deal room</p>'+
      '<div class="grid grid-cols-3 gap-3"><input name="bedrooms" type="number" min="0" step="0.5" placeholder="Beds" class="w-full rounded-lg border p-3"><input name="bathrooms" type="number" min="0" step="0.5" placeholder="Baths" class="w-full rounded-lg border p-3"><input name="square_feet" type="number" min="0" placeholder="Sq Ft" class="w-full rounded-lg border p-3"></div>'+
      '<div class="grid grid-cols-3 gap-3"><input name="asking_price" type="number" min="0" placeholder="Asking price" class="w-full rounded-lg border p-3"><input name="estimated_repairs" type="number" min="0" placeholder="Est. repairs" class="w-full rounded-lg border p-3"><input name="estimated_arv" type="number" min="0" placeholder="Est. ARV" class="w-full rounded-lg border p-3"></div>'+
      '<textarea name="investment_highlights" placeholder="Investment highlights, scope, or terms" class="w-full rounded-lg border p-3"></textarea>'+
      '<input name="documents_url" type="url" placeholder="Deal documents link (optional)" class="w-full rounded-lg border p-3">'+
      '<input name="deal_contact_email" type="email" value="office@hreinvestor.com" placeholder="Deal contact email" class="w-full rounded-lg border p-3">';
    form.querySelector("button").before(fields);
    const currentProperties = document.getElementById("properties");
    if (currentProperties) {
      const observer = new MutationObserver(() => {
        currentProperties.querySelectorAll("div.rounded-xl.border").forEach(card => {
          if (card.querySelector("[data-deal-link]")) return;
          const title = card.querySelector("b")?.textContent;
          const records = window.currentMember?.client;
          if (!title || !records) return;
        });
      });
      observer.observe(currentProperties, {childList:true, subtree:true});
    }
  });
})();