import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useGameStore } from '../../store/gameStore';
import { getCostPerCup, getExpectedCustomers } from '../../lib/gameEngine';
import { SUPPLY_COSTS, AD_CONFIG, CUP_SIZE_MULT } from '../../constants/gameConfig';
import { COLORS, FONT_SIZE, RADIUS, SPACING, SHADOW } from '../../constants/theme';

// ─── Slider component ─────────────────────────────────────────────────────────
function GameSlider({
  label,
  value,
  onChange,
  hint,
  accentColor,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  accentColor?: string;
}) {
  const color = accentColor ?? COLORS.amber;
  const steps = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  return (
    <View style={sliderStyles.row}>
      <View style={sliderStyles.top}>
        <Text style={sliderStyles.label}>{label}</Text>
        <Text style={[sliderStyles.value, { color }]}>{value}%</Text>
      </View>
      <View style={sliderStyles.track}>
        <View
          style={[
            sliderStyles.fill,
            { width: `${value}%`, backgroundColor: color },
          ]}
        />
        <View style={sliderStyles.ticks}>
          {steps.map((s) => (
            <TouchableOpacity
              key={s}
              style={sliderStyles.tickHit}
              onPress={() => onChange(s)}
            />
          ))}
        </View>
      </View>
      <View style={sliderStyles.dots}>
        {steps.map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => onChange(s)}
            style={[
              sliderStyles.dot,
              value >= s && { backgroundColor: color },
            ]}
          />
        ))}
      </View>
      {hint && <Text style={sliderStyles.hint}>{hint}</Text>}
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  row: { marginBottom: SPACING.md },
  top: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.xs },
  label: { fontSize: FONT_SIZE.md, fontWeight: '600', color: COLORS.textDark },
  value: { fontSize: FONT_SIZE.md, fontWeight: '800' },
  track: {
    height: 12,
    backgroundColor: '#E7E5E4',
    borderRadius: RADIUS.full,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: { height: '100%', borderRadius: RADIUS.full },
  ticks: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  tickHit: { flex: 1, height: '100%' },
  dots: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D6D3D1',
  },
  hint: { fontSize: FONT_SIZE.xs, color: COLORS.textLight, marginTop: 2 },
});

