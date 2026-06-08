import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { useGameStore } from '../../store/gameStore';
import { COLORS, FONT_SIZE, RADIUS, SPACING, SHADOW } from '../../constants/theme';

function StatRow({
  label,
  value,
  color,
  delay,
  large,
}: {
  label: string;
  value: string;
  color?: string;
  delay?: number;
  large?: boolean;
}) {
  const opacity = useSharedValue(0);
  const x = useSharedValue(20);

  useEffect(() => {
    opacity.value = withDelay(delay ?? 0, withTiming(1, { duration: 400 }));
    x.value = withDelay(delay ?? 0, withSpring(0, { damping: 14 }));
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }],
  }));

  return (
    <Animated.View style={[rowStyles.row, style]}>
      <Text style={[rowStyles.label, large && rowStyles.labelLarge]}>{label}</Text>
      <Text style={[rowStyles.value, large && rowStyles.valueLarge, color ? { color } : {}]}>
        {value}
      </Text>
    </Animated.View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EDE8',
  },
  label: { fontSize: FONT_SIZE.md, color: COLORS.textMid },
  labelLarge: { fontSize: FONT_SIZE.lg, fontWeight: '700', color: COLORS.textDark },
  value: { fontSize: FONT_SIZE.md, fontWeight: '700', color: COLORS.textDark },
  valueLarge: { fontSize: FONT_SIZE.xl, fontWeight: '900' },
});

function RepBadge({ delta }: { delta: number }) {
  const scale = useSharedValue(0.5);
  useEffect(() => {
    scale.value = withDelay(800, withSpring(1, { damping: 8 }));
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const positive = delta >= 0;
  return (
    <Animated.View style={[repStyles.badge, style, { backgroundColor: positive ? '#DCFCE7' : '#FEE2E2' }]}>
      <Text style={repStyles.arrow}>{positive ? '▲' : '▼'}</Text>
      <Text style={[repStyles.text, { color: positive ? '#16A34A' : '#DC2626' }]}>
        {Math.abs(delta)} rep
      </Text>
    </Animated.View>
  );
}

const repStyles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    ...SHADOW.sm,
  },
  arrow: { fontSize: FONT_SIZE.sm, fontWeight: '900' },
  text: { fontSize: FONT_SIZE.md, fontWeight: '800' },
});

function Stars({ count }: { count: number }) {
  return (
    <Text style={{ fontSize: 14, letterSpacing: 1 }}>
      {Array.from({ length: 5 }, (_, i) => (i < count ? '⭐' : '☆')).join('')}
    </Text>
  );
}

