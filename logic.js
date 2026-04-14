// ═══════════════════════════════════════════════════════════════
//  J&J RB INCENTIVE CALCULATOR — BACKEND LOGIC
// ═══════════════════════════════════════════════════════════════

const POLICY = {
  period: "Jan 2026 – Jun 2026",
  baseTotal: 200000,
  thresholdPct: 90,
  fastRunnersBonus: 15000,
};

const BANDS = [
  { id:"A", tv:[0,340],    mult:0.8 },
  { id:"B", tv:[340,425],  mult:0.9 },
  { id:"C", tv:[425,650],  mult:1.0 },
  { id:"D", tv:[650,1000], mult:1.1 },
  { id:"E", tv:[1000,1e9], mult:1.2 },
];

const PRODUCTS = [
  { id:"darz", label:"Darzalex IV & SC", shortLabel:"Darzalex",  weight:0.30, base:60000, freq:"Q" },
  { id:"ryb",  label:"Rybrevant",        shortLabel:"Rybrevant", weight:0.20, base:40000, freq:"Q" },
  { id:"tec",  label:"Tecvayli",         shortLabel:"Tecvayli",  weight:0.10, base:20000, freq:"Q" },
  { id:"trem", label:"Tremfya",          shortLabel:"Tremfya",   weight:0.10, base:20000, freq:"Q" },
  { id:"tv",   label:"Total Value",      shortLabel:"Total Val", weight:0.30, base:60000, freq:"Y" },
];

const PAYOUT_CURVE = [
  { lo:0,   hi:90,  factor:0    },
  { lo:90,  hi:95,  factor:0.40 },
  { lo:95,  hi:100, factor:0.60 },
  { lo:100, hi:105, factor:1.00 },
  { lo:105, hi:110, factor:1.10 },
  { lo:110, hi:120, factor:1.25 },
  { lo:120, hi:130, factor:1.40 },
  { lo:130, hi:1e9, factor:1.50 },
];

const SFE_TIERS = [
  { lo:0,  hi:70,  mult:0.80, label:"80%",  cls:"low",  desc:"20% deduction applied" },
  { lo:70, hi:85,  mult:0.90, label:"90%",  cls:"mid",  desc:"10% deduction applied" },
  { lo:85, hi:1e9, mult:1.00, label:"100%", cls:"high", desc:"Full incentive"         },
];

// ── STATE ──────────────────────────────────────────────────────

const State = {
  currentStep: 1,
  maxUnlocked: 1,

  // Step 1
  employeeName: "",
  quarter: "",           // "Q1 2026" or "Q2 2026" — the QUALIFIED quarter
  qualActual: null,
  qualTarget: null,

  // Qualification mode:
  //   "normal"   — qualified this quarter, proceed to full incentive calc
  //   "winback"  — missed this quarter, but other quarter qualified → win-back only
  qualMode: null,

  // Step 2
  tvTarget: null,
  detectedBand: null,

  // Step 3
  // actuals/brandTargets = the QUALIFIED quarter (always)
  actuals:       { darz:null, ryb:null, tec:null, trem:null, tv:null },
  brandTargets:  { darz:null, ryb:null, tec:null, trem:null, tv:null },

  // Win-back — the OTHER (missed) quarter's data
  // Used in both modes:
  //   normal mode:   optional, user toggles if they also missed the other quarter
  //   winback mode:  required — the qualified quarter data goes in actuals above,
  //                  the current (missed) quarter goes here
  winbackEnabled: false,
  otherQActuals:  { darz:null, ryb:null, tec:null, trem:null, tv:null },
  otherQTargets:  { darz:null, ryb:null, tec:null, trem:null, tv:null },

  // Step 4
  ei: null, ri: null, sfeScore: null, sfeTier: null,

  // Step 5
  result: null,

  // Derived — which quarter label is "other"
  get otherQuarter() {
    if (this.quarter === "Q1 2026") return "Q2 2026";
    if (this.quarter === "Q2 2026") return "Q1 2026";
    return "Other Quarter";
  },

  reset() {
    this.currentStep = 1; this.maxUnlocked = 1;
    this.employeeName = ""; this.quarter = "";
    this.qualActual = null; this.qualTarget = null;
    this.qualMode = null;
    this.tvTarget = null; this.detectedBand = null;
    this.actuals      = { darz:null, ryb:null, tec:null, trem:null, tv:null };
    this.brandTargets = { darz:null, ryb:null, tec:null, trem:null, tv:null };
    this.winbackEnabled = false;
    this.otherQActuals = { darz:null, ryb:null, tec:null, trem:null, tv:null };
    this.otherQTargets = { darz:null, ryb:null, tec:null, trem:null, tv:null };
    this.ei = null; this.ri = null; this.sfeScore = null; this.sfeTier = null;
    this.result = null;
  }
};

