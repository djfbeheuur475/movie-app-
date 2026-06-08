import React, { useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withSpring,
  FadeIn,
  FadeOut,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { useGameStore } from '../../store/gameStore';
import { COLORS, FONT_SIZE, RADIUS, SPACING, SHADOW } from '../../constants/theme';

const { width, height } = Dimensions.get('window');

const SCENE_HEIGHT = height * 0.38;

// Convert tick 0-59 to time string (8am-4pm)
function tickToTime(tick: number): string {
  const totalMin = tick * 8;
  const hour = 8 + Math.floor(totalMin / 60);
  const min = totalMin % 60;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const h = hour > 12 ? hour - 12 : hour;
  return `${h}:${min.toString().padStart(2, '0')}${suffix}`;
}

function getWeatherGradient(condition: string | undefined): string[] {
  const map: Record<string, string[]> = {
    heatwave: ['#FF6B35', '#FFB347'],
    sunny: ['#87CEEB', '#FCD34D'],
    perfect: ['#BAE6FD', '#D1FAE5'],
    cloudy: ['#B0C4DE', '#D3D3D3'],
    light_rain: ['#708090', '#87CEEB'],
    storm: ['#2F4F4F', '#708090'],
  };
  return map[condition ?? 'sunny'] ?? map.sunny;
}

// ─── Animated customer dot ────────────────────────────────────────────────────
function CustomerDot({ customer }: { customer: any }) {
  const posX = useSharedValue(customer.posX < 0.5 ? -30 : width + 30);
  const targetX = (width * 0.5) - 20 + (customer.lane - 2) * 8;

  useEffect(() => {
    posX.value = withTiming(targetX, {
      duration: 1200 + Math.random() * 600,
      easing: Easing.out(Easing.quad),
    });
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: posX.value }],
  }));

  const yPos = SCENE_HEIGHT * 0.55 + customer.lane * 16;

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(400)}
      style={[styles.customerDot, style, { top: yPos }]}
    >
      <Text style={styles.customerEmoji}>{customer.emoji}</Text>
    </Animated.View>
  );
}

// ─── Coin pop animation ───────────────────────────────────────────────────────
function CoinPop({ id }: { id: number }) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    translateY.value = withTiming(-50, { duration: 800, easing: Easing.out(Easing.quad) });
    opacity.value = withTiming(0, { duration: 800 });
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.coinPop, style]}>
      <Text style={styles.coinText}>💰</Text>
    </Animated.View>
  );
}

// ─── Speech bubble ────────────────────────────────────────────────────────────
function CommentBubble({ text }: { text: string }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(10);

  useEffect(() => {
    opacity.value = withSequence(
      withTiming(1, { duration: 300 }),
      withTiming(1, { duration: 2000 }),
      withTiming(0, { duration: 400 })
    );
    translateY.value = withTiming(0, { duration: 300 });
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.commentBubble, style]}>
      <Text style={styles.commentText}>{text}</Text>
    </Animated.View>
  );
}

