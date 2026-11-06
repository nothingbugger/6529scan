"use strict";
/* 6529 Scan — independent, unofficial explorer for the 6529 validator network.
   Cycle data: ./data (snapshots from one validator node, public fields only).
   Holder data: https://api.6529.io (public, read-only). */

const API_6529 = "https://api.6529.io/api";
const RELEASES = "https://6529.io/validator/releases.json";
const PROFILE = "https://6529.io/";
const ETHERSCAN_BLOCK = "https://etherscan.io/block/";
const DAY = 86400;

/* ---------- helpers ---------- */
function h(tag, attrs, ...kids) {
  const [name, ...cls] = tag.split(".");
  const el = document.createElement(name || "div");
  if (cls.length) el.className = cls.join(" ");
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") throw new Error("no raw html");
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  const add = (k) => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) return k.forEach(add);
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
}
const svgNS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  kids.forEach((k) => k != null && el.append(k instanceof Node ? k : document.createTextNode(String(k))));
  return el;
}
const nf = new Intl.NumberFormat("en-US");
const num = (n) => (n == null ? "—" : nf.format(n));
function compact(n) {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, "") + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return nf.format(n);
}
function pct(x, digits = 1) {
  if (x == null || !isFinite(x)) return "—";
  const p = x * 100;
  return (p > 0 && p < 0.1 ? "<0.1" : p.toFixed(digits)) + "%";
}
const dayDate = (day) => new Date(day * DAY * 1000);
const fmtDay = (day) => dayDate(day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtTime = (unix) => (unix ? new Date(unix * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");
function ago(unix) {
  const d = Math.max(0, Date.now() / 1000 - unix);
  if (d < 90) return "just now";
  if (d < 5400) return Math.round(d / 60) + " min ago";
  if (d < 129600) return Math.round(d / 3600) + " h ago";
  return Math.round(d / 86400) + " days ago";
}
const safeUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);
const isAddr = (q) => /^0x[0-9a-fA-F]{40}$/.test(q);

function hash(value, short = true) {
  if (!value) return h("span.muted", "—");
  const shown = short && value.length > 22 ? value.slice(0, 12) + "…" + value.slice(-8) : value;
  const btn = h("button.copy", { type: "button", title: "Copy", onclick: async () => {
    try { await navigator.clipboard.writeText(value); btn.textContent = "copied"; } catch { btn.textContent = "—"; }
    setTimeout(() => (btn.textContent = "copy"), 1200);
  } }, "copy");
  return h("span.hash", { title: value }, h("span", shown), btn);
}
function level(lv) {
  const map = { STRONG: "ok", FINAL: "ok", WEAK: "warn", PENDING: "warn" };
  return h("span.badge." + (map[lv] || ""), lv ? lv.toLowerCase() : "no certificate");
}

async function getJSON(url, { timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-cache", credentials: "omit" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const cache = {};
const local = (path) => (cache[path] ||= getJSON("data/" + path).catch((e) => { delete cache[path]; throw e; }));

/* ---------- views ---------- */
const app = document.getElementById("app");
function render(...nodes) { app.replaceChildren(...nodes); window.scrollTo(0, 0); }
function failed(what, e) {
  return h("div.panel", h("p.err", "Couldn't load " + what + "."), h("p.muted", String(e && e.message || e)));
}

function meter(label, value, note, mark) {
  const w = Math.max(0, Math.min(1, value || 0));
  return h("div.meter",
    h("div.lbl", h("span", label), h("b", pct(value))),
    h("div.bar", h("i", { style: "width:" + (w * 100).toFixed(2) + "%" }),
      mark != null ? h("span.mark", { style: "left:" + (mark * 100).toFixed(2) + "%" }, h("span", "2/3")) : null),
    note ? h("div.note", note) : null);
}
function tile(k, v, sub) { return h("div.tile", h("div.k", k), h("div.v", v), sub ? h("div.s", sub) : null); }

function historyChart(index) {
  const pts = index.slice(0, 60).reverse();
  if (pts.length < 2) {
    return h("div.callout", h("b", "History builds up day by day. "),
      "The chart appears once there are two agreed days to compare. The network opened to testers on 5 November 2026.");
  }
  const W = 720, H = 200, P = { l: 36, r: 8, t: 10, b: 26 };
  const max = Math.max(1, ...pts.map((p) => p.signing_accounts || 0));
  const bw = (W - P.l - P.r) / pts.length;
  const y = (v) => P.t + (H - P.t - P.b) * (1 - v / max);
  const g = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Signing accounts per day" });
  g.append(s("line", { x1: P.l, x2: W - P.r, y1: H - P.b, y2: H - P.b, class: "axis" }));
  [0, Math.ceil(max / 2), max].forEach((v) => {
    g.append(s("text", { x: P.l - 6, y: y(v) + 4, "text-anchor": "end", class: "lab" }, v));
  });
  pts.forEach((p, i) => {
    const x = P.l + i * bw + bw * 0.15, w = Math.max(2, bw * 0.7), v = p.signing_accounts || 0;
    const r = s("rect", { x, y: y(v), width: w, height: Math.max(0, H - P.b - y(v)), rx: 2, class: "col" });
    r.append(s("title", {}, `${fmtDay(p.day)}: ${v} accounts, ${pct(p.signed_share)} of network TDH`));
    g.append(r);
    if (i === 0 || i === pts.length - 1 || pts.length <= 10) {
      g.append(s("text", { x: x + w / 2, y: H - 8, "text-anchor": "middle", class: "lab" },
        dayDate(p.day).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })));
    }
  });
  return h("div.chart", g);
}

function cyclesTable(rows) {
  return h("div.table-wrap", h("table",
    h("thead", h("tr", h("th", "Day (UTC)"), h("th", "Level"), h("th.n", "Signing accounts"), h("th.n", "Keys signed"),
      h("th.n", "Signed / network TDH"), h("th.n", "Snapshot block"), h("th", "Cycle root"))),
    h("tbody", rows.map((r) => h("tr.link", { onclick: (e) => { if (!e.target.closest("button,a")) location.hash = "#/cycle/" + r.day; } },
      h("td", h("a", { href: "#/cycle/" + r.day }, fmtDay(r.day))),
      h("td", level(r.level)),
      h("td.n", num(r.signing_accounts)),
      h("td.n", r.key_count != null ? `${num(r.signed_keys)} / ${num(r.key_count)}` : "—"),
      h("td.n", pct(r.signed_share)),
      h("td.n", r.cutoff_number ? h("a", { href: ETHERSCAN_BLOCK + r.cutoff_number, target: "_blank", rel: "noopener" }, num(r.cutoff_number)) : "—"),
      h("td", hash(r.cycle_root)))))));
}

async function viewOverview() {
  let net, index;
  try { [net, index] = await Promise.all([local("network.json"), local("cycles/index.json")]); }
  catch (e) { return render(failed("network data", e)); }
  const agreed = index.find((c) => c.level) || index[0];
  if (!agreed) return render(h("div.panel", h("p", "No agreed day yet.")));

  const counted = agreed.signed_tdh && agreed.network_tdh ? agreed.signed_tdh / agreed.network_tdh : null;
  const left = h("div.panel",
    h("h3", "Latest agreed day"),
    h("div.hero-day", h("span.big", fmtDay(agreed.day)), level(agreed.level)),
    meter("Signed share of the TDH registered with validators", agreed.signed_tdh != null && agreed.registered_tdh ? agreed.signed_tdh / agreed.registered_tdh : null,
      "A day is agreed once validators holding more than two thirds of the counted TDH sign the same result.", 2 / 3),
    meter("Validator TDH as a share of all TDH on the network", counted,
      "How much of the whole network's TDH is behind a running, authorised validator. This grows as holders join."));

  const right = h("div.grid.tiles", { style: "grid-template-columns:repeat(2,minmax(0,1fr))" },
    tile("Signing accounts", num(agreed.signing_accounts), "accounts behind the certificate"),
    tile("Validator keys", agreed.key_count != null ? `${num(agreed.signed_keys)} / ${num(agreed.key_count)}` : "—", "signed / registered"),
    tile("Keys for the next day", num(net.next_keys), "registered so far"),
    tile("Network TDH", compact(agreed.network_tdh), num(agreed.network_tdh)));

  const facts = h("div.grid.tiles",
    tile("Identities", num(agreed.identities), "consolidated holders"),
    tile("Wallets", num(agreed.wallets)),
    tile("Tokens counted", num(agreed.tokens)),
    tile("Snapshot block", agreed.cutoff_number ? h("a", { href: ETHERSCAN_BLOCK + agreed.cutoff_number, target: "_blank", rel: "noopener" }, num(agreed.cutoff_number)) : "—", "last Ethereum block of the day"));

  render(
    h("div.head", h("div", h("h1", "The 6529 validator network"),
      h("p", "Every day, independent validators compute everyone's TDH from Ethereum and sign the result. This page shows what they agreed on."))),
    h("div.grid.g2", left, right),
    h("div.section", facts),
    h("div.section", h("h2", "Signing accounts per day"), h("div.panel", historyChart(index))),
    h("div.section", h("div.head", h("h2", "Recent days"), h("a", { href: "#/cycles" }, "All days →")), cyclesTable(index.slice(0, 7))));
}

async function viewCycles() {
  let index;
  try { index = await local("cycles/index.json"); } catch (e) { return render(failed("cycles", e)); }
  render(
    h("div.head", h("div", h("h1", "Cycles"), h("p", "One cycle per UTC day. Each one fixes an Ethereum snapshot block and the TDH of every identity at that block."))),
    index.length ? cyclesTable(index) : h("div.panel", h("p", "No cycles yet.")));
}

async function viewCycle(day) {
  let c;
  try { c = await local("cycles/" + day + ".json"); } catch (e) { return render(failed("day " + day, e)); }
  const hd = c.header || {}, cert = c.certificate || {};
  const kv = (rows) => h("dl.kv", rows.flatMap(([k, v]) => [h("dt", k), h("dd", v)]));

  const checks = h("div");
  if (c.dual_run) {
    const ok = c.dual_run.outcome === "AGREED";
    checks.append(h("div.check", h("span.dot." + (ok ? "ok" : "warn"), ok ? "✓" : "!"),
      h("div", h("b", `${c.dual_run.implementations} independent implementations ${ok ? "agreed" : "disagreed"}`),
        h("p", ok ? "Separately written TDH programs computed the same result." : `${c.dual_run.differences} differences found.`))));
  }
  if (c.compare && c.compare.status) {
    const cm = c.compare, ok = !cm.identities_differing && !cm.wallets_differing;
    checks.append(h("div.check", h("span.dot." + (ok ? "ok" : "warn"), ok ? "✓" : "!"),
      h("div", h("b", ok ? "Matches the TDH published by 6529.io" : "Differs from the TDH published by 6529.io"),
        h("p", `${num(cm.identities_compared)} identities and ${num(cm.wallets_compared)} wallets compared; ${num(cm.identities_differing)} identities and ${num(cm.wallets_differing)} wallets differ.`))));
  }
  if (c.other_roots) {
    checks.append(h("div.check", h("span.dot.warn", "!"), h("div", h("b", `${c.other_roots} competing result(s) seen`), h("p", "Some validators signed a different root for this day."))));
  }

  const weights = (cert.signer_weights || []).slice().sort((a, b) => b - a);
  const total = weights.reduce((a, b) => a + b, 0) + (cert.unsigned_weights || []).reduce((a, b) => a + b, 0);
  const signers = weights.length ? h("div", weights.slice(0, 25).map((w, i) => h("div.meter",
    h("div.lbl", h("span", "Account " + (i + 1)), h("b", compact(w) + " TDH")),
    h("div.bar", h("i", { style: "width:" + (total ? (w / total) * 100 : 0).toFixed(2) + "%" })))),
    weights.length > 25 ? h("p.muted", `+ ${weights.length - 25} more`) : null) : h("p.muted", "No signers recorded.");

  render(
    h("div.head",
      h("div", h("p", h("a", { href: "#/cycles" }, "← All cycles")), h("h1", fmtDay(c.day)),
        h("p", "Cycle " + c.day + " · " + (c.state || "").toLowerCase().replace(/_/g, " "))),
      level(cert.level)),
    h("div.grid.g2",
      h("div.stack",
        h("div.panel", h("h3", "Snapshot"), kv([
          ["Ethereum block", hd.cutoff_number ? h("a", { href: ETHERSCAN_BLOCK + hd.cutoff_number, target: "_blank", rel: "noopener" }, num(hd.cutoff_number)) : "—"],
          ["Block hash", hash(hd.cutoff_hash)],
          ["Block time", fmtTime(hd.cutoff_timestamp)],
          ["Total TDH", num(hd.total_tdh)],
          ["Identities", num(hd.identity_count)],
          ["Wallets", num(hd.wallet_count)],
          ["Tokens", num(hd.token_count)],
          ["TDH rule", hash(hd.tdh_rule_id)],
        ])),
        h("div.panel", h("h3", "Roots"), kv([
          ["Cycle root", hash(c.cycle_root)],
          ["Wallet root", hash(hd.wallet_root)],
          ["Token root", hash(hd.token_root)],
          ["History root", hash(c.history_root)],
          ["History entries", num(c.history_count)],
        ]))),
      h("div.stack",
        h("div.panel", h("h3", "Certificate"), kv([
          ["Level", level(cert.level)],
          ["Signed TDH", num(cert.raw_signed_tdh)],
          ["Registered TDH", num(cert.raw_registered_tdh)],
          ["Network TDH", num(cert.network_tdh)],
          ["Signing accounts", `${num(cert.signing_accounts)} of ${num(cert.roster_accounts)}`],
          ["Keys", `${num(cert.signed_keys)} signed of ${num(cert.key_count)}`],
          ["Excluded accounts", num(cert.excluded_accounts)],
          ["Roster root", hash(cert.roster_root)],
          ["Flags", (cert.flags || []).join(", ") || "—"],
        ])),
        h("div.panel", h("h3", "Independent checks"), checks.childNodes.length ? checks : h("p.muted", "Not recorded for this day.")))),
    h("div.section", h("h2", "Signers by weight"), h("div.panel", signers)));
}

let holderState = { page: 1, q: "" };
async function viewHolders() {
  const list = h("div", h("p.muted.pad", "Loading holders from api.6529.io…"));
  const search = h("input", { type: "search", placeholder: "Search a handle or 0x address", value: holderState.q, "aria-label": "Search holders" });
  const prev = h("button.btn", { type: "button" }, "← Prev"), next = h("button.btn", { type: "button" }, "Next →");
  const info = h("span");
  const size = 50;

  async function load() {
    list.replaceChildren(h("p.muted.pad", "Loading…"));
    const qs = new URLSearchParams({ page_size: size, page: holderState.page, sort: "boosted_tdh", sort_direction: "DESC" });
    if (holderState.q) qs.set("search", holderState.q);
    let d;
    try { d = await getJSON(API_6529 + "/tdh/consolidated_metrics?" + qs); }
    catch (e) { return list.replaceChildren(failed("holders", e)); }
    const rows = d.data || [];
    const start = (holderState.page - 1) * size;
    list.replaceChildren(rows.length ? h("div.table-wrap", h("table",
      h("thead", h("tr", h("th.n", "#"), h("th", "Holder"), h("th.n", "TDH"), h("th.n", "Level"), h("th.n", "Unique Memes"), h("th.n", "Sets"), h("th.n", "REP"))),
      h("tbody", rows.map((r, i) => {
        const pfp = safeUrl(r.pfp_url);
        const name = r.handle || r.consolidation_display || r.primary_wallet || "—";
        const link = r.handle ? PROFILE + encodeURIComponent(r.handle) : null;
        return h("tr",
          h("td.n.muted", holderState.q ? "" : start + i + 1),
          h("td", h("div.who", pfp ? h("img", { src: pfp, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }) : h("span.ph"),
            link ? h("a", { href: link, target: "_blank", rel: "noopener" }, h("b", name)) : h("b", name))),
          h("td.n", num(r.boosted_tdh)),
          h("td.n", num(r.level)),
          h("td.n", num(r.unique_memes)),
          h("td.n", num(r.memes_cards_sets)),
          h("td.n", num(r.rep_score)));
      })))) : h("div.panel", h("p", "No holder matches “" + holderState.q + "”.")));
    const pages = Math.max(1, Math.ceil((d.count || 0) / size));
    info.textContent = `${num(d.count)} holders · page ${holderState.page} of ${num(pages)}`;
    prev.disabled = holderState.page <= 1;
    next.disabled = holderState.page >= pages;
  }
  let t;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { holderState = { page: 1, q: search.value.trim().slice(0, 64) }; load(); }, 350);
  });
  prev.addEventListener("click", () => { holderState.page--; load(); });
  next.addEventListener("click", () => { holderState.page++; load(); });

  render(
    h("div.head", h("div", h("h1", "Holders"), h("p", "Identities ranked by TDH, live from the public 6529 API. Profiles open on 6529.io."))),
    h("div.toolbar", search), list, h("div.pager", info, prev, next));
  load();
}

