import type {
  Location,
  Upgrade,
  NewsEvent,
  CustomerType,
  WeatherCondition,
  AdTier,
} from '../types/game';

// ─── Supply costs (per unit) ────────────────────────────────────────────────
export const SUPPLY_COSTS = {
  lemons: 0.35,  // per lemon
  sugar: 0.08,   // per unit
  ice: 0.12,     // per unit
};

// Supply units consumed per cup (at 100% slider)
export const SUPPLY_PER_CUP = {
  lemons: 2.0,
  sugar: 1.5,
  ice: 3.0,
};

// Cup size price/cost multipliers
export const CUP_SIZE_MULT = {
  S: { price: 0.75, cost: 0.7 },
  M: { price: 1.0,  cost: 1.0 },
  L: { price: 1.35, cost: 1.3 },
};

// Advertising tiers
export const AD_CONFIG: Record<AdTier, { cost: number; trafficMult: number; label: string }> = {
  none:   { cost: 0,   trafficMult: 1.0,  label: 'None' },
  flyer:  { cost: 20,  trafficMult: 1.15, label: 'Flyer Drop' },
  social: { cost: 80,  trafficMult: 1.35, label: 'Social Post' },
  hype:   { cost: 200, trafficMult: 1.65, label: 'Full Hype' },
};

// Starting game defaults
export const STARTING_CASH = 500;
export const STARTING_REP = 10;
export const STARTING_SUPPLIES: { lemons: number; sugar: number; ice: number } = {
  lemons: 40,
  sugar: 60,
  ice: 50,
};

// ─── Locations ───────────────────────────────────────────────────────────────
export const INITIAL_LOCATIONS: Location[] = [
  {
    id: 'bondi',
    name: 'Bondi Beach',
    suburb: 'Bondi',
    tagline: 'Sun, surf, and thirsty tourists',
    emoji: '🏖️',
    baseTraffic: 120,
    rentPerDay: 40,
    unlockCost: 0,
    unlocked: true,
    customerTypes: ['beachgoer', 'tourist', 'athlete', 'family'],
    budgetRange: [4, 9],
  },
  {
    id: 'circular_quay',
    name: 'Circular Quay',
    suburb: 'CBD',
    tagline: 'Ferries, tourists, and lunch crowds',
    emoji: '⛴️',
    baseTraffic: 200,
    rentPerDay: 110,
    unlockCost: 1800,
    unlocked: false,
    customerTypes: ['tourist', 'office_worker', 'family'],
    budgetRange: [5, 12],
  },
  {
    id: 'newtown',
    name: 'Newtown',
    suburb: 'Newtown',
    tagline: 'Artsy crowd with big opinions',
    emoji: '🎨',
    baseTraffic: 90,
    rentPerDay: 55,
    unlockCost: 1200,
    unlocked: false,
    customerTypes: ['hipster', 'student', 'tradie'],
    budgetRange: [3, 7],
  },
  {
    id: 'parramatta',
    name: 'Parramatta',
    suburb: 'Parramatta',
    tagline: 'Western Sydney workers and families',
    emoji: '🏙️',
    baseTraffic: 110,
    rentPerDay: 60,
    unlockCost: 1500,
    unlocked: false,
    customerTypes: ['office_worker', 'family', 'tradie', 'student'],
    budgetRange: [3, 6],
  },
  {
    id: 'olympic_park',
    name: 'Olympic Park',
    suburb: 'Olympic Park',
    tagline: 'Event day crowds are massive',
    emoji: '🏟️',
    baseTraffic: 80,
    rentPerDay: 90,
    unlockCost: 2500,
    unlocked: false,
    customerTypes: ['athlete', 'family', 'tourist', 'student'],
    budgetRange: [4, 10],
  },
  {
    id: 'manly',
    name: 'Manly',
    suburb: 'Manly',
    tagline: 'Ferry crowd meets beach life',
    emoji: '🚢',
    baseTraffic: 100,
    rentPerDay: 70,
    unlockCost: 2000,
    unlocked: false,
    customerTypes: ['tourist', 'beachgoer', 'family', 'athlete'],
    budgetRange: [4, 10],
  },
];

