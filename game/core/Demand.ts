import type { BuildingMap } from './Building';
import { POPULATION_PER_LEVEL, POPULATION_PER_TILE_LEVEL } from './growthConstants';
import { buildingCapacity } from './buildingCapacity';

// Readonly<...> is a compile-time guard only — the module returns an Object.freeze'd snapshot to enforce immutability at runtime.
export type DemandVector = Readonly<{ residential: number; commercial: number; industrial: number }>;

/*
 * Unit quantization — the basis every constant below is calibrated against.
 * Every labor scalar — employed, unemployed, jobsCapacity, reachableUnfilledJobs, and therefore
 * `net` — is a sum of `buildingCapacity()` over residential or commercial/industrial buildings. At
 * density 0 that is a multiple of `POPULATION_PER_TILE_LEVEL` (5), not 10 — and now that the 7-
 * and 10-unit density tiers carry real capacity (`DENSITY_CAPACITY_UNITS`), a densified building's
 * contribution is an arbitrary integer, no longer any fixed multiple. The calibration anchor stays
 * the modal DENSITY-0 building-level (structureRect area 2): still 10 units, reading 10/100 = 0.10
 * partial severity (see MIN_MARKET below), so the smallest reachable imbalance a modal building can
 * cause is unchanged regardless of what higher-density buildings elsewhere add to the sums.
 */

// Below a 5% imbalance the city reads as balanced and the labor term contributes nothing — the only
// continuous damping a stateless design has. Matches the ~5% Cities: Skylines treats as balance.
export const DEADBAND_RATE = 0.05;

// A quarter of the market on the wrong side of the ledger is a full crisis; severity saturates there
// so a runaway imbalance cannot ask for more than "everything".
export const SATURATION_RATE = 0.25;

// Floors the severity denominator against the quantization above: one MODAL building-level of
// imbalance (10 units) then reads 10/100 = 0.10, i.e. PARTIAL severity between deadband and
// saturation — exactly today's response. A single density-0 tile-level (5 units) reads exactly
// DEADBAND_RATE and contributes severity 0: sub-modal-building noise is precisely what the deadband
// exists to absorb. Halving to 50 is rejected: one modal building-level would then read 20/100 —
// severity 0.75 instead of 0.25 — silently re-tuning small-city demand pacing, the exact
// decalibration this unit choice avoids.
// Written as a multiple of POPULATION_PER_TILE_LEVEL so it cannot drift out of the unit it measures.
export const MIN_MARKET = 20 * POPULATION_PER_TILE_LEVEL;

// laborMarket.ts pools C and I into one job type, so they are interchangeable providers and an even
// split is the only allocation that invents no economic distinction. Named so it can move when C and
// I get distinct roles.
export const COMMERCIAL_JOB_SHARE = 0.5;

// The labor axis pins C+I ≈ R, so a 25% commercial share of total building capacity puts the city
// at R:C:I = 2:1:1. Both axes share that one fixed point, so unlike the deleted structural terms it
// is actually reachable.
export const COMMERCIAL_CAPACITY_SHARE = 0.25;

// The residential demand a city with work for everyone shows from in-migration alone: the external
// growth driver, without which the all-zero state would be absorbing (no zone tile supplies workers,
// jobs or levels, so nothing the player painted could change the ratio). Must stay strictly between
// GROWTH_DEMAND_THRESHOLD (so the R gates stay open when balanced) and DENSITY_DEMAND_THRESHOLD (so
// migration alone can never densify); set at the low end, where it fills exactly one of the HUD's ten
// blocks. Merges are deliberately outside that band: canMerge keys on built-out parcels and accepts
// this floor, so a balanced city still consolidates land.
export const MIGRATION_PRESSURE = 0.1;

// The unemployment rate at which in-migration stops entirely — Micropolis's
// `migration = pop × (employment − 1)` in a bounded form. Shares its rate with
// UNEMPLOYMENT_WARNING_RATE in app/hooks/laborStatus.ts, duplicated here because the layer boundary
// runs core → app and never app → core; the HUD warning additionally needs WARNING_MIN_WORKFORCE, so
// a hamlet can have migration damped to zero with no warning shown.
export const MIGRATION_UNEMPLOYMENT_CUTOFF = 0.2;

