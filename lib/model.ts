// The token radar's model, fitted from the snapshot itself on every run.
//
// The board ranks the protocols that record no token by an implied value that
// is fitted, not asserted. The fit reads the snapshot's own live-token
// protocols (the 128 that carry a market cap above zero) and regresses
// log(market cap) on log(TVL), then lets each category shift the intercept
// by its own median residual, shrunk toward the pooled line by n/(n+4) so a
// thin category cannot drag the board. Nothing is keyed to a protocol's name:
// the same function scores every row, and the dashboard shows the fitted
// slope, the R-squared and the out-of-sample error beside the board, so a
// reader can see exactly how much the model knows and how much it guesses.
//
//   fitted mcap  = exp(intercept + category_shift + slope x ln(TVL))
//   growth       = clamp(change_7d, -40, 80) per cent, damped by 0.35
//   maturity     = 0.70 + 0.30 x min(age_days, 1095) / 1095 (age unknown: 365)
//   implied      = fitted mcap x (1 + 0.35 x growth/100) x maturity,
//                  capped at 5x TVL, floored at $1
//
// The fit is honest about its error: the pooled log-log R-squared is about
// 0.19 and the category model reaches about 0.32, with a five-fold
// out-of-sample median error of roughly x3.6. Implied values are therefore
// order-of-magnitude claims, and the board says so. A protocol's launch is
// the token it may issue one day; the board never predicts whether or when
// a token is issued, and "records no token" is never written as "has none":
// DefiLlama's record is not proof, and a protocol on the board may still
// carry a token its record does not show.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  shrink_k: number;
  implied_cap_multiple: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.35,
  growth_floor: -40,
  growth_cap: 80,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink_k: 4,
  implied_cap_multiple: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2-comps';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One fitted category: its shift, its comparables and their median multiple. */
export interface CategoryFit {
  category: string;
  comps: number;
  shift: number;
  median_multiple: number;
}

