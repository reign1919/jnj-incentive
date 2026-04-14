// ═══════════════════════════════════════════════════════════════
//  J&J RB INCENTIVE CALCULATOR — FRONTEND CONTROLLER
//  app.js
// ═══════════════════════════════════════════════════════════════

// ── NAVIGATION ─────────────────────────────────────────────────

function goTo(n) {
  if (n > State.maxUnlocked || n < 1 || n > 5) return;
  State.currentStep = n;

  document.querySelectorAll(".stage").forEach(s => s.classList.remove("on"));
  const panel = document.getElementById("stage-" + n);
  if (panel) { panel.classList.add("on"); window.scrollTo({ top:0, behavior:"smooth" }); }

  document.querySelectorAll(".st").forEach((t, i) => {
    const s = i + 1;
    t.classList.remove("active","done","locked");
    if      (s < n)                      t.classList.add("done");
    else if (s === n)                    t.classList.add("active");
    else if (s > State.maxUnlocked)      t.classList.add("locked");
  });

  const bar = document.getElementById("progress-fill");
  if (bar) bar.style.width = ((n-1)/4*100) + "%";
}

function advanceTo(n) {
  const v = Validators["step" + State.currentStep];
  if (v) {
    const errs = v();
    if (errs.length) { showErrors(errs); return false; }
  }
  clearErrors();
  if (n > State.maxUnlocked) State.maxUnlocked = n;
  goTo(n);
  return true;
}

// ── TOAST ──────────────────────────────────────────────────────

function showErrors(errors) {
  let t = document.getElementById("error-toast");
  if (t) t.remove();
  t = document.createElement("div");
  t.id = "error-toast"; t.className = "error-toast";
  t.innerHTML = errors.map(e => `<span class="et-row">⚠ ${e}</span>`).join("");
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("visible"));
  setTimeout(() => { t.classList.remove("visible"); setTimeout(() => t.remove(), 400); }, 5000);
}

function clearErrors() {
  const t = document.getElementById("error-toast");
  if (t) { t.classList.remove("visible"); setTimeout(() => t.remove(), 400); }
}

// ── STAGE 1: QUALIFICATION ──────────────────────────────────────

function onQualInput() {
  const a = parseFloat(document.getElementById("qual-actual").value);
  const t = parseFloat(document.getElementById("qual-target").value);
  State.qualActual = isNaN(a) ? null : a;
  State.qualTarget = isNaN(t) ? null : t;
  // Reset mode when inputs change
  State.qualMode = null;

  const resultEl  = document.getElementById("qual-result");
  const proceedEl = document.getElementById("qual-proceed");
  const missedEl  = document.getElementById("qual-missed");

  if (State.qualActual === null || State.qualTarget === null || State.qualTarget <= 0) {
    resultEl.innerHTML = "";
    proceedEl.style.display = "none";
    missedEl.style.display  = "none";
    return;
  }

  const pct       = getQualPct();
  const qualified = pct >= POLICY.thresholdPct;
  const cls       = pct >= 100 ? "ok" : qualified ? "warn" : "bad";

  resultEl.innerHTML = `
    <div class="qual-result-row">
      <span class="qual-pct ${cls}">${pct.toFixed(1)}%</span>
      <span class="qual-pct-label">Achievement this quarter</span>
      <span class="badge ${qualified ? "badge-ok" : "badge-fail"}" style="margin-left:12px;">
        ${qualified ? "✓ Qualified" : "⛔ Below 90%"}
      </span>
    </div>`;

  // Update "other quarter" label dynamically
  const otherLabel = document.getElementById("other-qtr-label");
  if (otherLabel) {
    otherLabel.textContent = State.quarter === "Q1 2026" ? "Q2" : State.quarter === "Q2 2026" ? "Q1" : "other";
  }

  proceedEl.style.display = qualified ? "block" : "none";
  missedEl.style.display  = qualified ? "none"  : "block";
}

function setQualMode(mode) {
  // mode = "normal" | "winback"
  State.qualMode = mode;
  if (mode === "winback") {
    // In win-back only mode:
    // The CURRENT (missed) quarter's data will go into otherQActuals in Step 3
    // The OTHER (qualified) quarter's data goes in actuals
    // We pre-enable win-back
    State.winbackEnabled = true;
  }
}

// ── STAGE 2: TV TARGET → BAND ───────────────────────────────────

function renderBandTable() {
  const tbody = document.getElementById("band-tbody");
  if (!tbody) return;
  tbody.innerHTML = BANDS.map(b => `
    <tr id="brow-${b.id}">
      <td class="band-cell">${b.id}</td>
      <td>${Fmt.range(...b.tv)}</td>
      <td class="mult-cell"><strong>${b.mult}×</strong></td>
    </tr>`).join("");
}

function onTVChange(rawVal) {
  const tv = parseFloat(rawVal);
  State.tvTarget = (!rawVal || isNaN(tv) || tv <= 0) ? null : tv;

  BANDS.forEach(b => {
    const r = document.getElementById("brow-" + b.id);
    if (r) r.classList.remove("active-band");
  });

  if (!State.tvTarget) { updateBandDisplay(null); State.detectedBand = null; return; }

  const band = detectBandByTV(State.tvTarget);
  State.detectedBand = band;
  updateBandDisplay(band);
  const row = document.getElementById("brow-" + band.id);
  if (row) row.classList.add("active-band");
}