export default function SimulationScreen() {
  const {
    simTick, simRunning, simSpeed, queue,
    todayRevenue, todayCups, missedCount,
    recentComments, weather, plan, locations,
    expectedCustomers, setSimSpeed,
  } = useGameStore((s) => ({
    simTick: s.simTick,
    simRunning: s.simRunning,
    simSpeed: s.simSpeed,
    queue: s.queue,
    todayRevenue: s.todayRevenue,
    todayCups: s.todayCups,
    missedCount: s.missedCount,
    recentComments: s.recentComments,
    weather: s.weather,
    plan: s.plan,
    locations: s.locations,
    expectedCustomers: s.expectedCustomers,
    setSimSpeed: s.setSimSpeed,
  }));

  const tickSim = useGameStore((s) => s.tickSim);
  const endSim = useGameStore((s) => s.endSim);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const coinKeyRef = useRef(0);
  const [coinPops, setCoinPops] = React.useState<number[]>([]);
  const prevCups = useRef(0);

  const location = locations.find((l) => l.id === plan.locationId)!;
  const gradColors = getWeatherGradient(weather?.condition);

  // Game loop
  useEffect(() => {
    if (!simRunning) return;

    const interval = Math.floor(200 / simSpeed);
    intervalRef.current = setInterval(() => {
      tickSim();
    }, interval);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [simRunning, simSpeed, tickSim]);

  // Coin pop on new sales
  useEffect(() => {
    if (todayCups > prevCups.current) {
      const newId = coinKeyRef.current++;
      setCoinPops((prev) => [...prev.slice(-5), newId]);
      setTimeout(() => {
        setCoinPops((prev) => prev.filter((id) => id !== newId));
      }, 1000);
    }
    prevCups.current = todayCups;
  }, [todayCups]);

  // Satisfaction metric
  const total = todayCups + missedCount;
  const satisfaction = total > 0 ? Math.round((todayCups / total) * 100) : 100;
  const progress = simTick / 60;

  // Stand scale pulse on sales
  const standScale = useSharedValue(1);
  useEffect(() => {
    if (todayCups > 0 && todayCups !== prevCups.current) {
      standScale.value = withSequence(
        withSpring(1.12, { damping: 5 }),
        withSpring(1, { damping: 8 })
      );
    }
  }, [todayCups]);

  const standStyle = useAnimatedStyle(() => ({
    transform: [{ scale: standScale.value }],
  }));

  const queueForDisplay = queue.filter((c) => c.state === 'approaching' || c.state === 'queued');

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <LinearGradient colors={['rgba(0,0,0,0.5)', 'transparent']} style={styles.topBar}>
        <Text style={styles.timeText}>{tickToTime(simTick)}</Text>
        <View style={styles.revenueBlock}>
          <Text style={styles.revenueLabel}>Revenue</Text>
          <Text style={styles.revenueValue}>${todayRevenue.toFixed(2)}</Text>
        </View>
        <View style={styles.weatherBadge}>
          <Text style={styles.weatherBadgeEmoji}>{weather?.emoji}</Text>
          <Text style={styles.weatherBadgeTemp}>{weather?.tempC}°C</Text>
        </View>
      </LinearGradient>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      {/* Scene */}
      <LinearGradient colors={gradColors} style={styles.scene}>
        {/* Location label */}
        <Text style={styles.sceneLocation}>{location.emoji} {location.name}</Text>

        {/* Ground / path */}
        <View style={styles.ground} />

        {/* Stand */}
        <Animated.View style={[styles.standContainer, standStyle]}>
          <Text style={styles.standEmoji}>🍋</Text>
          <View style={styles.standSign}>
            <Text style={styles.standSignText}>Fresh{'\n'}Lemon${plan.price.toFixed(2)}</Text>
          </View>
        </Animated.View>

        {/* Queue indicator */}
        <View style={styles.queueRow}>
          {queueForDisplay.slice(0, 8).map((c) => (
            <Text key={c.id} style={styles.queueEmoji}>{c.emoji}</Text>
          ))}
          {queueForDisplay.length > 8 && (
            <Text style={styles.queueMore}>+{queueForDisplay.length - 8}</Text>
          )}
        </View>

        {/* Walking customers */}
        {queueForDisplay.slice(0, 6).map((c) => (
          <CustomerDot key={c.id} customer={c} />
        ))}

        {/* Coin pops */}
        {coinPops.map((id) => <CoinPop key={id} id={id} />)}

        {/* Weather ambience */}
        {weather?.condition === 'light_rain' && (
          <Text style={styles.rainOverlay}>🌧️</Text>
        )}
        {weather?.condition === 'storm' && (
          <Text style={styles.rainOverlay}>⛈️</Text>
        )}
        {weather?.condition === 'heatwave' && (
          <Text style={styles.heatOverlay}>🌡️</Text>
        )}
      </LinearGradient>

      {/* Comment bubbles */}
      <View style={styles.commentArea}>
        {recentComments.map((c, i) => (
          <CommentBubble key={`${c}-${i}-${simTick}`} text={c} />
        ))}
      </View>

      {/* Live stats */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{todayCups}</Text>
          <Text style={styles.statLabel}>Cups Sold</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: COLORS.danger }]}>{missedCount}</Text>
          <Text style={styles.statLabel}>Missed</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[
            styles.statValue,
            { color: satisfaction >= 75 ? COLORS.success : satisfaction >= 50 ? COLORS.amber : COLORS.danger }
          ]}>
            {satisfaction}%
          </Text>
          <Text style={styles.statLabel}>Happy</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{queueForDisplay.length}</Text>
          <Text style={styles.statLabel}>In Queue</Text>
        </View>
      </View>

      {/* Speed controls */}
      <View style={styles.controls}>
        <View style={styles.speedGroup}>
          {[1, 2, 4].map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.speedBtn, simSpeed === s && styles.speedBtnActive]}
              onPress={() => setSimSpeed(s)}
            >
              <Text style={[styles.speedBtnText, simSpeed === s && styles.speedBtnTextActive]}>
                ×{s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            endSim();
            router.replace('/game/report');
          }}
        >
          <Text style={styles.skipBtnText}>⏩  Skip to End</Text>
        </TouchableOpacity>
      </View>

      {/* Auto-navigate when sim ends */}
      {simTick >= 60 && !simRunning && (
        <View style={styles.endOverlay}>
          <Text style={styles.endText}>Day Complete! 🎉</Text>
          <TouchableOpacity
            style={styles.endBtn}
            onPress={() => router.replace('/game/report')}
          >
            <Text style={styles.endBtnText}>See Results →</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xl + 16,
    paddingBottom: SPACING.sm,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  timeText: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '800',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  revenueBlock: { alignItems: 'center' },
  revenueLabel: {
    fontSize: FONT_SIZE.xs,
    color: 'rgba(255,255,255,0.8)',
    letterSpacing: 1,
    fontWeight: '600',
  },
  revenueValue: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '900',
    color: '#FFE135',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  weatherBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  weatherBadgeEmoji: { fontSize: 20 },
  weatherBadgeTemp: { fontSize: FONT_SIZE.sm, color: '#FFF', fontWeight: '700' },
  progressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginTop: 80 + SPACING.xl,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFE135',
  },
  scene: {
    height: SCENE_HEIGHT,
    position: 'relative',
    overflow: 'hidden',
  },
  sceneLocation: {
    position: 'absolute',
    bottom: 70,
    left: SPACING.md,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.8)',
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
  },
  ground: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: 'rgba(139,115,85,0.4)',
  },
  standContainer: {
    position: 'absolute',
    bottom: 50,
    left: width / 2 - 45,
    alignItems: 'center',
  },
  standEmoji: { fontSize: 64 },
  standSign: {
    backgroundColor: '#FFE135',
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    position: 'absolute',
    top: -10,
    right: -50,
    ...SHADOW.sm,
  },
  standSignText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '800',
    color: COLORS.textDark,
    textAlign: 'center',
  },
  queueRow: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  queueEmoji: { fontSize: 18 },
  queueMore: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  customerDot: {
    position: 'absolute',
  },
  customerEmoji: { fontSize: 20 },
  coinPop: {
    position: 'absolute',
    bottom: 80,
    left: width / 2 - 10,
  },
  coinText: { fontSize: 24 },
  rainOverlay: {
    position: 'absolute',
    top: 20,
    right: 20,
    fontSize: 36,
    opacity: 0.6,
  },
  heatOverlay: {
    position: 'absolute',
    top: 20,
    right: 20,
    fontSize: 36,
    opacity: 0.6,
  },
  commentArea: {
    minHeight: 70,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    justifyContent: 'flex-end',
  },
  commentBubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.xs,
    ...SHADOW.sm,
    alignSelf: 'flex-start',
    maxWidth: '90%',
  },
  commentText: { fontSize: FONT_SIZE.sm, color: COLORS.textDark, fontWeight: '500' },
  statsBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '900',
    color: COLORS.textDark,
  },
  statLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textLight,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    backgroundColor: '#F8F7F4',
    borderTopWidth: 1,
    borderTopColor: '#EEECE8',
  },
  speedGroup: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  speedBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    borderColor: '#E7E5E4',
    backgroundColor: COLORS.white,
    minWidth: 48,
    alignItems: 'center',
  },
  speedBtnActive: { backgroundColor: COLORS.textDark, borderColor: COLORS.textDark },
  speedBtnText: { fontSize: FONT_SIZE.md, fontWeight: '700', color: COLORS.textMid },
  speedBtnTextActive: { color: '#FFE135' },
  skipBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.creamDark,
    borderWidth: 1,
    borderColor: COLORS.amber,
  },
  skipBtnText: {
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    color: COLORS.amberDark,
  },
  endOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.lg,
  },
  endText: {
    fontSize: FONT_SIZE.xxxl,
    fontWeight: '900',
    color: '#FFE135',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  endBtn: {
    backgroundColor: COLORS.success,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.xl,
    ...SHADOW.lg,
  },
  endBtnText: {
    color: '#FFF',
    fontSize: FONT_SIZE.xl,
    fontWeight: '800',
  },
});