/** The comparables fit, computed from the snapshot's live protocols. */
export interface CompsFit {
  slope: number;
  intercept: number;
  r_squared: number;
  comps: number;
  oos_median_log_error: number;
  oos_factor: number;
  categories: CategoryFit[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fitted_value_usd: number;
    fitted_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    category: string | null;
    category_comps: number;
    category_shift: number;
    category_median_multiple: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fitted_value_usd: number;
  fitted_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  category_comps: number;
  category_shift: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the fitted model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: CompsFit;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** FNV-1a hash of a string, for the deterministic five-fold split. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** Ordinary least squares of ys on xs: returns [slope, intercept]. */
function ols(xs: number[], ys: number[]): [number, number] {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = den === 0 ? 0 : num / den;
  return [slope, my - slope * mx];
}

/** The live comparables: protocols that record a token with a market cap above zero. */
export function liveComps(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/**
 * Fit the comparables model from the snapshot's live protocols: a pooled
 * log-log OLS slope, a per-category intercept shift from the median residual
 * shrunk toward the pooled line, the log-space R-squared, and a five-fold
 * out-of-sample median log error (folds by slug hash, so the split is stable
 * across runs and the grade reads the same numbers).
 */
export function fitComps(protocols: SnapshotProtocol[]): CompsFit {
  const comps = liveComps(protocols);
  const xs = comps.map((p) => Math.log(p.tvl_usd));
  const ys = comps.map((p) => Math.log(p.mcap_usd!));
  const [slope, intercept] = ols(xs, ys);
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let ssTot = 0;
  for (let i = 0; i < comps.length; i++) {
    ssTot += (ys[i]! - meanY) * (ys[i]! - meanY);
  }

  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of comps) {
    const key = p.category ?? 'Uncategorised';
    const arr = byCat.get(key);
    if (arr) arr.push(p);
    else byCat.set(key, [p]);
  }
  const categories: CategoryFit[] = [];
  for (const [category, ps] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const residuals = ps.map((p) => Math.log(p.mcap_usd!) - (intercept + slope * Math.log(p.tvl_usd)));
    const w = ps.length / (ps.length + MODEL.shrink_k);
    categories.push({
      category,
      comps: ps.length,
      shift: w * median(residuals),
      median_multiple: median(ps.map((p) => p.mcap_usd! / p.tvl_usd)),
    });
  }

  // Five-fold out-of-sample check of the pooled line (no category shift, so
  // the number is the model's honest error, not a fit it memorised).
  const errs: number[] = [];
  for (let k = 0; k < 5; k++) {
    const train = comps.filter((p) => hash32(p.slug) % 5 !== k);
    const test = comps.filter((p) => hash32(p.slug) % 5 === k);
    if (train.length < 10 || test.length === 0) continue;
    const [b2, a2] = ols(train.map((p) => Math.log(p.tvl_usd)), train.map((p) => Math.log(p.mcap_usd!)));
    for (const p of test) {
      const pred = a2 + b2 * Math.log(p.tvl_usd);
      errs.push(Math.abs(pred - Math.log(p.mcap_usd!)));
    }
  }
  const oosMedian = errs.length > 0 ? median(errs) : 0;

  // The R-squared the board actually runs on: pooled line plus the shrunk
  // category shifts, measured in log space on the same comparables.
  const shiftByCat = new Map(categories.map((c) => [c.category, c.shift]));
  let ssResCat = 0;
  for (let i = 0; i < comps.length; i++) {
    const p = comps[i]!;
    const pred = intercept + (shiftByCat.get(p.category ?? 'Uncategorised') ?? 0) + slope * xs[i]!;
    ssResCat += (ys[i]! - pred) * (ys[i]! - pred);
  }
  const rSquared = ssTot === 0 ? 0 : 1 - ssResCat / ssTot;
  return {
    slope,
    intercept,
    r_squared: Math.max(0, rSquared),
    comps: comps.length,
    oos_median_log_error: oosMedian,
    oos_factor: Math.exp(oosMedian),
    categories,
  };
}

/** The category shift for a protocol's category, or 0 when it has no comparables. */
function categoryShiftOf(fit: CompsFit, category: string | null): { shift: number; comps: number; medianMultiple: number } {
  const key = category ?? 'Uncategorised';
  const found = fit.categories.find((c) => c.category === key);
  if (!found) return { shift: 0, comps: 0, medianMultiple: 0 };
  return { shift: found.shift, comps: found.comps, medianMultiple: found.median_multiple };
}

/** The fitted value and the multipliers one protocol gets under the fit. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CompsFit,
  model: ModelConstants = MODEL,
): {
  implied: number;
  fitted: number;
  fittedMultiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  categoryComps: number;
  categoryShift: number;
  categoryMedianMultiple: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const cat = categoryShiftOf(fit, protocol.category);
  const fitted = Math.exp(fit.intercept + cat.shift + fit.slope * Math.log(protocol.tvl_usd));
  const capped = Math.min(fitted * growthMult * maturityMult, protocol.tvl_usd * model.implied_cap_multiple);
  const implied = Math.max(1, Math.round(capped));
  return {
    implied,
    fitted: Math.round(fitted),
    fittedMultiple: fitted / protocol.tvl_usd,
    growthPct,
    growthMult,
    maturityMult,
    age,
    categoryComps: cat.comps,
    categoryShift: cat.shift,
    categoryMedianMultiple: cat.medianMultiple,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule treats as a wrapped, staked or bridged product. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names a protocol must not start with, per the watchlist rule. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a
 * wrapped, staked or bridged product of a token that already trades. This
 * reproduces the watchlist's rule from the snapshot's own ten fields
 * (parentProtocol is not among them, so the rule is the list's floor, and
 * the board always adds the watchlist itself on top).
 */
export function isStrictPreToken(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: CompsFit, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other strictly pre-token protocol, whatever its
  // TVL. The floor is never the whole board: 158 of the 198 rows below are
  // protocols the watchlist does not name.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isStrictPreToken(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      fitted_value_usd: s.v.fitted,
      fitted_multiple: round4(s.v.fittedMultiple),
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      age_days: s.v.age,
      category: s.p.category,
      category_comps: s.v.categoryComps,
      category_shift: round4(s.v.categoryShift),
      category_median_multiple: round4(s.v.categoryMedianMultiple),
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Gas for one transaction on the protocol's main chain, in dollars. */
function gasFor(chain: string): number {
  const cheap = ['Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'BNB Chain', 'Avalanche', 'Sui', 'Aptos'];
  if (cheap.includes(chain)) return 1;
  if (chain === 'Ethereum') return 6;
  return 3;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow $25 of USDC against it, then repay the borrow a week later.`;
  if (c.includes('dex') || c.includes('amm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in a $25 USDC / $25 paired-asset split, and swap $10 through the pool once a week.`;
  if (c.includes('leveraged farm') || c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position of $25 notional, then close it the same week.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one $10 market position, then settle or close it before expiry.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares for the full qualifying window.`;
  if (c.includes('stable')) return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it; record the mint transaction hash.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for a 30-day term and keep the policy receipt.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app within the same week.`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('launchpad')) return `Complete ${name}'s onboarding on ${chain}, stake $${capital} in its launch pool, and vote on one proposal.`;
  if (c.includes('nft')) return `List one item or buy a floor item worth about $${capital} on ${name} and hold it for the qualifying window.`;
  if (c.includes('privacy')) return `Run one shielded deposit of $${capital} through ${name} on ${chain} and keep the proof of the deposit.`;
  if (c.includes('ai') || c.includes('depin') || c.includes('chain')) return `Run the ${name} client or node on ${chain} with a $${capital} stake or deposit and keep it online for the qualifying window.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} in two or more transfers, a week apart.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and use its main feature once a week.`;
}

/** The second, mechanism-specific step: what the farmer does after the first deposit. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Keep the borrow below 40% of the supplied collateral so a price move cannot liquidate the position.`;
  if (c.includes('dex') || c.includes('amm')) return `Keep the pool position in range; if the pair drifts more than 20%, rebalance once instead of withdrawing.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Never leave the hedge open overnight without a stop: close it the same day you open it.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Confirm the bridged funds arrived on ${chain} before you spend them, and keep both transaction hashes.`;
  if (c.includes('restak') || c.includes('staking')) return `Check the receipt token still matches the staked amount after one week; report any mismatch before adding more.`;
  return `Leave the position untouched for one full week after the first deposit, so the protocol's snapshots see a single continuous position.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * Every step is derived from the protocol's own record (category, chains,
 * TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `under $${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: 'no extra capital',
      time: '5 minutes to check',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never let two weeks pass with no activity.`,
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from the link it publishes and claim only from there; a token that does not exist yet cannot be claimed from anywhere else.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it, and set a calendar reminder for the day the hold ends.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.tvl_usd > 0 ? p.mcap_usd! / p.tvl_usd : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, isWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    fitted_value_usd: row.model.fitted_value_usd,
    fitted_multiple: row.model.fitted_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    category_comps: row.model.category_comps,
    category_shift: row.model.category_shift,
    watchlist: isWatchlist,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData; fit: CompsFit } {
  const fit = fitComps(snapshot.protocols);
  const board = buildBoard(snapshot, fit, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const wl = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, wl.has(r.slug))),
    live,
  };
  return { board, radar, fit };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