// The C/I demand a city with a worker for every job shows from outside investment alone — the
// external-market pull that keeps the workplace gates open at balance, MIGRATION_PRESSURE's
// counterpart for commercial and industrial. Must stay strictly between GROWTH_DEMAND_THRESHOLD
// (so the C/I spawn/level-up gates stay open when balanced) and the smaller of DENSITY_DEMAND_BAR's
// C and I entries (so the floor alone can never densify — it can still merge a built-out pair, by
// design); today COMMERCIAL_JOB_SHARE's even split makes both entries equal at 0.1875, comfortably
// above 0.1. Set at the low end, like MIGRATION_PRESSURE. Shared unsplit by C and I: laborMarket.ts
// pools their jobs as interchangeable, so there is no shared quantity to divide between them.
export const WORKPLACE_PRESSURE = 0.1;

// Applied whenever the labor market is empty: there is nothing to be proportional to in that state
// and "build homes" is the only correct instruction. A gate opener, not a pacing knob.
export const BOOTSTRAP_RESIDENTIAL_DEMAND = 1;

// Gate for spawn, level-up, and — now that consolidation keys on built-out parcels — merge. Zero is
// the anchor, not the absence of one: the deadband already encodes "balanced", so a strictly
// positive reading is either an imbalance beyond DEADBAND_RATE or live in-migration.
export const GROWTH_DEMAND_THRESHOLD = 0;

// The one gate where magnitude matters: the fraction of each type's labor-derived demand range that
// must be crossed before density can bump. Residential's severity arm reaches 1.0, so its bar is this
// threshold in full. The C/I workplaceSeverity arms are each split by COMMERCIAL_JOB_SHARE AFTER the
// severity curve, so they cap at COMMERCIAL_JOB_SHARE and 1 - COMMERCIAL_JOB_SHARE respectively;
// commercial's retail arm can exceed its share and intentionally shares the same bar, since both
// answer "is commercial demand high enough". DENSITY_DEMAND_BAR below applies this fraction per type.
//
// A flat threshold failed here: capped at its share of workplaceSeverity, a jobs bar could only clear
// 0.375 when citywide unemployment hit 20% with no reachable vacancies — exactly
// MIGRATION_UNEMPLOYMENT_CUTOFF, the point where migration hits 0 and residential growth freezes
// entirely. The stable policy: DENSITY_DEMAND_BAR's C/I entries — 0.1875 today, following from
// COMMERCIAL_JOB_SHARE's even split — open the gate at that same no-reachable-vacancies unemployment
// rate, just above 12.5%.
export const DENSITY_DEMAND_THRESHOLD = 0.375;

/** Per-type application of DENSITY_DEMAND_THRESHOLD — see the comment above for the derivation. */
export const DENSITY_DEMAND_BAR: DemandVector = Object.freeze({
  residential: DENSITY_DEMAND_THRESHOLD,
  commercial: DENSITY_DEMAND_THRESHOLD * COMMERCIAL_JOB_SHARE,
  industrial: DENSITY_DEMAND_THRESHOLD * (1 - COMMERCIAL_JOB_SHARE),
});

/** Reading of a city whose labor market is empty; also Demand's value before the first recompute. */
export const EMPTY_CITY_DEMAND: DemandVector = Object.freeze({
  residential: BOOTSTRAP_RESIDENTIAL_DEMAND,
  commercial: 0,
  industrial: 0,
});

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Deadbanded, saturating severity of a shortfall against the market. MIN_MARKET > 0 floors `market`, so this never divides by zero. */
function severity(shortfall: number, market: number): number {
  return clamp01((shortfall / market - DEADBAND_RATE) / (SATURATION_RATE - DEADBAND_RATE));
}

// Plain scalars extracted from LaborMarketMap — no import of World or labor modules here.
type LaborScalars = Readonly<{
  employed: number;
  unemployed: number;
  reachableUnfilledJobs: number;
  jobsCapacity: number;
}>;

export class Demand {
  private cached: DemandVector;

  constructor() {
    this.cached = EMPTY_CITY_DEMAND;
  }