function updateBandDisplay(band) {
  const el = document.getElementById("band-display");
  if (!el) return;
  if (!band) {
    el.innerHTML = `<span class="bd-placeholder">Enter target above →</span>`;
    el.className = "band-display";
    return;
  }
  el.innerHTML = `
    <span class="bd-band">Band ${band.id}</span>
    <span class="bd-mult">${band.mult}×</span>
    <span class="bd-label">Target Multiplier</span>`;
  el.className = "band-display detected";
}

// ── STAGE 3: BRAND ACTUALS + TARGETS ────────────────────────────
// Each product row: actual input + target input → compute % live.
// All reads go through getPct(id) from logic.js — no order dependency.

function renderBrandTable() {
  const wrap = document.getElementById("ach-wrap");
  if (!wrap) return;

  const isWinbackOnly = State.qualMode === "winback";
  const curQLabel     = State.quarter || "This Quarter";
  const othQLabel     = State.otherQuarter;

  // Always show winback section (both Q1 and Q2 can use it)
  const wbSection = document.getElementById("winback-section-step3");
  if (wbSection) wbSection.style.display = "block";

  // Update winback toggle text and inputs description
  const wbToggleText = document.getElementById("wb-toggle-text");
  const wbInputsDesc = document.getElementById("wb-inputs-desc");
  if (wbToggleText) {
    wbToggleText.textContent = isWinbackOnly
      ? `${othQLabel} data — H1 Win-Back (required)`
      : `I also missed ${othQLabel} — check H1 Win-Back eligibility`;
  }
  if (wbInputsDesc) {
    wbInputsDesc.innerHTML = `Enter your <strong>${othQLabel} actuals and targets</strong> per component to check H1 combined eligibility.`;
  }

  // In winback-only mode, auto-enable and show the winback inputs
  if (isWinbackOnly) {
    State.winbackEnabled = true;
    const wbCb = document.getElementById("wb-enabled");
    if (wbCb) wbCb.checked = true;
    const wbInputs = document.getElementById("wb-inputs");
    if (wbInputs) wbInputs.style.display = "block";
  }

  // Update notice at top
  const q2notice = document.getElementById("q2-notice");
  if (q2notice) {
    q2notice.style.display = "block";
    if (isWinbackOnly) {
      q2notice.innerHTML = `
        <div class="notice warn" style="margin-top:0;margin-bottom:18px;">
          <span class="ni">🔄</span>
          <div>
            <strong>Win-Back Mode:</strong> You missed <strong>${curQLabel}</strong>.
            Enter your <strong>${othQLabel}</strong> data below (the quarter you qualified).
            Then scroll down to enter ${curQLabel} data for the win-back check.
            If H1 combined ≥ 100%, the missed quarter is recovered at 1.00× factor.
          </div>
        </div>`;
    } else {
      q2notice.innerHTML = `
        <div class="notice info" style="margin-top:0;margin-bottom:18px;">
          <span class="ni">💡</span>
          <div>
            Calculating <strong>${curQLabel}</strong>. If you also missed <strong>${othQLabel}</strong>,
            scroll down to check H1 Win-Back eligibility.
          </div>
        </div>`;
    }
  }

  // Section label
  const q2label = document.getElementById("q2-label");
  if (q2label) q2label.textContent = curQLabel + " — ";

  wrap.innerHTML = `
    <table class="ach-table">
      <thead>
        <tr>
          <th class="col-prod">Component</th>
          <th>Actual (₹L)</th>
          <th>Target (₹L)</th>
          <th>Achievement %</th>
          <th>Payout Factor</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${PRODUCTS.map(p => `
          <tr id="ach-row-${p.id}" class="ach-row">
            <td class="prod-cell">
              <span class="prod-name">${p.label}</span>
              <span class="prod-meta">${Math.round(p.weight*100)}% weight · ${p.freq === "Q" ? "Quarterly" : "Annual"} · Base: ${Fmt.inr(p.base)}</span>
            </td>
            <td class="input-cell">
              <input type="number" id="actual-${p.id}" class="ach-input"
                placeholder="Actual" min="0" step="0.1"
                value="${State.actuals[p.id] !== null ? State.actuals[p.id] : ""}"
                oninput="onBrandInput('${p.id}')">
            </td>
            <td class="input-cell">
              <input type="number" id="target-${p.id}" class="ach-input"
                placeholder="Target" min="0" step="0.1"
                value="${State.brandTargets[p.id] !== null ? State.brandTargets[p.id] : ""}"
                oninput="onBrandInput('${p.id}')">
            </td>
            <td class="pct-cell" id="pct-${p.id}">—</td>
            <td class="factor-cell" id="fac-${p.id}">—</td>
            <td class="status-cell" id="stat-${p.id}"></td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  PRODUCTS.forEach(p => refreshBrandRow(p.id));
  if (isWinbackOnly) renderWinbackTable();
}

