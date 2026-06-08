import React, { useState, useCallback } from 'react';
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
  Linking,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../constants/theme';
import { useApiKeysStore } from '../store/apiKeysStore';
import { requestDeviceCode, pollDeviceToken } from '../lib/trakt';

type Step = 'intro' | 'tmdb' | 'trakt' | 'gemini';

const STEPS: Step[] = ['tmdb', 'trakt', 'gemini'];

function StepDots({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current);
  if (idx < 0) return null;
  return (
    <View style={styles.dots}>
      {STEPS.map((s, i) => (
        <View key={s} style={[styles.dot, i === idx && styles.dotActive, i < idx && styles.dotDone]} />
      ))}
    </View>
  );
}

export default function WelcomeScreen() {
  const router = useRouter();
  const { saveKeys, markSetupDone } = useApiKeysStore();

  const [step, setStep] = useState<Step>('intro');

  // TMDB
  const [tmdbKey, setTmdbKey] = useState('');
  const [tmdbError, setTmdbError] = useState('');

  // Trakt
  const [traktClientId, setTraktClientId] = useState('');
  const [traktCode, setTraktCode] = useState<{ userCode: string; verifyUrl: string } | null>(null);
  const [traktConnecting, setTraktConnecting] = useState(false);
  const [traktConnected, setTraktConnected] = useState(false);

  // Gemini
  const [geminiKey, setGeminiKey] = useState('');
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  const [isSaving, setIsSaving] = useState(false);

  // ── TMDB ──────────────────────────────────────────────────────────────────

  const handleTmdbNext = async () => {
    const key = tmdbKey.trim();
    if (!key) { setTmdbError('A TMDB API key is required to load movie data.'); return; }
    setTmdbError('');
    setIsSaving(true);
    await saveKeys({ tmdbKey: key });
    setIsSaving(false);
    setStep('trakt');
  };

  // ── Trakt ─────────────────────────────────────────────────────────────────

  const handleTraktConnect = useCallback(async () => {
    const clientId = traktClientId.trim();
    if (!clientId) {
      Alert.alert('Missing Client ID', 'Enter your Trakt Client ID first.');
      return;
    }
    setTraktConnecting(true);
    setTraktCode(null);
    try {
      const dc = await requestDeviceCode(clientId);
      setTraktCode({ userCode: dc.user_code, verifyUrl: dc.verification_url });
      Linking.openURL(dc.verification_url);

      const interval = (dc.interval + 1) * 1000;
      const deadline = Date.now() + dc.expires_in * 1000;

      const poll = async (): Promise<void> => {
        if (Date.now() > deadline) {
          setTraktCode(null);
          setTraktConnecting(false);
          Alert.alert('Timed out', 'Code expired. Try connecting again.');
          return;
        }
        await new Promise((r) => setTimeout(r, interval));
        const token = await pollDeviceToken(dc.device_code, clientId);
        if (token) {
          await saveKeys({ traktClientId: clientId, traktAccessToken: token.access_token });
          setTraktCode(null);
          setTraktConnecting(false);
          setTraktConnected(true);
        } else {
          await poll();
        }
      };
      await poll();
    } catch (e: any) {
      setTraktCode(null);
      setTraktConnecting(false);
      Alert.alert('Trakt error', e.message);
    }
  }, [traktClientId, saveKeys]);

  // ── Gemini ────────────────────────────────────────────────────────────────

  const handleFinish = async () => {
    setIsSaving(true);
    const key = geminiKey.trim();
    if (key) await saveKeys({ geminiKey: key });
    await markSetupDone();
    setIsSaving(false);
    router.replace('/(tabs)');
  };

  const handleSkipToFinish = async () => {
    setIsSaving(true);
    await markSetupDone();
    setIsSaving(false);
    router.replace('/(tabs)');
  };

  // ── Render ────────────────────────────────────────────────────────────────

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

      {/* ── Intro ── */}
      {step === 'intro' && (
        <View style={styles.center}>
          <Image source={require('../assets/icon.png')} style={styles.logoImage} contentFit="contain" />
          <Text style={styles.logo}>Next<Text style={styles.logoAccent}>Up</Text></Text>
          <Text style={styles.tagline}>DISCOVER · TRACK · EXPERIENCE</Text>

          <View style={styles.featureList}>
            {[
              { icon: '🎬', label: 'Netflix-style home feed' },
              { icon: '🔍', label: 'Search movies, shows & actors' },
              { icon: '✦', label: 'AI-powered recommendations' },
              { icon: '📅', label: 'New episode calendar' },
              { icon: '📋', label: 'Watchlist with Trakt sync' },
            ].map((f) => (
              <View key={f.label} style={styles.featureRow}>
                <Text style={styles.featureIcon}>{f.icon}</Text>
                <Text style={styles.featureLabel}>{f.label}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep('tmdb')} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Get Started →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── TMDB step ── */}
      {step === 'tmdb' && (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <StepDots current="tmdb" />

          <View style={styles.stepHeader}>
            <Text style={styles.stepBadge}>Step 1 of 3 · Required</Text>
            <Text style={styles.stepTitle}>TMDB API Key</Text>
            <Text style={styles.stepDesc}>
              Powers all movie and TV data. Completely{' '}
              <Text style={styles.highlight}>free</Text> to register.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>How to get your key</Text>
            {[
              'Go to themoviedb.org and create a free account',
              'Settings → API → Request an API key',
              'Choose "Developer" and fill in the form',
              'Copy your API Key (v3 auth)',
            ].map((s, i) => (
              <View key={i} style={styles.instructionRow}>
                <View style={styles.stepCircle}><Text style={styles.stepCircleText}>{i + 1}</Text></View>
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
              style={[styles.input, tmdbError ? styles.inputError : null]}
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

          <TouchableOpacity style={styles.primaryBtn} onPress={handleTmdbNext} disabled={isSaving} activeOpacity={0.85}>
            {isSaving ? <ActivityIndicator color={Colors.text} /> : <Text style={styles.primaryBtnText}>Continue →</Text>}
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── Trakt step ── */}
      {step === 'trakt' && (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <StepDots current="trakt" />

          <View style={styles.stepHeader}>
            <Text style={styles.stepBadge}>Step 2 of 3 · Optional</Text>
            <Text style={styles.stepTitle}>Connect Trakt</Text>
            <Text style={styles.stepDesc}>
              Sync your watch history for "Recently Watched", "New Eps This Week", and smart watchlist tabs.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>How to connect</Text>
            {[
              'Go to trakt.tv and create a free account',
              'trakt.tv/oauth/applications → New Application',
              'Name it anything, set redirect URI to urn:ietf:wg:oauth:2.0:oob',
              'Copy your Client ID',
            ].map((s, i) => (
              <View key={i} style={styles.instructionRow}>
                <View style={styles.stepCircle}><Text style={styles.stepCircleText}>{i + 1}</Text></View>
                <Text style={styles.instructionText}>{s}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => Linking.openURL('https://trakt.tv/oauth/applications/new')}
            >
              <Text style={styles.linkBtnText}>Open Trakt Developer ↗</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Trakt Client ID</Text>
            <TextInput
              style={styles.input}
              value={traktClientId}
              onChangeText={setTraktClientId}
              placeholder="Paste your Client ID..."
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              selectionColor={Colors.primary}
            />
          </View>

          {traktCode && (
            <View style={styles.codeCard}>
              <Text style={styles.codeLabel}>Enter this code at trakt.tv/activate</Text>
              <Text style={styles.codeValue}>{traktCode.userCode}</Text>
              <Text style={styles.codeHint}>Waiting for you to approve in your browser...</Text>
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 8 }} />
            </View>
          )}

          {traktConnected ? (
            <View style={styles.connectedBanner}>
              <Text style={styles.connectedText}>✓ Trakt connected successfully!</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, traktConnecting && styles.btnDisabled]}
              onPress={handleTraktConnect}
              disabled={traktConnecting}
              activeOpacity={0.85}
            >
              {traktConnecting
                ? <ActivityIndicator color={Colors.text} />
                : <Text style={styles.primaryBtnText}>Connect via Trakt →</Text>
              }
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.nextBtn}
            onPress={() => setStep('gemini')}
            disabled={isSaving}
            activeOpacity={0.85}
          >
            <Text style={styles.nextBtnText}>{traktConnected ? 'Continue →' : 'Skip for now'}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── Gemini step ── */}
      {step === 'gemini' && (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <StepDots current="gemini" />

          <View style={styles.stepHeader}>
            <Text style={styles.stepBadge}>Step 3 of 3 · Optional</Text>
            <Text style={styles.stepTitle}>Gemini AI Key</Text>
            <Text style={styles.stepDesc}>
              Enables AI chat, personalised recommendations, and the{' '}
              <Text style={styles.highlight}>✦ AI Picks</Text> home rows.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>How to get your key</Text>
            {[
              'Go to aistudio.google.com',
              'Sign in with your Google account',
              'Click "Get API key" → Create API key',
              'Copy the key and paste it below',
            ].map((s, i) => (
              <View key={i} style={styles.instructionRow}>
                <View style={styles.stepCircle}><Text style={styles.stepCircleText}>{i + 1}</Text></View>
                <Text style={styles.instructionText}>{s}</Text>
              </View>
            ))}
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => Linking.openURL('https://aistudio.google.com/app/apikey')}
            >
              <Text style={styles.linkBtnText}>Open Google AI Studio ↗</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Gemini API Key</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={[styles.input, styles.inputWithBtn]}
                value={geminiKey}
                onChangeText={setGeminiKey}
                placeholder="AIza..."
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showGeminiKey}
                selectionColor={Colors.primary}
              />
              {geminiKey.length > 0 && (
                <TouchableOpacity style={styles.showBtn} onPress={() => setShowGeminiKey((v) => !v)}>
                  <Text style={styles.showBtnText}>{showGeminiKey ? '🙈' : '👁'}</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.hintText}>Free tier available — no credit card required for basic use.</Text>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={handleFinish} disabled={isSaving} activeOpacity={0.85}>
            {isSaving ? <ActivityIndicator color={Colors.text} /> : <Text style={styles.primaryBtnText}>Enter App →</Text>}
          </TouchableOpacity>

          {!geminiKey.trim() && (
            <TouchableOpacity style={styles.nextBtn} onPress={handleSkipToFinish} disabled={isSaving} activeOpacity={0.85}>
              <Text style={styles.nextBtnText}>Skip for now</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.settingsNote}>All keys can be updated anytime in Settings.</Text>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.xl },

  // Logo / intro
  logoImage: { width: 80, height: 80, borderRadius: 20, marginBottom: 12 },
  logo: { fontSize: 60, fontWeight: '900', color: Colors.text, letterSpacing: -2 },
  logoAccent: { color: Colors.primary },
  tagline: { ...Typography.label, color: Colors.textMuted, letterSpacing: 3, marginTop: 4, marginBottom: Spacing.xxl },
  featureList: { width: '100%', gap: Spacing.md, marginBottom: Spacing.xxl },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  featureIcon: { fontSize: 22, width: 32, textAlign: 'center' },
  featureLabel: { ...Typography.body, color: Colors.textSecondary },

  // Step dots
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: Spacing.xl },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.border },
  dotActive: { width: 20, backgroundColor: Colors.primary },
  dotDone: { backgroundColor: Colors.primary + '60' },

  // Step content
  scrollContent: { paddingHorizontal: Spacing.xl, paddingTop: 60, paddingBottom: 48, gap: Spacing.xl },
  stepHeader: { gap: Spacing.sm },
  stepBadge: { ...Typography.label, color: Colors.primary, letterSpacing: 1 },
  stepTitle: { fontSize: 28, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  stepDesc: { ...Typography.body, color: Colors.textSecondary, lineHeight: 22 },
  highlight: { color: Colors.success, fontWeight: '600' },

  // Instruction card
  card: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md,
  },
  cardLabel: { ...Typography.label, color: Colors.textMuted, letterSpacing: 1, marginBottom: 2 },
  instructionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  stepCircle: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 1, flexShrink: 0,
  },
  stepCircleText: { fontSize: 11, fontWeight: '700', color: Colors.background },
  instructionText: { ...Typography.body, color: Colors.textSecondary, flex: 1, lineHeight: 20 },
  linkBtn: { marginTop: Spacing.sm, alignSelf: 'flex-start', borderBottomWidth: 1, borderBottomColor: Colors.primary },
  linkBtnText: { ...Typography.body, color: Colors.primary },

  // Input
  inputGroup: { gap: Spacing.sm },
  inputLabel: { ...Typography.label, color: Colors.textSecondary, letterSpacing: 0.5 },
  inputWrap: { position: 'relative' },
  input: {
    backgroundColor: Colors.surfaceElevated, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 13,
    ...Typography.body, color: Colors.text, borderWidth: 1, borderColor: Colors.border,
  },
  inputWithBtn: { paddingRight: 44 },
  inputError: { borderColor: Colors.error },
  errorText: { ...Typography.caption, color: Colors.error },
  hintText: { ...Typography.caption, color: Colors.textMuted, lineHeight: 17 },
  showBtn: {
    position: 'absolute', right: 12, top: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  showBtnText: { fontSize: 16 },

  // Trakt code display
  codeCard: {
    backgroundColor: Colors.primary + '12', borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.primary + '40',
    padding: Spacing.lg, alignItems: 'center', gap: 6,
  },
  codeLabel: { ...Typography.caption, color: Colors.textSecondary },
  codeValue: { fontSize: 28, fontWeight: '800', color: Colors.primary, letterSpacing: 4 },
  codeHint: { ...Typography.caption, color: Colors.textMuted },

  // Connected banner
  connectedBanner: {
    backgroundColor: Colors.success + '18', borderRadius: BorderRadius.lg,
    borderWidth: 1, borderColor: Colors.success + '40',
    padding: Spacing.md, alignItems: 'center',
  },
  connectedText: { ...Typography.subheading, color: Colors.success, fontWeight: '700' },

  // Buttons
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: BorderRadius.md,
    height: 52, alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { ...Typography.subheading, color: Colors.background, fontWeight: '700' },
  btnDisabled: { opacity: 0.5 },
  nextBtn: {
    height: 48, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
  },
  nextBtnText: { ...Typography.subheading, color: Colors.textMuted },
  settingsNote: { ...Typography.caption, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