// ── PURE HELPERS ───────────────────────────────────────────────

function computePct(actual, target) {
  if (actual === null || target === null || isNaN(actual) || isNaN(target) || target <= 0) return null;
  return (actual / target) * 100;
}

// Achievement % for current (qualified) quarter
function getPct(id) {
  return computePct(State.actuals[id], State.brandTargets[id]);
}

function getQualPct() {
  return computePct(State.qualActual, State.qualTarget);
}

function inRange(v, range) { return v >= range[0] && v < range[1]; }

function detectBandByTV(tv) {
  if (!tv || isNaN(tv) || tv <= 0) return null;
  for (const b of BANDS) { if (inRange(tv, b.tv)) return b; }
  return BANDS[BANDS.length - 1];
}

function getPayoutFactor(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return null;
  for (const row of PAYOUT_CURVE) {
    if (pct >= row.lo && pct < row.hi) return row;
  }
  return PAYOUT_CURVE[PAYOUT_CURVE.length - 1];
}

function getCurveRowIndex(pct) {
  if (pct === null || isNaN(pct)) return -1;
  for (let i = 0; i < PAYOUT_CURVE.length; i++) {
    if (pct >= PAYOUT_CURVE[i].lo && pct < PAYOUT_CURVE[i].hi) return i;
  }
  return PAYOUT_CURVE.length - 1;
}

function calcSFEScore(ei, ri) {
  if (ei === null || ri === null || isNaN(ei) || isNaN(ri)) return null;
  return 0.5 * ei + 0.5 * ri;
}

function getSFETier(score) {
  if (score === null) return null;
  for (const t of SFE_TIERS) { if (score >= t.lo && score < t.hi) return t; }
  return SFE_TIERS[SFE_TIERS.length - 1];
}

// ── WIN-BACK ENGINE ────────────────────────────────────────────
// Works both ways:
//   - Normal mode: qualified quarter entered in actuals, missed quarter in otherQActuals
//   - Winback-only mode: same — the ONE qualified quarter goes in actuals,
//     the missed (current) quarter goes in otherQActuals
//
// Per product: (qualActual + otherActual) / (qualTarget + otherTarget) >= 100%
// Recovery: base × tFactor × 1.00 (capped) × sFactor — no upside multiplier
// Qualified quarter: pays normally through full curve