// ── WIN-BACK UI ─────────────────────────────────────────────────

function onWinbackToggle(enabled) {
  State.winbackEnabled = enabled;
  const wbInputs = document.getElementById("wb-inputs");
  if (wbInputs) wbInputs.style.display = enabled ? "block" : "none";
  if (enabled) renderWinbackTable();
}

function renderWinbackTable() {
  const wrap = document.getElementById("wb-wrap");
  if (!wrap) return;
  const othQLabel = State.otherQuarter;
  wrap.innerHTML = `
    <table class="ach-table">
      <thead>
        <tr>
          <th class="col-prod">Component</th>
          <th>${othQLabel} Actual (₹L)</th>
          <th>${othQLabel} Target (₹L)</th>
          <th>H1 Combined %</th>
          <th>Win-Back Status</th>
        </tr>
      </thead>
      <tbody>
        ${PRODUCTS.map(p => `
          <tr id="wb-row-${p.id}" class="ach-row">
            <td class="prod-cell">
              <span class="prod-name">${p.label}</span>
              <span class="prod-meta">${Math.round(p.weight*100)}% weight</span>
            </td>
            <td class="input-cell">
              <input type="number" id="wba-${p.id}" class="ach-input"
                placeholder="Actual" min="0" step="0.1"
                value="${State.otherQActuals[p.id] !== null ? State.otherQActuals[p.id] : ""}"
                oninput="onWBInput('${p.id}')">
            </td>
            <td class="input-cell">
              <input type="number" id="wbt-${p.id}" class="ach-input"
                placeholder="Target" min="0" step="0.1"
                value="${State.otherQTargets[p.id] !== null ? State.otherQTargets[p.id] : ""}"
                oninput="onWBInput('${p.id}')">
            </td>
            <td class="pct-cell" id="wb-pct-${p.id}">—</td>
            <td class="status-cell" id="wb-stat-${p.id}"></td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  PRODUCTS.forEach(p => refreshWBRow(p.id));
}

function onWBInput(id) {
  const a = parseFloat(document.getElementById("wba-" + id).value);
  const t = parseFloat(document.getElementById("wbt-" + id).value);
  State.otherQActuals[id] = isNaN(a) ? null : a;
  State.otherQTargets[id] = isNaN(t) ? null : t;
  refreshWBRow(id);
}

function refreshWBRow(id) {
  const pctEl  = document.getElementById("wb-pct-"  + id);
  const statEl = document.getElementById("wb-stat-" + id);
  if (!pctEl || !statEl) return;

  const curA = State.actuals[id];
  const curT = State.brandTargets[id];
  const othA = State.otherQActuals[id];
  const othT = State.otherQTargets[id];

  if (curA === null || curT === null || othA === null || othT === null) {
    pctEl.textContent = "—"; pctEl.className = "pct-cell";
    statEl.innerHTML = "";
    return;
  }

  const h1Pct    = computePct(curA + othA, curT + othT);
  const eligible = h1Pct !== null && h1Pct >= 100;
  pctEl.textContent = Fmt.pct(h1Pct);
  pctEl.className   = "pct-cell " + (eligible ? "ok" : "bad");
  statEl.innerHTML  = eligible
    ? `<span class="badge badge-ok">✓ Win-back eligible</span>`
    : `<span class="badge badge-fail">✗ H1 < 100%</span>`;
}

function onBrandInput(id) {
  const aEl = document.getElementById("actual-" + id);
  const tEl = document.getElementById("target-" + id);
  const a = parseFloat(aEl.value);
  const t = parseFloat(tEl.value);
  // Always update state immediately — no order dependency
  State.actuals[id]      = isNaN(a) ? null : a;
  State.brandTargets[id] = isNaN(t) ? null : t;
  refreshBrandRow(id);
}

function refreshBrandRow(id) {
  const pctEl  = document.getElementById("pct-"  + id);
  const facEl  = document.getElementById("fac-"  + id);
  const statEl = document.getElementById("stat-" + id);
  const rowEl  = document.getElementById("ach-row-" + id);
  if (!pctEl || !facEl || !statEl || !rowEl) return;

  const pct = getPct(id);  // always computed fresh from State

  if (pct === null) {
    pctEl.textContent = "—";  pctEl.className = "pct-cell";
    facEl.textContent = "—";  statEl.innerHTML = "";
    rowEl.className   = "ach-row";
    return;
  }

  const curve = getPayoutFactor(pct);
  const cls   = pct >= 100 ? "ok" : pct >= 90 ? "warn" : "bad";

  pctEl.textContent = pct.toFixed(1) + "%";
  pctEl.className   = "pct-cell " + cls;
  facEl.textContent = curve ? curve.factor.toFixed(2) + "×" : "—";
  rowEl.className   = "ach-row " + cls;
  statEl.innerHTML  = pct < POLICY.thresholdPct
    ? `<span class="badge badge-fail">⛔ Below 90%</span>`
    : `<span class="badge badge-ok">✓ Qualified</span>`;
}

