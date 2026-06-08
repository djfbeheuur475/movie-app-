import type {
  Weather,
  NewsEvent,
  SimCustomer,
  CustomerType,
  DayPlan,
  DayResult,
  Location,
  Upgrade,
  WeatherCondition,
} from '../types/game';
import {
  WEATHER_POOL,
  NEWS_EVENT_POOL,
  CUSTOMER_DATA,
  SUPPLY_COSTS,
  SUPPLY_PER_CUP,
  CUP_SIZE_MULT,
  AD_CONFIG,
  SIM_COMMENTS,
  LEAVE_COMMENTS,
  REVIEW_TEXTS,
} from '../constants/gameConfig';

// ─── Seeded RNG for reproducible daily values ─────────────────────────────────
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function rng(...seeds: number[]): number {
  const combined = seeds.reduce((a, b) => a * 31 + b, 1);
  const rand = seededRandom(combined);
  rand(); rand(); // warm up
  return rand();
}

// ─── Normal distribution helpers ─────────────────────────────────────────────
function normalPDF(x: number, mu: number, sigma: number): number {
  return (
    (1 / (sigma * Math.sqrt(2 * Math.PI))) *
    Math.exp(-0.5 * Math.pow((x - mu) / sigma, 2))
  );
}

// Precomputed arrival weights — 60 ticks, each tick = 8 game-minutes (8am–4pm)
// Peak arrival at noon (tick 30 = 240 game-minutes from 8am)
const ARRIVAL_WEIGHTS: number[] = (() => {
  const raw = Array.from({ length: 60 }, (_, t) =>
    normalPDF(t * 8, 240, 90)
  );
  const total = raw.reduce((s, w) => s + w, 0);
  return raw.map((w) => w / total);
})();

// Poisson sample: round(λ + gaussian noise)
function poissonSample(lambda: number, noiseRand: number): number {
  if (lambda <= 0) return 0;
  const noise = (noiseRand * 2 - 1) * Math.sqrt(Math.max(lambda, 1));
  return Math.max(0, Math.round(lambda + noise * 0.6));
}

// ─── Weather ──────────────────────────────────────────────────────────────────
export function generateWeather(day: number): Weather {
  // Deterministic but varied — day seeds the selection
  const r = rng(day, 77);
  const totalWeight = WEATHER_POOL.reduce((s, w) => s + w.weight, 0);
  let pick = r * totalWeight;
  const pool = [...WEATHER_POOL];
  pool.sort((a, b) => a.weight - b.weight);

  let chosen = pool[0];
  for (const w of pool) {
    pick -= w.weight;
    if (pick <= 0) {
      chosen = w;
      break;
    }
  }

  const tempR = rng(day, 88);
  const tempC = Math.round(
    chosen.tempRange[0] +
      tempR * (chosen.tempRange[1] - chosen.tempRange[0])
  );

  return {
    condition: chosen.condition as WeatherCondition,
    tempC,
    demandMult: chosen.demandMult,
    iceDrainRate: chosen.iceDrainRate,
    description: chosen.description,
    forecast: chosen.forecast,
    emoji: chosen.emoji,
  };
}

// ─── News events ─────────────────────────────────────────────────────────────
export function generateEvents(
  day: number,
  weather: Weather
): NewsEvent[] {
  const r1 = rng(day, 11);
  const r2 = rng(day, 22);
  const r3 = rng(day, 33);

  // 60% chance of 1 event, 30% of 2 events
  const count = r1 < 0.1 ? 0 : r1 < 0.7 ? 1 : 2;

  const pool = [...NEWS_EVENT_POOL];
  // Filter out contradictory events (e.g. no heatwave on storm day)
  const filtered = pool.filter((e) => {
    if (weather.condition === 'storm' && e.id === 'heatwave_warning') return false;
    if (weather.condition === 'heatwave' && e.id === 'rain_incoming') return false;
    return true;
  });

  const events: NewsEvent[] = [];
  const rands = [r2, r3];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rands[i] * filtered.length);
    const event = filtered[idx];
    if (event && !events.find((e) => e.id === event.id)) {
      events.push(event);
    }
  }
  return events;
}