function computeWinback() {
  if (!State.winbackEnabled) return null;

  const band    = State.detectedBand;
  const sfeTier = State.sfeTier;
  const tFactor = band    ? band.mult    : 1.0;
  const sFactor = sfeTier ? sfeTier.mult : 1.0;

  const productResults = PRODUCTS.map(p => {
    const curActual = State.actuals[p.id];
    const curTarget = State.brandTargets[p.id];
    const othActual = State.otherQActuals[p.id];
    const othTarget = State.otherQTargets[p.id];

    if (curActual === null || curTarget === null ||
        othActual === null || othTarget === null) {
      return { ...p, eligible: false, h1Pct: null, winbackAmount: 0, reason: "incomplete" };
    }

    const h1Pct = computePct(curActual + othActual, curTarget + othTarget);

    if (h1Pct === null || h1Pct < 100) {
      return { ...p, eligible: false, h1Pct, winbackAmount: 0,
        reason: `H1 ${h1Pct !== null ? h1Pct.toFixed(1) : "—"}% < 100%` };
    }

    // Recovered missed quarter: capped at 1.00× achievement factor, no upside
    const winbackAmount = p.base * tFactor * 1.00 * sFactor;
    return { ...p, eligible: true, h1Pct, winbackAmount,
      reason: `H1 ${h1Pct.toFixed(1)}% ≥ 100%` };
  });

  const totalWinback = productResults.reduce((s, r) => s + r.winbackAmount, 0);
  const anyEligible  = productResults.some(r => r.eligible);
  return { productResults, totalWinback, anyEligible, tFactor, sFactor };
}

// ── INCENTIVE CALCULATION ──────────────────────────────────────

function calculateIncentive() {
  const band    = State.detectedBand;
  const sfeTier = State.sfeTier;
  const tFactor = band    ? band.mult    : 1.0;
  const sFactor = sfeTier ? sfeTier.mult : 1.0;

  // In winback-only mode, the qualified quarter normal payout still runs
  // (actuals = qualified quarter data entered in Step 3)
  const rows = PRODUCTS.map(p => {
    const base    = p.base;
    const pct     = getPct(p.id);
    const curve   = getPayoutFactor(pct);
    const aFactor = curve ? curve.factor : 0;
    const total   = base * tFactor * aFactor * sFactor;
    return {
      ...p, base, pct, curve, aFactor, tFactor, sFactor, total,
      qualified: pct !== null && pct >= POLICY.thresholdPct,
    };
  });

  const quarterTotal   = rows.reduce((s, r) => s + r.total, 0);
  const qualifiedCount = rows.filter(r => r.qualified).length;
  const winback        = computeWinback();
  const grandTotal     = quarterTotal + (winback ? winback.totalWinback : 0);

  return { rows, quarterTotal, grandTotal, qualifiedCount, tFactor, sFactor, band, sfeTier, winback };
}

// ── VALIDATORS ─────────────────────────────────────────────────

const Validators = {
  step1() {
    const errors = [];
    if (!State.quarter) errors.push("Please select a quarter.");
    // qualMode must be set (user clicked Proceed or Win-Back path)
    if (!State.qualMode) errors.push("Please enter your actual and target values above.");
    return errors;
  },
  step2() {
    if (!State.tvTarget || isNaN(State.tvTarget) || State.tvTarget <= 0)
      return ["Please enter your Annual Total Value target."];
    return [];
  },
  step3() {
    const anyEntered = PRODUCTS.some(p =>
      State.actuals[p.id] !== null && State.brandTargets[p.id] !== null
    );
    if (!anyEntered)
      return ["Please enter actual and target values for at least one component."];
    return [];
  },
  step4() {
    const errors = [];
    if (State.ei === null || isNaN(State.ei)) errors.push("Please enter your Efficiency Index (EI).");
    if (State.ri === null || isNaN(State.ri)) errors.push("Please enter your Reach Index (RI).");
    return errors;
  },
};

// ── FORMATTING ─────────────────────────────────────────────────

const Fmt = {
  inr(n)    { return "₹" + Math.round(n).toLocaleString("en-IN"); },
  pct(n)    { return (n !== null && n !== undefined && !isNaN(n)) ? n.toFixed(1) + "%" : "—"; },
  factor(n) { return (n !== null && n !== undefined && !isNaN(n)) ? n.toFixed(2) + "×" : "—"; },
  score(n)  { return (n !== null && n !== undefined && !isNaN(n)) ? n.toFixed(1) : "—"; },
  range(lo, hi) { return hi >= 1e9 ? "≥ " + lo : lo + " – <" + hi; },
};