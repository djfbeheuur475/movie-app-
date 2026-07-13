import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../constants/theme';
import { useApiKeysStore } from '../store/apiKeysStore';
import { useAuthStore } from '../store/authStore';
import { requestDeviceCode, pollDeviceToken, TRAKT_DEFAULT_CLIENT_ID } from '../lib/trakt';

type Step = 'intro' | 'trakt';

export default function WelcomeScreen() {
  const router = useRouter();
  const { saveKeys, markSetupDone, syncToCloud } = useApiKeysStore();
  const userId = useAuthStore((s) => s.user?.id);

  const [step, setStep] = useState<Step>(userId ? 'trakt' : 'intro');
  const [traktCode, setTraktCode] = useState<{ userCode: string; verifyUrl: string } | null>(null);
  const [traktConnecting, setTraktConnecting] = useState(false);
  const [traktConnected, setTraktConnected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleTraktConnect = useCallback(async () => {
    setTraktConnecting(true);
    setTraktCode(null);
    try {
      const dc = await requestDeviceCode(TRAKT_DEFAULT_CLIENT_ID);
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
        const token = await pollDeviceToken(dc.device_code, TRAKT_DEFAULT_CLIENT_ID);
        if (token) {
          await saveKeys({
            traktAccessToken: token.access_token,
            traktRefreshToken: token.refresh_token,
          });
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
      Alert.alert('Connection error', e.message);
    }
  }, [saveKeys]);

  const handleFinish = async () => {
    setIsSaving(true);
    await markSetupDone();
    if (userId) await syncToCloud(userId);
    setIsSaving(false);
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#1a0e00', '#0d0d0d', Colors.background]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe}>

        {/* ── Intro ── */}
        {step === 'intro' && (
          <View style={styles.center}>
            <Image source={require('../assets/icon.png')} style={styles.logoImage} contentFit="contain" />
            <Text style={styles.logo}>Next<Text style={styles.logoAccent}>Up</Text></Text>
            <Text style={styles.tagline}>DISCOVER · TRACK · EXPERIENCE</Text>

            <View style={styles.featureList}>
              {[
                { icon: '🎬', label: 'Personalised home feed' },
                { icon: '✦', label: 'AI-powered recommendations' },
                { icon: '📅', label: 'Episode calendar & alerts' },
                { icon: '📋', label: 'Watchlist & progress tracking' },
              ].map((f) => (
                <View key={f.label} style={styles.featureRow}>
                  <Text style={styles.featureIcon}>{f.icon}</Text>
                  <Text style={styles.featureLabel}>{f.label}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={() => setStep('trakt')} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Get Started →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Trakt ── */}
        {step === 'trakt' && (
          <View style={styles.center}>
            <Text style={styles.optionalBadge}>OPTIONAL</Text>
            <Text style={styles.traktTitle}>Connect Trakt</Text>
            <Text style={styles.traktDesc}>
              Link your watch history so NextUp can learn your taste and personalise everything.
            </Text>

            <View style={styles.benefits}>
              {[
                { icon: '✦', text: 'AI rows built around what you actually watch' },
                { icon: '📅', text: 'Episode alerts for shows you follow' },
                { icon: '✓',  text: "See what you've watched across your library" },
              ].map((b) => (
                <View key={b.icon} style={styles.benefitRow}>
                  <Text style={styles.benefitIcon}>{b.icon}</Text>
                  <Text style={styles.benefitText}>{b.text}</Text>
                </View>
              ))}
            </View>

            {traktCode ? (
              <View style={styles.codeCard}>
                <Text style={styles.codeLabel}>Go to trakt.tv/activate and enter:</Text>
                <Text style={styles.codeValue}>{traktCode.userCode}</Text>
                <Text style={styles.codeHint}>Waiting for approval in your browser…</Text>
                <ActivityIndicator color={Colors.primary} style={{ marginTop: 8 }} />
              </View>
            ) : traktConnected ? (
              <View style={styles.connectedBanner}>
                <Text style={styles.connectedText}>✓ Trakt connected!</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtn, traktConnecting && styles.btnDisabled]}
                onPress={handleTraktConnect}
                disabled={traktConnecting}
                activeOpacity={0.85}
              >
                {traktConnecting
                  ? <ActivityIndicator color={Colors.background} />
                  : <Text style={styles.primaryBtnText}>Connect with Trakt →</Text>
                }
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.skipBtn} onPress={handleFinish} disabled={isSaving} activeOpacity={0.85}>
              {isSaving
                ? <ActivityIndicator color={Colors.textMuted} />
                : <Text style={styles.skipBtnText}>{traktConnected ? 'Enter App →' : 'Skip for now'}</Text>
              }
            </TouchableOpacity>
          </View>
        )}

      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safe: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.lg,
  },

  // Intro
  logoImage: { width: 80, height: 80, borderRadius: 20 },
  logo: { fontSize: 60, fontWeight: '900', color: Colors.text, letterSpacing: -2 },
  logoAccent: { color: Colors.primary },
  tagline: { ...Typography.label, color: Colors.textMuted, letterSpacing: 3, marginBottom: Spacing.md },
  featureList: { width: '100%', gap: Spacing.md, marginBottom: Spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  featureIcon: { fontSize: 22, width: 32, textAlign: 'center' },
  featureLabel: { ...Typography.body, color: Colors.textSecondary },

  // Trakt step
  optionalBadge: {
    ...Typography.label,
    color: Colors.primary,
    letterSpacing: 2,
    marginBottom: -Spacing.sm,
  },
  traktTitle: { fontSize: 32, fontWeight: '800', color: Colors.text, letterSpacing: -0.5, textAlign: 'center' },
  traktDesc: { ...Typography.body, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  benefits: { width: '100%', gap: Spacing.md },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  benefitIcon: { fontSize: 18, width: 28, textAlign: 'center', color: Colors.primary, marginTop: 1 },
  benefitText: { ...Typography.body, color: Colors.textSecondary, flex: 1, lineHeight: 22 },

  // Code card
  codeCard: {
    width: '100%',
    backgroundColor: Colors.primary + '12',
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    padding: Spacing.lg,
    alignItems: 'center',
    gap: 6,
  },
  codeLabel: { ...Typography.caption, color: Colors.textSecondary },
  codeValue: { fontSize: 32, fontWeight: '900', color: Colors.primary, letterSpacing: 6 },
  codeHint: { ...Typography.caption, color: Colors.textMuted },

  // Connected
  connectedBanner: {
    width: '100%',
    backgroundColor: Colors.success + '18',
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.success + '40',
    padding: Spacing.md,
    alignItems: 'center',
  },
  connectedText: { ...Typography.subheading, color: Colors.success, fontWeight: '700' },

  // Buttons
  primaryBtn: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { ...Typography.subheading, color: Colors.background, fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.5 },
  skipBtn: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipBtnText: { ...Typography.body, color: Colors.textMuted },
});
