import { create } from 'zustand';
import type {
  GameState,
  DayPhase,
  GameMode,
  DayPlan,
  Recipe,
  UpgradeId,
  LocationId,
  SimCustomer,
} from '../types/game';
import type { Supplies } from '../types/game';
import {
  INITIAL_LOCATIONS,
  INITIAL_UPGRADES,
  STARTING_CASH,
  STARTING_REP,
  STARTING_SUPPLIES,
  AD_CONFIG,
} from '../constants/gameConfig';
import {
  generateWeather,
  generateEvents,
  getExpectedCustomers,
  getArrivalsForTick,
  createCustomer,
  processQueueTick,
  buildDayResult,
  getSupplyPurchaseCost,
} from '../lib/gameEngine';
import { saveGame } from '../lib/saveLoad';

const DEFAULT_PLAN: DayPlan = {
  recipe: {
    lemonStrength: 60,
    sweetness: 50,
    ice: 65,
    cupSize: 'M',
  },
  price: 4.5,
  advertising: 'none',
  locationId: 'bondi',
  suppliesBought: {},
};

function cloneLocations() {
  return INITIAL_LOCATIONS.map((l) => ({ ...l }));
}
function cloneUpgrades() {
  return INITIAL_UPGRADES.map((u) => ({ ...u }));
}

