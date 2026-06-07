import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Dimensions,
  Linking,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../constants/theme';
import { useApiKeysStore } from '../store/apiKeysStore';

const { height: H } = Dimensions.get('window');

type Step = 'intro' | 'tmdb' | 'done';

export default function WelcomeScreen() {
  const router = useRouter();
  const { saveKeys, markSetupDone } = useApiKeysStore();

  const [step, setStep] = useState<Step>('intro');
  const [tmdbKey, setTmdbKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [tmdbError, setTmdbError] = useState('');

  const handleTmdbNext = async () => {
    const key = tmdbKey.trim();
    if (!key) {
      setTmdbError('A TMDB API key is required to load movie data.');
      return;
    }
    setTmdbError('');
    setIsSaving(true);
    await saveKeys({ tmdbKey: key });
    await markSetupDone();
    setIsSaving(false);
    router.replace('/(tabs)');
  };

  const handleSkip = async () => {
    setIsSaving(true);
    await markSetupDone();
    setIsSaving(false);
    router.replace('/(tabs)');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LinearGradient
        colors={['#1a0e00', '#0d0d0d', Colors.background]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />

      {step === 'intro' && (
        <View style={styles.center}>
          <Image
            source={require('../assets/icon.png')}
            style={styles.logoImage}
            contentFit="contain"
          />
          <Text style={styles.logo}>Next<Text style={styles.logoAccent}>Up</Text></Text>
          <Text style={styles.tagline}>DISCOVER · TRACK · EXPERIENCE</Text>

          <View style={styles.featureList}>
            {[
              { icon: '🎬', label: 'Netflix-style home feed' },
              { icon: '🔍', label: 'Search movies, shows & actors' },
              { icon: '✦', label: 'AI-powered recommendations' },
              { icon: '📅', label: 'Release calendar' },
              { icon: '⚡', label: 'Launch in Stremio' },
            ].map((f) => (
              <View key={f.label} style={styles.featureRow}>
                <Text style={styles.featureIcon}>{f.icon}</Text>
                <Text style={styles.featureLabel}>{f.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.disclaimer}>
            <Text style={styles.disclaimerText}>
              NextUp uses free third-party APIs.{'\n'}
              You'll need a free TMDB API key to get started.
            </Text>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep('tmdb')} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Get Started →</Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 'tmdb' && (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.stepHeader}>
            <Text style={styles.stepNum}>Setup</Text>
            <Text style={styles.stepTitle}>TMDB API Key</Text>
            <Text style={styles.stepDesc}>
              The Movie Database (TMDB) powers all movie and TV data. It's{' '}
              <Text style={styles.highlight}>completely free</Text> to register.
            </Text>
          </View>

          <View style={styles.instructionCard}>
            <Text style={styles.instructionTitle}>How to get your key:</Text>
            {[
              'Go to themoviedb.org',
              'Create a free account',
              'Settings → API → Request an API key',
              'Choose "Developer" and fill the form',
              'Copy your API Key (v3 auth)',
            ].map((s, i) => (
              <View key={i} style={styles.instructionRow}>
                <View style={styles.stepCircle}>
                  <Text style={styles.stepCircleText}>{i + 1}</Text>
                </View>
                <Text style={styles.instructionText}>{s}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => Linking.openURL('https://www.themoviedb.org/settings/api')}
            >
              <Text style={styles.linkBtnText}>Open TMDB Settings ↗</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>API Key (v3 auth)</Text>
            <TextInput
              style={[styles.input, tmdbError && styles.inputError]}
              value={tmdbKey}
              onChangeText={(t) => { setTmdbKey(t); setTmdbError(''); }}
              placeholder="e.g. a1b2c3d4e5f6..."
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              selectionColor={Colors.primary}
            />
            {tmdbError ? <Text style={styles.errorText}>{tmdbError}</Text> : null}
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleTmdbNext}
            disabled={isSaving}
            activeOpacity={0.85}
          >
            {isSaving
              ? <ActivityIndicator color={Colors.text} />
              : <Text style={styles.primaryBtnText}>Enter App →</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} disabled={isSaving}>
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>

          <Text style={styles.settingsNote}>
            You can also add Trakt and Gemini API keys later in Settings.
          </Text>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl },
  logoImage: { width: 80, height: 80, borderRadius: 20, marginBottom: 12 },
  logo: { fontSize: 60, fontWeight: '900', color: Colors.text, letterSpacing: -2 },
  logoAccent: { color: Colors.primary },
  tagline: {
    ...Typography.label, color: Colors.textMuted, letterSpacing: 3, marginTop: 4, marginBottom: Spacing.xxl,
  },
  featureList: { width: '100%', gap: Spacing.md, marginBottom: Spacing.xxl },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  featureIcon: { fontSize: 22, width: 32, textAlign: 'center' },
  featureLabel: { ...Typography.body, color: Colors.textSecondary },
  disclaimer: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
    marginBottom: Spacing.xl, width: '100%',
  },
  disclaimerText: { ...Typography.caption, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    height: 52, alignItems: 'center', justifyContent: 'center', width: '100%',
  },
  primaryBtnText: { ...Typography.subheading, color: Colors.text },
  scrollContent: { paddingHorizontal: Spacing.xl, paddingTop: 60, paddingBottom: 40, gap: Spacing.xl },
  stepHeader: { gap: Spacing.sm },
  stepNum: { ...Typography.label, color: Colors.primary, letterSpacing: 1 },
  stepTitle: { fontSize: 28, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  stepDesc: { ...Typography.body, color: Colors.textSecondary, lineHeight: 22 },
  highlight: { color: Colors.success, fontWeight: '600' },
  instructionCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md,
  },
  instructionTitle: { ...Typography.subheading, color: Colors.text, marginBottom: Spacing.sm },
  instructionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  stepCircle: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  stepCircleText: { fontSize: 11, fontWeight: '700', color: Colors.text },
  instructionText: { ...Typography.body, color: Colors.textSecondary, flex: 1, lineHeight: 20 },
  linkBtn: { marginTop: Spacing.sm, alignSelf: 'flex-start', borderBottomWidth: 1, borderBottomColor: Colors.primary },
  linkBtnText: { ...Typography.body, color: Colors.primary },
  inputGroup: { gap: Spacing.sm },
  inputLabel: { ...Typography.label, color: Colors.textSecondary, letterSpacing: 0.5 },
  input: {
    backgroundColor: Colors.surfaceElevated, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 13, ...Typography.body,
    color: Colors.text, borderWidth: 1, borderColor: Colors.border,
  },
  inputError: { borderColor: Colors.error },
  errorText: { ...Typography.caption, color: Colors.error },
  skipBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  skipText: { ...Typography.body, color: Colors.textMuted },
  settingsNote: {
    ...Typography.caption, color: Colors.textMuted, textAlign: 'center', lineHeight: 18,
  },
});
