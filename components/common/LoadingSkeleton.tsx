import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, BorderRadius } from '../../constants/theme';

interface Props {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export default function LoadingSkeleton({ width, height, borderRadius = BorderRadius.md, style }: Props) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        { width: width as number, height, borderRadius, opacity },
        style,
      ]}
    />
  );
}

export function PosterSkeleton({ width = 120 }: { width?: number }) {
  return (
    <View style={{ marginRight: 10 }}>
      <LoadingSkeleton width={width} height={width * 1.5} />
      <LoadingSkeleton width={width * 0.8} height={10} style={{ marginTop: 6 }} borderRadius={4} />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: Colors.surfaceElevated,
  },
});
