export type LocationId =
  | 'bondi'
  | 'circular_quay'
  | 'newtown'
  | 'parramatta'
  | 'olympic_park'
  | 'manly';

export type WeatherCondition =
  | 'heatwave'
  | 'sunny'
  | 'perfect'
  | 'cloudy'
  | 'light_rain'
  | 'storm';

export type CustomerType =
  | 'tourist'
  | 'student'
  | 'office_worker'
  | 'family'
  | 'beachgoer'
  | 'hipster'
  | 'tradie'
  | 'athlete';

export type DayPhase =
  | 'briefing'
  | 'planning'
  | 'simulation'
  | 'report'
  | 'upgrades';

export type GameMode = 'career' | 'sandbox';

export type UpgradeId =
  | 'better_cooler'
  | 'faster_blender'
  | 'premium_signage'
  | 'umbrella_shade'
  | 'ice_machine'
  | 'loyalty_cards'
  | 'bulk_supplier'
  | 'hire_casual'
  | 'second_stand';

export type AdTier = 'none' | 'flyer' | 'social' | 'hype';

export interface Recipe {
  lemonStrength: number; // 0–100
  sweetness: number;     // 0–100
  ice: number;           // 0–100
  cupSize: 'S' | 'M' | 'L';
}

export interface Supplies {
  lemons: number;
  sugar: number;
  ice: number;
}

export interface Weather {
  condition: WeatherCondition;
  tempC: number;
  demandMult: number;
  iceDrainRate: number;
  description: string;
  forecast: string;
  emoji: string;
}

export interface NewsEvent {
  id: string;
  headline: string;
  body: string;
  trafficMod: number;
  emoji: string;
}

export interface Location {
  id: LocationId;
  name: string;
  suburb: string;
  tagline: string;
  emoji: string;
  baseTraffic: number;
  rentPerDay: number;
  unlockCost: number;
  unlocked: boolean;
  customerTypes: CustomerType[];
  budgetRange: [number, number];
}

export interface Upgrade {
  id: UpgradeId;
  name: string;
  description: string;
  effect: string;
  cost: number;
  purchased: boolean;
  emoji: string;
  category: 'equipment' | 'marketing' | 'staff' | 'supply';
}

export interface SimCustomer {
  id: string;
  type: CustomerType;
  emoji: string;
  budget: number;
  patience: number;  // game-minutes
  state: 'approaching' | 'queued' | 'served' | 'left';
  waitedFor: number; // game-minutes accumulated
  posX: number;      // 0.0–1.0 horizontal screen position
  lane: number;      // 0–4 for vertical stagger
}

export interface DayPlan {
  recipe: Recipe;
  price: number;
  advertising: AdTier;
  locationId: LocationId;
  suppliesBought: Partial<Supplies>;
}

export interface DayResult {
  day: number;
  revenue: number;
  supplyCost: number;
  adCost: number;
  rentCost: number;
  profit: number;
  waste: number;
  cupsServed: number;
  missed: number;
  satisfaction: number;
  repDelta: number;
  weatherEmoji: string;
  tempC: number;
  reviews: Array<{ stars: number; text: string }>;
}

export interface GameState {
  started: boolean;
  gameMode: GameMode;
  phase: DayPhase;
  day: number;
  cash: number;
  reputation: number;
  totalProfit: number;

  weather: Weather | null;
  todayEvents: NewsEvent[];
  plan: DayPlan;
  supplies: Supplies;

  simTick: number;
  simRunning: boolean;
  simSpeed: number;
  queue: SimCustomer[];
  todayRevenue: number;
  todayCups: number;
  recentComments: string[];
  missedCount: number;
  expectedCustomers: number;

  lastResult: DayResult | null;
  locations: Location[];
  upgrades: Upgrade[];
  history: DayResult[];

  newGame: (mode: GameMode) => void;
  beginDay: () => void;
  updatePlan: (p: Partial<DayPlan>) => void;
  updateRecipe: (r: Partial<Recipe>) => void;
  buySupply: (item: keyof Supplies, qty: number) => void;
  startSim: () => void;
  tickSim: () => void;
  setSimSpeed: (s: number) => void;
  endSim: () => void;
  buyUpgrade: (id: UpgradeId) => void;
  unlockLocation: (id: LocationId) => void;
  goPhase: (phase: DayPhase) => void;
}