function renderCurveTable() {
  const wrap = document.getElementById("curve-wrap");
  if (!wrap) return;
  wrap.innerHTML = `
    <table class="curve-table" id="curve-table">
      <thead><tr><th>Achievement Range</th><th>Payout Factor</th><th>Earnings on ₹1,00,000</th></tr></thead>
      <tbody>
        ${PAYOUT_CURVE.map(c => `
          <tr>
            <td>${c.lo === 0 ? "< 90%" : c.hi >= 1e9 ? "≥ 130%" : c.lo + "% – " + c.hi + "%"}</td>
            <td class="${c.factor === 0 ? "no-pay" : "factor-val"}">${c.factor === 0 ? "Zero payout" : c.factor.toFixed(2) + "×"}</td>
            <td class="${c.factor === 0 ? "no-pay" : ""}">₹${(1e5*c.factor).toLocaleString("en-IN")}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

// ── STAGE 4: SFE ────────────────────────────────────────────────

function onSFEInput() {
  const eiRaw = document.getElementById("ei").value;
  const riRaw = document.getElementById("ri").value;
  State.ei = eiRaw === "" ? null : parseFloat(eiRaw);
  State.ri = riRaw === "" ? null : parseFloat(riRaw);

  const score   = calcSFEScore(State.ei, State.ri);
  State.sfeScore = score;
  State.sfeTier  = getSFETier(score);

  const scoreEl = document.getElementById("sfe-score-val");
  const pctEl   = document.getElementById("sfe-pct-val");
  const badgeEl = document.getElementById("sfe-badge");
  const noteEl  = document.getElementById("sfe-note");
  const meterEl = document.getElementById("sfe-meter-fill");
  if (!scoreEl) return;

  if (score === null) {
    scoreEl.textContent = "—"; pctEl.textContent = "—";
    if (badgeEl) badgeEl.textContent = "";
    if (noteEl)  noteEl.textContent  = "";
    if (meterEl) meterEl.style.width = "0%";
    return;
  }

  const tier = State.sfeTier;
  scoreEl.textContent = Fmt.score(score);
  pctEl.textContent   = tier.label;
  if (badgeEl) { badgeEl.textContent = tier.desc; badgeEl.className = "sfe-badge sfe-" + tier.cls; }
  if (noteEl)  noteEl.textContent = tier.cls === "high" ? "No deduction. Full incentive earned." : `${tier.cls === "mid" ? "10%" : "20%"} deduction applied.`;
  if (meterEl) meterEl.style.width = Math.min(score, 100) + "%";

  document.querySelectorAll(".sfe-ref-row").forEach(r => r.classList.remove("hl-row"));
  const idx = tier.cls === "low" ? 0 : tier.cls === "mid" ? 1 : 2;
  const refs = document.querySelectorAll(".sfe-ref-row");
  if (refs[idx]) refs[idx].classList.add("hl-row");
}

// ── STAGE 5: RESULTS ────────────────────────────────────────────

function renderResults() {
  const result = calculateIncentive();
  State.result = result;

  const metaEl = document.getElementById("result-meta");
  if (metaEl) {
    metaEl.innerHTML = `
      <div class="result-meta-row">
        <span class="meta-name">${State.employeeName || "Employee"}</span>
        <span class="meta-tags">
          <span class="meta-tag">${State.quarter || "—"}</span>
          <span class="meta-tag">Band ${result.band ? result.band.id : "—"} · ${result.tFactor}×</span>
          <span class="meta-tag">SFE ${Fmt.score(State.sfeScore)} → ${result.sfeTier ? result.sfeTier.label : "—"}</span>
        </span>
      </div>`;
  }

  // KPI cards — one main box: quarterly incentive = grandTotal / 2
  const quarterlyIncentive = result.grandTotal / 2;
  const kpiEl = document.getElementById("result-kpis");
  if (kpiEl) {
    kpiEl.innerHTML = `
      <div class="kpi-card main">
        <div class="kc-label">Quarterly Incentive</div>
        <div class="kc-value">${Fmt.inr(quarterlyIncentive)}</div>
        <div class="kc-sub">H1 Total ${Fmt.inr(result.grandTotal)} ÷ 2</div>
      </div>
      ${result.winback && result.winback.anyEligible ? `
      <div class="kpi-card" style="border-color:var(--amber-bdr);background:var(--gold-bg);">
        <div class="kc-label">Win-Back Recovered</div>
        <div class="kc-value" style="color:var(--gold);">${Fmt.inr(result.winback.totalWinback)}</div>
        <div class="kc-sub">H1 combined ≥ 100%</div>
      </div>` : ""}
      <div class="kpi-card">
        <div class="kc-label">Target Band</div>
        <div class="kc-value">Band ${result.band ? result.band.id : "—"}</div>
        <div class="kc-sub">${result.tFactor}× multiplier</div>
      </div>
      <div class="kpi-card">
        <div class="kc-label">SFE Factor</div>
        <div class="kc-value">${result.sfeTier ? result.sfeTier.label : "—"}</div>
        <div class="kc-sub">Score: ${Fmt.score(State.sfeScore)}</div>
      </div>`;
  }

  const brEl = document.getElementById("breakdown-body");
  if (brEl) {
    brEl.innerHTML = result.rows.map(r => `
      <tr class="${r.total === 0 ? "zero-row" : ""}">
        <td class="br-prod">
          <strong>${r.label}</strong>
          <span class="br-wt">${Math.round(r.weight*100)}%</span>
          <span style="font-size:10px;color:var(--stone);margin-left:4px;">${Fmt.inr(r.base)}</span>
        </td>
        <td>${result.tFactor}×</td>
        <td class="${r.pct !== null ? (r.pct >= 100 ? "ok" : r.pct >= 90 ? "warn" : "bad") : ""}">${Fmt.pct(r.pct)}</td>
        <td>${r.curve ? r.curve.factor.toFixed(2) + "×" : "—"}</td>
        <td>${result.sfeTier ? Math.round(result.sfeTier.mult*100) + "%" : "—"}</td>
        <td class="br-total">${Fmt.inr(r.total)}</td>
      </tr>`).join("") + `
      <tr class="total-row">
        <td colspan="5"><strong>${State.quarter || "Quarter"} Incentive</strong></td>
        <td class="br-total grand">${Fmt.inr(result.quarterTotal)}</td>
      </tr>`;
  }

  // Win-back breakdown
  const wbEl = document.getElementById("winback-section");
  if (wbEl) {
    if (result.winback && State.winbackEnabled) {
      const wb = result.winback;
      wbEl.innerHTML = `
        <div class="fr-card" style="background:linear-gradient(135deg,#f0fff4,#e8f5ee);border-color:var(--green-bdr);margin-top:18px;">
          <div class="fr-title" style="color:var(--green);">🔄 H1 Win-Back — Q1 Recovery</div>
          <p style="font-size:12.5px;color:#1a4a28;margin-bottom:12px;">
            ${wb.anyEligible
              ? `Win-back <strong>triggered</strong> — H1 combined ≥ 100% on eligible components. Q1 recovered at 1.00× achievement factor (capped).`
              : `Win-back <strong>not triggered</strong> — H1 combined did not reach 100% on any component.`}
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
            <thead>
              <tr style="background:rgba(10,105,48,.08);">
                <th style="padding:8px 12px;text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--green);">Component</th>
                <th style="padding:8px 12px;text-align:center;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--green);">H1 Combined %</th>
                <th style="padding:8px 12px;text-align:center;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--green);">Eligible?</th>
                <th style="padding:8px 12px;text-align:right;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;color:var(--green);">Q1 Recovered</th>
              </tr>
            </thead>
            <tbody>
              ${wb.productResults.map(r => `
                <tr style="border-top:1px solid var(--green-bdr);">
                  <td style="padding:8px 12px;font-weight:600;">${r.label}</td>
                  <td style="padding:8px 12px;text-align:center;font-family:var(--font-mono);font-weight:700;color:${r.eligible ? "var(--green)" : "var(--crimson)"};">${r.h1Pct !== null ? r.h1Pct.toFixed(1) + "%" : "—"}</td>
                  <td style="padding:8px 12px;text-align:center;">${r.eligible ? '<span class="badge badge-ok">✓ Yes</span>' : r.reason === "incomplete" ? '<span style="color:var(--pewter);font-size:11px;">No Q1 data</span>' : '<span class="badge badge-fail">✗ No</span>'}</td>
                  <td style="padding:8px 12px;text-align:right;font-family:var(--font-mono);font-weight:700;color:${r.eligible ? "var(--green)" : "var(--pewter)"};">${r.eligible ? Fmt.inr(r.winbackAmount) : "—"}</td>
                </tr>`).join("")}
              <tr style="border-top:2px solid var(--green);background:rgba(10,105,48,.06);">
                <td colspan="3" style="padding:9px 12px;font-weight:700;">Total Q1 Win-Back Recovered</td>
                <td style="padding:9px 12px;text-align:right;font-family:var(--font-mono);font-weight:700;font-size:14px;color:var(--green);">${Fmt.inr(wb.totalWinback)}</td>
              </tr>
            </tbody>
          </table>
        </div>`;
    } else {
      wbEl.innerHTML = `
        <div class="notice warn" style="margin-top:14px;">
          <span class="ni">🔄</span>
          <div><strong>Win-back:</strong> Only available in Q2. If Q1 was missed but H1 combined (Q1+Q2) reaches ≥ 100%, Q1 can be recovered at 1.00× factor.</div>
        </div>`;
    }
  }

  renderProductCharts(result);

  document.getElementById("fr-section").innerHTML = `
    <div class="fr-card">
      <div class="fr-title">⭐ Fast Runners' Incentive <span class="fr-amount">₹15,000</span></div>
      <p style="font-size:12.5px;color:#5c3d00;">Paid over &amp; above base incentive. Evaluated at H1 end (June).</p>
      <div class="fr-grid">
        <div class="fr-crit"><span class="fr-crit-icon">📌</span><div>H1 sales achievement (June) must be <strong>≥ 110%</strong></div></div>
        <div class="fr-crit"><span class="fr-crit-icon">📌</span><div>Sales &gt;100% for <strong>≥ 4 months out of 6</strong>, OR <strong>both Q1 &amp; Q2</strong></div></div>
      </div>
    </div>`;
}

function renderProductCharts(result) {
  const wrap = document.getElementById("bar-chart");
  if (!wrap) return;

  const BAR_H = 88; // max bar height px

  wrap.innerHTML = result.rows.map((r, ri) => {
    // Build bars for every curve band using this product's base amount
    const bars = PAYOUT_CURVE.map((c, ci) => {
      const earnAt = r.base * result.tFactor * c.factor * result.sFactor;
      const maxEarn = r.base * result.tFactor * 1.50 * result.sFactor;
      const h = earnAt > 0 ? Math.max(6, Math.round((earnAt / Math.max(maxEarn, 1)) * BAR_H)) : 4;
      const label = c.lo === 0 ? "<90%" : c.hi >= 1e9 ? "≥130%" : c.lo + "–" + c.hi + "%";
      const isActive = r.pct !== null && r.pct >= c.lo && r.pct < c.hi;
      const barCls = c.factor === 0 ? "pc-bar zero" : isActive ? "pc-bar active" : "pc-bar";
      return { c, ci, earnAt, h, label, isActive, barCls };
    });

    const pctDisplay = r.pct !== null ? r.pct.toFixed(1) + "%" : "—";
    const earnDisplay = r.total > 0 ? Fmt.inr(r.total) : (r.pct !== null && r.pct < 90 ? "₹0 (below threshold)" : "—");
    const statusCls = r.pct === null ? "" : r.pct >= 100 ? "ok" : r.pct >= 90 ? "warn" : "bad";

    return `
      <div class="pc-card" style="animation-delay:${ri * 80}ms">
        <div class="pc-header">
          <div class="pc-name">${r.label}</div>
          <div class="pc-meta">
            <span class="pc-weight">${Math.round(r.weight*100)}% weight</span>
            <span class="pc-base">Base: ${Fmt.inr(r.base)}</span>
          </div>
        </div>
        <div class="pc-stats">
          <div class="pc-stat">
            <div class="pc-stat-label">Achievement</div>
            <div class="pc-stat-val ${statusCls}">${pctDisplay}</div>
          </div>
          <div class="pc-stat">
            <div class="pc-stat-label">Factor</div>
            <div class="pc-stat-val">${r.curve && r.curve.factor > 0 ? r.curve.factor.toFixed(2) + "×" : "—"}</div>
          </div>
          <div class="pc-stat">
            <div class="pc-stat-label">Earned</div>
            <div class="pc-stat-val ${r.total > 0 ? "ok" : ""}">${r.total > 0 ? Fmt.inr(r.total) : r.pct !== null && r.pct < 90 ? "₹0" : "—"}</div>
          </div>
        </div>
        <div class="pc-chart-scroll">
        <div class="pc-chart">
          ${bars.map(b => `
            <div class="pc-col">
              <div class="pc-earn">${b.earnAt > 0 ? "₹" + Math.round(b.earnAt / 1000) + "k" : "—"}</div>
              <div class="pc-bar-wrap" style="height:${BAR_H}px;">
                <div class="${b.barCls}" data-h="${b.h}"
                  style="height:4px; transition:height .6s cubic-bezier(0.34,1.4,0.64,1) ${ri*60 + b.ci*40}ms;">
                </div>
              </div>
              <div class="pc-range${b.isActive ? " active-label" : ""}">${b.label}</div>
            </div>`).join("")}
        </div>
        </div>
      </div>`;
  }).join("");

  // Animate bars + auto-scroll each chart to active bar
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      wrap.querySelectorAll(".pc-bar[data-h]").forEach(b => {
        b.style.height = b.dataset.h + "px";
      });
      // After animation settles, scroll each chart to center its active bar
      setTimeout(() => {
        wrap.querySelectorAll(".pc-chart-scroll").forEach(scroll => {
          const activeCol = scroll.querySelector(".pc-bar.active");
          if (!activeCol) return;
          const col = activeCol.closest(".pc-col");
          if (!col) return;
          // Center the active column in the scroll container
          const scrollLeft = col.offsetLeft - (scroll.clientWidth / 2) + (col.clientWidth / 2);
          scroll.scrollTo({ left: Math.max(0, scrollLeft), behavior: "smooth" });
        });
      }, 700); // wait for bar grow animation to finish
    });
  });
}