// ─── Upgrades ─────────────────────────────────────────────────────────────────
export const INITIAL_UPGRADES: Upgrade[] = [
  {
    id: 'better_cooler',
    name: 'Better Cooler',
    description: 'Heavy-duty esky keeps ice 2× longer',
    effect: 'Ice lasts twice as long on hot days',
    cost: 280,
    purchased: false,
    emoji: '🧊',
    category: 'equipment',
  },
  {
    id: 'faster_blender',
    name: 'Turbo Blender',
    description: 'Serve 35% more cups per minute',
    effect: '+35% service speed',
    cost: 400,
    purchased: false,
    emoji: '⚡',
    category: 'equipment',
  },
  {
    id: 'premium_signage',
    name: 'Premium Signage',
    description: 'Eye-catching neon sign attracts foot traffic',
    effect: '+15% base foot traffic',
    cost: 180,
    purchased: false,
    emoji: '🪧',
    category: 'marketing',
  },
  {
    id: 'umbrella_shade',
    name: 'Beach Umbrella',
    description: 'Shade keeps customers patient on hot days',
    effect: '+50% queue patience in hot weather',
    cost: 150,
    purchased: false,
    emoji: '☂️',
    category: 'equipment',
  },
  {
    id: 'ice_machine',
    name: 'Ice Machine',
    description: 'Make your own ice on-site',
    effect: 'Ice cost reduced by 60%',
    cost: 650,
    purchased: false,
    emoji: '❄️',
    category: 'equipment',
  },
  {
    id: 'loyalty_cards',
    name: 'Loyalty Cards',
    description: 'Every 5th cup free drives repeat visits',
    effect: '+20% repeat customer rate',
    cost: 120,
    purchased: false,
    emoji: '🃏',
    category: 'marketing',
  },
  {
    id: 'bulk_supplier',
    name: 'Bulk Supplier Deal',
    description: 'Lock in a discounted wholesale contract',
    effect: 'All supply costs reduced 25%',
    cost: 350,
    purchased: false,
    emoji: '🚛',
    category: 'supply',
  },
  {
    id: 'hire_casual',
    name: 'Hire Casual Staff',
    description: 'Extra hands on deck to serve customers faster',
    effect: 'Service rate +80%, costs $60/day',
    cost: 0,
    purchased: false,
    emoji: '🧑‍🍳',
    category: 'staff',
  },
  {
    id: 'second_stand',
    name: 'Second Stand',
    description: 'Double your throughput with two serving points',
    effect: 'Service rate ×2',
    cost: 900,
    purchased: false,
    emoji: '🏪',
    category: 'equipment',
  },
];