// ─── Expected customer count for today ───────────────────────────────────────
export function getExpectedCustomers(
  location: Location,
  weather: Weather,
  events: NewsEvent[],
  plan: DayPlan,
  reputation: number,
  upgrades: Upgrade[]
): number {
  const adMult = AD_CONFIG[plan.advertising].trafficMult;
  const eventMult = events.reduce((m, e) => m * e.trafficMod, 1);
  const repMult = 0.6 + (reputation / 100) * 0.9; // 0.6–1.5
  const signageMult = upgrades.find((u) => u.id === 'premium_signage' && u.purchased)
    ? 1.15
    : 1.0;

  return Math.round(
    location.baseTraffic *
      weather.demandMult *
      adMult *
      eventMult *
      repMult *
      signageMult
  );
}

// ─── Recipe score (0–1) ───────────────────────────────────────────────────────
export function getRecipeScore(
  plan: DayPlan,
  weather: Weather,
  customerType: CustomerType
): number {
  const { recipe } = plan;
  const data = CUSTOMER_DATA[customerType];

  // Ideal ice scales with temperature
  const idealIce = Math.min(100, Math.max(0, (weather.tempC - 15) * 3.5));
  const iceDiff = Math.abs(recipe.ice - idealIce) / 100;

  const sweetDiff = Math.abs(recipe.sweetness - data.sweetnessPreference) / 100;
  const lemonDiff = Math.abs(recipe.lemonStrength - 60) / 100;

  const score =
    1.0 -
    iceDiff * 0.35 -
    sweetDiff * 0.25 -
    lemonDiff * 0.2 +
    data.tempBoost * Math.max(0, (weather.tempC - 25) / 30);

  return Math.max(0.1, Math.min(1.0, score));
}

// ─── Will customer buy at this price? ────────────────────────────────────────
export function willBuy(
  price: number,
  budget: number,
  recipeScore: number,
  weather: Weather,
  rand: number
): boolean {
  if (price > budget * 1.1) return false; // hard ceiling with small flexibility

  const pricePressure = price > budget ? 0.3 : 1 - (price / budget) * 0.3;
  const heatBonus = Math.max(0, (weather.tempC - 28) / 25) * 0.25;
  const buyChance = Math.min(0.97, recipeScore * pricePressure + heatBonus);

  return rand < buyChance;
}

// ─── Customer cost per cup ────────────────────────────────────────────────────
export function getCostPerCup(plan: DayPlan, upgrades: Upgrade[]): number {
  const { recipe } = plan;
  const bulkDiscount = upgrades.find((u) => u.id === 'bulk_supplier' && u.purchased)
    ? 0.75
    : 1.0;

  const lemonCost =
    (recipe.lemonStrength / 100) *
    SUPPLY_PER_CUP.lemons *
    SUPPLY_COSTS.lemons *
    bulkDiscount;
  const sugarCost =
    (recipe.sweetness / 100) *
    SUPPLY_PER_CUP.sugar *
    SUPPLY_COSTS.sugar *
    bulkDiscount;
  const iceCost =
    (recipe.ice / 100) *
    SUPPLY_PER_CUP.ice *
    SUPPLY_COSTS.ice *
    bulkDiscount;

  const sizeMult = CUP_SIZE_MULT[recipe.cupSize].cost;
  return (lemonCost + sugarCost + iceCost + 0.15) * sizeMult; // 0.15 = cup cost
}

// ─── Service rate ─────────────────────────────────────────────────────────────
export function getServiceRate(upgrades: Upgrade[]): number {
  // Base: 2 cups per game-minute (= 16 per 8-min tick)
  let rate = 2.0;
  if (upgrades.find((u) => u.id === 'faster_blender' && u.purchased)) rate *= 1.35;
  if (upgrades.find((u) => u.id === 'hire_casual' && u.purchased)) rate *= 1.8;
  if (upgrades.find((u) => u.id === 'second_stand' && u.purchased)) rate *= 2.0;
  return rate;
}

// ─── Generate customer arrivals for a tick ────────────────────────────────────
export function getArrivalsForTick(
  tick: number,
  totalExpected: number,
  day: number
): number {
  const weight = ARRIVAL_WEIGHTS[tick] ?? 0;
  const expected = totalExpected * weight;
  const noiseRand = rng(day, tick, 555);
  return poissonSample(expected, noiseRand);
}