export const useGameStore = create<GameState>()((set, get) => ({
  // ─── Initial state ──────────────────────────────────────────────────────────
  started: false,
  gameMode: 'career',
  phase: 'briefing',
  day: 1,
  cash: STARTING_CASH,
  reputation: STARTING_REP,
  totalProfit: 0,

  weather: null,
  todayEvents: [],
  plan: { ...DEFAULT_PLAN },
  supplies: { ...STARTING_SUPPLIES },

  simTick: 0,
  simRunning: false,
  simSpeed: 1,
  queue: [],
  todayRevenue: 0,
  todayCups: 0,
  recentComments: [],
  missedCount: 0,
  expectedCustomers: 0,

  lastResult: null,
  locations: cloneLocations(),
  upgrades: cloneUpgrades(),
  history: [],

  // ─── Actions ────────────────────────────────────────────────────────────────
  newGame: (mode: GameMode) => {
    set({
      started: true,
      gameMode: mode,
      phase: 'briefing',
      day: 1,
      cash: mode === 'sandbox' ? 9999 : STARTING_CASH,
      reputation: STARTING_REP,
      totalProfit: 0,
      plan: { ...DEFAULT_PLAN },
      supplies: { ...STARTING_SUPPLIES },
      locations: cloneLocations(),
      upgrades: cloneUpgrades(),
      history: [],
      lastResult: null,
    });
    get().beginDay();
  },

  beginDay: () => {
    const { day } = get();
    const weather = generateWeather(day);
    const events = generateEvents(day, weather);
    set({
      weather,
      todayEvents: events,
      phase: 'briefing',
      simTick: 0,
      simRunning: false,
      queue: [],
      todayRevenue: 0,
      todayCups: 0,
      recentComments: [],
      missedCount: 0,
    });
  },

  updatePlan: (p: Partial<DayPlan>) => {
    set((s) => ({ plan: { ...s.plan, ...p } }));
  },

  updateRecipe: (r: Partial<Recipe>) => {
    set((s) => ({
      plan: { ...s.plan, recipe: { ...s.plan.recipe, ...r } },
    }));
  },

  buySupply: (item: keyof Supplies, qty: number) => {
    const { cash, supplies, upgrades, plan } = get();
    const cost = getSupplyPurchaseCost(item, qty, upgrades);
    if (cost > cash) return;

    set((s) => ({
      cash: parseFloat((s.cash - cost).toFixed(2)),
      supplies: { ...s.supplies, [item]: s.supplies[item] + qty },
      plan: {
        ...s.plan,
        suppliesBought: {
          ...s.plan.suppliesBought,
          [item]: (s.plan.suppliesBought[item] ?? 0) + qty,
        },
      },
    }));
  },

  startSim: () => {
    const { plan, weather, locations, upgrades, reputation, todayEvents } = get();
    const location = locations.find((l) => l.id === plan.locationId)!;
    const expected = getExpectedCustomers(
      location,
      weather!,
      todayEvents,
      plan,
      reputation,
      upgrades
    );

    // Deduct advertising cost
    const adCost = AD_CONFIG[plan.advertising].cost;

    set({
      phase: 'simulation',
      simTick: 0,
      simRunning: true,
      queue: [],
      todayRevenue: 0,
      todayCups: 0,
      recentComments: [],
      missedCount: 0,
      expectedCustomers: expected,
      cash: parseFloat((get().cash - adCost).toFixed(2)),
    });
  },

  tickSim: () => {
    const {
      simTick,
      expectedCustomers,
      queue,
      plan,
      weather,
      upgrades,
      day,
      supplies,
      todayRevenue,
      todayCups,
      missedCount,
    } = get();

    if (simTick >= 60) {
      get().endSim();
      return;
    }

    // Generate new arrivals
    const arrivals = getArrivalsForTick(simTick, expectedCustomers, day);
    const newCustomers: SimCustomer[] = Array.from({ length: arrivals }, (_, i) => {
      const location = get().locations.find((l) => l.id === plan.locationId)!;
      return createCustomer(i, simTick, day, location);
    });

    const activeQueue = queue.filter(
      (c) => c.state === 'approaching' || c.state === 'queued'
    );
    const combined = [...activeQueue, ...newCustomers];

    // Process the queue
    const result = processQueueTick(
      combined,
      plan,
      weather!,
      upgrades,
      day,
      simTick,
      supplies
    );

    // Update supplies (ice drain)
    const newIce = Math.max(0, supplies.ice - result.iceUsed);

    // Keep only recent comments (last 3)
    const allComments = [...(get().recentComments ?? []), ...result.comments].slice(-3);

    // Keep visible queue (not served/left, max 12 visible)
    const visibleQueue = result.updatedQueue
      .filter((c) => c.state !== 'served' && c.state !== 'left')
      .slice(0, 12);

    set({
      simTick: simTick + 1,
      queue: visibleQueue,
      todayRevenue: parseFloat((todayRevenue + result.revenue).toFixed(2)),
      todayCups: todayCups + result.served,
      missedCount: missedCount + result.missed,
      recentComments: allComments,
      supplies: { ...supplies, ice: parseFloat(newIce.toFixed(1)) },
    });

    if (simTick + 1 >= 60) {
      // Small delay to show final state, then auto-end
      setTimeout(() => get().endSim(), 600);
    }
  },

  setSimSpeed: (s: number) => set({ simSpeed: s }),

  endSim: () => {
    const {
      day,
      plan,
      weather,
      locations,
      upgrades,
      totalProfit,
      cash,
      reputation,
      todayRevenue,
      todayCups,
      missedCount,
      supplies,
      history,
    } = get();

    const location = locations.find((l) => l.id === plan.locationId)!;

    // Calculate waste from remaining supplies vs what was at start
    const initialSupplies = STARTING_SUPPLIES; // simplified — full waste calc in engine
    const result = buildDayResult({
      day,
      plan,
      location,
      weather: weather!,
      totalRevenue: todayRevenue,
      totalSupplyCost: 0, // already deducted per-cup in revenue
      cupsServed: todayCups,
      missed: missedCount,
      initialSupplies,
      finalSupplies: supplies,
      upgrades,
    });

    // Apply rent cost + staff cost
    const totalCost = result.adCost + result.rentCost;
    const netCash = parseFloat((cash + todayRevenue - totalCost).toFixed(2));
    const newRep = Math.max(0, Math.min(100, reputation + result.repDelta));
    const newHistory = [...history, result];

    set({
      simRunning: false,
      phase: 'report',
      lastResult: result,
      cash: netCash,
      reputation: newRep,
      totalProfit: parseFloat((totalProfit + result.profit).toFixed(2)),
      history: newHistory,
    });

    // Auto-save
    const state = get();
    saveGame({
      day: state.day,
      cash: netCash,
      reputation: newRep,
      totalProfit: state.totalProfit,
      locations: state.locations,
      upgrades: state.upgrades,
      history: newHistory,
      savedAt: Date.now(),
    });
  },

  buyUpgrade: (id: UpgradeId) => {
    const { upgrades, cash } = get();
    const upgrade = upgrades.find((u) => u.id === id);
    if (!upgrade || upgrade.purchased) return;
    if (upgrade.cost > cash) return;

    set((s) => ({
      cash: parseFloat((s.cash - upgrade.cost).toFixed(2)),
      upgrades: s.upgrades.map((u) =>
        u.id === id ? { ...u, purchased: true } : u
      ),
    }));
  },

  unlockLocation: (id: LocationId) => {
    const { locations, cash } = get();
    const loc = locations.find((l) => l.id === id);
    if (!loc || loc.unlocked) return;
    if (loc.unlockCost > cash) return;

    set((s) => ({
      cash: parseFloat((s.cash - loc.unlockCost).toFixed(2)),
      locations: s.locations.map((l) =>
        l.id === id ? { ...l, unlocked: true } : l
      ),
    }));
  },

  goPhase: (phase: DayPhase) => {
    if (phase === 'briefing') {
      set((s) => ({ day: s.day + 1, plan: { ...s.plan, suppliesBought: {} } }));
      get().beginDay();
    } else {
      set({ phase });
    }
  },
}));
