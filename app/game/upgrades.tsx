import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useGameStore } from '../../store/gameStore';
import { COLORS, FONT_SIZE, RADIUS, SPACING, SHADOW } from '../../constants/theme';
import type { UpgradeId, LocationId } from '../../types/game';

function UpgradeCard({
  upgrade,
  cash,
  onBuy,
  index,
}: {
  upgrade: any;
  cash: number;
  onBuy: () => void;
  index: number;
}) {
  const canAfford = cash >= upgrade.cost || upgrade.cost === 0;
  const isPurchased = upgrade.purchased;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 60).springify()}
      style={[
        styles.upgradeCard,
        isPurchased && styles.upgradeCardOwned,
        !canAfford && !isPurchased && styles.upgradeCardLocked,
      ]}
    >
      <Text style={styles.upgradeEmoji}>{upgrade.emoji}</Text>
      <View style={styles.upgradeInfo}>
        <Text style={[styles.upgradeName, isPurchased && styles.upgradeNameOwned]}>
          {upgrade.name}
        </Text>
        <Text style={styles.upgradeDesc}>{upgrade.description}</Text>
        <Text style={[styles.upgradeEffect, { color: isPurchased ? COLORS.textLight : COLORS.info }]}>
          {isPurchased ? '✓ Active' : upgrade.effect}
        </Text>
      </View>
      <View style={styles.upgradeRight}>
        {isPurchased ? (
          <View style={styles.ownedBadge}>
            <Text style={styles.ownedText}>✓</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.buyBtn, !canAfford && styles.buyBtnDisabled]}
            onPress={onBuy}
            disabled={!canAfford}
            activeOpacity={0.8}
          >
            <Text style={[styles.buyBtnCost, !canAfford && styles.buyBtnCostDisabled]}>
              ${upgrade.cost === 0 ? 'Free' : upgrade.cost}
            </Text>
            <Text style={[styles.buyBtnText, !canAfford && styles.buyBtnDisabledText]}>
              {canAfford ? 'Buy' : '🔒'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

function LocationCard({
  location,
  cash,
  onUnlock,
  index,
}: {
  location: any;
  cash: number;
  onUnlock: () => void;
  index: number;
}) {
  const canAfford = cash >= location.unlockCost;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 80).springify()}
      style={[styles.locationCard, location.unlocked && styles.locationCardOwned]}
    >
      <Text style={styles.locationEmoji}>{location.emoji}</Text>
      <View style={styles.locationInfo}>
        <Text style={styles.locationName}>{location.name}</Text>
        <Text style={styles.locationSuburb}>{location.suburb}</Text>
        <Text style={styles.locationTagline}>{location.tagline}</Text>
        <View style={styles.locationMeta}>
          <Text style={styles.locationMetaText}>👥 {location.baseTraffic} base traffic</Text>
          <Text style={styles.locationMetaText}>🏠 ${location.rentPerDay}/day</Text>
        </View>
      </View>
      <View style={styles.locationRight}>
        {location.unlocked ? (
          <View style={styles.unlockedBadge}>
            <Text style={styles.unlockedText}>✓ Open</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.unlockBtn, !canAfford && styles.unlockBtnDisabled]}
            onPress={onUnlock}
            disabled={!canAfford}
            activeOpacity={0.8}
          >
            <Text style={[styles.unlockCost, !canAfford && { color: COLORS.textLight }]}>
              ${location.unlockCost}
            </Text>
            <Text style={[styles.unlockLabel, !canAfford && { color: COLORS.textLight }]}>
              {canAfford ? 'Unlock' : '🔒'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

export default function UpgradesScreen() {
  const { cash, upgrades, locations, day, reputation, buyUpgrade, unlockLocation, goPhase } = useGameStore((s) => ({
    cash: s.cash,
    upgrades: s.upgrades,
    locations: s.locations,
    day: s.day,
    reputation: s.reputation,
    buyUpgrade: s.buyUpgrade,
    unlockLocation: s.unlockLocation,
    goPhase: s.goPhase,
  }));

  const categories = [
    { id: 'equipment', label: '⚙️  Equipment', color: '#DBEAFE' },
    { id: 'marketing', label: '📣  Marketing', color: '#FEF3C7' },
    { id: 'staff', label: '🧑‍🍳  Staff', color: '#DCFCE7' },
    { id: 'supply', label: '🚛  Supply', color: '#F3E8FF' },
  ];

  function handleDone() {
    goPhase('briefing');
    router.replace('/game/briefing');
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient colors={['#FFFBEB', '#FEF3C7']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>SHOP</Text>
          <Text style={styles.headerSub}>Day {day} · Rep {reputation}/100</Text>
        </View>
        <View style={styles.cashBadge}>
          <Text style={styles.cashEmoji}>💵</Text>
          <Text style={styles.cashText}>${cash.toFixed(0)}</Text>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Upgrades by category */}
        {categories.map((cat) => {
          const catUpgrades = upgrades.filter((u) => u.category === cat.id);
          if (!catUpgrades.length) return null;
          return (
            <View key={cat.id} style={styles.section}>
              <View style={[styles.categoryHeader, { backgroundColor: cat.color }]}>
                <Text style={styles.categoryLabel}>{cat.label}</Text>
              </View>
              {catUpgrades.map((u, i) => (
                <UpgradeCard
                  key={u.id}
                  upgrade={u}
                  cash={cash}
                  onBuy={() => buyUpgrade(u.id as UpgradeId)}
                  index={i}
                />
              ))}
            </View>
          );
        })}

        {/* Locations */}
        <View style={styles.section}>
          <View style={[styles.categoryHeader, { backgroundColor: '#E0F2FE' }]}>
            <Text style={styles.categoryLabel}>📍  Locations</Text>
          </View>
          {locations.map((loc, i) => (
            <LocationCard
              key={loc.id}
              location={loc}
              cash={cash}
              onUnlock={() => unlockLocation(loc.id as LocationId)}
              index={i}
            />
          ))}
        </View>

        {/* Done button */}
        <TouchableOpacity style={styles.doneBtn} onPress={handleDone} activeOpacity={0.85}>
          <Text style={styles.doneBtnText}>Done — Start Day {day + 1}  →</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xl + 16,
    paddingBottom: SPACING.md,
    ...SHADOW.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { fontSize: FONT_SIZE.xl, fontWeight: '700', color: COLORS.textDark },
  headerTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '900',
    color: COLORS.textDark,
    letterSpacing: 2,
  },
  headerSub: { fontSize: FONT_SIZE.xs, color: COLORS.textLight, fontWeight: '600' },
  cashBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    gap: 4,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  cashEmoji: { fontSize: 16 },
  cashText: { fontSize: FONT_SIZE.lg, fontWeight: '800', color: COLORS.successDark },
  scroll: { padding: SPACING.md, paddingBottom: SPACING.xxl },
  section: { marginBottom: SPACING.lg },
  categoryHeader: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.sm,
  },
  categoryLabel: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: 1,
  },
  // Upgrade cards
  upgradeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOW.sm,
    gap: SPACING.sm,
  },
  upgradeCardOwned: {
    backgroundColor: '#F8FFF8',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  upgradeCardLocked: { opacity: 0.65 },
  upgradeEmoji: { fontSize: 32 },
  upgradeInfo: { flex: 1 },
  upgradeName: { fontSize: FONT_SIZE.md, fontWeight: '700', color: COLORS.textDark },
  upgradeNameOwned: { color: COLORS.textMid },
  upgradeDesc: { fontSize: FONT_SIZE.sm, color: COLORS.textMid, marginTop: 2 },
  upgradeEffect: { fontSize: FONT_SIZE.xs, fontWeight: '600', marginTop: 4 },
  upgradeRight: { alignItems: 'center' },
  buyBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    minWidth: 56,
    ...SHADOW.sm,
  },
  buyBtnDisabled: { backgroundColor: '#F0EDE8' },
  buyBtnCost: { fontSize: FONT_SIZE.xs, color: '#FFFFFF', fontWeight: '700' },
  buyBtnCostDisabled: { color: COLORS.textMuted },
  buyBtnText: { fontSize: FONT_SIZE.sm, fontWeight: '800', color: '#FFFFFF' },
  buyBtnDisabledText: { color: COLORS.textMuted },
  ownedBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ownedText: { fontSize: FONT_SIZE.lg, color: COLORS.successDark, fontWeight: '800' },
  // Location cards
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOW.sm,
    gap: SPACING.sm,
  },
  locationCardOwned: {
    borderWidth: 1.5,
    borderColor: '#BBF7D0',
    backgroundColor: '#F8FFF8',
  },
  locationEmoji: { fontSize: 36 },
  locationInfo: { flex: 1 },
  locationName: { fontSize: FONT_SIZE.md, fontWeight: '800', color: COLORS.textDark },
  locationSuburb: { fontSize: FONT_SIZE.xs, color: COLORS.textLight, fontWeight: '600', letterSpacing: 0.5 },
  locationTagline: { fontSize: FONT_SIZE.sm, color: COLORS.textMid, marginTop: 2 },
  locationMeta: { flexDirection: 'row', gap: SPACING.sm, marginTop: 6 },
  locationMetaText: { fontSize: FONT_SIZE.xs, color: COLORS.textLight },
  locationRight: { alignItems: 'center' },
  unlockBtn: {
    backgroundColor: COLORS.skyDeep,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    minWidth: 64,
    ...SHADOW.sm,
  },
  unlockBtnDisabled: { backgroundColor: '#F0EDE8' },
  unlockCost: { fontSize: FONT_SIZE.xs, color: '#FFFFFF', fontWeight: '700' },
  unlockLabel: { fontSize: FONT_SIZE.sm, fontWeight: '800', color: '#FFFFFF' },
  unlockedBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  unlockedText: { fontSize: FONT_SIZE.sm, fontWeight: '700', color: COLORS.successDark },
  doneBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md + 2,
    borderRadius: RADIUS.xl,
    alignItems: 'center',
    ...SHADOW.lg,
    marginTop: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZE.xl,
    fontWeight: '800',
  },
});