// ── RESET ────────────────────────────────────────────────────────

function resetAll() {
  State.reset();
  document.querySelectorAll("input[type=number], input[type=text]").forEach(el => { el.value = ""; });
  document.querySelectorAll("select").forEach(el => el.value = "");
  // Reset win-back UI
  const wbCb = document.getElementById("wb-enabled");
  if (wbCb) wbCb.checked = false;
  const wbInputs = document.getElementById("wb-inputs");
  if (wbInputs) wbInputs.style.display = "none";
  const wbWrap = document.getElementById("wb-wrap");
  if (wbWrap) wbWrap.innerHTML = "";
  const wbResult = document.getElementById("wb-result");
  if (wbResult) wbResult.innerHTML = "";
  const qr = document.getElementById("qual-result");
  const qp = document.getElementById("qual-proceed");
  const qm = document.getElementById("qual-missed");
  if (qr) qr.innerHTML = "";
  if (qp) qp.style.display = "none";
  if (qm) qm.style.display = "none";
  // Reset band display
  updateBandDisplay(null);
  BANDS.forEach(b => { const r = document.getElementById("brow-"+b.id); if(r) r.classList.remove("active-band"); });
  // Reset SFE display
  ["sfe-score-val","sfe-pct-val"].forEach(id => { const el=document.getElementById(id); if(el) el.textContent="—"; });
  const meter = document.getElementById("sfe-meter-fill");
  if (meter) meter.style.width = "0%";
  // Re-render brand table fresh
  renderBrandTable();
  goTo(1);
}