export default function ReportScreen() {
  const { lastResult, day, cash, reputation, goPhase } = useGameStore((s) => ({
    lastResult: s.lastResult,
    day: s.day,
    cash: s.cash,
    reputation: s.reputation,
    goPhase: s.goPhase,
  }));

  const headerOpacity = useSharedValue(0);
  const bigNumberScale = useSharedValue(0.7);

  useEffect(() => {
    headerOpacity.value = withTiming(1, { duration: 500 });
    bigNumberScale.value = withDelay(200, withSpring(1, { damping: 10 }));
  }, []);

  const headerStyle = useAnimatedStyle(() => ({ opacity: headerOpacity.value }));
  const bigNumStyle = useAnimatedStyle(() => ({
    transform: [{ scale: bigNumberScale.value }],
  }));

  if (!lastResult) return null;

  const profitPositive = lastResult.profit >= 0;

  function handleNextDay() {
    goPhase('briefing');
    router.replace('/game/briefing');
  }

  return (
    <LinearGradient
      colors={profitPositive ? ['#F0FDF4', '#FFFBEB'] : ['#FFF5F5', '#FFFBEB']}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <Animated.View style={[styles.header, headerStyle]}>
          <Text style={styles.dayLabel}>DAY {lastResult.day} COMPLETE</Text>
          <Text style={styles.subLabel}>
            {lastResult.weatherEmoji} {lastResult.tempC}°C  ·  {lastResult.cupsServed} cups sold
          </Text>
          <RepBadge delta={lastResult.repDelta} />
        </Animated.View>

        {/* Big profit number */}
        <Animated.View style={[styles.profitCard, bigNumStyle, {
          backgroundColor: profitPositive ? '#DCFCE7' : '#FEE2E2',
        }]}>
          <Text style={styles.profitLabel}>Today's Profit</Text>
          <Text style={[styles.profitValue, { color: profitPositive ? '#16A34A' : '#DC2626' }]}>
            {profitPositive ? '+' : ''}{lastResult.profit < 0 ? '-' : ''}$
            {Math.abs(lastResult.profit).toFixed(2)}
          </Text>
          <Text style={styles.totalCash}>Total cash: ${cash.toFixed(2)}</Text>
        </Animated.View>

        {/* Breakdown */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>💰 FINANCIALS</Text>
          <StatRow label="Revenue" value={`$${lastResult.revenue.toFixed(2)}`} color={COLORS.success} delay={100} />
          <StatRow label="Supply costs" value={`-$${lastResult.supplyCost.toFixed(2)}`} color={COLORS.danger} delay={150} />
          <StatRow label="Advertising" value={`-$${lastResult.adCost.toFixed(2)}`} color={COLORS.textMid} delay={200} />
          <StatRow label="Rent + staff" value={`-$${lastResult.rentCost.toFixed(2)}`} color={COLORS.textMid} delay={250} />
          {lastResult.waste > 0 && (
            <StatRow label="Waste (spoiled)" value={`-$${lastResult.waste.toFixed(2)}`} color={COLORS.warning} delay={300} />
          )}
          <StatRow label="Profit" value={`$${lastResult.profit.toFixed(2)}`} color={profitPositive ? COLORS.success : COLORS.danger} delay={350} large />
        </View>

        {/* Performance */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📊 PERFORMANCE</Text>
          <StatRow label="Cups sold" value={lastResult.cupsServed.toString()} delay={200} />
          <StatRow label="Customers missed" value={lastResult.missed.toString()} color={lastResult.missed > 20 ? COLORS.danger : COLORS.textMid} delay={250} />
          <StatRow
            label="Satisfaction"
            value={`${lastResult.satisfaction}%`}
            color={lastResult.satisfaction >= 75 ? COLORS.success : lastResult.satisfaction >= 50 ? COLORS.amber : COLORS.danger}
            delay={300}
          />
          <StatRow label="Reputation" value={`${reputation}/100`} delay={350} />
        </View>

        {/* Reviews */}
        {lastResult.reviews.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>⭐ CUSTOMER REVIEWS</Text>
            {lastResult.reviews.map((r, i) => (
              <Animated.View
                key={i}
                style={[styles.reviewRow]}
              >
                <Stars count={r.stars} />
                <Text style={styles.reviewText}>"{r.text}"</Text>
              </Animated.View>
            ))}
          </View>
        )}

        {/* Tips for tomorrow */}
        <View style={styles.tipCard}>
          <Text style={styles.tipTitle}>💡 FOR TOMORROW</Text>
          <Text style={styles.tipText}>
            {lastResult.satisfaction < 60 && lastResult.missed > 20
              ? '• Queue too long — consider hiring staff or upgrading your blender'
              : lastResult.satisfaction < 60
              ? '• Customer satisfaction is low — tweak your recipe to match the weather'
              : lastResult.profit < 0
              ? '• You lost money today. Try raising prices slightly or cut ad spend'
              : lastResult.missed > 30
              ? '• You missed lots of customers — a faster blender would help'
              : '• Good day! Keep the momentum going 🍋'}
          </Text>
        </View>

        {/* CTA buttons */}
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={styles.upgradesBtn}
            activeOpacity={0.85}
            onPress={() => router.push('/game/upgrades')}
          >
            <Text style={styles.upgradesBtnText}>🏪 Shop</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.nextDayBtn}
            activeOpacity={0.85}
            onPress={handleNextDay}
          >
            <Text style={styles.nextDayBtnText}>Next Day  →</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    padding: SPACING.md,
    paddingTop: SPACING.xl + 20,
    paddingBottom: SPACING.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  dayLabel: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '900',
    color: COLORS.textDark,
    letterSpacing: 2,
  },
  subLabel: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textMid,
  },
  profitCard: {
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    alignItems: 'center',
    marginBottom: SPACING.lg,
    ...SHADOW.md,
  },
  profitLabel: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    color: COLORS.textMid,
    letterSpacing: 1,
    marginBottom: SPACING.xs,
  },
  profitValue: {
    fontSize: 52,
    fontWeight: '900',
    letterSpacing: -1,
  },
  totalCash: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textMid,
    marginTop: SPACING.xs,
    fontWeight: '600',
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOW.sm,
  },
  cardTitle: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: 1.5,
    marginBottom: SPACING.sm,
  },
  reviewRow: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EDE8',
    gap: 4,
  },
  reviewText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textMid,
    fontStyle: 'italic',
    marginTop: 4,
  },
  tipCard: {
    backgroundColor: '#FFFDE7',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.amber,
    marginBottom: SPACING.xl,
  },
  tipTitle: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '800',
    color: COLORS.amberDark,
    letterSpacing: 1,
    marginBottom: SPACING.xs,
  },
  tipText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textDark,
    lineHeight: 22,
  },
  btnRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  upgradesBtn: {
    flex: 0.4,
    backgroundColor: COLORS.creamDark,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.xl,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.amber,
  },
  upgradesBtnText: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    color: COLORS.amberDark,
  },
  nextDayBtn: {
    flex: 0.6,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.xl,
    alignItems: 'center',
    ...SHADOW.md,
  },
  nextDayBtnText: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
