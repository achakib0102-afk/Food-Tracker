import { REF } from "./reference.js";

/* ---------- energy factors: EU Reg 1169/2011 Annex XIV (kcal/g) ---------- */
const KCAL = { protein: 4, carbohydrate: 4, fat: 9, fibre: 2, polyols: 2.4 };
const KJ_PER_KCAL = 4.184;
const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];
const NUT_ROWS = [
  ["energy_kcal", "Energy", "kcal", false], ["fat", "Fat", "g", false],
  ["saturates", "of which saturates", "g", true], ["carbohydrate", "Carbohydrate", "g", false],
  ["sugars", "of which sugars", "g", true], ["polyols", "of which polyols", "g", true],
  ["fibre", "Fibre", "g", false], ["protein", "Protein", "g", false], ["salt", "Salt", "g", false],
];

const EMPTY = {
  name: "", language: "", basis: "per_100g", columnUsed: "", columnsAvailable: [],
  energy_kcal: null, energy_kj: null, fat: null, saturates: null, carbohydrate: null,
  sugars: null, polyols: null, fibre: null, protein: null, salt: null,
};

const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const fmt = (v, d = 1) => (v === null || v === undefined ? "—" : Number(v).toFixed(d).replace(/\.0$/, ""));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const r1 = (x) => Math.round(x * 10) / 10;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const dateKey = (d) => {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const shiftDay = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const prettyDate = (k) => {
  const t = dateKey(new Date());
  if (k === t) return "Today";
  if (k === shiftDay(t, -1)) return "Yesterday";
  return parseKey(k).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

function derivedKcal(p) {
  const parts = [[p.protein, KCAL.protein], [p.carbohydrate, KCAL.carbohydrate], [p.fat, KCAL.fat],
                 [p.fibre, KCAL.fibre], [p.polyols, KCAL.polyols]];
  let total = 0, any = false;
  for (const [g, f] of parts) { const x = num(g); if (x !== null) { total += x * f; any = true; } }
  return any ? total : null;
}
function resolvedKcal(p) {
  const k = num(p.energy_kcal); if (k !== null) return k;
  const kj = num(p.energy_kj); if (kj !== null) return kj / KJ_PER_KCAL;
  return derivedKcal(p);
}
function scale(p, grams) {
  const f = grams / 100, out = {};
  for (const key of ["fat", "saturates", "carbohydrate", "sugars", "polyols", "fibre", "protein", "salt"]) {
    const v = num(p[key]); out[key] = v === null ? null : v * f;
  }
  const k = resolvedKcal(p);
  out.kcal = k === null ? null : k * f;
  return out;
}
/* USDA-style totals -> European convention (carbohydrate net of fibre) */
function toEU({ name, kcal, protein, fat, sat, carbTotal, sugars, fibre, salt, source }) {
  const fib = fibre ?? null;
  const carb = carbTotal === null || carbTotal === undefined ? null : r1(Math.max(0, carbTotal - (fib || 0)));
  return { ...EMPTY, name, basis: "per_100g", columnUsed: source,
    energy_kcal: kcal ?? null, fat: fat ?? null, saturates: sat ?? null, carbohydrate: carb,
    sugars: sugars ?? null, fibre: fib, protein: protein ?? null, salt: salt ?? null };
}

const REFERENCE = REF.map(([name, group, kcal, protein, fat, sat, carbTotal, sugars, fibre, salt]) => ({
  id: "ref-" + name, name, group,
  per100: toEU({ name, kcal, protein, fat, sat, carbTotal, sugars, fibre, salt, source: "Reference table" }),
}));

/* ---------------- state ---------------- */
const DEFAULTS = { goalCals: 2200, pctP: 30, pctC: 40, pctF: 30, fibreInCarbs: false, fdcKey: "", anthropicKey: "" };
const S = {
  settings: { ...DEFAULTS }, log: [], library: { foods: [], meals: [] },
  tab: "day", date: dateKey(new Date()),
  month: { y: new Date().getFullYear(), m: new Date().getMonth() },
  draft: null, grams: "100", bucket: "Breakfast", keep: true,
  adding: null, query: "", usda: [], usdaMsg: "", barcode: "",
  busy: "", error: "", showGoal: false, savingMeal: null, mealName: "",
};

const KEYS = { settings: "nutri:settings", log: "nutri:log", library: "nutri:library" };
function load() {
  try { const r = localStorage.getItem(KEYS.settings); if (r) S.settings = { ...DEFAULTS, ...JSON.parse(r) }; } catch (e) {}
  try { const r = localStorage.getItem(KEYS.log); if (r) S.log = JSON.parse(r); } catch (e) {}
  try { const r = localStorage.getItem(KEYS.library); if (r) S.library = { foods: [], meals: [], ...JSON.parse(r) }; } catch (e) {}
}
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const saveSettings = () => put(KEYS.settings, S.settings);
const saveLog = () => put(KEYS.log, S.log);
const saveLib = () => put(KEYS.library, S.library);

/* ---------------- derived ---------------- */
const targets = () => ({
  kcal: S.settings.goalCals,
  protein: (S.settings.goalCals * S.settings.pctP) / 100 / KCAL.protein,
  carbohydrate: (S.settings.goalCals * S.settings.pctC) / 100 / KCAL.carbohydrate,
  fat: (S.settings.goalCals * S.settings.pctF) / 100 / KCAL.fat,
});
const dayEntries = () => S.log.filter((e) => e.date === S.date);
const totalsFor = (entries) => entries.reduce((a, e) => ({
  kcal: a.kcal + (e.computed.kcal || 0),
  protein: a.protein + (e.computed.protein || 0),
  carbohydrate: a.carbohydrate + (e.computed.carbohydrate || 0) + (S.settings.fibreInCarbs ? e.computed.fibre || 0 : 0),
  fat: a.fat + (e.computed.fat || 0),
  fibre: a.fibre + (e.computed.fibre || 0),
  salt: a.salt + (e.computed.salt || 0),
}), { kcal: 0, protein: 0, carbohydrate: 0, fat: 0, fibre: 0, salt: 0 });
const kcalByDate = () => {
  const m = {};
  for (const e of S.log) m[e.date] = (m[e.date] || 0) + (e.computed.kcal || 0);
  return m;
};

/* ---------------- remote ---------------- */
async function lookupBarcode(code) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`);
  const data = await res.json();
  if (data.status !== 1 || !data.product) throw new Error("notfound");
  const p = data.product, nu = p.nutriments || {};
  const parsed = { ...EMPTY,
    name: [p.product_name, p.brands].filter(Boolean).join(" · ") || "Barcode " + code,
    language: "database", columnUsed: "Open Food Facts",
    energy_kcal: num(nu["energy-kcal_100g"]), energy_kj: num(nu["energy-kj_100g"] ?? nu["energy_100g"]),
    fat: num(nu["fat_100g"]), saturates: num(nu["saturated-fat_100g"]),
    carbohydrate: num(nu["carbohydrates_100g"]), sugars: num(nu["sugars_100g"]),
    polyols: num(nu["polyols_100g"]), fibre: num(nu["fiber_100g"]),
    protein: num(nu["proteins_100g"]), salt: num(nu["salt_100g"]) };
  if (resolvedKcal(parsed) === null && parsed.protein === null && parsed.fat === null) throw new Error("empty");
  return parsed;
}

/* USDA: 1008 kcal, 1003 protein, 1004 fat, 1258 saturates,
   1005 carbohydrate (incl fibre), 2000 sugars, 1079 fibre, 1093 sodium mg */
async function searchUSDA(query, key) {
  const apiKey = (key || "").trim() || "DEMO_KEY";
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`
    + `&query=${encodeURIComponent(query)}&dataType=Foundation,SR%20Legacy&pageSize=20`;
  const res = await fetch(url);
  if (res.status === 429) throw new Error("ratelimit");
  if (!res.ok) throw new Error("http");
  const data = await res.json();
  return (data.foods || []).map((f) => {
    const get = (id) => {
      const hit = (f.foodNutrients || []).find((x) => (x.nutrientId ?? x.number) === id);
      return hit && hit.value !== undefined ? Number(hit.value) : null;
    };
    const sodium = get(1093);
    const name = (f.description || "").replace(/\s+/g, " ").trim();
    return { id: "usda-" + f.fdcId, name, per100: toEU({
      name, kcal: get(1008), protein: get(1003), fat: get(1004), sat: get(1258),
      carbTotal: get(1005), sugars: get(2000), fibre: get(1079),
      salt: sodium === null ? null : r1((sodium / 1000) * 2.5),
      source: ("USDA " + (f.dataType || "")).trim() }) };
  }).filter((x) => resolvedKcal(x.per100) !== null);
}

const VISION_PROMPT = `You are reading a European packaged-food nutrition declaration. It may be in Greek, German, Dutch, or any other language.

Rules:
- EU labels follow a fixed order: energy, fat, of which saturates, carbohydrate, of which sugars, (polyols), (fibre), protein, salt. Use position as well as wording.
- Decimal commas mean decimal points: "4,5" is 4.5.
- Report values for 100 g (or 100 ml). Never report a per-serving column.
- If both an "as sold / dry" column and a "prepared / zubereitet / bereid" column exist, use the AS SOLD column and list both in columns_available.
- EU carbohydrate is already exclusive of fibre. Do not subtract fibre.
- Salt is in grams. Do not convert it.
- Give the product name in English where the brand allows it.
- Use null for anything not printed. Never estimate.

Respond with ONLY a JSON object, no fences, no commentary:
{"name":string,"language":string,"basis":"per_100g"|"per_100ml","column_used":string,"columns_available":[string],"energy_kcal":number|null,"energy_kj":number|null,"fat":number|null,"saturates":number|null,"carbohydrate":number|null,"sugars":number|null,"polyols":number|null,"fibre":number|null,"protein":number|null,"salt":number|null}`;

async function readLabelImage(base64, mediaType, apiKey) {
  if (!apiKey) throw new Error("nokey");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", max_tokens: 1000,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: VISION_PROMPT }] }],
    }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? "badkey" : "http");
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const j = JSON.parse(text.replace(/```json/g, "").replace(/```/g, "").trim());
  return { ...EMPTY, name: j.name || "", language: j.language || "", basis: j.basis || "per_100g",
    columnUsed: j.column_used || "", columnsAvailable: j.columns_available || [],
    energy_kcal: num(j.energy_kcal), energy_kj: num(j.energy_kj), fat: num(j.fat),
    saturates: num(j.saturates), carbohydrate: num(j.carbohydrate), sugars: num(j.sugars),
    polyols: num(j.polyols), fibre: num(j.fibre), protein: num(j.protein), salt: num(j.salt) };
}

