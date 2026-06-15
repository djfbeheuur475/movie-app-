import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { BorderRadius, Spacing, Typography } from '../../constants/theme';
import { TASTE_MODE_CONFIG, type TasteMode } from '../../lib/tasteDna';

interface Props {
  mode: TasteMode;
}

export default function TasteModeChip({ mode }: Props) {
  const config = TASTE_MODE_CONFIG[mode];
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [mode]);

  return (
    <Animated.View style={[styles.chip, { borderColor: config.color + '60', opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={[styles.dot, { backgroundColor: config.color }]} />
      <Text style={styles.label}>{config.icon} {config.label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginLeft: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    fontWeight: '500',
  },
});
