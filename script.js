const API_URL = "http://127.0.0.1:8000";

/* ---------- Field definitions (keys match the FastAPI model) ---------- */
const num = (id, label, help, o) => ({ id, label, help, type: "number", step: 1, ...o });
const pick = (id, label, options) => ({ id, label, type: "select", options });
const list = (a) => a.map((v) => ({ v, t: v }));

const SECTIONS = [
  { title: "Personal", fields: [
    num("age", "Age", "Between 18 and 75 years.", { min: 18, max: 75, int: true }),
    pick("gender", "Gender", list(["Female", "Male"])),
    pick("marital_status", "Marital status", list(["Married", "Single"])),
    pick("education_level", "Education level", list(["Graduate", "Not Graduate"])),
    num("dependents", "Dependents", "People who rely on your income (0 to 10).", { min: 0, max: 10, int: true }),
  ]},
  { title: "Employment & income", fields: [
    pick("employment_status", "Employment status", list(["Salaried", "Self-employed", "Unemployed", "Contract"])),
    pick("employer_category", "Employer category", list(["Government", "MNC", "Private", "Unemployed", "Business"])),
    num("applicant_income", "Applicant income", "Monthly income. Must be greater than 0.", { min: 0, gt: true, step: "any" }),
    num("coapplicant_income", "Co-applicant income", "Monthly income of a co-applicant. Use 0 if none.", { min: 0, step: "any" }),
  ]},
  { title: "Credit & assets", fields: [
    num("credit_score", "Credit score", "Between 300 and 900.", { min: 300, max: 900 }),
    num("dti_ratio", "DTI ratio", "Monthly debt divided by monthly income, between 0 and 1.", { min: 0, max: 1, step: 0.01 }),
    num("existing_loans", "Existing loans", "Number of loans you already have (0 to 10).", { min: 0, max: 10, int: true }),
    num("savings", "Savings", "Total savings. Use 0 if none.", { min: 0, step: "any" }),
    num("collateral_value", "Collateral value", "Value of assets pledged. Use 0 if none.", { min: 0, step: "any" }),
  ]},
  { title: "Loan details", fields: [
    num("loan_amount", "Loan amount", "Amount you want to borrow. Must be greater than 0.", { min: 0, gt: true, step: "any" }),
    pick("loan_term", "Loan term", [12, 24, 36, 48, 60, 72, 84].map((v) => ({ v, t: v + " months" }))),
    pick("loan_purpose", "Loan purpose", list(["Business", "Car", "Education", "Home", "Personal"])),
    pick("property_area", "Property area", list(["Rural", "Semiurban", "Urban"])),
  ]},
];
const FIELDS = SECTIONS.flatMap((s) => s.fields);

const EXAMPLE = {
  age: 35, gender: "Female", marital_status: "Married", education_level: "Graduate", dependents: 1,
  employment_status: "Salaried", employer_category: "Private", applicant_income: 9000, coapplicant_income: 3000,
  credit_score: 720, dti_ratio: 0.25, existing_loans: 1, savings: 12000, collateral_value: 25000,
  loan_amount: 20000, loan_term: 60, loan_purpose: "Car", property_area: "Urban",
};

/* ---------- Elements ---------- */
const $ = (s) => document.querySelector(s);
const form = $("#form"), banner = $("#banner"), result = $("#result");
const submitBtn = $("#submit"), spin = submitBtn.querySelector(".spin"), btnLabel = submitBtn.querySelector(".label");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Build the form ---------- */
$("#sections").innerHTML = SECTIONS.map((s) => `
  <section class="card"><h2>${s.title}</h2><div class="fields">
    ${s.fields.map(fieldHTML).join("")}
  </div></section>`).join("");

function fieldHTML(f) {
  const input = f.type === "select"
    ? `<select id="${f.id}" name="${f.id}" required><option value="" disabled selected>Select an option</option>
        ${f.options.map((o) => `<option value="${o.v}">${o.t}</option>`).join("")}</select>`
    : `<input id="${f.id}" name="${f.id}" type="number" inputmode="decimal" min="${f.min}" ${f.max !== undefined ? `max="${f.max}"` : ""} step="${f.step}" required>`;
  return `<div class="field" id="f-${f.id}">
    <label for="${f.id}">${f.label}</label>${input}
    ${f.help ? `<span class="help" id="h-${f.id}">${f.help}</span>` : ""}
    <span class="err" id="e-${f.id}"></span></div>`;
}

/* ---------- Validation ---------- */
function setError(f, msg) {
  $("#f-" + f.id).classList.toggle("invalid", !!msg);
  $("#e-" + f.id).textContent = msg || "";
  $("#" + f.id).setAttribute("aria-invalid", msg ? "true" : "false");
}

function validateField(f) {
  const raw = $("#" + f.id).value.trim();
  if (raw === "") return setError(f, f.type === "select" ? "Choose an option." : "Enter a value."), null;
  if (f.type === "select") return setError(f, ""), isNaN(Number(raw)) ? raw : Number(raw);

  const n = Number(raw);
  let msg = "";
  if (!Number.isFinite(n)) msg = "Enter a valid number.";
  else if (f.int && !Number.isInteger(n)) msg = "Enter a whole number.";
  else if (f.gt && n <= f.min) msg = "Enter an amount greater than 0.";
  else if (f.max !== undefined && (n < f.min || n > f.max)) msg = `Enter a number from ${f.min} to ${f.max}.`;
  else if (n < f.min) msg = `Enter ${f.min} or more.`;
  setError(f, msg);
  return msg ? null : n;
}