/* ---------------- actions ---------------- */
function rememberFood(per100) {
  const key = (per100.name || "").trim().toLowerCase();
  const existing = S.library.foods.find((f) => (f.name || "").trim().toLowerCase() === key);
  if (existing) { existing.per100 = per100; existing.usedAt = Date.now(); }
  else S.library.foods.unshift({ id: uid(), name: per100.name || "Unnamed", per100, usedAt: Date.now() });
  saveLib();
}
function openDraft(per100, keep) {
  S.draft = { ...per100 }; S.grams = "100"; S.keep = !!keep; S.error = "";
}
function commitDraft() {
  const g = Number(S.grams);
  if (!S.draft || !g || g <= 0) return;
  S.log.unshift({ id: uid(), date: S.date, meal: S.bucket, name: S.draft.name || "Unnamed item",
                  grams: g, per100: S.draft, computed: scale(S.draft, g) });
  saveLog();
  if (S.keep) rememberFood(S.draft);
  S.draft = null; S.grams = "100"; S.adding = null; S.query = ""; S.usda = []; S.usdaMsg = "";
  render();
}
function logSavedMeal(meal, bucket) {
  for (const it of meal.items) {
    S.log.unshift({ id: uid(), date: S.date, meal: bucket, name: it.name, grams: it.grams,
                    per100: it.per100, computed: scale(it.per100, it.grams) });
  }
  saveLog();
  S.adding = null; S.query = ""; S.usda = [];
  render();
}
function exportCsv() {
  const head = ["date","meal","item","grams","kcal","protein_g","carbohydrate_g","fat_g","fibre_g","sugars_g","saturates_g","salt_g"];
  const rows = [...S.log].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [
    e.date, e.meal, `"${(e.name || "").replace(/"/g, '""')}"`, e.grams,
    fmt(e.computed.kcal, 0), fmt(e.computed.protein), fmt(e.computed.carbohydrate), fmt(e.computed.fat),
    fmt(e.computed.fibre), fmt(e.computed.sugars), fmt(e.computed.saturates), fmt(e.computed.salt, 2)].join(","));
  const blob = new Blob([[head.join(","), ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "nutrition-log.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* hidden file input, created once so re-renders don't lose it */
const filePicker = document.createElement("input");
filePicker.type = "file"; filePicker.accept = "image/*"; filePicker.setAttribute("capture", "environment");
filePicker.style.display = "none";
document.body.appendChild(filePicker);
filePicker.addEventListener("change", async () => {
  const file = filePicker.files && filePicker.files[0];
  filePicker.value = "";
  if (!file) return;
  S.error = ""; S.busy = "photo"; render();
  try {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = () => rej(new Error("read"));
      r.readAsDataURL(file);
    });
    const p = await readLabelImage(b64, file.type || "image/jpeg", S.settings.anthropicKey.trim());
    openDraft(p, true);
  } catch (e) {
    S.error = e.message === "nokey"
      ? "Add an Anthropic API key under Goal to use label photos. Barcode, reference foods and USDA all work without it."
      : e.message === "badkey" ? "That Anthropic key was rejected. Check it under Goal."
      : "Couldn't read that label. Try a straighter, closer shot of the nutrition table.";
  }
  S.busy = ""; render();
});

/* ---------------- render ---------------- */
const app = document.getElementById("app");

function bar(label, val, tgt, color) {
  const pct = tgt > 0 ? Math.min(100, (val / tgt) * 100) : 0;
  const over = tgt > 0 && val > tgt;
  return `<div class="barrow"><span>${label}</span>
    <span class="track"><span class="fill" style="width:${pct}%;background:${over ? "var(--alert)" : color}"></span></span>
    <span class="amt ${over ? "over" : ""}">${fmt(val, 0)}/${fmt(tgt, 0)} g</span></div>`;
}
const hit = (act, id, name, sub) =>
  `<div class="libitem"><div><div>${esc(name)}</div><div class="entry-sub">${esc(sub)}</div></div>
   <button class="btn alt sm" data-act="${act}" data-id="${esc(id)}">Log</button></div>`;

function goalPanel() {
  const t = targets(), sum = S.settings.pctP + S.settings.pctC + S.settings.pctF;
  return `<div class="panel">
    <label class="lab">Daily calories</label>
    <input type="number" inputmode="numeric" data-field="goalCals" value="${S.settings.goalCals}">
    <div style="height:12px"></div>
    <label class="lab">Split by percent of calories</label>
    <div class="grid3">
      ${[["pctP","Protein"],["pctC","Carbs"],["pctF","Fat"]].map(([k, l]) =>
        `<div><label class="lab">${l}</label>
         <input type="number" inputmode="numeric" data-field="${k}" value="${S.settings[k]}"></div>`).join("")}
    </div>
    ${sum !== 100 ? `<p class="note" style="color:var(--alert)">Percentages total ${sum}. They need to total 100 for the gram targets to match your calorie goal.</p>` : ""}
    <p class="note">Targets: ${fmt(t.protein, 0)} g protein · ${fmt(t.carbohydrate, 0)} g carbs · ${fmt(t.fat, 0)} g fat.
      Calculated at 4 kcal/g for protein and carbohydrate, 9 kcal/g for fat.</p>
    <div class="check">
      <input id="fib" type="checkbox" data-field="fibreInCarbs" ${S.settings.fibreInCarbs ? "checked" : ""}>
      <label for="fib">Count fibre inside my carb total. EU labels list carbohydrate already excluding fibre;
        tick this to match the Canadian total-carbohydrate convention.</label>
    </div>
    <div style="height:18px"></div>
    <label class="lab">USDA key</label>
    <input data-field="fdcKey" autocapitalize="none" autocorrect="off" spellcheck="false"
      placeholder="Leave blank for the shared demo key" value="${esc(S.settings.fdcKey)}">
    <p class="note">${S.settings.fdcKey.trim()
      ? "Saved. USDA searches use your key."
      : "Optional. USDA search works without one, at a low shared rate limit. Get yours at fdc.nal.usda.gov."}</p>
    <div style="height:14px"></div>
    <label class="lab">Anthropic key</label>
    <input data-field="anthropicKey" type="password" autocapitalize="none" autocorrect="off" spellcheck="false"
      placeholder="Needed only for label photos" value="${esc(S.settings.anthropicKey)}">
    <p class="note">${S.settings.anthropicKey.trim()
      ? "Saved on this device only. Label photos are enabled."
      : "Without this, label photos are off. Everything else still works. Billed per use from console.anthropic.com."}</p>
  </div>`;
}

function dayTab() {
  const t = targets(), entries = dayEntries(), c = totalsFor(entries);
  const left = t.kcal - c.kcal;
  let html = `<div class="datebar">
      <button class="nav" data-act="day" data-delta="-1" aria-label="Previous day">&lsaquo;</button>
      <span class="d">${prettyDate(S.date)}</span>
      <button class="nav" data-act="day" data-delta="1" ${S.date >= dateKey(new Date()) ? "disabled" : ""} aria-label="Next day">&rsaquo;</button>
    </div>
    <div class="panel">
      <div class="bignum">${fmt(Math.abs(left), 0)}</div>
      <div class="bigsub">${left < 0 ? "calories over your goal" : "calories left"} · ${fmt(c.kcal, 0)} of ${fmt(t.kcal, 0)} eaten</div>
      <div class="bars">
        ${bar("Protein", c.protein, t.protein, "var(--p)")}
        ${bar("Carbs", c.carbohydrate, t.carbohydrate, "var(--c)")}
        ${bar("Fat", c.fat, t.fat, "var(--f)")}
      </div>
      <p class="note">Fibre ${fmt(c.fibre)} g · salt ${fmt(c.salt, 1)} g · sodium ${fmt((c.salt / 2.5) * 1000, 0)} mg</p>
    </div>`;

  if (S.error) html += `<div class="err">${esc(S.error)}</div>`;

  html += `<div class="panel">` + MEALS.map((b, i) => {
    const items = entries.filter((e) => e.meal === b), tt = totalsFor(items);
    return `<div class="bucket ${i === 0 ? "first" : ""}">
      <div class="bhead"><span class="bname">${b}</span>
        <span class="bkcal">${items.length ? fmt(tt.kcal, 0) + " kcal" : ""}</span></div>
      ${items.map((e) => `<div class="entry"><div><div>${esc(e.name)}</div>
        <div class="entry-sub">${fmt(e.grams, 0)} g · ${fmt(e.computed.kcal, 0)} kcal ·
          P ${fmt(e.computed.protein)} · C ${fmt(e.computed.carbohydrate)} · F ${fmt(e.computed.fat)}</div></div>
        <button class="x" data-act="rm" data-id="${e.id}" aria-label="Remove">&times;</button></div>`).join("")}
      <div class="brow">
        <button class="btn alt sm" data-act="add" data-bucket="${b}">Add food</button>
        ${items.length ? `<button class="btn alt sm" data-act="savemeal" data-bucket="${b}">Save as meal</button>` : ""}
      </div></div>`;
  }).join("") + `</div>`;

  if (S.savingMeal) {
    html += `<div class="panel">
      <label class="lab">Name this ${S.savingMeal.toLowerCase()} so you can log it again in one tap</label>
      <div class="row"><input data-field="mealName" value="${esc(S.mealName)}" placeholder="Halloumi wrap and yoghurt">
        <button class="btn" data-act="mealok">Save</button>
        <button class="btn alt" data-act="mealcancel">Cancel</button></div></div>`;
  }

  if (S.adding && !S.draft) html += addPanel();
  if (S.draft) html += draftPanel();
  return html;
}

function resultsHtml() {
  const q = S.query.trim().toLowerCase();
  const foods = [...S.library.foods].sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0));
  const mine = q ? foods.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 8) : foods.slice(0, 5);
  const meals = q ? S.library.meals.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 5) : S.library.meals.slice(0, 3);
  const ref = q ? REFERENCE.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 10) : [];
  const line = (p) => `${fmt(resolvedKcal(p), 0)} kcal · P ${fmt(p.protein)} · C ${fmt(p.carbohydrate)} · F ${fmt(p.fat)} per 100 g`;

  let h = "";
  if (meals.length) h += `<div class="srch">Your meals</div>` +
    meals.map((m) => hit("logmeal", m.id, m.name, `${m.items.length} items`)).join("");
  if (mine.length) h += `<div class="srch">Your foods</div>` +
    mine.map((f) => hit("logmine", f.id, f.name, line(f.per100))).join("");
  if (ref.length) h += `<div class="srch">Reference foods</div>` +
    ref.map((r) => hit("logref", r.id, r.name, line(r.per100))).join("");
  if (S.usda.length) h += `<div class="srch">USDA</div>` +
    S.usda.map((u) => hit("logusda", u.id, u.name, line(u.per100))).join("");
  if (q && !S.usda.length) h += `<div style="margin-top:10px">
      <button class="btn alt sm" data-act="usda" ${S.busy ? "disabled" : ""}>
        ${S.busy === "usda" ? "Searching USDA…" : `Search USDA for "${esc(S.query.trim())}"`}</button>
      ${S.usdaMsg ? `<p class="note">${esc(S.usdaMsg)}</p>` : ""}</div>`;
  if (!q && !mine.length && !meals.length)
    h += `<p class="empty">Type a food name to search ${REFERENCE.length} built-in whole foods, or scan below.</p>`;
  return h;
}

