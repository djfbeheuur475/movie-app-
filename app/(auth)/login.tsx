import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { setUser } = useAuthStore();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSaveProfile = async () => {
    const name = displayName.trim();
    if (!name) {
      Alert.alert('Name required', 'Please enter your display name.');
      return;
    }
    setIsLoading(true);
    try {
      await setUser({ displayName: name, email: email.trim(), avatarUrl: null });
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestMode = () => {
    router.replace('/(tabs)');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LinearGradient
        colors={['#1a0f00', Colors.background]}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.logoArea}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logoImage}
            contentFit="contain"
          />
          <Text style={styles.logoText}>Next<Text style={styles.logoAccent}>Up</Text></Text>
          <Text style={styles.logoTagline}>DISCOVER · TRACK · EXPERIENCE</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.formTitle}>Create Profile</Text>
          <Text style={styles.formSub}>Your profile is stored locally on this device.</Text>

          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Display name"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            selectionColor={Colors.primary}
          />
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Email (optional)"
            placeholderTextColor={Colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            selectionColor={Colors.primary}
          />

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleSaveProfile}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color={Colors.text} />
            ) : (
              <Text style={styles.primaryBtnText}>Save Profile</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.guestBtn} onPress={handleGuestMode} activeOpacity={0.8}>
            <Text style={styles.guestBtnText}>Continue without profile</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            No account needed. All data is stored locally on your device.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, justifyContent: 'flex-end' },
  logoArea: { alignItems: 'center', paddingTop: 80, paddingBottom: 40 },
  logoText: { fontSize: 52, fontWeight: '900', color: Colors.text, letterSpacing: -2 },
  logoAccent: { color: Colors.primary },
  logoImage: { width: 64, height: 64, borderRadius: 16, marginBottom: 12 },
  logoTagline: {
    ...Typography.caption, color: Colors.textMuted, marginTop: 4, letterSpacing: 2,
  },
  form: {
    padding: Spacing.xl, paddingBottom: 40, backgroundColor: Colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: Colors.border,
  },
  formTitle: { ...Typography.heading, color: Colors.text, marginBottom: Spacing.xs },
  formSub: { ...Typography.caption, color: Colors.textMuted, marginBottom: Spacing.lg, lineHeight: 18 },
  divider: {
    flexDirection: 'row', alignItems: 'center', marginVertical: Spacing.md, gap: Spacing.sm,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { ...Typography.caption, color: Colors.textMuted },
  input: {
    backgroundColor: Colors.surfaceElevated, borderRadius: BorderRadius.md,
    padding: Spacing.md, color: Colors.text, ...Typography.body, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, height: 50,
  },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    height: 50, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.xs,
  },
  primaryBtnText: { ...Typography.subheading, color: Colors.text },
  guestBtn: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    height: 50, alignItems: 'center', justifyContent: 'center',
  },
  guestBtnText: { ...Typography.subheading, color: Colors.textSecondary },
  disclaimer: {
    ...Typography.caption, color: Colors.textMuted,
    textAlign: 'center', marginTop: Spacing.lg, lineHeight: 18,
  },
});