function collect() {
  const payload = {};
  let firstBad = null;
  for (const f of FIELDS) {
    const v = validateField(f);
    if (v === null) firstBad = firstBad || f; else payload[f.id] = v;
  }
  return { payload, firstBad };
}

FIELDS.forEach((f) => {
  const el = $("#" + f.id);
  el.addEventListener("blur", () => validateField(f));
  el.addEventListener("input", () => { if ($("#f-" + f.id).classList.contains("invalid")) validateField(f); });
});

/* ---------- Banner / loading ---------- */
function showBanner(msg) { banner.textContent = msg; banner.hidden = false; }
function hideBanner() { banner.hidden = true; banner.textContent = ""; }
function setLoading(on) {
  submitBtn.disabled = on; spin.hidden = !on;
  btnLabel.textContent = on ? "Checking…" : "Check eligibility";
}

/* ---------- Submit ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideBanner(); result.hidden = true;
  const { payload, firstBad } = collect();
  if (firstBad) { $("#" + firstBad.id).focus(); return showBanner("Fix the highlighted fields and try again."); }

  setLoading(true);
  try {
    const res = await fetch(`${API_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 422) {
      const body = await res.json().catch(() => ({}));
      return showBanner(describe422(body.detail));
    }
    if (!res.ok) return showBanner(`The server returned an error (${res.status}). Check the FastAPI terminal for details.`);
    showResult(await res.json());
  } catch {
    showBanner("Cannot reach the server. Start FastAPI with: uvicorn main:app --reload");
    checkHealth();
  } finally {
    setLoading(false);
  }
});

function describe422(detail) {
  if (!Array.isArray(detail) || !detail.length) return "The server rejected the input. Check every field.";
  const parts = detail.map((d) => {
    const key = d.loc && d.loc[d.loc.length - 1];
    const f = FIELDS.find((x) => x.id === key);
    if (f) setError(f, d.msg);
    return `${f ? f.label : key}: ${d.msg}`;
  });
  return "Invalid input. " + parts.join(" | ");
}

/* ---------- Result ---------- */
function showResult(r) {
  const ok = r.prediction === "Approved";
  const prob = Math.max(0, Math.min(100, Number(r.approval_probability) || 0));
  const C = 2 * Math.PI * 52;

  result.className = "result " + (ok ? "approved" : "rejected");
  result.innerHTML = `
    <div class="gauge" role="img" aria-label="Approval probability ${prob} percent">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle class="track" cx="60" cy="60" r="52"></circle>
        <circle class="bar" cx="60" cy="60" r="52" stroke-dasharray="${C}" stroke-dashoffset="${C}"></circle>
      </svg>
      <div class="pct"><div><span id="pct">0</span>%<small>approval chance</small></div></div>
    </div>
    <div class="verdict">
      <div class="icon" aria-hidden="true"><span>${ok ? "✓" : "✕"}</span></div>
      <h2>${ok ? "Loan Approved" : "Loan Rejected"}</h2>
      <p>The model estimates a ${+prob.toFixed(2)}% chance of approval.</p>
      <small>Prediction from a student ML model, not financial advice.</small>
    </div>`;
  result.hidden = false;
  result.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });

  const bar = result.querySelector(".bar");
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.strokeDashoffset = C * (1 - prob / 100); }));
  countUp($("#pct"), prob);
}

function countUp(el, to) {
  if (reduceMotion) { el.textContent = to.toFixed(1); return; }
  const t0 = performance.now(), dur = 900;
  const tick = (t) => {
    const p = Math.min((t - t0) / dur, 1);
    el.textContent = (to * (1 - Math.pow(1 - p, 3))).toFixed(1);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------- Example / Reset ---------- */
$("#example").addEventListener("click", () => {
  hideBanner();
  FIELDS.forEach((f) => { $("#" + f.id).value = EXAMPLE[f.id]; setError(f, ""); });
});
$("#reset").addEventListener("click", () => {
  form.reset(); hideBanner(); result.hidden = true;
  FIELDS.forEach((f) => setError(f, ""));
});

/* ---------- API status ---------- */
async function checkHealth() {
  const badge = $("#status");
  try {
    const res = await fetch(`${API_URL}/health`);
    if (!res.ok) throw new Error();
    badge.textContent = "API connected"; badge.className = "badge ok";
  } catch {
    badge.textContent = "API offline"; badge.className = "badge off";
  }
}
checkHealth();

/* ---------- Dark mode (kept in a variable, not localStorage) ---------- */
let dark = matchMedia("(prefers-color-scheme: dark)").matches;
function applyTheme() {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const btn = $("#theme");
  btn.textContent = dark ? "Light mode" : "Dark mode";
  btn.setAttribute("aria-pressed", String(dark));
}
$("#theme").addEventListener("click", () => { dark = !dark; applyTheme(); });
applyTheme();