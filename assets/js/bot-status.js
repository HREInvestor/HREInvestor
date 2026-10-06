const money = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const s = (v < 0 ? "-" : "") + "$" + Math.abs(v).toFixed(2);
  return s;
};
const pnlClass = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? "" : Number(n) >= 0 ? "pos" : "neg");
const pct = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? "—" : (Number(n) * 100).toFixed(0) + "%");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));

function card(s) {
  const real = String(s.mode || "").toLowerCase() === "real";
  return `<article class="rounded-2xl bg-white p-4 shadow-sm">
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <b class="text-base">${esc(s.display_name || s.id)}</b>
        <div class="mt-1 flex flex-wrap gap-2 items-center">
          <span class="chip ${real ? "chip-real" : "chip-paper"}">${real ? "REAL" : "Paper"}</span>
          <span class="text-xs font-semibold text-slate-500">bet ${esc(money(s.bet_size))}</span>
        </div>
      </div>
      <div class="text-right">
        <div class="text-lg font-extrabold tabular-nums ${pnlClass(s.today_pnl)}">${esc(money(s.today_pnl))}</div>
        <div class="text-[11px] font-semibold text-slate-500">today</div>
      </div>
    </div>
    <div class="mt-3 grid grid-cols-3 gap-2 text-center">
      <div><div class="text-sm font-extrabold tabular-nums">${esc(s.open_count ?? "—")}</div><div class="text-[11px] text-slate-500">open</div></div>
      <div><div class="text-sm font-extrabold tabular-nums ${pnlClass(s.total_pnl)}">${esc(money(s.total_pnl))}</div><div class="text-[11px] text-slate-500">total</div></div>
      <div><div class="text-sm font-extrabold tabular-nums">${esc(pct(s.win_rate))}</div><div class="text-[11px] text-slate-500">win</div></div>
    </div>
  </article>`;
}

function sumField(rows, key) {
  let t = 0, any = false;
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined || Number.isNaN(Number(v))) continue;
    t += Number(v); any = true;
  }
  return any ? t : null;
}

function render(payload, updatedAt) {
  const platforms = payload.platforms || {};
  const pm = platforms.polymarket || {};
  const kx = platforms.kalshi || {};
  const strats = Array.isArray(payload.strategies) ? payload.strategies : [];
  const pmRows = strats.filter(s => (s.platform || "") === "polymarket");
  const kxRows = strats.filter(s => (s.platform || "") === "kalshi");
  const sortFn = (a, b) => {
    const ao = Number(a.open_count || 0), bo = Number(b.open_count || 0);
    if (ao !== bo) return bo - ao;
    const ar = String(a.mode).toLowerCase() === "real" ? 1 : 0;
    const br = String(b.mode).toLowerCase() === "real" ? 1 : 0;
    if (ar !== br) return br - ar;
    return Math.abs(Number(b.today_pnl || 0)) - Math.abs(Number(a.today_pnl || 0));
  };
  pmRows.sort(sortFn); kxRows.sort(sortFn);

  document.getElementById("pmBal").textContent = money(pm.balance);
  document.getElementById("kxBal").textContent = money(kx.balance);
  document.getElementById("pmAuth").textContent = pm.auth_ok ? "auth ok" : "auth issue";
  document.getElementById("pmAuth").className = "mt-1 text-xs font-semibold " + (pm.auth_ok ? "text-emerald-700" : "text-red-700");
  document.getElementById("kxAuth").textContent = kx.auth_ok ? "auth ok" : "auth issue";
  document.getElementById("kxAuth").className = "mt-1 text-xs font-semibold " + (kx.auth_ok ? "text-emerald-700" : "text-red-700");

  const openAll = sumField(strats, "open_count");
  const todayAll = sumField(strats, "today_pnl");
  const totalAll = sumField(strats, "total_pnl");
  document.getElementById("openAll").textContent = openAll === null ? "—" : String(openAll);
  const todayEl = document.getElementById("todayAll");
  todayEl.textContent = money(todayAll);
  todayEl.className = "mt-1 text-xl font-extrabold tabular-nums " + pnlClass(todayAll);
  const totalEl = document.getElementById("totalAll");
  totalEl.textContent = money(totalAll);
  totalEl.className = "mt-1 text-xl font-extrabold tabular-nums " + pnlClass(totalAll);

  document.getElementById("pmList").innerHTML = pmRows.length ? pmRows.map(card).join("") : '<p class="text-sm text-slate-500">No Polymarket strategies in snapshot.</p>';
  document.getElementById("kxList").innerHTML = kxRows.length ? kxRows.map(card).join("") : '<p class="text-sm text-slate-500">No Kalshi strategies in snapshot.</p>';

  const bot = payload.bot || {};
  const ageMs = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) : null;
  let fresh = "Updated —";
  if (ageMs !== null && !Number.isNaN(ageMs)) {
    const sec = Math.max(0, Math.round(ageMs / 1000));
    fresh = sec < 90 ? `Live · ${sec}s ago` : `Stale · ${Math.round(sec / 60)}m ago`;
  }
  if (bot.monitor_state) fresh += ` · ${bot.monitor_state}`;
  document.getElementById("fresh").textContent = fresh;
  document.getElementById("fresh").className = "text-xs font-semibold " + ((ageMs !== null && ageMs < 120000) ? "text-emerald-700" : "text-amber-700");

  const alert = document.getElementById("alert");
  const issues = [];
  if (bot.auth_ok === false) issues.push("Bot auth is not OK.");
  if (pm.auth_ok === false) issues.push("Polymarket auth issue.");
  if (kx.auth_ok === false) issues.push("Kalshi auth issue.");
  if (ageMs !== null && ageMs > 180000) issues.push("Status feed is stale (PC push may be down).");
  if (issues.length) {
    alert.textContent = issues.join(" ");
    alert.classList.remove("hidden");
  } else {
    alert.classList.add("hidden");
  }
}

async function loadStatus(client) {
  const { data, error } = await client.from("bot_trading_status").select("payload,updated_at").eq("id", 1).maybeSingle();
  if (error) throw error;
  if (!data) {
    document.getElementById("alert").textContent = "No status snapshot yet. Waiting for the PC bot to push.";
    document.getElementById("alert").classList.remove("hidden");
    return;
  }
  render(data.payload || {}, data.updated_at);
}

window.addEventListener("hrei:member-ready", async (e) => {
  document.body.style.visibility = "visible";
  const client = e.detail.client;
  const tick = async () => {
    try { await loadStatus(client); }
    catch (err) {
      document.getElementById("alert").textContent = "Could not load status: " + (err.message || err);
      document.getElementById("alert").classList.remove("hidden");
    }
  };
  await tick();
  setInterval(tick, 45000);
});
document.getElementById("out").onclick = async () => {
  await window.currentMember.client.auth.signOut();
  location.replace("/login.html");
};