// ── DARK MODE ────────────────────────────────────────────────────

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("jnj-theme", isDark ? "dark" : "light");
  document.body.classList.add("theme-transitioning");
  setTimeout(() => document.body.classList.remove("theme-transitioning"), 400);
}

function initTheme() {
  if (localStorage.getItem("jnj-theme") === "dark") document.body.classList.add("dark");
}

// ═══════════════════════════════════════════════════════════════
//  PDF EXPORT
// ═══════════════════════════════════════════════════════════════

function exportPDF() {
  if (!State.result) { showErrors(["Please calculate your incentive first."]); return; }
  const overlay = showPDFOverlay();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try { buildPrintTemplate(State.result); }
      catch(e) { overlay.remove(); showErrors(["PDF error: " + e.message]); return; }
      setTimeout(() => {
        overlay.remove();
        window.print();
        const pt = document.getElementById("print-template"); if(pt) pt.innerHTML = "";
        const pr = document.getElementById("print-root");      if(pr) pr.remove();
      }, 80);
    });
  });
}

function showPDFOverlay() {
  const o = document.createElement("div");
  o.className = "pdf-overlay";
  o.innerHTML = `<div class="pdf-modal"><div class="pdf-spinner"></div><h3>Preparing your report…</h3><p>Building a print-ready PDF of your H1 2026 incentive calculation.</p></div>`;
  document.body.appendChild(o);
  requestAnimationFrame(() => o.classList.add("visible"));
  return o;
}