// ─── Create a new arriving customer ──────────────────────────────────────────
export function createCustomer(
  index: number,
  tick: number,
  day: number,
  location: Location
): SimCustomer {
  const typeIdx = Math.floor(
    rng(day, tick, index, 1) * location.customerTypes.length
  );
  const type: CustomerType = location.customerTypes[typeIdx];
  const data = CUSTOMER_DATA[type];

  const budgetR = rng(day, tick, index, 2);
  const patienceR = rng(day, tick, index, 3);
  const posXR = rng(day, tick, index, 4);
  const laneR = rng(day, tick, index, 5);

  const budget =
    location.budgetRange[0] +
    budgetR * (location.budgetRange[1] - location.budgetRange[0]);

  const patience =
    data.patienceRange[0] +
    patienceR * (data.patienceRange[1] - data.patienceRange[0]);

  return {
    id: `c-${day}-${tick}-${index}`,
    type,
    emoji: data.emoji,
    budget: parseFloat(budget.toFixed(2)),
    patience,
    state: 'approaching' as const,
    waitedFor: 0,
    posX: posXR < 0.5 ? posXR * 0.3 : 0.7 + posXR * 0.3, // spawn at edges
    lane: Math.floor(laneR * 5),
  };
}

// ─── Queue processing for one tick ───────────────────────────────────────────
export interface TickResult {
  served: number;
  missed: number;
  revenue: number;
  supplyCost: number;
  comments: string[];
  updatedQueue: SimCustomer[];
  iceUsed: number;
}

export function processQueueTick(
  queue: SimCustomer[],
  plan: DayPlan,
  weather: Weather,
  upgrades: Upgrade[],
  day: number,
  tick: number,
  currentSupplies: { lemons: number; sugar: number; ice: number }
): TickResult {
  const GAME_MINS_PER_TICK = 8;
  const serviceRate = getServiceRate(upgrades);
  const canServe = Math.floor(serviceRate * GAME_MINS_PER_TICK);
  const costPerCup = getCostPerCup(plan, upgrades);
  const sizeMult = CUP_SIZE_MULT[plan.recipe.cupSize];

  let served = 0;
  let missed = 0;
  let revenue = 0;
  let supplyCost = 0;
  const comments: string[] = [];
  const updatedQueue: SimCustomer[] = [];

  // Sort queue: queued first, then approaching
  const sorted = [...queue].sort((a, b) => {
    if (a.state === 'queued' && b.state !== 'queued') return -1;
    if (b.state === 'queued' && a.state !== 'queued') return 1;
    return 0;
  });

  let servedThisTick = 0;

  for (const customer of sorted) {
    if (customer.state === 'served' || customer.state === 'left') continue;

    // Check patience
    const patienceMult =
      upgrades.find((u) => u.id === 'umbrella_shade' && u.purchased) &&
      weather.tempC >= 30
        ? 1.5
        : 1.0;

    const waitedFor = customer.waitedFor + GAME_MINS_PER_TICK;

    if (customer.state === 'queued' && waitedFor > customer.patience * patienceMult) {
      // Customer leaves
      missed++;
      const leaveR = rng(day, tick, parseInt(customer.id.split('-')[3] ?? '0'), 99);
      if (leaveR < 0.3 && LEAVE_COMMENTS.length > 0) {
        const commentIdx = Math.floor(leaveR * 10) % LEAVE_COMMENTS.length;
        comments.push(LEAVE_COMMENTS[commentIdx]);
      }
      updatedQueue.push({ ...customer, state: 'left', waitedFor });
      continue;
    }

    // Try to serve
    if (servedThisTick < canServe && customer.state === 'queued') {
      const recipeScore = getRecipeScore(plan, weather, customer.type);
      const buyR = rng(day, tick, parseInt(customer.id.split('-')[3] ?? '0'), 77);
      const buys = willBuy(
        plan.price * sizeMult.price,
        customer.budget,
        recipeScore,
        weather,
        buyR
      );

      servedThisTick++;

      if (buys) {
        served++;
        revenue += plan.price * sizeMult.price;
        supplyCost += costPerCup;

        const commentR = rng(day, tick, served, 44);
        if (commentR < 0.15 && SIM_COMMENTS.length > 0) {
          comments.push(SIM_COMMENTS[Math.floor(commentR * 10 * SIM_COMMENTS.length) % SIM_COMMENTS.length]);
        }
      } else {
        missed++;
      }
      updatedQueue.push({ ...customer, state: 'served', waitedFor });
      continue;
    }

    // Move approaching → queued
    if (customer.state === 'approaching') {
      updatedQueue.push({ ...customer, state: 'queued', waitedFor });
    } else {
      updatedQueue.push({ ...customer, waitedFor });
    }
  }

  // Ice drain
  const iceUsed =
    (plan.recipe.ice / 100) *
    weather.iceDrainRate *
    served *
    (upgrades.find((u) => u.id === 'better_cooler' && u.purchased) ? 0.5 : 1.0) *
    (upgrades.find((u) => u.id === 'ice_machine' && u.purchased) ? 0.4 : 1.0);

  return {
    served,
    missed,
    revenue: parseFloat(revenue.toFixed(2)),
    supplyCost: parseFloat(supplyCost.toFixed(2)),
    comments,
    updatedQueue,
    iceUsed,
  };
}