  recompute(buildings: BuildingMap, labor: LaborScalars): void {
    let capacitySumR = 0;
    let capacitySumC = 0;
    let capacitySumI = 0;

    for (const b of buildings.iterBuildings()) {
      if (b.abandoned) continue;
      if (b.type === 'residential') capacitySumR += buildingCapacity(b);
      else if (b.type === 'commercial') capacitySumC += buildingCapacity(b);
      else if (b.type === 'industrial') capacitySumI += buildingCapacity(b);
    }

    // --- labor axis ---
    const workforce = labor.employed + labor.unemployed;
    // reachableUnfilledJobs is summed over job nodes reached by at least one residential BFS, so with
    // no residential origins it is structurally 0 and an all-jobs city would read "balanced". With no
    // workforce every job IS a vacancy and reachability is vacuous, so jobsCapacity is honest there.
    const vacancies = workforce === 0 ? labor.jobsCapacity : labor.reachableUnfilledJobs;
    // A state, not a one-time transition: a city that bulldozes (or abandons) every R/C/I building
    // re-enters it and correctly reads "build homes" again.
    const marketEmpty = workforce === 0 && vacancies === 0;
    const market = Math.max(workforce + vacancies, MIN_MARKET);
    // Only the residual sign survives — stranded workers and stranded reachable vacancies cancel, and
    // a net of 0 is a legitimate all-zero reading (the fix there is a road, not a zone; laborStatus.ts
    // already carries that message).
    const net = vacancies - labor.unemployed;
    const resSeverity = net > 0 ? severity(net, market) : 0;
    // ONE aggregate figure: the whole shortage against the whole market, so the deadband and the
    // saturation point stay citywide. Curving each half separately would double both and spend the
    // same shortage twice.
    const workplaceSeverity = net < 0 ? severity(-net, market) : 0;

    // --- migration (residential only) ---
    // Combined by `max` OUTSIDE the severity, so it cannot move the balance point; folding it in is
    // exactly the offset-inside-the-formula defect the deleted structural terms had. Migration stays
    // residential-only, but C and I carry their own external driver in `workplaceFloor` below,
    // combined the same way.
    const unemploymentRate = workforce > 0 ? labor.unemployed / workforce : 0;
    const migration = MIGRATION_PRESSURE * clamp01(1 - unemploymentRate / MIGRATION_UNEMPLOYMENT_CUTOFF);

    // --- retail axis (commercial only) ---
    const totalCapacity = capacitySumR + capacitySumC + capacitySumI;
    const targetC = COMMERCIAL_CAPACITY_SHARE * totalCapacity;
    // Floored at one MODAL building-level (POPULATION_PER_LEVEL), the same anchor MIN_MARKET uses
    // above — not the bare `1` left over from the old raw-level formula, which would read a near-
    // saturated retail gap out of a single small building's capacity units instead of a damped one.
    const retail = clamp01((targetC - capacitySumC) / Math.max(targetC, capacitySumC, POPULATION_PER_LEVEL));
    // Micropolis's laborBase: with more open jobs than workers already, another shop has nobody to
    // staff it, so the retail axis collapses.
    const staffing = 1 - resSeverity;

    // --- workplace floor (commercial AND industrial) ---
    // Reuses `staffing`, so the floor decays through the severity band and reaches exactly 0 once
    // the vacancy surplus saturates — nobody left to staff another workplace. Gated to 0 with no
    // workforce: nothing is staffable, and without the gate a small all-jobs hamlet would leak a
    // partial floor even though every worker slot is already vacant.
    const workplaceFloor = workforce === 0 ? 0 : WORKPLACE_PRESSURE * staffing;

    const residential = marketEmpty ? BOOTSTRAP_RESIDENTIAL_DEMAND : Math.max(resSeverity, migration);
    // `max`, not `+`: each arm is an alternative reason to build the same building, and summing
    // would push the bar past what the worse of them justifies. `workplaceFloor` is a third such
    // arm on commercial, second on industrial.
    const commercial = Math.max(workplaceSeverity * COMMERCIAL_JOB_SHARE, retail * staffing, workplaceFloor);
    // The split happens AFTER the severity curve — see workplaceSeverity above.
    const industrial = Math.max(workplaceSeverity * (1 - COMMERCIAL_JOB_SHARE), workplaceFloor);

    this.cached = Object.freeze({ residential, commercial, industrial });
  }

  get(): DemandVector {
    return this.cached;
  }

  getRaw(): DemandVector {
    return this.cached;
  }
}