async function viewAbout() {
  const rel = h("div.panel", h("p.muted", "Loading releases…"));
  render(
    h("div.head", h("div", h("h1", "About"), h("p", "What 6529 Scan shows, where the data comes from, and how to run a validator."))),
    h("div.grid.g2",
      h("div.panel.prose",
        h("h2", "How the network works"),
        h("p", "The 6529 validator is a small program that holders run on their own computers. Once a day it reads Ethereum through a light client, computes everyone's TDH with independently written programs, checks they agree, and signs the result with a key the holder authorised from their wallet."),
        h("p", "Validators share signatures peer to peer. A day counts as agreed once validators holding more than two thirds of the counted TDH have signed the same result. The signed statement — the certificate — can be checked by anyone, offline."),
        h("h2", "Where this data comes from"),
        h("ul",
          h("li", "Cycles and certificates: snapshots from one validator node, published as static files. Only network-wide facts are published; nothing that identifies the node."),
          h("li", "Validators: the signer list the network broadcasts (accounts, machines, days signed) and each machine's optional daily report (continent, country if published, home or data center, software). Names and pictures come from public 6529 profiles, looked up by your browser."),
          h("li", "Holders: the public read-only API at api.6529.io, queried live from your browser."),
          h("li", "Map: d3 and topojson from cdnjs, country shapes from world-atlas (Natural Earth) on jsDelivr."),
          h("li", "Releases: 6529's signed release list at 6529.io/validator/releases.json.")),
        h("h2", "Run a validator"),
        h("p", "Download it only from ", h("a", { href: "https://6529.io/validator", target: "_blank", rel: "noopener" }, "6529.io/validator"),
          ". The validator's key signs TDH results only: it can't move NFTs or funds, and authorising it costs no gas. Nobody legitimate will ever ask for your seed phrase."),
        h("p.muted", "This site is independent and unofficial. It is not affiliated with or endorsed by 6529.")),
      h("div.stack", h("h2", "Validator releases"), rel)));

  try {
    const d = await getJSON(RELEASES);
    const rs = (d.releases || []).slice(0, 6);
    rel.replaceChildren(...rs.map((r) => h("div.check",
      h("span.dot.ok", "↑"),
      h("div", h("b", r.version), " ", h("span.muted", `${r.channel || ""} · ${r.date || ""}`),
        r.commit ? h("p", "commit ", h("code", String(r.commit).slice(0, 10))) : null))),
      h("p.muted", "Install updates yourself, after reading their notes."));
  } catch (e) { rel.replaceChildren(failed("releases", e)); }
}

