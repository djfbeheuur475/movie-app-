import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';

export interface MediaToggleOption<T extends string> {
  value: T;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

interface Props<T extends string> {
  options: MediaToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** Segmented Movies / TV switch — shared by Discover and Home so they match. */
export default function MediaToggle<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <View style={styles.toggle} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            style={[styles.btn, active && styles.btnActive]}
            onPress={() => onChange(o.value)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Ionicons name={o.icon} size={16} color={active ? Colors.background : Colors.textSecondary} />
            <Text style={[styles.btnText, active && styles.btnTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: BorderRadius.md,
  },
  btnActive: { backgroundColor: Colors.primary },
  btnText: { ...Typography.subheading, color: Colors.textMuted },
  btnTextActive: { color: Colors.background },
});