function addPanel() {
  return `<div class="panel" id="addpanel">
    <label class="lab">Add to ${S.adding}</label>
    <input id="q" data-field="query" value="${esc(S.query)}" placeholder="Search foods — yours, reference, or USDA"
      autocapitalize="none" autocorrect="off">
    <div id="results">${resultsHtml()}</div>
    <p class="or">or</p>
    <div class="row">
      <input data-field="barcode" inputmode="numeric" value="${esc(S.barcode)}" placeholder="Barcode digits">
      <button class="btn" data-act="barcode" ${S.busy || !S.barcode.trim() ? "disabled" : ""}>
        ${S.busy === "barcode" ? "…" : "Look up"}</button>
    </div>
    <div style="height:8px"></div>
    <button class="btn alt" style="width:100%" data-act="photo" ${S.busy ? "disabled" : ""}>
      ${S.busy === "photo" ? "Reading the label…" : "Photograph the nutrition table"}</button>
    <div style="height:6px"></div>
    <button class="ghost" data-act="addcancel">Cancel</button>
  </div>`;
}

function draftPanel() {
  const d = S.draft;
  const labelK = num(d.energy_kcal) ?? (num(d.energy_kj) !== null ? num(d.energy_kj) / KJ_PER_KCAL : null);
  const derK = derivedKcal(d);
  const mismatch = labelK !== null && derK !== null && Math.abs(labelK - derK) > Math.max(10, labelK * 0.1);
  const cols = d.columnsAvailable || [];
  const g = Number(S.grams);
  const s = g > 0 ? scale(d, g) : null;
  return `<div class="panel" id="draftpanel">
    <label class="lab">Item</label>
    <input data-field="draftName" value="${esc(d.name)}">
    <p class="note" style="margin-bottom:10px">
      ${d.columnUsed ? "Source: " + esc(d.columnUsed) + ". " : ""}
      ${d.language && d.language !== "database" ? "Label language: " + esc(d.language) + ". " : ""}
      Values are per 100 ${d.basis === "per_100ml" ? "ml" : "g"}. Correct anything that looks wrong.</p>
    ${cols.length > 1 ? `<div class="warn">This label has more than one column (${esc(cols.join(", "))}).
      The values shown are the as-sold column. If you weighed the food after cooking, switch to the prepared figures.</div>` : ""}
    ${mismatch ? `<div class="warn">The stated ${fmt(labelK, 0)} kcal doesn't match ${fmt(derK, 0)} kcal from the macros.
      That's normal when polyols or fibre are present, since they count at 2.4 and 2 kcal/g. The stated figure is used.</div>` : ""}
    <table><tbody>
      ${NUT_ROWS.map(([k, label, unit, sub]) => `<tr>
        <td class="${sub ? "sub" : ""}">${label}</td>
        <td class="val"><input type="number" step="any" inputmode="decimal" data-nut="${k}"
          value="${d[k] === null || d[k] === undefined ? "" : d[k]}"></td>
        <td class="unit">${unit}</td></tr>`).join("")}
    </tbody></table>
    <div style="margin-top:14px">
      <div class="row">
        <div style="flex:1"><label class="lab">Grams eaten</label>
          <input type="number" inputmode="decimal" data-field="grams" value="${esc(S.grams)}"></div>
        <div style="flex:1"><label class="lab">Meal</label>
          <select data-field="bucket">${MEALS.map((m) =>
            `<option ${m === S.bucket ? "selected" : ""}>${m}</option>`).join("")}</select></div>
      </div>
      <p class="note" id="portion">${s ? `That portion: ${fmt(s.kcal, 0)} kcal · ${fmt(s.protein)} g protein · ${fmt(s.carbohydrate)} g carbs · ${fmt(s.fat)} g fat` : ""}</p>
      <div class="check">
        <input id="keep" type="checkbox" data-field="keep" ${S.keep ? "checked" : ""}>
        <label for="keep">Save to my foods so I can log it again without searching</label>
      </div>
      <div class="brow">
        <button class="btn" data-act="commit">Add to ${S.bucket}</button>
        <button class="btn alt" data-act="draftcancel">Cancel</button>
      </div>
    </div></div>`;
}

function calendarTab() {
  const t = targets(), by = kcalByDate();
  const first = new Date(S.month.y, S.month.m, 1);
  const start = (first.getDay() + 6) % 7;
  const days = new Date(S.month.y, S.month.m + 1, 0).getDate();
  const cells = Array(start).fill(null);
  for (let d = 1; d <= days; d++) cells.push(dateKey(new Date(S.month.y, S.month.m, d)));
  while (cells.length % 7) cells.push(null);
  const logged = cells.filter(Boolean).filter((k) => by[k]);
  const avg = logged.length ? logged.reduce((a, k) => a + by[k], 0) / logged.length : 0;

  return `<div class="panel">
    <div class="datebar">
      <button class="nav" data-act="month" data-delta="-1" aria-label="Previous month">&lsaquo;</button>
      <span class="d">${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
      <button class="nav" data-act="month" data-delta="1" aria-label="Next month">&rsaquo;</button>
    </div>
    <div class="cal">
      ${["M","T","W","T","F","S","S"].map((d) => `<div class="dow">${d}</div>`).join("")}
      ${cells.map((k) => {
        if (!k) return `<div class="cell blank"></div>`;
        const kc = by[k], ratio = kc && t.kcal ? kc / t.kcal : 0;
        const col = !kc ? "var(--faint)" : ratio > 1.05 ? "var(--alert)" : ratio < 0.8 ? "var(--c)" : "var(--p)";
        return `<button class="cell ${k === S.date ? "sel" : ""}" data-act="pick" data-date="${k}">
          <span class="dn">${parseKey(k).getDate()}</span>
          <span class="kc">${kc ? fmt(kc, 0) : ""}</span>
          <span class="dot" style="background:${col}"></span></button>`;
      }).join("")}
    </div>
    <p class="note">${logged.length
      ? `${logged.length} days logged this month, averaging ${fmt(avg, 0)} kcal against a ${fmt(t.kcal, 0)} goal.`
      : "No days logged this month yet."}
      Green is within 5% of your goal, amber is under 80%, red is over. Tap a day to open it.</p>
  </div>`;
}

function libraryTab() {
  const q = S.query.trim().toLowerCase();
  const line = (p) => `${fmt(resolvedKcal(p), 0)} kcal · P ${fmt(p.protein)} · C ${fmt(p.carbohydrate)} · F ${fmt(p.fat)} per 100 g`;
  const meals = S.library.meals.filter((m) => m.name.toLowerCase().includes(q));
  const foods = [...S.library.foods].sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0))
    .filter((f) => f.name.toLowerCase().includes(q));
  return `<div class="panel">
    <input data-field="query" value="${esc(S.query)}" placeholder="Search saved foods and meals" autocapitalize="none">
    <div style="height:14px"></div>
    ${meals.length ? `<div class="bname">Meals</div>` + meals.map((m) => `<div class="libitem">
        <div><div>${esc(m.name)}</div><div class="entry-sub">${esc(m.items.map((i) => i.name).join(", "))}</div></div>
        <div class="libact"><button class="btn alt sm" data-act="logmeal" data-id="${m.id}">Log</button>
        <button class="x" data-act="delmeal" data-id="${m.id}" aria-label="Delete">&times;</button></div></div>`).join("")
      + `<div style="height:18px"></div>` : ""}
    <div class="bname">Foods</div>
    ${foods.length ? foods.map((f) => `<div class="libitem">
        <div><div>${esc(f.name)}</div><div class="entry-sub">${line(f.per100)}</div></div>
        <div class="libact"><button class="btn alt sm" data-act="logmine" data-id="${f.id}">Log</button>
        <button class="x" data-act="delfood" data-id="${f.id}" aria-label="Delete">&times;</button></div></div>`).join("")
      : `<p class="empty">Empty for now. Labels you scan and USDA results you log get saved here.
         The ${REFERENCE.length} built-in reference foods are always searchable without being saved.</p>`}
  </div>`;
}

function render() {
  const focus = document.activeElement;
  const fid = focus && focus.dataset ? (focus.dataset.field || focus.dataset.nut) : null;
  const selStart = focus && focus.selectionStart;

  app.innerHTML = `
    <div class="head"><h1 class="title">Label Reader</h1><div>
      <button class="ghost" data-act="export">Export</button>
      <button class="ghost" data-act="goal">${S.showGoal ? "Done" : "Goal"}</button></div></div>
    ${S.showGoal ? goalPanel() : ""}
    <div class="tabs">${[["day","Day"],["calendar","Calendar"],["library","My foods"]].map(([k, l]) =>
      `<button class="tab ${S.tab === k ? "on" : ""}" data-act="tab" data-tab="${k}">${l}</button>`).join("")}</div>
    ${S.tab === "day" ? dayTab() : S.tab === "calendar" ? calendarTab() : libraryTab()}`;

  if (fid) {
    const el = app.querySelector(`[data-field="${fid}"],[data-nut="${fid}"]`);
    if (el) {
      el.focus();
      try { if (selStart != null && el.setSelectionRange) el.setSelectionRange(selStart, selStart); } catch (e) {}
    }
  }
}

/* ---------------- events ---------------- */
app.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;

  if (act === "goal") { S.showGoal = !S.showGoal; return render(); }
  if (act === "export") return exportCsv();
  if (act === "tab") { S.tab = el.dataset.tab; S.query = ""; return render(); }
  if (act === "day") { S.date = shiftDay(S.date, Number(el.dataset.delta)); return render(); }
  if (act === "month") {
    const d = Number(el.dataset.delta);
    let { y, m } = S.month; m += d;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    S.month = { y, m }; return render();
  }
  if (act === "pick") { S.date = el.dataset.date; S.tab = "day"; return render(); }
  if (act === "rm") { S.log = S.log.filter((e) => e.id !== id); saveLog(); return render(); }
  if (act === "add") {
    S.bucket = el.dataset.bucket; S.adding = el.dataset.bucket;
    S.draft = null; S.keep = true; S.query = ""; S.usda = []; S.usdaMsg = "";
    render();
    const p = document.getElementById("addpanel");
    if (p) p.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (act === "addcancel") { S.adding = null; S.query = ""; S.usda = []; S.usdaMsg = ""; return render(); }
  if (act === "draftcancel") { S.draft = null; S.adding = null; return render(); }
  if (act === "commit") return commitDraft();
  if (act === "savemeal") { S.savingMeal = el.dataset.bucket; S.mealName = ""; return render(); }
  if (act === "mealcancel") { S.savingMeal = null; return render(); }
  if (act === "mealok") {
    const items = dayEntries().filter((e) => e.meal === S.savingMeal)
      .map((e) => ({ name: e.name, grams: e.grams, per100: e.per100 }));
    if (items.length) {
      S.library.meals.unshift({ id: uid(), name: S.mealName.trim() || S.savingMeal, items });
      saveLib();
    }
    S.savingMeal = null; S.mealName = ""; return render();
  }
  if (act === "delfood") { S.library.foods = S.library.foods.filter((f) => f.id !== id); saveLib(); return render(); }
  if (act === "delmeal") { S.library.meals = S.library.meals.filter((m) => m.id !== id); saveLib(); return render(); }

  if (act === "logmine") {
    const f = S.library.foods.find((x) => x.id === id); if (!f) return;
    if (S.adding) S.bucket = S.adding;
    f.usedAt = Date.now(); saveLib();
    openDraft(f.per100, false); S.tab = "day"; return render();
  }
  if (act === "logref") {
    const r = REFERENCE.find((x) => x.id === id); if (!r) return;
    if (S.adding) S.bucket = S.adding;
    openDraft(r.per100, false); S.tab = "day"; return render();
  }
  if (act === "logusda") {
    const u = S.usda.find((x) => x.id === id); if (!u) return;
    if (S.adding) S.bucket = S.adding;
    openDraft(u.per100, true); S.tab = "day"; return render();
  }
  if (act === "logmeal") {
    const m = S.library.meals.find((x) => x.id === id); if (!m) return;
    S.tab = "day"; return logSavedMeal(m, S.adding || S.bucket);
  }

  if (act === "barcode") {
    const code = S.barcode.trim(); if (!code) return;
    S.error = ""; S.busy = "barcode"; render();
    try { const p = await lookupBarcode(code); S.barcode = ""; openDraft(p, true); }
    catch (e) {
      S.error = e.message === "notfound" ? "No product with that barcode. Photograph the label instead."
        : e.message === "empty" ? "That product is in the database but has no nutrition values. Photograph the label instead."
        : "Couldn't reach Open Food Facts. Photograph the label instead.";
    }
    S.busy = ""; return render();
  }
  if (act === "usda") {
    const q = S.query.trim(); if (!q) return;
    S.usdaMsg = ""; S.usda = []; S.busy = "usda"; render();
    try {
      S.usda = await searchUSDA(q, S.settings.fdcKey);
      if (!S.usda.length) S.usdaMsg = "USDA has no whole-food match for that.";
    } catch (e) {
      S.usdaMsg = e.message === "ratelimit"
        ? (S.settings.fdcKey.trim() ? "USDA rate limit reached. It resets within the hour."
           : "Shared demo key is rate limited. Paste your own USDA key under Goal to lift it.")
        : "Couldn't reach USDA. The reference list still works offline.";
    }
    S.busy = ""; return render();
  }
  if (act === "photo") return filePicker.click();
});

/* text inputs: update state without a full re-render, so focus is never lost */
app.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.dataset.nut) {
    const v = t.value.replace(",", ".");
    S.draft[t.dataset.nut] = v === "" ? null : Number(v);
    return updatePortion();
  }
  const f = t.dataset.field;
  if (!f) return;
  if (f === "query") { S.query = t.value; const r = document.getElementById("results"); if (r) r.innerHTML = resultsHtml(); return; }
  if (f === "barcode") { S.barcode = t.value; return; }
  if (f === "mealName") { S.mealName = t.value; return; }
  if (f === "grams") { S.grams = t.value; return updatePortion(); }
  if (f === "draftName") { S.draft.name = t.value; return; }
  if (["goalCals", "pctP", "pctC", "pctF"].includes(f)) {
    S.settings[f] = Number(t.value) || 0; saveSettings(); return;
  }
  if (["fdcKey", "anthropicKey"].includes(f)) { S.settings[f] = t.value; saveSettings(); return; }
});

app.addEventListener("change", (ev) => {
  const f = ev.target.dataset.field;
  if (f === "fibreInCarbs") { S.settings.fibreInCarbs = ev.target.checked; saveSettings(); return render(); }
  if (f === "keep") { S.keep = ev.target.checked; return; }
  if (f === "bucket") { S.bucket = ev.target.value; return render(); }
  if (["goalCals", "pctP", "pctC", "pctF"].includes(f)) return render();
});

function updatePortion() {
  const el = document.getElementById("portion");
  if (!el || !S.draft) return;
  const g = Number(S.grams);
  if (!g || g <= 0) { el.textContent = ""; return; }
  const s = scale(S.draft, g);
  el.textContent = `That portion: ${fmt(s.kcal, 0)} kcal · ${fmt(s.protein)} g protein · `
    + `${fmt(s.carbohydrate)} g carbs · ${fmt(s.fat)} g fat`;
}

load();
render();