// ─── News event pool ──────────────────────────────────────────────────────────
export const NEWS_EVENT_POOL: NewsEvent[] = [
  {
    id: 'surf_comp',
    headline: 'Surf comp at Bondi today!',
    body: 'Hundreds of spectators expected at the beach',
    trafficMod: 1.4,
    emoji: '🏄',
  },
  {
    id: 'bus_strike',
    headline: 'Bus strike hits CBD',
    body: 'Workers on foot — capturing the lunch crowd',
    trafficMod: 1.2,
    emoji: '🚌',
  },
  {
    id: 'heatwave_warning',
    headline: 'Bureau of Met issues heat warning',
    body: 'Thirsty punters will pay anything for cold drinks',
    trafficMod: 1.5,
    emoji: '🌡️',
  },
  {
    id: 'rain_incoming',
    headline: 'Afternoon showers on the way',
    body: 'Foot traffic may drop off after midday',
    trafficMod: 0.75,
    emoji: '🌧️',
  },
  {
    id: 'market_day',
    headline: 'Weekend market in full swing',
    body: 'Stall browsers love a cold lemonade',
    trafficMod: 1.3,
    emoji: '🛍️',
  },
  {
    id: 'vivid_preview',
    headline: 'Vivid Sydney setup crews arrive',
    body: 'Workers and media scouting around the CBD',
    trafficMod: 1.25,
    emoji: '💡',
  },
  {
    id: 'footy_final',
    headline: "Footy finals — city's pumping!",
    body: 'Fans heading to the pub route pass your stand',
    trafficMod: 1.6,
    emoji: '🏉',
  },
  {
    id: 'school_holidays',
    headline: 'School holidays start today',
    body: 'Families flooding beaches and parks',
    trafficMod: 1.35,
    emoji: '🎒',
  },
  {
    id: 'road_works',
    headline: 'Road works close main path',
    body: 'Pedestrian detour takes people away from your stand',
    trafficMod: 0.7,
    emoji: '🚧',
  },
  {
    id: 'tiktok_trend',
    headline: "You're going viral on TikTok!",
    body: 'Someone posted your stand — influencer crowds incoming',
    trafficMod: 1.8,
    emoji: '📱',
  },
  {
    id: 'health_inspector',
    headline: 'Health inspector spotted nearby',
    body: 'Competitors nervous — customers trust your clean stand',
    trafficMod: 1.1,
    emoji: '🔍',
  },
  {
    id: 'sydney_hailstorm',
    headline: 'Freak hailstorm clears streets',
    body: 'Sydney doing what Sydney does',
    trafficMod: 0.4,
    emoji: '⛈️',
  },
  {
    id: 'new_years_eve',
    headline: "It's New Year's Eve!",
    body: 'Half a million people flooding the foreshore tonight',
    trafficMod: 2.2,
    emoji: '🎆',
  },
  {
    id: 'public_holiday',
    headline: 'Public holiday — city takes the day off',
    body: 'Families and tourists everywhere',
    trafficMod: 1.45,
    emoji: '🎉',
  },
  {
    id: 'cockatoo_attack',
    headline: 'Cockatoos terrorise outdoor diners',
    body: 'People moving faster than usual — good for quick sales',
    trafficMod: 0.95,
    emoji: '🦜',
  },
];

// ─── Weather generation weights by day ────────────────────────────────────────
// Simulates Sydney's generally hot, sunny climate with occasional storms
export const WEATHER_POOL: Array<{
  condition: WeatherCondition;
  weight: number;
  tempRange: [number, number];
  demandMult: number;
  iceDrainRate: number;
  description: string;
  forecast: string;
  emoji: string;
}> = [
  {
    condition: 'heatwave',
    weight: 8,
    tempRange: [38, 44],
    demandMult: 2.2,
    iceDrainRate: 2.5,
    description: 'Scorching heat wave',
    forecast: 'Extreme heat — stay hydrated!',
    emoji: '🔥',
  },
  {
    condition: 'sunny',
    weight: 30,
    tempRange: [28, 37],
    demandMult: 1.6,
    iceDrainRate: 1.5,
    description: 'Hot and sunny',
    forecast: 'Beautiful summer day',
    emoji: '☀️',
  },
  {
    condition: 'perfect',
    weight: 25,
    tempRange: [22, 27],
    demandMult: 1.2,
    iceDrainRate: 1.0,
    description: 'Perfect Sydney day',
    forecast: 'Just right for a lemonade',
    emoji: '🌤️',
  },
  {
    condition: 'cloudy',
    weight: 18,
    tempRange: [18, 24],
    demandMult: 0.8,
    iceDrainRate: 0.7,
    description: 'Overcast and mild',
    forecast: 'Grey skies, lighter crowds',
    emoji: '☁️',
  },
  {
    condition: 'light_rain',
    weight: 12,
    tempRange: [15, 21],
    demandMult: 0.55,
    iceDrainRate: 0.5,
    description: 'Light showers',
    forecast: 'Bring a brolly',
    emoji: '🌦️',
  },
  {
    condition: 'storm',
    weight: 7,
    tempRange: [14, 18],
    demandMult: 0.3,
    iceDrainRate: 0.3,
    description: 'Thunderstorm',
    forecast: "Don't bother going outside",
    emoji: '⛈️',
  },
];

// ─── Customer type data ────────────────────────────────────────────────────────
export const CUSTOMER_DATA: Record<
  CustomerType,
  {
    emoji: string;
    patienceRange: [number, number]; // game-minutes
    tempBoost: number; // extra demand multiplier on hot days
    priceFlexibility: number; // 0–1, higher = less price sensitive
    icePreference: number; // 0–100, ideal ice level
    sweetnessPreference: number;
  }
