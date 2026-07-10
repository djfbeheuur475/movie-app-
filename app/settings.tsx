import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../constants/theme';
import { useApiKeysStore } from '../store/apiKeysStore';
import { useAuthStore } from '../store/authStore';
import { requestDeviceCode, pollDeviceToken } from '../lib/trakt';

// ─── Reusable input component ─────────────────────────────────────────────────

function KeyInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  linkLabel,
  linkUrl,
  secure,
  keyboard = 'default',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  linkLabel?: string;
  linkUrl?: string;
  secure?: boolean;
  keyboard?: 'default' | 'url';
}) {
  const [show, setShow] = useState(false);
  return (
    <View style={styles.inputGroup}>
      <View style={styles.inputLabelRow}>
        <Text style={styles.inputLabel}>{label}</Text>
        {linkLabel && linkUrl && (
          <TouchableOpacity onPress={() => Linking.openURL(linkUrl)}>
            <Text style={styles.linkText}>{linkLabel} ↗</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={secure && !show}
          keyboardType={keyboard}
          selectionColor={Colors.primary}
        />
        {secure && value.length > 0 && (
          <TouchableOpacity style={styles.showBtn} onPress={() => setShow((s) => !s)}>
            <Text style={styles.showBtnText}>{show ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function CardHeader({
  icon,
  title,
  subtitle,
  badge,
}: {
  icon: string;
  title: string;
  subtitle: string;
  badge?: string;
}) {
  return (
    <View style={styles.cardHeader}>
      <Text style={styles.cardIcon}>{icon}</Text>
      <View style={styles.cardHeaderText}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle}>{title}</Text>
          {badge && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut } = useAuthStore();
  const userId = user?.id ?? null;
  const {
    traktClientId, traktUsername, traktAccessToken, geminiKey,
    saveKeys, clearKeys, syncToCloud,
  } = useApiKeysStore();

  const [fields, setFields] = useState({
    traktClientId,
    traktUsername,
    geminiKey,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [traktConnecting, setTraktConnecting] = useState(false);
  const [traktCode, setTraktCode] = useState<{ userCode: string; verifyUrl: string } | null>(null);

  useEffect(() => {
    setFields({ traktClientId, traktUsername, geminiKey });
  }, [traktClientId, traktUsername, geminiKey]);

  const set = (key: keyof typeof fields) => (val: string) =>
    setFields((f) => ({ ...f, [key]: val }));

  const handleSave = async () => {
    setIsSaving(true);
    await saveKeys(fields);
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTraktConnect = useCallback(async () => {
    const clientId = fields.traktClientId.trim();
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

      // Poll for token
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
          await saveKeys({
            traktClientId: clientId,
            traktAccessToken: token.access_token,
            traktRefreshToken: token.refresh_token,
          });
          // Persist to cloud immediately so token survives sign-out/reinstall
          if (userId) await syncToCloud(userId);
          setTraktCode(null);
          setTraktConnecting(false);
          Alert.alert('Connected!', 'Trakt is now linked to NextUp.');
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
  }, [fields.traktClientId, saveKeys]);

  const handleDisconnectTrakt = () => {
    Alert.alert('Disconnect Trakt?', 'This will remove your Trakt access token.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => saveKeys({ traktAccessToken: '' }),
      },
    ]);
  };

  const handleReset = () => {
    Alert.alert(
      'Reset all settings?',
      'This will clear all stored keys and return you to the welcome screen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await clearKeys();
            router.replace('/welcome');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.backBtn}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Settings</Text>
            <View style={{ width: 60 }} />
          </View>

          <Text style={styles.pageDesc}>
            All keys are stored securely on-device.{' '}
            <Text style={styles.highlight}>Never sent to anyone</Text>
            {' '}except the respective service.
          </Text>

          {/* ── Account ── */}
          <Card>
            <CardHeader icon="👤" title="Account" subtitle="Your NextUp profile" />
            {user ? (
              <View style={styles.accountRow}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarLetter}>
                    {(user.displayName || user.email || 'U')[0].toUpperCase()}
                  </Text>
                </View>
                <View style={styles.accountInfo}>
                  <Text style={styles.accountName}>{user.displayName || 'Guest'}</Text>
                  {user.email ? <Text style={styles.accountEmail}>{user.email}</Text> : null}
                </View>
                <TouchableOpacity style={styles.signOutBtn} onPress={signOut}>
                  <Text style={styles.signOutText}>Sign Out</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.signInBtn}
                onPress={() => router.push('/(auth)/login')}
                activeOpacity={0.85}
              >
                <Text style={styles.signInBtnText}>Sign In</Text>
              </TouchableOpacity>
            )}
          </Card>

          {/* ── Trakt ── */}
          <Card>
            <CardHeader
              icon="📡"
              title="Trakt.tv"
              subtitle="Import your watch history for personalised AI recommendations"
              badge="Optional"
            />

            <Text style={styles.integrationDesc}>
              Connect Trakt to unlock personalised AI recommendations based on your real watch history — movies and TV shows.
            </Text>

            <View style={styles.instructionBox}>
              <Text style={styles.instructionTitle}>How to get a Trakt Client ID:</Text>
              {[
                'Go to trakt.tv/oauth/applications/new',
                'Create a new app (name it anything)',
                'Set Redirect URI to  urn:ietf:wg:oauth:2.0:oob',
                'Copy the Client ID',
              ].map((step, i) => (
                <View key={i} style={styles.instructionRow}>
                  <View style={styles.stepCircle}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                  </View>
                  <Text style={styles.instructionText}>{step}</Text>
                </View>
              ))}
              <TouchableOpacity onPress={() => Linking.openURL('https://trakt.tv/oauth/applications/new')}>
                <Text style={styles.instructionLink}>trakt.tv/oauth/applications/new ↗</Text>
              </TouchableOpacity>
            </View>

            <KeyInput
              label="Trakt Client ID"
              value={fields.traktClientId}
              onChange={set('traktClientId')}
              placeholder="Paste your Trakt Client ID (optional)..."
              hint="Your Client ID from the Trakt application you created"
            />

            <KeyInput
              label="Trakt Username"
              value={fields.traktUsername}
              onChange={set('traktUsername')}
              placeholder="your-trakt-username"
              hint="Used to fetch your public watch history"
            />

            {traktCode && (
              <View style={styles.codeBox}>
                <Text style={styles.codeLabel}>Go to {traktCode.verifyUrl} and enter:</Text>
                <Text style={styles.codeValue}>{traktCode.userCode}</Text>
                <Text style={styles.codeHint}>Waiting for confirmation…</Text>
              </View>
            )}

            {traktAccessToken ? (
              <View style={styles.connectedRow}>
                <View style={styles.connectedDot} />
                <Text style={styles.connectedText}>Trakt connected</Text>
                <TouchableOpacity onPress={handleDisconnectTrakt} style={styles.disconnectBtn}>
                  <Text style={styles.disconnectText}>Disconnect</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.connectBtn, traktConnecting && styles.connectBtnDisabled]}
                onPress={handleTraktConnect}
                disabled={traktConnecting}
                activeOpacity={0.85}
              >
                {traktConnecting ? (
                  <ActivityIndicator color={Colors.text} size="small" />
                ) : (
                  <Text style={styles.connectBtnText}>Connect Trakt →</Text>
                )}
              </TouchableOpacity>
            )}
          </Card>

          {/* ── Gemini ── */}
          <Card>
            <CardHeader
              icon="✦"
              title="Gemini AI"
              subtitle="Powers the AI recommendation engine"
              badge={fields.geminiKey ? '✓ Set' : 'Optional'}
            />

            <Text style={styles.integrationDesc}>
              Add your Gemini API key to enable AI-powered recommendations personalised to your Trakt watch history.
            </Text>

            <View style={styles.instructionBox}>
              <Text style={styles.instructionTitle}>How to get a Gemini API key:</Text>
              {[
                'Go to aistudio.google.com',
                'Sign in with your Google account',
                'Click "Get API key" → Create API key',
                'Copy the key and paste it below',
              ].map((step, i) => (
                <View key={i} style={styles.instructionRow}>
                  <View style={styles.stepCircle}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                  </View>
                  <Text style={styles.instructionText}>{step}</Text>
                </View>
              ))}
              <TouchableOpacity onPress={() => Linking.openURL('https://aistudio.google.com/app/apikey')}>
                <Text style={styles.instructionLink}>aistudio.google.com ↗</Text>
              </TouchableOpacity>
            </View>

            <KeyInput
              label="Gemini API Key"
              value={fields.geminiKey}
              onChange={set('geminiKey')}
              placeholder="Paste your Gemini API key here..."
              secure
              hint="Free tier available — no billing required for personal use"
            />
          </Card>

          {/* ── Actions ── */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.saveBtn, saved && styles.saveBtnSuccess]}
              onPress={handleSave}
              disabled={isSaving}
              activeOpacity={0.85}
            >
              {isSaving
                ? <ActivityIndicator color={Colors.text} />
                : <Text style={styles.saveBtnText}>{saved ? '✓ Saved!' : 'Save Settings'}</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={styles.resetBtn} onPress={handleReset} activeOpacity={0.8}>
              <Text style={styles.resetBtnText}>Reset All Settings</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 48 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { ...Typography.body, color: Colors.primary, width: 60 },
  headerTitle: { ...Typography.subheading, color: Colors.text },
  pageDesc: {
    ...Typography.caption,
    color: Colors.textSecondary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    lineHeight: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  highlight: { color: Colors.success, fontWeight: '600' },

  // Card
  card: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  cardIcon: { fontSize: 22, marginTop: 1 },
  cardHeaderText: { flex: 1 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardTitle: { ...Typography.subheading, color: Colors.text },
  cardSubtitle: { ...Typography.caption, color: Colors.textMuted, marginTop: 2, lineHeight: 16 },
  badge: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  badgeText: { fontSize: 11, fontWeight: '600', color: Colors.textMuted },

  // Account
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { fontSize: 20, fontWeight: '700', color: Colors.background },
  accountInfo: { flex: 1 },
  accountName: { ...Typography.subheading, color: Colors.text },
  accountEmail: { ...Typography.caption, color: Colors.textMuted },
  signOutBtn: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  signOutText: { ...Typography.caption, color: Colors.textSecondary, fontWeight: '600' },
  signInBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInBtnText: { ...Typography.subheading, color: Colors.background },

  // Integration descriptions
  integrationDesc: { ...Typography.body, color: Colors.textSecondary, lineHeight: 20 },
  instructionBox: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  instructionTitle: { ...Typography.label, color: Colors.text, fontWeight: '700', marginBottom: 4 },
  instructionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  stepCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  stepNum: { fontSize: 11, fontWeight: '700', color: Colors.background },
  instructionText: { ...Typography.caption, color: Colors.textSecondary, flex: 1, lineHeight: 18 },
  instructionLink: { ...Typography.caption, color: Colors.primary, marginTop: 4 },

  // Trakt device code
  codeBox: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  codeLabel: { ...Typography.caption, color: Colors.textMuted, textAlign: 'center' },
  codeValue: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.primary,
    letterSpacing: 4,
  },
  codeHint: { ...Typography.caption, color: Colors.textMuted },
  connectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  connectedText: { ...Typography.body, color: Colors.success, flex: 1 },
  disconnectBtn: {
    backgroundColor: Colors.error + '18',
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.error + '50',
  },
  disconnectText: { ...Typography.caption, color: Colors.error, fontWeight: '600' },
  connectBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectBtnDisabled: { opacity: 0.5 },
  connectBtnText: { ...Typography.subheading, color: Colors.background, fontWeight: '700' },

  // Input
  inputGroup: { gap: 6 },
  inputLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inputLabel: { ...Typography.label, color: Colors.textSecondary, letterSpacing: 0.5 },
  linkText: { ...Typography.caption, color: Colors.primary },
  inputWrap: { position: 'relative' },
  input: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    paddingRight: 44,
    ...Typography.body,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  showBtn: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' },
  showBtnText: { fontSize: 16 },
  hint: { ...Typography.caption, color: Colors.textMuted, lineHeight: 16 },

  // Footer actions
  actions: { paddingHorizontal: Spacing.lg, marginTop: Spacing.xl, gap: Spacing.md },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnSuccess: { backgroundColor: Colors.success },
  saveBtnText: { ...Typography.subheading, color: Colors.text },
  resetBtn: {
    backgroundColor: Colors.error + '18',
    borderRadius: BorderRadius.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.error + '60',
  },
  resetBtnText: { ...Typography.subheading, color: Colors.error },
});
