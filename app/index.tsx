import React, { useEffect, useRef } from 'react';
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
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { useGameStore } from '../store/gameStore';
import { COLORS, FONT_SIZE, RADIUS, SPACING, SHADOW } from '../constants/theme';

const { width, height } = Dimensions.get('window');

export default function MainMenu() {
  const newGame = useGameStore((s) => s.newGame);

  // Animations
  const titleScale = useSharedValue(0.8);
  const titleOpacity = useSharedValue(0);
  const subtitleOpacity = useSharedValue(0);
  const btnOpacity = useSharedValue(0);
  const btnScale = useSharedValue(1);
  const lemonBob = useSharedValue(0);
  const sunRotate = useSharedValue(0);

  useEffect(() => {
    titleOpacity.value = withDelay(200, withTiming(1, { duration: 600 }));
    titleScale.value = withDelay(200, withTiming(1, { duration: 600, easing: Easing.out(Easing.back(1.5)) }));
    subtitleOpacity.value = withDelay(700, withTiming(1, { duration: 500 }));
    btnOpacity.value = withDelay(1100, withTiming(1, { duration: 500 }));
    lemonBob.value = withRepeat(
      withSequence(
        withTiming(-12, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      false
    );
    sunRotate.value = withRepeat(withTiming(360, { duration: 20000, easing: Easing.linear }), -1, false);
  }, []);

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ scale: titleScale.value }],
  }));

  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
  }));

  const btnStyle = useAnimatedStyle(() => ({
    opacity: btnOpacity.value,
    transform: [{ scale: btnScale.value }],
  }));

  const lemonStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lemonBob.value }],
  }));

  const sunStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sunRotate.value}deg` }],
  }));

  function handlePlay(mode: 'career' | 'sandbox') {
    btnScale.value = withSequence(
      withTiming(0.94, { duration: 80 }),
      withTiming(1, { duration: 80 })
    );
    newGame(mode);
    router.push('/game/briefing');
  }

  return (
    <LinearGradient colors={['#FCD34D', '#F59E0B', '#D97706']} style={styles.container}>
      {/* Decorative sun */}
      <Animated.View style={[styles.sun, sunStyle]}>
        <Text style={styles.sunEmoji}>✳️</Text>
      </Animated.View>

      {/* Floating clouds */}
      <Text style={[styles.cloud, styles.cloud1]}>☁️</Text>
      <Text style={[styles.cloud, styles.cloud2]}>☁️</Text>

      {/* Sydney skyline row */}
      <View style={styles.skylineRow}>
        <Text style={styles.skylineEmoji}>🌉</Text>
        <Text style={styles.skylineEmoji}>⛴️</Text>
        <Text style={styles.skylineEmoji}>🏖️</Text>
      </View>

      {/* Title */}
      <Animated.View style={[styles.titleBlock, titleStyle]}>
        <Animated.Text style={[styles.lemonHero, lemonStyle]}>🍋</Animated.Text>
        <Text style={styles.titleLine1}>LEMONADE</Text>
        <Text style={styles.titleLine2}>TYCOON</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>☀️ SYDNEY EDITION ☀️</Text>
        </View>
      </Animated.View>

      {/* Tagline */}
      <Animated.Text style={[styles.tagline, subtitleStyle]}>
        Build your empire.{'\n'}One lemonade at a time.
      </Animated.Text>

      {/* Buttons */}
      <Animated.View style={[styles.buttons, btnStyle]}>
        <TouchableOpacity
          style={styles.playBtn}
          activeOpacity={0.85}
          onPress={() => handlePlay('career')}
        >
          <Text style={styles.playBtnText}>▶  PLAY CAREER</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.sandboxBtn}
          activeOpacity={0.85}
          onPress={() => handlePlay('sandbox')}
        >
          <Text style={styles.sandboxBtnText}>🏖️  SANDBOX MODE</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Bottom decorative strip */}
      <View style={styles.bottomStrip}>
        <Text style={styles.stripEmoji}>🦜</Text>
        <Text style={styles.stripEmoji}>🌊</Text>
        <Text style={styles.stripEmoji}>🍋</Text>
        <Text style={styles.stripEmoji}>🌊</Text>
        <Text style={styles.stripEmoji}>🦅</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  sun: {
    position: 'absolute',
    top: 50,
    right: 30,
  },
  sunEmoji: {
    fontSize: 44,
    opacity: 0.6,
  },
  cloud: {
    position: 'absolute',
    fontSize: 32,
    opacity: 0.6,
  },
  cloud1: { top: 80, left: 20 },
  cloud2: { top: 120, right: 80 },
  skylineRow: {
    flexDirection: 'row',
    gap: SPACING.lg,
    marginBottom: SPACING.xl,
    opacity: 0.7,
  },
  skylineEmoji: { fontSize: 32 },
  titleBlock: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  lemonHero: {
    fontSize: 80,
    marginBottom: SPACING.sm,
  },
  titleLine1: {
    fontSize: 42,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 4,
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  titleLine2: {
    fontSize: 52,
    fontWeight: '900',
    color: '#1C1917',
    letterSpacing: 4,
    textShadowColor: 'rgba(255,255,255,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    marginTop: -8,
  },
  badge: {
    backgroundColor: '#1C1917',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    marginTop: SPACING.sm,
  },
  badgeText: {
    color: '#FFE135',
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    letterSpacing: 2,
  },
  tagline: {
    fontSize: FONT_SIZE.lg,
    color: '#FFFBEB',
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 26,
    marginBottom: SPACING.xl,
    textShadowColor: 'rgba(0,0,0,0.15)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  buttons: {
    width: '100%',
    gap: SPACING.sm,
  },
  playBtn: {
    backgroundColor: '#1C1917',
    paddingVertical: SPACING.md + 2,
    borderRadius: RADIUS.xl,
    alignItems: 'center',
    ...SHADOW.lg,
  },
  playBtnText: {
    color: '#FFE135',
    fontSize: FONT_SIZE.xl,
    fontWeight: '800',
    letterSpacing: 1,
  },
  sandboxBtn: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.xl,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  sandboxBtnText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
  bottomStrip: {
    position: 'absolute',
    bottom: SPACING.xl,
    flexDirection: 'row',
    gap: SPACING.lg,
  },
  stripEmoji: { fontSize: 24, opacity: 0.7 },
});