// ─── Supply item card ─────────────────────────────────────────────────────────
function SupplyRow({
  emoji,
  label,
  current,
  costPer,
  onBuy,
  cash,
  warning,
}: {
  emoji: string;
  label: string;
  current: number;
  costPer: number;
  onBuy: (qty: number) => void;
  cash: number;
  warning?: boolean;
}) {
  return (
    <View style={[supplyStyles.row, warning && supplyStyles.warningRow]}>
      <Text style={supplyStyles.emoji}>{emoji}</Text>
      <View style={supplyStyles.info}>
        <Text style={supplyStyles.label}>{label}</Text>
        <Text style={[supplyStyles.stock, warning && { color: COLORS.danger }]}>
          {warning ? '⚠️ ' : ''}{current} units
        </Text>
      </View>
      <View style={supplyStyles.btns}>
        {[10, 25, 50].map((qty) => {
          const cost = parseFloat((costPer * qty).toFixed(2));
          const canAfford = cash >= cost;
          return (
            <TouchableOpacity
              key={qty}
              style={[supplyStyles.buyBtn, !canAfford && supplyStyles.buyBtnDisabled]}
              onPress={() => canAfford && onBuy(qty)}
              activeOpacity={0.75}
            >
              <Text style={[supplyStyles.buyBtnLabel, !canAfford && supplyStyles.buyBtnLabelDisabled]}>
                +{qty}
              </Text>
              <Text style={[supplyStyles.buyBtnCost, !canAfford && supplyStyles.buyBtnLabelDisabled]}>
                ${cost.toFixed(0)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const supplyStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOW.sm,
    gap: SPACING.sm,
  },
  warningRow: {
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    backgroundColor: '#FFF5F5',
  },
  emoji: { fontSize: 28 },
  info: { flex: 1 },
  label: { fontSize: FONT_SIZE.md, fontWeight: '700', color: COLORS.textDark },
  stock: { fontSize: FONT_SIZE.sm, color: COLORS.textMid, marginTop: 2 },
  btns: { flexDirection: 'row', gap: 6 },
  buyBtn: {
    backgroundColor: '#F0FDF4',
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    minWidth: 42,
  },
  buyBtnDisabled: {
    backgroundColor: '#F5F5F4',
    borderColor: '#E7E5E4',
  },
  buyBtnLabel: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    color: COLORS.successDark,
  },
  buyBtnCost: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.successDark,
    marginTop: 1,
  },
  buyBtnLabelDisabled: { color: COLORS.textMuted },
});

export default function PlanningScreen() {
  const {
    plan, weather, cash, day, supplies, locations, reputation,
    upgrades, updatePlan, updateRecipe, buySupply, startSim,
  } = useGameStore((s) => ({
    plan: s.plan,
    weather: s.weather,
    cash: s.cash,
    day: s.day,
    supplies: s.supplies,
    locations: s.locations,
    reputation: s.reputation,
    upgrades: s.upgrades,
    updatePlan: s.updatePlan,
    updateRecipe: s.updateRecipe,
    buySupply: s.buySupply,
    startSim: s.startSim,
  }));

  const location = locations.find((l) => l.id === plan.locationId)!;
  const costPerCup = getCostPerCup(plan, upgrades);
  const sizeMult = CUP_SIZE_MULT[plan.recipe.cupSize];
  const effectivePrice = plan.price * sizeMult.price;
  const margin = effectivePrice - costPerCup;
  const adCost = AD_CONFIG[plan.advertising].cost;

  const expectedCustomers = weather
    ? getExpectedCustomers(location, weather, [], plan, reputation, upgrades)
    : 0;
  const estRevenue = expectedCustomers * effectivePrice * 0.75; // rough 75% conversion
  const estProfit = estRevenue - (costPerCup * expectedCustomers * 0.75) - adCost - location.rentPerDay;

  function handleStart() {
    if (supplies.lemons < 10 || supplies.sugar < 10 || supplies.ice < 5) {
      Alert.alert(
        'Low Supplies!',
        'You\'re running low on ingredients. Are you sure you want to start?',
        [
          { text: 'Buy More', style: 'cancel' },
          { text: 'Start Anyway', onPress: doStart },
        ]
      );
      return;
    }
    doStart();
  }

  function doStart() {
    startSim();
    router.push('/game/simulation');
  }

  const AD_TIERS = [
    { id: 'none' as const, label: 'None', cost: 0, emoji: '🚫' },
    { id: 'flyer' as const, label: 'Flyer', cost: 20, emoji: '📄' },
    { id: 'social' as const, label: 'Social', cost: 80, emoji: '📱' },
    { id: 'hype' as const, label: 'Full Hype', cost: 200, emoji: '🔥' },
  ];

  const CUP_SIZES = [
    { id: 'S' as const, label: 'Small', mult: 0.75 },
    { id: 'M' as const, label: 'Medium', mult: 1.0 },
    { id: 'L' as const, label: 'Large', mult: 1.35 },
  ];

  // Price steps $0.50 each, $1.50–$12.00
  const priceSteps = Array.from({ length: 22 }, (_, i) => 1.5 + i * 0.5);

  return (
    <View style={styles.container}>
      {/* Sticky header */}
      <LinearGradient colors={['#FFFBEB', '#FEF3C7']} style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerDay}>DAY {day} — PLAN</Text>
          <Text style={styles.headerLoc}>{location.emoji} {location.name}</Text>
        </View>
        <View style={styles.cashBadge}>
          <Text style={styles.cashEmoji}>💵</Text>
          <Text style={styles.cashText}>${cash.toFixed(0)}</Text>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ─── RECIPE ─── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🍋 RECIPE</Text>
          <View style={styles.card}>
            <GameSlider
              label="Lemon Strength"
              value={plan.recipe.lemonStrength}
              onChange={(v) => updateRecipe({ lemonStrength: v })}
              hint={plan.recipe.lemonStrength > 70 ? 'Very tart — hipsters love it' : plan.recipe.lemonStrength < 30 ? 'Very mild' : 'Balanced'}
              accentColor='#EAB308'
            />
            <GameSlider
              label="Sweetness"
              value={plan.recipe.sweetness}
              onChange={(v) => updateRecipe({ sweetness: v })}
              hint={plan.recipe.sweetness > 70 ? 'Quite sweet — families love this' : plan.recipe.sweetness < 30 ? 'Barely sweet' : 'Just right'}
              accentColor='#EC4899'
            />
            <GameSlider
              label="Ice"
              value={plan.recipe.ice}
              onChange={(v) => updateRecipe({ ice: v })}
              hint={weather && weather.tempC >= 32
                ? `🔥 ${weather.tempC}°C — more ice = more sales!`
                : weather && weather.tempC < 20
                ? '❄️ Cold day — dial back the ice'
                : 'Moderate ice'}
              accentColor={weather && weather.tempC >= 32 ? '#EF4444' : '#0EA5E9'}
            />
            {/* Cup size */}
            <Text style={styles.subLabel}>Cup Size</Text>
            <View style={styles.sizeRow}>
              {CUP_SIZES.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[
                    styles.sizeBtn,
                    plan.recipe.cupSize === s.id && styles.sizeBtnActive,
                  ]}
                  onPress={() => updateRecipe({ cupSize: s.id })}
                >
                  <Text style={[styles.sizeBtnText, plan.recipe.cupSize === s.id && styles.sizeBtnTextActive]}>
                    {s.label}
                  </Text>
                  <Text style={[styles.sizeMult, plan.recipe.cupSize === s.id && { color: '#fff' }]}>
                    ×{s.mult}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* ─── PRICE ─── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💰 PRICE</Text>
          <View style={styles.card}>
            <View style={styles.priceDisplay}>
              <Text style={styles.priceValue}>${effectivePrice.toFixed(2)}</Text>
              <View style={styles.priceInfo}>
                <Text style={styles.priceMarginLabel}>Margin: </Text>
                <Text style={[styles.priceMargin, { color: margin > 0 ? COLORS.success : COLORS.danger }]}>
                  ${margin.toFixed(2)}/cup
                </Text>
              </View>
            </View>

            {/* Price selector grid */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.priceScroll}>
              {priceSteps.map((p) => {
                const effective = p * sizeMult.price;
                const isSelected = Math.abs(plan.price - p) < 0.01;
                const isSweet = location.budgetRange[1] > effective && effective > location.budgetRange[0];
                return (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.priceChip,
                      isSelected && styles.priceChipSelected,
                      isSweet && !isSelected && styles.priceChipSweet,
                    ]}
                    onPress={() => updatePlan({ price: p })}
                  >
                    <Text style={[styles.priceChipText, isSelected && styles.priceChipTextSelected]}>
                      ${p.toFixed(2)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={styles.sweetSpotNote}>
              💡 Sweet spot for {location.name}: ${location.budgetRange[0].toFixed(2)}–${location.budgetRange[1].toFixed(2)}
            </Text>
          </View>
        </View>

        {/* ─── SUPPLIES ─── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🛒 SUPPLIES</Text>
          <SupplyRow
            emoji="🍋"
            label="Lemons"
            current={supplies.lemons}
            costPer={SUPPLY_COSTS.lemons}
            onBuy={(qty) => buySupply('lemons', qty)}
            cash={cash}
            warning={supplies.lemons < 20}
          />
          <SupplyRow
            emoji="🍬"
            label="Sugar"
            current={supplies.sugar}
            costPer={SUPPLY_COSTS.sugar}
            onBuy={(qty) => buySupply('sugar', qty)}
            cash={cash}
            warning={supplies.sugar < 20}
          />
          <SupplyRow
            emoji="🧊"
            label="Ice"
            current={supplies.ice}
            costPer={SUPPLY_COSTS.ice}
            onBuy={(qty) => buySupply('ice', qty)}
            cash={cash}
            warning={supplies.ice < 20}
          />
        </View>

        {/* ─── ADVERTISING ─── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📣 ADVERTISING</Text>
          <View style={styles.adGrid}>
            {AD_TIERS.map((tier) => {
              const isSelected = plan.advertising === tier.id;
              const canAfford = cash >= tier.cost;
              return (
                <TouchableOpacity
                  key={tier.id}
                  style={[
                    styles.adCard,
                    isSelected && styles.adCardSelected,
                    !canAfford && tier.cost > 0 && styles.adCardDisabled,
                  ]}
                  onPress={() => canAfford && updatePlan({ advertising: tier.id })}
                  activeOpacity={0.8}
                >
                  <Text style={styles.adEmoji}>{tier.emoji}</Text>
                  <Text style={[styles.adLabel, isSelected && styles.adLabelSelected]}>
                    {tier.label}
                  </Text>
                  <Text style={[styles.adCost, isSelected && styles.adCostSelected]}>
                    {tier.cost > 0 ? `$${tier.cost}` : 'Free'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ─── ESTIMATE ─── */}
        <View style={styles.estimateCard}>
          <Text style={styles.estimateTitle}>📈 TODAY'S ESTIMATE</Text>
          <View style={styles.estimateRow}>
            <Text style={styles.estimateLabel}>Expected customers</Text>
            <Text style={styles.estimateValue}>~{expectedCustomers}</Text>
          </View>
          <View style={styles.estimateRow}>
            <Text style={styles.estimateLabel}>Est. revenue</Text>
            <Text style={[styles.estimateValue, { color: COLORS.success }]}>${estRevenue.toFixed(0)}</Text>
          </View>
          <View style={[styles.estimateRow, { borderTopWidth: 1, borderTopColor: '#E7E5E4', marginTop: 8, paddingTop: 8 }]}>
            <Text style={[styles.estimateLabel, { fontWeight: '700' }]}>Est. profit</Text>
            <Text style={[styles.estimateValue, { color: estProfit > 0 ? COLORS.success : COLORS.danger, fontWeight: '800' }]}>
              ${estProfit.toFixed(0)}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.startBtn} onPress={handleStart} activeOpacity={0.85}>
          <Text style={styles.startBtnText}>Start Day  →</Text>
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
  backText: { fontSize: FONT_SIZE.xl, color: COLORS.textDark, fontWeight: '700' },
  headerDay: { fontSize: FONT_SIZE.xs, fontWeight: '800', color: COLORS.textLight, letterSpacing: 1.5 },
  headerLoc: { fontSize: FONT_SIZE.lg, fontWeight: '800', color: COLORS.textDark },
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
  sectionTitle: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: 1.5,
    marginBottom: SPACING.sm,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    ...SHADOW.sm,
  },
  subLabel: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    color: COLORS.textMid,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  sizeRow: { flexDirection: 'row', gap: SPACING.sm },
  sizeBtn: {
    flex: 1,
    borderRadius: RADIUS.md,
    borderWidth: 2,
    borderColor: '#E7E5E4',
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  sizeBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primaryDark },
  sizeBtnText: { fontSize: FONT_SIZE.md, fontWeight: '700', color: COLORS.textDark },
  sizeBtnTextActive: { color: '#FFF' },
  sizeMult: { fontSize: FONT_SIZE.xs, color: COLORS.textLight, marginTop: 2 },
  priceDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  priceValue: {
    fontSize: FONT_SIZE.xxxl,
    fontWeight: '900',
    color: COLORS.textDark,
  },
  priceInfo: { flexDirection: 'row', alignItems: 'center' },
  priceMarginLabel: { fontSize: FONT_SIZE.sm, color: COLORS.textMid },
  priceMargin: { fontSize: FONT_SIZE.md, fontWeight: '800' },
  priceScroll: { marginBottom: SPACING.sm },
  priceChip: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: '#E7E5E4',
    marginRight: 6,
    minWidth: 54,
    alignItems: 'center',
  },
  priceChipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primaryDark },
  priceChipSweet: { borderColor: '#22C55E', backgroundColor: '#F0FDF4' },
  priceChipText: { fontSize: FONT_SIZE.sm, fontWeight: '600', color: COLORS.textDark },
  priceChipTextSelected: { color: '#FFF', fontWeight: '800' },
  sweetSpotNote: { fontSize: FONT_SIZE.xs, color: COLORS.textLight },
  adGrid: { flexDirection: 'row', gap: SPACING.sm },
  adCard: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.lg,
    padding: SPACING.sm,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E7E5E4',
    ...SHADOW.sm,
  },
  adCardSelected: { borderColor: COLORS.primary, backgroundColor: '#FFFBEB' },
  adCardDisabled: { opacity: 0.4 },
  adEmoji: { fontSize: 22, marginBottom: 4 },
  adLabel: { fontSize: FONT_SIZE.xs, fontWeight: '700', color: COLORS.textDark, textAlign: 'center' },
  adLabelSelected: { color: COLORS.primary },
  adCost: { fontSize: FONT_SIZE.xs, color: COLORS.textLight, marginTop: 2 },
  adCostSelected: { color: COLORS.amber },
  estimateCard: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    ...SHADOW.sm,
  },
  estimateTitle: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  estimateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  estimateLabel: { fontSize: FONT_SIZE.md, color: COLORS.textMid },
  estimateValue: { fontSize: FONT_SIZE.md, fontWeight: '700', color: COLORS.textDark },
  startBtn: {
    backgroundColor: COLORS.success,
    paddingVertical: SPACING.md + 2,
    borderRadius: RADIUS.xl,
    alignItems: 'center',
    ...SHADOW.lg,
    marginBottom: SPACING.xl,
  },
  startBtnText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZE.xl,
    fontWeight: '800',
  },
});