> = {
  beachgoer: {
    emoji: '🏄',
    patienceRange: [12, 20],
    tempBoost: 0.4,
    priceFlexibility: 0.6,
    icePreference: 85,
    sweetnessPreference: 45,
  },
  tourist: {
    emoji: '📸',
    patienceRange: [15, 25],
    tempBoost: 0.3,
    priceFlexibility: 0.8,
    icePreference: 65,
    sweetnessPreference: 55,
  },
  office_worker: {
    emoji: '💼',
    patienceRange: [5, 12],
    tempBoost: 0.2,
    priceFlexibility: 0.5,
    icePreference: 50,
    sweetnessPreference: 50,
  },
  family: {
    emoji: '👨‍👩‍👧',
    patienceRange: [10, 18],
    tempBoost: 0.25,
    priceFlexibility: 0.55,
    icePreference: 60,
    sweetnessPreference: 65,
  },
  hipster: {
    emoji: '🧔',
    patienceRange: [8, 16],
    tempBoost: 0.15,
    priceFlexibility: 0.65,
    icePreference: 40,
    sweetnessPreference: 35,
  },
  tradie: {
    emoji: '👷',
    patienceRange: [4, 10],
    tempBoost: 0.35,
    priceFlexibility: 0.4,
    icePreference: 70,
    sweetnessPreference: 60,
  },
  student: {
    emoji: '🎓',
    patienceRange: [8, 18],
    tempBoost: 0.2,
    priceFlexibility: 0.3,
    icePreference: 55,
    sweetnessPreference: 55,
  },
  athlete: {
    emoji: '🏃',
    patienceRange: [6, 14],
    tempBoost: 0.45,
    priceFlexibility: 0.6,
    icePreference: 90,
    sweetnessPreference: 30,
  },
};

// ─── Customer reviews pool ─────────────────────────────────────────────────────
export const REVIEW_TEXTS: Record<number, string[]> = {
  5: [
    'Best lemonade in Sydney, no cap!',
    'Absolutely cold and refreshing, cheers!',
    "Mate, this hits different on a 40° day",
    'Five stars, would queue again 🍋',
    "Perfect sweetness, I'm telling everyone",
    'Came back three times today lol',
  ],
  4: [
    'Pretty good value for the area',
    'Solid lemonade, hit the spot',
    'Queue was worth it',
    'Refreshing! Could use a touch more ice',
    'Nice stand, friendly service',
  ],
  3: [
    'Not bad, but a bit pricey',
    'Average queue wait but drink was okay',
    "Could be sweeter for my taste",
    'It does the job',
    'Decent for this weather',
  ],
  2: [
    'Waited too long for this',
    'A bit too sour for me',
    'Price is a bit steep',
    'Could use more ice on a day like today',
  ],
  1: [
    'Way too expensive, sorry',
    'Queue was brutal, nearly left',
    'Not worth the wait today',
    'Needs more ice in this heat!',
  ],
};

// Demand insight comments during simulation
export const SIM_COMMENTS = [
  '💬 "This is exactly what I needed today!"',
  '💬 "More ice please, legend!"',
  '💬 "Perfect for the beach!"',
  '💬 "Could be a bit cheaper..."',
  '💬 "Absolute ripper, mate!"',
  '💬 "Queue\'s a bit long..."',
  '💬 "Best in the area honestly"',
  '💬 "I\'ll be back tomorrow!"',
  '💬 "Just what I needed on this scorcher"',
  '💬 "A bit too sweet for me"',
  '💬 "Worth every cent!"',
  '💬 "My kids love it!"',
  '💬 "Recommend to everyone!"',
  '💬 "Nice and cold, cheers!"',
];

export const LEAVE_COMMENTS = [
  '💨 "Queue\'s too long, I\'m off"',
  '💨 "Too expensive, heading to 7-Eleven"',
  '💨 "Can\'t wait around all day"',
  '💨 "I\'ll try that other stand"',
];
