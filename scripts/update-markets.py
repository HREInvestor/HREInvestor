#!/usr/bin/env python3
"""Refresh data/markets.json for hreinvestor.com/markets.html.

Usage:  python3 scripts/update-markets.py      (run weekly; needs numpy)
Optional env: SUPABASE_URL + SUPABASE_KEY (read-only key) to refresh CRM aggregates;
otherwise data/crm-zip-snapshot.json is used. HUD_TOKEN for HUD FMR/SAFMR.
Every value comes from a public source; any source that fails is marked unavailable.
"""
import csv, io, json, os, sys, gzip, datetime as dt, urllib.request
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "markets.json")
ZIPS = {"35810": "Huntsville N (Gay St area)", "35811": "Huntsville NE", "35816": "Huntsville NW",
        "35805": "Huntsville central", "35801": "Huntsville downtown/SE", "35806": "Huntsville W",
        "35756": "Madison (S)", "35757": "Madison (N)", "35758": "Madison", "35601": "Decatur",
        "35603": "Decatur (S)", "35976": "Guntersville"}
METROS = ["Huntsville, AL", "Decatur, AL", "Albertville, AL"]
Z = "https://files.zillowstatic.com/research/public_csvs/"
FRED = {"MORTGAGE30US": "30-yr fixed mortgage rate (Freddie Mac PMMS), %",
        "MORTGAGE15US": "15-yr fixed mortgage rate (Freddie Mac PMMS), %",
        "ATNHPIUS26620Q": "FHFA all-transactions HPI, Huntsville MSA (1995Q1=100)",
        "HUNT601UR": "Unemployment rate, Huntsville MSA (BLS LAUS, SA), %",
        "HUNT601NA": "Nonfarm employment, Huntsville MSA (BLS CES), thousands",
        "BPPRIV001089": "Private housing units permitted, Madison County (Census BPS), annual",
        "BPPRIV001083": "Private housing units permitted, Limestone County, annual",
        "BPPRIV001103": "Private housing units permitted, Morgan County, annual",
        "BPPRIV001095": "Private housing units permitted, Marshall County, annual",
        "MHIAL01089A052NCEN": "Median household income, Madison County (Census SAIPE), $",
        "WPU081": "PPI softwood lumber (1982=100)"}
BLS = {"ENU0108940010": "Avg weekly wage, Madison County, all industries (BLS QCEW), $",
       "ENU0108910010": "Total covered employment, Madison County (BLS QCEW)"}
status = []

CACHE = os.environ.get("MARKETS_CACHE")  # optional dir to reuse downloads while testing
def get(url, timeout=120):
    if CACHE:
        import hashlib; fp = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest())
        if os.path.exists(fp): return open(fp, "rb").read()
    b = _get(url, timeout)
    if CACHE: os.makedirs(CACHE, exist_ok=True); open(fp, "wb").write(b)
    return b
def _get(url, timeout):
    if "fred.stlouisfed.org" in url:  # FRED stalls urllib clients; curl works
        import subprocess
        return subprocess.run(["curl", "-sfL", "-m", str(timeout), url], check=True, capture_output=True).stdout
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 HREI-markets"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        b = r.read()
    return gzip.decompress(b) if url.endswith(".gz") else b

def src(name, url, ok, as_of=None, note=""):
    status.append({"source": name, "url": url, "ok": ok, "as_of": as_of, "note": note})

def zillow(path, key, regions):
    """Return {region: [(date, value)...]} for matching RegionName rows."""
    url = Z + path
    try:
        rows = csv.reader(io.StringIO(get(url).decode()))
        hdr = next(rows); dcols = [i for i, h in enumerate(hdr) if h[:2] == "20" or h[:2] == "19"]
        ri = hdr.index("RegionName"); si = hdr.index("State") if "State" in hdr else None
        out = {}
        for r in rows:
            if r[ri] in regions and (si is None or r[si] in ("AL", "")):
                out[r[ri]] = [(hdr[i], float(r[i])) for i in dcols if r[i] not in ("", None)]
        last = max((v[-1][0] for v in out.values() if v), default=None)
        src(key, url, bool(out), last, "" if out else "no matching rows")
        return out
    except Exception as e:
        src(key, url, False, None, str(e)[:120]); return {}

def latest(s): return s[-1][1] if s else None
def chg(s, n):
    return (s[-1][1] / s[-1 - n][1] - 1) if s and len(s) > n and s[-1 - n][1] else None