/* ---------- validators ---------- */
const D3_URL = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
const TOPO_URL = "https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js";
const WORLD_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
const CONTINENTS = {
  NORTH_AMERICA: { name: "North America", lon: -100, lat: 42 },
  SOUTH_AMERICA: { name: "South America", lon: -60, lat: -16 },
  EUROPE: { name: "Europe", lon: 14, lat: 51 },
  AFRICA: { name: "Africa", lon: 19, lat: 4 },
  ASIA: { name: "Asia", lon: 95, lat: 32 },
  OCEANIA: { name: "Oceania", lon: 140, lat: -25 },
  ANTARCTICA: { name: "Antarctica", lon: 0, lat: -80 },
};
const contKey = (c) => String(c || "").toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^NORTHAMERICA$/, "NORTH_AMERICA").replace(/^SOUTHAMERICA$/, "SOUTH_AMERICA");
const regionName = (() => { try { const dn = new Intl.DisplayNames(["en"], { type: "region" }); return (c) => { try { return dn.of(c); } catch { return c; } }; } catch { return (c) => c; } })();
const flag = (cc) => (/^[A-Z]{2}$/.test(cc || "") ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1a5 + ch.charCodeAt(0))) : "");
const shortAddr = (w) => (w ? w.slice(0, 6) + "…" + w.slice(-4) : "—");
const ipfs = (u) => (typeof u === "string" && u.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + u.slice(7).replace(/^ipfs\//, "") : safeUrl(u));

const scriptCache = {};
function loadScript(src) {
  return (scriptCache[src] ||= new Promise((ok, ko) => {
    const el = document.createElement("script");
    el.src = src; el.async = true; el.crossOrigin = "anonymous"; el.referrerPolicy = "no-referrer";
    el.onload = ok; el.onerror = () => { delete scriptCache[src]; ko(new Error("couldn't load " + src)); };
    document.head.append(el);
  }));
}

/* Wallet -> 6529 identity, resolved by the visitor's browser (public API), a few at a time. */
const idCache = new Map();
function identity(wallet) {
  if (!idCache.has(wallet)) {
    idCache.set(wallet, getJSON(API_6529 + "/identities/" + wallet, { timeout: 12000 })
      .then((d) => ({ handle: d.handle || null, pfp: ipfs(d.pfp), level: d.level, display: d.display }))
      .catch(() => ({})));
  }
  return idCache.get(wallet);
}
async function resolveAll(wallets, onEach, limit = 6) {
  let i = 0;
  const worker = async () => { while (i < wallets.length) { const w = wallets[i++]; onEach(w, await identity(w)); } };
  await Promise.all(Array.from({ length: Math.min(limit, wallets.length) }, worker));
}
function whoCell(wallet) {
  const ph = h("span.ph"), name = h("b", shortAddr(wallet));
  const cell = h("div.who", { "data-wallet": wallet }, ph, name);
  return cell;
}
function fillWho(cell, id) {
  if (!cell || !id) return;
  const wallet = cell.dataset.wallet;
  const kids = [];
  kids.push(id.pfp ? h("img", { src: id.pfp, alt: "", loading: "lazy", referrerpolicy: "no-referrer",
    onerror: (e) => e.target.replaceWith(h("span.ph")) }) : h("span.ph"));
  kids.push(id.handle
    ? h("a", { href: PROFILE + encodeURIComponent(id.handle), target: "_blank", rel: "noopener", title: wallet }, h("b", id.handle))
    : h("a", { href: "https://etherscan.io/address/" + wallet, target: "_blank", rel: "noopener" }, h("b.mono", shortAddr(wallet))));
  cell.replaceChildren(...kids);
}

async function drawMap(box, reports) {
  try {
    await loadScript(D3_URL); await loadScript(TOPO_URL);
    const world = await getJSON(WORLD_URL, { timeout: 20000 });
    const d3 = window.d3, topojson = window.topojson;
    const W = 960, H = 470;
    const proj = d3.geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: "Sphere" });
    const path = d3.geoPath(proj);
    const countries = topojson.feature(world, world.objects.countries).features;

    const byCountry = {}, byCont = {};
    reports.forEach((r) => {
      if (r.country) byCountry[r.country] = (byCountry[r.country] || 0) + 1;
      const k = contKey(r.continent); if (CONTINENTS[k]) byCont[k] = (byCont[k] || 0) + 1;
    });
    const numToCc = {}; Object.entries(window.ISO_NUM || {}).forEach(([cc, n]) => (numToCc[n] = cc));

    const svg = d3.create("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
      .attr("aria-label", "Where validators say they are");
    svg.append("path").attr("d", path({ type: "Sphere" })).attr("class", "sea");
    svg.append("g").selectAll("path").data(countries).join("path")
      .attr("d", path)
      .attr("class", (f) => (byCountry[numToCc[String(f.id).padStart(3, "0")]] ? "land on" : "land"))
      .append("title").text((f) => {
        const cc = numToCc[String(f.id).padStart(3, "0")], n = byCountry[cc];
        return (f.properties && f.properties.name || cc || "") + (n ? ` — ${n} validator machine${n > 1 ? "s" : ""}` : "");
      });
    const max = Math.max(1, ...Object.values(byCont));
    const g = svg.append("g");
    Object.entries(byCont).forEach(([k, n]) => {
      const [x, y] = proj([CONTINENTS[k].lon, CONTINENTS[k].lat]);
      const r = 14 + 22 * Math.sqrt(n / max);
      const b = g.append("g").attr("transform", `translate(${x},${y})`);
      b.append("circle").attr("r", r).attr("class", "bubble");
      b.append("text").attr("class", "bubble-n").attr("dy", "0.35em").text(n);
      b.append("text").attr("class", "bubble-l").attr("y", r + 14).text(CONTINENTS[k].name);
      b.append("title").text(`${CONTINENTS[k].name}: ${n} reporting machine${n > 1 ? "s" : ""}`);
    });
    box.replaceChildren(svg.node());
  } catch (e) {
    box.replaceChildren(h("p.muted", "The map couldn't load (" + e.message + ")."));
  }
}

function countBy(list, fn) {
  const m = new Map();
  list.forEach((x) => { const k = fn(x); if (k != null) m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function breakdown(title, rows, total, fmt = (k) => k) {
  return h("div.panel", h("h3", title),
    rows.length ? rows.map(([k, n]) => h("div.meter",
      h("div.lbl", h("span", fmt(k)), h("b", `${n}`)),
      h("div.bar", h("i", { style: "width:" + ((n / Math.max(1, total)) * 100).toFixed(1) + "%" }))))
      : h("p.muted", "Nothing reported yet."));
}

async function viewValidators() {
  let v, net;
  try { [v, net] = await Promise.all([local("validators.json"), local("network.json")]); }
  catch (e) { return render(failed("validators", e)); }
  const accounts = v.accounts || [];
  const machines = accounts.flatMap((a) => (a.machines || []).map((m) => ({ ...m, wallet: a.wallet })));
  const reports = machines.map((m) => m.report).filter(Boolean);
  const signedToday = machines.filter((m) => m.today === "SIGNED").length;
  const W = v.w || accounts.reduce((s, a) => s + (a.weight || 0), 0);
  const current = new Set(accounts.map((a) => a.wallet));
  const joining = (v.next_members || []).filter((m) => !current.has(m.wallet));

  const mapBox = h("div.map", h("p.muted.pad", "Loading map…"));
  const table = h("div.table-wrap", h("table",
    h("thead", h("tr", h("th.n", "#"), h("th", "Validator"), h("th.n", "TDH"), h("th.n", "Vote weight"),
      h("th.n", "Machines"), h("th", "Today"), h("th", "Where"), h("th", "Type"), h("th", "Ethereum data"), h("th", "Software"))),
    h("tbody", accounts.map((a, i) => {
      const ms = a.machines || [];
      const rep = ms.map((m) => m.report).find(Boolean) || {};
      const signed = ms.filter((m) => m.today === "SIGNED").length;
      const cc = rep.country;
      const where = cc ? `${flag(cc)} ${regionName(cc)}` : (CONTINENTS[contKey(rep.continent)] || {}).name || "—";
      return h("tr",
        h("td.n.muted", i + 1),
        h("td", whoCell(a.wallet)),
        h("td.n", num(a.tdh)),
        h("td.n", W ? pct((a.weight || 0) / W) : "—"),
        h("td.n", ms.length),
        h("td", h("span.badge." + (signed === ms.length ? "ok" : signed ? "warn" : "bad"), `${signed}/${ms.length} signed`)),
        h("td", where),
        h("td", rep.infrastructure ? rep.infrastructure : h("span.muted", "—")),
        h("td", rep.source_class ? (rep.source_class === "OWN_NODE" ? "own node" : "verified servers") : h("span.muted", "—")),
        h("td", rep.software ? h("code", rep.software) : h("span.muted", "—")));
    }))));

  const joinList = joining.length ? h("div.table-wrap", h("table",
    h("thead", h("tr", h("th", "Validator"), h("th.n", "TDH"), h("th.n", "Keys"))),
    h("tbody", joining.sort((a, b) => (b.tdh || 0) - (a.tdh || 0)).map((m) =>
      h("tr", h("td", whoCell(m.wallet)), h("td.n", num(m.tdh)), h("td.n", num(m.keys)))))))
    : h("div.panel", h("p.muted", "No new accounts registered for the next day yet."));

  const reportsN = reports.length;
  render(
    h("div.head", h("div", h("h1", "Validators"),
      h("p", `Who signed ${fmtDay(v.cycle_day)}, as the network broadcasts it. Names come from public 6529 profiles.`))),
    h("div.grid.tiles",
      tile("Validator accounts", num(accounts.length), "signed today"),
      tile("Machines", num(machines.length), `${num(signedToday)} signed today`),
      tile("Joining next day", num(joining.length), `${num(net.next_accounts)} accounts registered`),
      tile("Reporting a location", `${num(reportsN)} / ${num(machines.length)}`, "machines with a daily report")),
    h("div.section", h("h2", "Where validators run"),
      h("div.panel", mapBox,
        h("p.muted", { style: "margin:10px 0 0;font-size:12.5px" },
          "Only what each machine publishes in its daily report: its continent and, if the operator switches it on, its country. ",
          "Circles count reporting machines per continent; shaded countries are those named. Most validators publish nothing, so this is a lower bound."))),
    h("div.section.grid.tiles", { style: "grid-template-columns:repeat(auto-fit,minmax(220px,1fr))" },
      breakdown("Home or data center", countBy(reports, (r) => r.infrastructure), reportsN),
      breakdown("Ethereum data", countBy(reports, (r) => r.source_class), reportsN, (k) => (k === "OWN_NODE" ? "Own Ethereum node" : "Verified public servers")),
      breakdown("Software", countBy(reports, (r) => r.software), reportsN),
      breakdown("Continent", countBy(reports, (r) => (CONTINENTS[contKey(r.continent)] || {}).name), reportsN)),
    h("div.section", h("h2", "Who signed"), table),
    h("div.section", h("h2", `Joining on ${fmtDay(v.next_day)}`), joinList),
    h("div.section", h("div.callout", h("b", "What about hardware? "),
      "The network doesn't broadcast it. A validator's daily report carries only coarse labels — continent, country if published, home or data center, its software and where its Ethereum data came from. CPU, memory and disk stay on the machine.")));

  drawMap(mapBox, reports);
  const cells = new Map();
  app.querySelectorAll(".who[data-wallet]").forEach((c) => {
    const w = c.dataset.wallet; if (!cells.has(w)) cells.set(w, []); cells.get(w).push(c);
  });
  resolveAll([...cells.keys()], (w, id) => (cells.get(w) || []).forEach((c) => fillWho(c, id)));
}

/* ---------- router ---------- */
const routes = [
  [/^#?\/?$/, "overview", viewOverview],
  [/^#\/validators$/, "validators", viewValidators],
  [/^#\/cycles$/, "cycles", viewCycles],
  [/^#\/cycle\/(\d{1,7})$/, "cycles", (m) => viewCycle(m[1])],
  [/^#\/holders$/, "holders", viewHolders],
  [/^#\/about$/, "about", viewAbout],
];
function route() {
  const hsh = location.hash || "#/";
  for (const [re, key, fn] of routes) {
    const m = hsh.match(re);
    if (m) {
      document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.r === key));
      return fn(m);
    }
  }
  render(h("div.panel", h("p", "Page not found. "), h("a", { href: "#/" }, "Back to the overview")));
}
window.addEventListener("hashchange", route);

/* ---------- theme & freshness ---------- */
(function theme() {
  const root = document.documentElement;
  try { const t = localStorage.getItem("theme"); if (t) root.dataset.theme = t; } catch {}
  document.getElementById("theme").addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch {}
  });
})();
local("network.json").then((n) => {
  document.getElementById("fresh").textContent =
    `Cycle data updated ${ago(n.generated_unix)} (${fmtTime(n.generated_unix)}) · validator release ${n.release} · ${n.rule_version}`;
}).catch(() => {});

route();
