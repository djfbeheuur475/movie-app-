import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { useGameStore } from '../../store/gameStore';
import { getExpectedCustomers } from '../../lib/gameEngine';
import { COLORS, FONT_SIZE, RADIUS, SPACING, SHADOW } from '../../constants/theme';
import type { Location, Upgrade } from '../../types/game';

const { width } = Dimensions.get('window');

function getWeatherGradient(condition: string): string[] {
  const map: Record<string, string[]> = {
    heatwave: ['#FF6B35', '#F59E0B'],
    sunny: ['#FCD34D', '#FBBF24'],
    perfect: ['#BAE6FD', '#6EE7B7'],
    cloudy: ['#94A3B8', '#CBD5E1'],
    light_rain: ['#60A5FA', '#93C5FD'],
    storm: ['#334155', '#1E293B'],
  };
  return map[condition] ?? map.sunny;
}

function getTimeOfDay(tick: number): string {
  const hour = 8 + Math.floor(tick * 8 / 60);
  const suffix = hour >= 12 ? 'pm' : 'am';
  const h = hour > 12 ? hour - 12 : hour;
  return `${h}:00${suffix}`;
}

function DemandBar({ expected, max = 300 }: { expected: number; max?: number }) {
  const pct = Math.min(1, expected / max);
  const barW = useSharedValue(0);

  useEffect(() => {
    barW.value = withDelay(600, withTiming(pct, { duration: 800 }));
  }, [expected]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${barW.value * 100}%`,
  }));

  const color =
    pct > 0.8 ? '#EF4444' :
    pct > 0.5 ? '#F59E0B' : '#22C55E';

  return (
    <View style={demandStyles.wrap}>
      <View style={demandStyles.track}>
        <Animated.View style={[demandStyles.fill, barStyle, { backgroundColor: color }]} />
      </View>
      <Text style={[demandStyles.label, { color }]}>
        ~{expected} customers expected
      </Text>
    </View>
  );
}

const demandStyles = StyleSheet.create({
  wrap: { marginTop: SPACING.sm },
  track: {
    height: 10,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: RADIUS.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: RADIUS.full,
  },
  label: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    marginTop: SPACING.xs,
  },
});

function NewsCard({ event, index }: { event: any; index: number }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    opacity.value = withDelay(400 + index * 150, withTiming(1, { duration: 400 }));
    translateY.value = withDelay(400 + index * 150, withSpring(0, { damping: 14 }));
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const isPositive = event.trafficMod >= 1;

  return (
    <Animated.View style={[newsStyles.card, style]}>
      <Text style={newsStyles.emoji}>{event.emoji}</Text>
      <View style={newsStyles.content}>
        <Text style={newsStyles.headline}>{event.headline}</Text>
        <Text style={newsStyles.body}>{event.body}</Text>
      </View>
      <View style={[newsStyles.tag, { backgroundColor: isPositive ? '#DCFCE7' : '#FEE2E2' }]}>
        <Text style={[newsStyles.tagText, { color: isPositive ? '#16A34A' : '#DC2626' }]}>
          {isPositive ? `+${Math.round((event.trafficMod - 1) * 100)}%` : `${Math.round((event.trafficMod - 1) * 100)}%`}
        </Text>
      </View>
    </Animated.View>
  );
}

const newsStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOW.sm,
    gap: SPACING.sm,
  },
  emoji: { fontSize: 28 },
  content: { flex: 1 },
  headline: { fontSize: FONT_SIZE.md, fontWeight: '700', color: COLORS.textDark },
  body: { fontSize: FONT_SIZE.sm, color: COLORS.textMid, marginTop: 2 },
  tag: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.sm,
  },
  tagText: { fontSize: FONT_SIZE.xs, fontWeight: '700' },
});

export default function BriefingScreen() {
  const { weather, todayEvents, day, plan, locations, reputation } = useGameStore((s) => ({
    weather: s.weather,
    todayEvents: s.todayEvents,
    day: s.day,
    plan: s.plan,
    locations: s.locations,
    reputation: s.reputation,
  }));
  const upgrades = useGameStore((s) => s.upgrades);
  const [expectedCustomers, setExpected] = React.useState(0);

  const headerOpacity = useSharedValue(0);
  const weatherScale = useSharedValue(0.9);

  useEffect(() => {
    headerOpacity.value = withTiming(1, { duration: 500 });
    weatherScale.value = withSpring(1, { damping: 12 });

    if (weather) {
      const loc = locations.find((l: Location) => l.id === plan.locationId)!;
      const expected = getExpectedCustomers(loc, weather, todayEvents, plan, reputation, upgrades);
      setExpected(expected);
    }
  }, [weather]);

  const headerStyle = useAnimatedStyle(() => ({ opacity: headerOpacity.value }));
  const weatherCardStyle = useAnimatedStyle(() => ({ transform: [{ scale: weatherScale.value }] }));

  if (!weather) return null;

  const gradColors = getWeatherGradient(weather.condition);
  const location = locations.find((l) => l.id === plan.locationId)!;

  return (
    <LinearGradient colors={[...gradColors, '#FFFBEB']} style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View style={[styles.header, headerStyle]}>
          <View>
            <Text style={styles.dayLabel}>DAY {day}</Text>
            <Text style={styles.locationName}>{location.emoji} {location.name}</Text>
          </View>
          <View style={styles.repBadge}>
            <Text style={styles.repEmoji}>⭐</Text>
            <Text style={styles.repText}>{reputation}</Text>
          </View>
        </Animated.View>

        {/* Weather card */}
        <Animated.View style={[styles.weatherCard, weatherCardStyle]}>
          <Text style={styles.weatherEmoji}>{weather.emoji}</Text>
          <View style={styles.weatherInfo}>
            <Text style={styles.weatherDesc}>{weather.description}</Text>
            <Text style={styles.tempText}>{weather.tempC}°C</Text>
          </View>
          <View style={styles.weatherRight}>
            <Text style={styles.forecastLabel}>FORECAST</Text>
            <Text style={styles.forecastText}>{weather.forecast}</Text>
          </View>
        </Animated.View>

        {/* Demand forecast */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📊 DEMAND FORECAST</Text>
          <DemandBar expected={expectedCustomers} />
          <Text style={styles.peakNote}>Peak 11am – 2pm</Text>
        </View>

        {/* News */}
        {todayEvents.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📰 TODAY'S NEWS</Text>
            {todayEvents.map((e, i) => (
              <NewsCard key={e.id} event={e} index={i} />
            ))}
          </View>
        )}

        {/* Tips based on weather */}
        <View style={styles.tipCard}>
          <Text style={styles.tipEmoji}>💡</Text>
          <Text style={styles.tipText}>
            {weather.tempC >= 35
              ? `It's scorching! Load up on ice and keep prices fair — customers are desperate.`
              : weather.tempC >= 28
              ? `Hot sunny day. Ice is king. Consider bumping your price slightly.`
              : weather.condition === 'light_rain'
              ? `Rainy day ahead. Expect light traffic. Keep costs low.`
              : weather.condition === 'storm'
              ? `Storm warning! Minimal traffic today. Play it safe.`
              : `Nice day. Good conditions for building reputation.`}
          </Text>
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={styles.planBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/game/planning')}
        >
          <Text style={styles.planBtnText}>Plan My Day  →</Text>
        </TouchableOpacity>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: {
    padding: SPACING.md,
    paddingTop: SPACING.xl + 16,
    paddingBottom: SPACING.xxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.lg,
  },
  dayLabel: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '800',
    color: 'rgba(28,25,23,0.5)',
    letterSpacing: 2,
  },
  locationName: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '800',
    color: COLORS.textDark,
    marginTop: 2,
  },
  repBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    gap: 4,
    ...SHADOW.sm,
  },
  repEmoji: { fontSize: 16 },
  repText: { fontSize: FONT_SIZE.md, fontWeight: '800', color: COLORS.textDark },
  weatherCard: {
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: RADIUS.xl,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.lg,
    gap: SPACING.md,
    ...SHADOW.md,
  },
  weatherEmoji: { fontSize: 52 },
  weatherInfo: { flex: 1 },
  weatherDesc: { fontSize: FONT_SIZE.lg, fontWeight: '700', color: COLORS.textDark },
  tempText: { fontSize: FONT_SIZE.xxxl, fontWeight: '900', color: COLORS.primary },
  weatherRight: { alignItems: 'flex-end' },
  forecastLabel: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
    color: COLORS.textLight,
    letterSpacing: 1,
  },
  forecastText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMid,
    textAlign: 'right',
    maxWidth: 110,
  },
  section: { marginBottom: SPACING.lg },
  sectionTitle: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '800',
    color: COLORS.textDark,
    letterSpacing: 1.5,
    marginBottom: SPACING.sm,
  },
  peakNote: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textLight,
    marginTop: SPACING.xs,
  },
  tipCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFDE7',
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    gap: SPACING.sm,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.amber,
    marginBottom: SPACING.xl,
    alignItems: 'flex-start',
  },
  tipEmoji: { fontSize: 20, marginTop: 1 },
  tipText: {
    flex: 1,
    fontSize: FONT_SIZE.md,
    color: COLORS.textDark,
    lineHeight: 22,
  },
  planBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md + 2,
    borderRadius: RADIUS.xl,
    alignItems: 'center',
    ...SHADOW.lg,
  },
  planBtnText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZE.xl,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
