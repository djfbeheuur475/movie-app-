import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DayResult, Location, Upgrade } from '../types/game';

const SAVE_KEY = 'lemonade_tycoon_save_v1';

export interface SaveData {
  day: number;
  cash: number;
  reputation: number;
  totalProfit: number;
  locations: Location[];
  upgrades: Upgrade[];
  history: DayResult[];
  savedAt: number;
}

export async function saveGame(data: SaveData): Promise<void> {
  try {
    await AsyncStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Silently fail — game still playable without persistence
  }
}

export async function loadGame(): Promise<SaveData | null> {
  try {
    const raw = await AsyncStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SaveData;
  } catch {
    return null;
  }
}

export async function clearSave(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}