function buildPrintTemplate(result) {
  const ex = document.getElementById("print-root"); if(ex) ex.remove();
  const emp    = State.employeeName || "Employee";
  const qtr    = State.quarter || "H1 2026";
  const band   = result.band ? result.band.id : "—";
  const tFac   = result.tFactor || 1;
  const sfe    = Fmt.score(State.sfeScore);
  const sfePct = result.sfeTier ? result.sfeTier.label : "—";
  const today  = new Date().toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"});
  const maxVal = Math.max(...result.rows.map(r=>r.total), result.grandTotal, 1);

  const barsHTML = [...result.rows, {shortLabel:"Total",label:"Total",total:result.grandTotal,isTotal:true}].map(r => {
    const h  = Math.max(3, Math.round(((r.total||0)/maxVal)*65));
    const bg = r.isTotal ? "#8a0012" : (r.total||0)===0 ? "#e4dbd0" : "#c0001a";
    return `<div class="pdf-bar-wrap">
      <div class="pdf-bar-val">${(r.total||0)>0?"₹"+Math.round(r.total).toLocaleString("en-IN"):"—"}</div>
      <div class="pdf-bar${r.isTotal?" total-b":""}" style="height:${h}px;background:${bg};"></div>
      <div class="pdf-bar-label">${r.shortLabel||r.label}</div>
    </div>`;
  }).join("");

  const sfeFillColor = (State.sfeScore||0)<70?"#c0001a":(State.sfeScore||0)<85?"#d97706":"#0a6930";

  const rowsHTML = result.rows.map(r => {
    const achPct  = Fmt.pct(r.pct);
    const achCls  = r.pct===null?"":r.pct>=100?"pdf-ok":r.pct>=90?"pdf-warn":"pdf-bad";
    const aFacStr = r.aFac!==null && r.aFac!==undefined ? r.aFac.toFixed(2)+"×" : "—";
    const sFact   = result.sfeTier ? Math.round(result.sfeTier.mult*100)+"%" : "—";
    return `<tr class="${r.total===0?"pdf-zero":""}">
      <td><strong>${r.label}</strong><span class="pdf-wt">${Math.round(r.weight*100)}%</span></td>
      <td>${Fmt.inr(r.base)}</td><td>${tFac}×</td>
      <td class="${achCls}">${achPct}</td>
      <td>${aFacStr}</td><td>${sFact}</td><td>${Fmt.inr(r.total)}</td>
    </tr>`;
  }).join("") + `
    <tr class="pdf-total-row"><td colspan="6"><strong>H1 Total</strong></td><td><strong>${Fmt.inr(result.grandTotal)}</strong></td></tr>
    <tr class="pdf-total-row" style="background:#fff0f2;"><td colspan="6"><strong>Quarterly Incentive (÷ 2)</strong></td><td><strong>${Fmt.inr(result.grandTotal / 2)}</strong></td></tr>`;

  const html = `<div id="print-root" class="pdf-report">
    <div class="pdf-header">
      <div>
        <div class="pdf-logo">J&amp;J</div>
        <div class="pdf-title">Incentive Statement — ${qtr}</div>
        <div class="pdf-subtitle">Innovative Medicine · Reimbursed Business · Policy: Jan 2026 – Jun 2026</div>
      </div>
      <div class="pdf-meta-right">
        <span class="pdf-emp">${emp}</span>
        <span class="pdf-date">Generated ${today}</span>
        <span style="display:block;font-size:9px;color:#b8ada0;margin-top:3px;">Indicative · Subject to HR/Finance approval</span>
      </div>
    </div>
    <div class="pdf-summary-strip">
      <div class="pdf-kpi main">
        <div class="pdf-kpi-label">Quarterly Incentive</div>
        <div class="pdf-kpi-value">${Fmt.inr(result.grandTotal / 2)}</div>
        <div class="pdf-kpi-sub">H1 Total ${Fmt.inr(result.grandTotal)} ÷ 2</div>
      </div>
      ${result.winback && result.winback.anyEligible ? `<div class="pdf-kpi" style="background:#f0fff4;"><div class="pdf-kpi-label">Win-Back Recovered</div><div class="pdf-kpi-value" style="color:#0a6930;">${Fmt.inr(result.winback.totalWinback)}</div><div class="pdf-kpi-sub">H1 combined ≥ 100%</div></div>` : ""}
      <div class="pdf-kpi"><div class="pdf-kpi-label">Target Band</div><div class="pdf-kpi-value">Band ${band}</div><div class="pdf-kpi-sub">${tFac}× multiplier</div></div>
      <div class="pdf-kpi"><div class="pdf-kpi-label">SFE Factor</div><div class="pdf-kpi-value">${sfePct}</div><div class="pdf-kpi-sub">Score: ${sfe}</div></div>
    </div>
    <div class="pdf-sec">Visual Breakdown</div>
    <div class="pdf-bars">${barsHTML}</div>
    <div class="pdf-sec">Component Breakdown</div>
    <table class="pdf-table">
      <thead><tr><th>Component</th><th>Base (₹)</th><th>Target Factor</th><th>Achvt %</th><th>Achvt Factor</th><th>SFE Factor</th><th>Total (₹)</th></tr></thead>
      <tbody>${rowsHTML}</tbody>
    </table>
    <div class="pdf-sec">KPI &amp; Policy Details</div>
    <div class="pdf-policy-grid">
      <div class="pdf-policy-item">
        <strong>SFE Score</strong><span>${sfe}</span>
        <div class="pdf-sfe-meter"><div class="pdf-sfe-fill" style="width:${Math.min(State.sfeScore||0,100)}%;background:${sfeFillColor};"></div></div>
        <span style="font-size:9px;color:#8a7d72;">EI: ${State.ei??'—'} · RI: ${State.ri??'—'} · Multiplier: ${sfePct}</span>
      </div>
      <div class="pdf-policy-item"><strong>Base Amount</strong><span>${Fmt.inr(State.baseTotal)}</span><span style="display:block;font-size:9px;color:#8a7d72;margin-top:4px;">Darz 30% · Ryb 20% · Tec 10% · Trem 10% · TV 30%</span></div>
      <div class="pdf-policy-item"><strong>Quarter</strong><span>${qtr}</span><span style="display:block;font-size:9px;color:#8a7d72;margin-top:4px;">Period: Jan 2026 – Jun 2026</span></div>
      <div class="pdf-policy-item"><strong>Win-back</strong><span style="font-size:10px;line-height:1.5;">RB win-back on achieving YTD 100% vs prior quarter. All components eligible.</span></div>
    </div>
    <div class="pdf-fr">
      <div class="pdf-fr-title">⭐ Fast Runners' Incentive — ₹15,000</div>
      <div class="pdf-fr-grid">
        <div class="pdf-fr-crit">📌 H1 achievement (June) must be <strong>≥ 110%</strong></div>
        <div class="pdf-fr-crit">📌 Sales &gt;100% for <strong>≥ 4 months</strong> out of 6 OR <strong>both Q1 &amp; Q2</strong></div>
      </div>
    </div>
    <div class="pdf-footer">
      <div class="pdf-footer-disclaimer">
        • Any product with zero target is considered against H1 target &amp; 20% component (both quarters).<br>
        • SFE KPI computed monthly from iConnect/SFE+ (3rd working day of following month).<br>
        • Indicative. Final payout subject to official HR / Finance approval.
      </div>
      <div class="pdf-footer-stamp"><strong>J&amp;J Innovative Medicine</strong> RB Incentive Calculator</div>
    </div>
  </div>`;

  document.getElementById("print-template").innerHTML = html;
  document.body.appendChild(document.getElementById("print-root"));
}

// ── INIT ─────────────────────────────────────────────────────────

function init() {
  renderBandTable();
  renderBrandTable();
  renderCurveTable();
  document.getElementById("qtr")?.addEventListener("change", e => { State.quarter = e.target.value; });
  document.getElementById("emp")?.addEventListener("input",  e => { State.employeeName = e.target.value; });
  goTo(1);
}

document.addEventListener("DOMContentLoaded", () => { init(); initTheme(); });