def main():
    zips = list(ZIPS)
    zhvi = zillow("zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "Zillow ZHVI (mid tier) by ZIP", zips)
    zlo = zillow("zhvi/Zip_zhvi_uc_sfrcondo_tier_0.0_0.33_sm_sa_month.csv", "Zillow ZHVI bottom tier by ZIP", zips)
    zhi = zillow("zhvi/Zip_zhvi_uc_sfrcondo_tier_0.67_1.0_sm_sa_month.csv", "Zillow ZHVI top tier by ZIP", zips)
    zori = zillow("zori/Zip_zori_uc_sfrcondomfr_sm_month.csv", "Zillow ZORI rent by ZIP", zips)
    zhvf = zillow("zhvf_growth/Zip_zhvf_growth_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "Zillow ZHVF forecast by ZIP", zips)
    m = {k: zillow(p, n, METROS) for k, p, n in [
        ("zhvi", "zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "Zillow ZHVI by metro"),
        ("zori", "zori/Metro_zori_uc_sfrcondomfr_sm_month.csv", "Zillow ZORI by metro"),
        ("zhvf", "zhvf_growth/Metro_zhvf_growth_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv", "Zillow ZHVF forecast by metro"),
        ("inv", "invt_fs/Metro_invt_fs_uc_sfrcondo_sm_month.csv", "Zillow for-sale inventory by metro"),
        ("newl", "new_listings/Metro_new_listings_uc_sfrcondo_sm_month.csv", "Zillow new listings by metro"),
        ("pend", "new_pending/Metro_new_pending_uc_sfrcondo_sm_month.csv", "Zillow newly pending by metro"),
        ("cut", "perc_listings_price_cut/Metro_perc_listings_price_cut_uc_sfrcondo_sm_month.csv", "Zillow % listings with price cut"),
        ("dop", "med_doz_pending/Metro_med_doz_pending_uc_sfrcondo_sm_month.csv", "Zillow median days to pending"),
        ("sp", "median_sale_price/Metro_median_sale_price_uc_sfrcondo_sm_month.csv", "Zillow median sale price"),
        ("stl", "mean_sale_to_list/Metro_mean_sale_to_list_uc_sfrcondo_sm_month.csv", "Zillow mean sale-to-list"),
        ("above", "pct_sold_above_list/Metro_pct_sold_above_list_uc_sfrcondo_sm_month.csv", "Zillow % sold above list")]}

    # Redfin Data Center (S3 tracker). Often 403s to scripts; kept so it lights up if access returns.
    rf = "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz"
    redfin = {}
    try:
        txt = get(rf, 300).decode(); rows = csv.DictReader(io.StringIO(txt), delimiter="\t")
        for r in rows:
            z = r["REGION"].replace("Zip Code: ", "")
            if z in ZIPS and r["PROPERTY_TYPE"] == "All Residential" and (z not in redfin or r["PERIOD_END"] > redfin[z]["PERIOD_END"]):
                redfin[z] = r
        src("Redfin Data Center ZIP tracker", rf, bool(redfin), max((r["PERIOD_END"] for r in redfin.values()), default=None))
    except Exception as e:
        src("Redfin Data Center ZIP tracker", rf, False, None, "download blocked: " + str(e)[:80])

    # Realtor.com Research ZIP inventory (latest month)
    rdc_url = "https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Zip.csv"
    rdc = {}
    try:
        for r in csv.DictReader(io.StringIO(get(rdc_url).decode(errors="ignore"))):
            z = (r.get("postal_code") or "").zfill(5)
            if z in ZIPS: rdc[z] = r
        mm = max((r["month_date_yyyymm"] for r in rdc.values()), default=None)
        src("Realtor.com Research ZIP inventory", rdc_url, bool(rdc), mm and f"{mm[:4]}-{mm[4:]}")
    except Exception as e:
        src("Realtor.com Research ZIP inventory", rdc_url, False, None, str(e)[:120])

    # Census ACS 5-year via Census Reporter API (no key)
    acs = {}; tables = "B25003,B25002,B19013,B01003,B25064,B25070,B11001"
    def cr(release, geos):
        u = f"https://api.censusreporter.org/1.0/data/show/{release}?table_ids={tables}&geo_ids=" + ",".join(geos)
        return u, json.loads(get(u))
    try:
        geos = ["86000US" + z for z in ZIPS]
        u, d = cr("latest", geos); rel = d["release"]["name"]
        try: _, old = cr("acs2019_5yr", geos)
        except Exception: old = None
        for z in ZIPS:
            e = {t: v["estimate"] for t, v in d["data"]["86000US" + z].items()}
            occ = e["B25003"]["B25003001"]; b70 = e["B25070"]
            denom = b70["B25070001"] - b70["B25070011"]
            hh0 = old["data"]["86000US" + z]["B11001"]["estimate"]["B11001001"] if old else None
            acs[z] = {"renter_pct": e["B25003"]["B25003003"] / occ if occ else None,
                      "owner_pct": e["B25003"]["B25003002"] / occ if occ else None,
                      "occupied_units": occ, "vacancy_pct": e["B25002"]["B25002003"] / e["B25002"]["B25002001"],
                      "median_income": e["B19013"]["B19013001"], "population": e["B01003"]["B01003001"],
                      "median_gross_rent": e["B25064"]["B25064001"],
                      "rent_burden_pct": sum(b70[f"B25070{i:03d}"] for i in range(7, 11)) / denom if denom else None,
                      "households": e["B11001"]["B11001001"],
                      "hh_growth_since_2019acs": (e["B11001"]["B11001001"] / hh0 - 1) if hh0 else None}
        src("Census ACS 5-year (" + rel + ") via Census Reporter", u, True, d["release"]["years"])
        # Gay St tract (3506 Gay St NW geocodes to tract 01089000302)
        _, t = cr("latest", ["14000US01089000302"]); te = t["data"]["14000US01089000302"]["B25003"]["estimate"]
        acs["_gay_st_tract"] = {"tract": "Census Tract 3.02, Madison County", "renter_pct": te["B25003003"] / te["B25003001"],
                                "owner_pct": te["B25003002"] / te["B25003001"], "occupied_units": te["B25003001"]}
    except Exception as e:
        src("Census ACS 5-year via Census Reporter", "https://censusreporter.org", False, None, str(e)[:120])

    fred = {}
    for sid, name in FRED.items():
        u = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}"
        try:
            rows = list(csv.reader(io.StringIO(get(u, 60).decode())))[1:]
            s = [(a, float(b)) for a, b in rows if b not in (".", "")]
            fred[sid] = {"name": name, "url": "https://fred.stlouisfed.org/series/" + sid, "last": s[-1], "history": s[-60:]}
            src("FRED " + sid, fred[sid]["url"], True, s[-1][0])
        except Exception as e:
            src("FRED " + sid, u, False, None, str(e)[:100])
    bls = {}
    for sid, name in BLS.items():
        u = "https://api.bls.gov/publicAPI/v1/timeseries/data/" + sid
        try:
            d = json.loads(get(u, 60))["Results"]["series"][0]["data"]
            s = [(f'{x["year"]}-{x["period"]}', float(x["value"])) for x in d if x["period"] != "M13"]
            bls[sid] = {"name": name, "url": "https://data.bls.gov/timeseries/" + sid, "last": s[0], "prior_year": next((v for p, v in s if p == f"{int(s[0][0][:4])-1}{s[0][0][4:]}"), None)}
            src("BLS QCEW " + sid, bls[sid]["url"], True, s[0][0])
        except Exception as e:
            src("BLS QCEW " + sid, u, False, None, str(e)[:100])

    fmr = None
    if os.environ.get("HUD_TOKEN"):
        try:
            req = urllib.request.Request("https://www.huduser.gov/hudapi/public/fmr/data/METRO26620M26620",
                                         headers={"Authorization": "Bearer " + os.environ["HUD_TOKEN"]})
            fmr = json.loads(urllib.request.urlopen(req, timeout=60).read())["data"]
            src("HUD FMR/SAFMR", "https://www.huduser.gov/portal/datasets/fmr.html", True, str(fmr.get("year")))
        except Exception as e:
            src("HUD FMR/SAFMR", "https://www.huduser.gov/portal/datasets/fmr.html", False, None, str(e)[:100])
    else:
        src("HUD FMR/SAFMR", "https://www.huduser.gov/portal/datasets/fmr.html", False, None, "needs free HUD API token (set HUD_TOKEN)")
    src("ATTOM / county foreclosure data", "https://www.attomdata.com", False, None, "no free automated source")

    # CRM aggregates
    crm = json.load(open(os.path.join(ROOT, "data", "crm-zip-snapshot.json")))
    src("HREI CRM aggregates (leads/offers/ARV)", "internal", True, crm["as_of"],
        "snapshot file; refresh via Supabase read-only")

    # ---------- Forecast model: pooled OLS on ZIP ZHVI history, out-of-sample backtest ----------
    try:
        rows = list(csv.reader(io.StringIO(get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US").decode())))[1:]
        mm = {}
        for a, b in rows:
            if b != ".": mm[a[:7]] = float(b)
    except Exception:
        mm = {}
    minv = dict((d[:7], v) for d, v in m["inv"].get("Huntsville, AL", []))
    def feats(s, i):
        d = s[i][0][:7]; dprev = s[i - 12][0][:7]
        yoy = s[i][1] / s[i - 12][1] - 1; mom = (s[i][1] / s[i - 3][1]) ** 4 - 1
        c5 = (s[i][1] / s[i - 60][1]) ** 0.2 - 1 if i >= 60 else yoy
        dr = (mm.get(d, np.nan) - mm.get(dprev, np.nan))
        inv = (minv[d] / minv[dprev] - 1) if d in minv and dprev in minv else np.nan
        return [1, yoy, mom, c5, dr, inv]
    X, Y, D = [], [], []
    for z, s in zhvi.items():
        for i in range(60, len(s) - 12):
            f = feats(s, i)
            if not np.any(np.isnan(f)):
                X.append(f); Y.append(s[i + 12][1] / s[i][1] - 1); D.append(s[i][0])
    model = {"available": False}
    NAMES = ["intercept", "yoy_12m", "momentum_3m_ann", "cagr_5y", "mortgage_rate_chg_12m_pts", "metro_inventory_yoy"]
    if len(X) > 50:
        X, Y, D = np.array(X), np.array(Y), np.array(D)
        def fit(A, y, lam=0.05):
            L = lam * len(A) * np.eye(A.shape[1]); L[0, 0] = 0
            return np.linalg.solve(A.T @ A + L, A.T @ y)
        # Walk-forward backtest: for each origin month t, train only on origins <= t-12
        # (their 12-month outcome was already known at t), then predict t's next 12 months.
        months = sorted(set(D)); err_m, err_n, err_d, err_z, rec_m, rec_d = [], [], [], [], [], []
        for t in months:
            tr = D <= months[max(0, months.index(t) - 12)]
            if months.index(t) < 24 or tr.sum() < 60: continue
            te = D == t; bb = fit(X[tr], Y[tr])
            err_m += list(np.abs(X[te] @ bb - Y[te])); err_n += list(np.abs(X[te][:, 1] - Y[te]))
            err_d += list(np.abs(0.5 * X[te][:, 1] - Y[te]))
            if months.index(t) >= len(months) - 36: rec_m += list(Y[te] - X[te] @ bb); rec_d += list(Y[te] - 0.5 * X[te][:, 1]); err_z += list(np.abs(Y[te]))
        mae = lambda e: float(np.mean(e)) if e else None
        bt = {"method": "walk-forward, expanding window, 12-mo outcome lag", "n_test": len(err_m),
              "mae_model": mae(err_m), "mae_naive_yoy_persist": mae(err_n), "mae_damped_half_yoy": mae(err_d), "mae_zero_change": mae(err_z)}
        cands = {"multi-variable ridge regression": bt["mae_model"], "damped persistence (0.5 x trailing YoY)": bt["mae_damped_half_yoy"]}
        choice = min(cands, key=lambda k: cands[k] if cands[k] is not None else 9)
        b = fit(X, Y)
        res = np.array(rec_m if choice.startswith("multi") else rec_d)  # out-of-sample errors, last 36 origins
        lo, hi = np.quantile(res, [0.1, 0.9])
        model = {"available": True, "chosen": choice, "coef": dict(zip(NAMES, [round(float(x), 4) for x in b])),
                 "resid_p10": float(lo), "resid_p90": float(hi), "n_obs": int(len(Y)), "train_origins": [months[0], months[-1]],
                 "backtest": bt}
    def forecast(s):
        if not model["available"] or not s or len(s) < 61: return None
        f = np.array(feats(s, len(s) - 1))
        if np.any(np.isnan(f)):
            f[4] = 0 if np.isnan(f[4]) else f[4]; f[5] = 0 if np.isnan(f[5]) else f[5]
        p = float(f @ np.array(list(model["coef"].values()))) if model["chosen"].startswith("multi") else 0.5 * float(f[1])
        return {"mid": p, "low": p + model["resid_p10"], "high": p + model["resid_p90"]}

    def lean(r, dom_med):
        """Exit lean rules (documented on page)."""
        rp, yoy, dom, rtv = r.get("renter_pct"), r.get("yoy"), r.get("dom"), r.get("rent_to_value")
        if rp is None or yoy is None: return "Insufficient data", ""
        slow = dom is not None and dom_med and dom > 1.15 * dom_med
        if rp >= 0.5 or (rtv or 0) >= 0.008:
            return "Rental / DSCR", f"renter share {rp:.0%}, rent-to-value {rtv:.2%}/mo" if rtv else f"renter share {rp:.0%}"
        if yoy > 0 and not slow:
            return "Flip (retail resale)", f"owner-heavy ({1-rp:.0%} owner), values {yoy:+.1%} YoY, DOM {dom:.0f}" if dom else f"owner-heavy, values {yoy:+.1%} YoY"
        return "Wholesale (price to move)", f"values {yoy:+.1%} YoY" + (f", DOM {dom:.0f} vs {dom_med:.0f} median" if dom else "")

    out_z = []
    for z, label in ZIPS.items():
        s = zhvi.get(z, []); rs = zori.get(z, []); a = acs.get(z, {}); rd = rdc.get(z, {}); f = redfin.get(z, {})
        num = lambda v: float(v) if v not in (None, "", "NA") else None
        r = {"zip": z, "label": label, "value": latest(s), "value_as_of": s[-1][0] if s else None,
             "yoy": chg(s, 12), "mom3": chg(s, 3), "value_low_tier": latest(zlo.get(z, [])),
             "value_top_tier": latest(zhi.get(z, [])), "rent": latest(rs), "rent_yoy": chg(rs, 12),
             "rent_as_of": rs[-1][0] if rs else None,
             "dom": num(rd.get("median_days_on_market")), "inventory": num(rd.get("active_listing_count")),
             "new_listings": num(rd.get("new_listing_count")), "price_reduced_share": num(rd.get("price_reduced_share")),
             "list_price": num(rd.get("median_listing_price")), "inventory_yy": num(rd.get("active_listing_count_yy")),
             "redfin": {k: num(f.get(k.upper())) for k in ["median_sale_price", "median_dom", "inventory", "months_of_supply", "avg_sale_to_list", "sold_above_list", "price_drops", "pending_sales"]} if f else None,
             "zillow_forecast_12m": (zhvf.get(z) or [[None, None]])[-1][1] if zhvf.get(z) else None,
             "crm": crm["zips"].get(z)}
        r.update({k: a.get(k) for k in ["renter_pct", "owner_pct", "vacancy_pct", "median_income", "population",
                  "median_gross_rent", "rent_burden_pct", "hh_growth_since_2019acs", "households"]})
        r["rent_to_value"] = r["rent"] / r["value"] if r["rent"] and r["value"] else None
        r["forecast"] = forecast(s)
        out_z.append(r)
    doms = [r["dom"] for r in out_z if r["dom"]]; dom_med = float(np.median(doms)) if doms else None
    for r in out_z: r["lean"], r["lean_why"] = lean(r, dom_med)
    metros = []
    for mt in METROS:
        g = lambda k: m[k].get(mt, [])
        metros.append({"metro": mt, "value": latest(g("zhvi")), "yoy": chg(g("zhvi"), 12), "rent": latest(g("zori")),
                       "rent_yoy": chg(g("zori"), 12), "inventory": latest(g("inv")), "inventory_yoy": chg(g("inv"), 12),
                       "new_listings": latest(g("newl")), "new_pending": latest(g("pend")), "price_cut_share": latest(g("cut")),
                       "days_to_pending": latest(g("dop")), "median_sale_price": latest(g("sp")), "sale_to_list": latest(g("stl")),
                       "pct_sold_above_list": latest(g("above")), "zillow_forecast_12m": latest(g("zhvf")),
                       "forecast": forecast(g("zhvi")), "as_of": g("zhvi")[-1][0] if g("zhvi") else None})
    json.dump({"generated": dt.datetime.now().isoformat(timespec="minutes"), "zips": out_z, "metros": metros,
               "gay_st_tract": acs.get("_gay_st_tract"), "macro": {**fred, **bls}, "model": model,
               "hud_fmr": fmr, "sources": status}, open(OUT, "w"), indent=1, default=float)
    print("wrote", OUT, "| sources ok:", sum(s["ok"] for s in status), "/", len(status))

if __name__ == "__main__":
    main()