// ─── End of day: build DayResult ─────────────────────────────────────────────
export function buildDayResult(params: {
  day: number;
  plan: DayPlan;
  location: Location;
  weather: Weather;
  totalRevenue: number;
  totalSupplyCost: number;
  cupsServed: number;
  missed: number;
  initialSupplies: { lemons: number; sugar: number; ice: number };
  finalSupplies: { lemons: number; sugar: number; ice: number };
  upgrades: Upgrade[];
}): DayResult {
  const {
    day, plan, location, weather,
    totalRevenue, totalSupplyCost,
    cupsServed, missed,
    initialSupplies, finalSupplies,
  } = params;

  const adCost = AD_CONFIG[plan.advertising].cost;
  const staffCost = params.upgrades.find((u) => u.id === 'hire_casual' && u.purchased)
    ? 60
    : 0;
  const rentCost = location.rentPerDay;

  const suppliesBoughtCost = Object.entries(plan.suppliesBought).reduce((sum, [k, v]) => {
    return sum + (SUPPLY_COSTS[k as keyof typeof SUPPLY_COSTS] ?? 0) * (v ?? 0);
  }, 0);

  const waste =
    (finalSupplies.lemons - initialSupplies.lemons) * SUPPLY_COSTS.lemons * -1 +
    (finalSupplies.ice - initialSupplies.ice) * SUPPLY_COSTS.ice * -1;
  const wasteVal = Math.max(0, parseFloat(waste.toFixed(2)));

  const profit = totalRevenue - totalSupplyCost - adCost - rentCost - staffCost - suppliesBoughtCost;

  const total = cupsServed + missed;
  const satisfaction = total > 0 ? Math.round((cupsServed / total) * 100) : 50;
  const repDelta = satisfaction > 75 ? 3 : satisfaction > 55 ? 1 : satisfaction > 40 ? -1 : -3;

  // Generate reviews
  const reviews: Array<{ stars: number; text: string }> = [];
  const reviewCount = Math.min(4, Math.max(1, Math.floor(cupsServed / 20)));
  for (let i = 0; i < reviewCount; i++) {
    const starsBias = satisfaction / 100;
    const r = rng(day, i, 42);
    const stars = Math.max(
      1,
      Math.min(5, Math.round(1 + (r * 0.3 + starsBias * 0.7) * 4))
    );
    const pool = REVIEW_TEXTS[stars] ?? REVIEW_TEXTS[3];
    const textIdx = Math.floor(rng(day, i, 43) * pool.length);
    reviews.push({ stars, text: pool[textIdx] });
  }

  return {
    day,
    revenue: parseFloat(totalRevenue.toFixed(2)),
    supplyCost: parseFloat((totalSupplyCost + suppliesBoughtCost).toFixed(2)),
    adCost,
    rentCost: rentCost + staffCost,
    profit: parseFloat(profit.toFixed(2)),
    waste: wasteVal,
    cupsServed,
    missed,
    satisfaction,
    repDelta,
    weatherEmoji: weather.emoji,
    tempC: weather.tempC,
    reviews,
  };
}

// ─── Supply cost for a purchase ───────────────────────────────────────────────
export function getSupplyPurchaseCost(
  item: keyof typeof SUPPLY_COSTS,
  qty: number,
  upgrades: Upgrade[]
): number {
  const discount = upgrades.find((u) => u.id === 'bulk_supplier' && u.purchased)
    ? 0.75
    : 1.0;
  return parseFloat((SUPPLY_COSTS[item] * qty * discount).toFixed(2));
}
