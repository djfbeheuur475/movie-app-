import React, { useState, useEffect } from 'react';
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
  SafeAreaView,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Typography, BorderRadius } from '../constants/theme';
import { useApiKeysStore } from '../store/apiKeysStore';

interface SettingInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  linkLabel?: string;
  linkUrl?: string;
  secureText?: boolean;
  keyboardType?: 'default' | 'email-address' | 'url';
}

function SettingInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  linkLabel,
  linkUrl,
  secureText,
  keyboardType = 'default',
}: SettingInputProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={styles.inputGroup}>
      <View style={styles.labelRow}>
        <Text style={styles.inputLabel}>{label}</Text>
        {linkLabel && linkUrl && (
          <TouchableOpacity onPress={() => Linking.openURL(linkUrl)}>
            <Text style={styles.linkText}>{linkLabel} ↗</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.inputWrap}>
        <TextInput
          style={[styles.input, secureText && !revealed && styles.inputSecret]}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={secureText && !revealed}
          keyboardType={keyboardType}
          selectionColor={Colors.primary}
        />
        {secureText && value.length > 0 && (
          <TouchableOpacity
            style={styles.revealBtn}
            onPress={() => setRevealed((r) => !r)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.revealText}>{revealed ? '🙈' : '👁'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {hint && <Text style={styles.hintText}>{hint}</Text>}
    </View>
  );
}

function SectionHeader({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionDesc}>{description}</Text>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { tmdbKey, backendUrl, supabaseUrl, supabaseAnonKey, saveKeys, clearKeys } = useApiKeysStore();

  const [fields, setFields] = useState({
    tmdbKey,
    backendUrl,
    supabaseUrl,
    supabaseAnonKey,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setFields({ tmdbKey, backendUrl, supabaseUrl, supabaseAnonKey });
  }, [tmdbKey, backendUrl, supabaseUrl, supabaseAnonKey]);

  const set = (key: keyof typeof fields) => (val: string) =>
    setFields((f) => ({ ...f, [key]: val }));

  const handleSave = async () => {
    if (!fields.tmdbKey.trim()) {
      Alert.alert('TMDB key required', 'The TMDB API key cannot be empty.');
      return;
    }
    setIsSaving(true);
    await saveKeys(fields);
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    Alert.alert(
      'Reset all API keys?',
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.backBtn}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>API Settings</Text>
            <View style={{ width: 60 }} />
          </View>

          <Text style={styles.pageDesc}>
            All keys are stored securely on your device using encrypted storage.
            They are{' '}
            <Text style={styles.highlight}>never sent to anyone</Text>
            {' '}except the respective API provider.
          </Text>

          {/* TMDB */}
          <View style={styles.card}>
            <SectionHeader
              icon="🎬"
              title="TMDB API Key"
              description="Required · Powers all movie & TV data, images, and search."
            />
            <SettingInput
              label="API Key (v3 auth)"
              value={fields.tmdbKey}
              onChange={set('tmdbKey')}
              placeholder="a1b2c3d4e5f6..."
              secureText
              hint="Free at themoviedb.org → Settings → API"
              linkLabel="Get key"
              linkUrl="https://www.themoviedb.org/settings/api"
            />
          </View>

          {/* Backend */}
          <View style={styles.card}>
            <SectionHeader
              icon="✦"
              title="AI Backend"
              description="Optional · Self-hosted Express server that proxies Gemini AI and Trakt calls so your keys stay server-side."
            />
            <SettingInput
              label="Backend URL"
              value={fields.backendUrl}
              onChange={set('backendUrl')}
              placeholder="https://your-backend.railway.app"
              hint="See backend/ folder in the repo. Deploy free on Railway or Render."
              keyboardType="url"
              linkLabel="Deploy guide"
              linkUrl="https://railway.app"
            />
          </View>

          {/* Supabase */}
          <View style={styles.card}>
            <SectionHeader
              icon="🔑"
              title="Supabase"
              description="Optional · Enables account creation, cloud watchlist sync, and Trakt OAuth persistence."
            />
            <SettingInput
              label="Project URL"
              value={fields.supabaseUrl}
              onChange={set('supabaseUrl')}
              placeholder="https://xxxx.supabase.co"
              keyboardType="url"
              hint="Project Settings → API → Project URL"
              linkLabel="supabase.com"
              linkUrl="https://supabase.com"
            />
            <SettingInput
              label="Anon / Public Key"
              value={fields.supabaseAnonKey}
              onChange={set('supabaseAnonKey')}
              placeholder="eyJhbGci..."
              secureText
              hint="Project Settings → API → anon / public"
            />
          </View>

          {/* Save */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.saveBtn, saved && styles.saveBtnSuccess]}
              onPress={handleSave}
              disabled={isSaving}
              activeOpacity={0.85}
            >
              {isSaving
                ? <ActivityIndicator color={Colors.text} />
                : <Text style={styles.saveBtnText}>{saved ? '✓ Saved!' : 'Save Keys'}</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={styles.resetBtn} onPress={handleReset} activeOpacity={0.8}>
              <Text style={styles.resetBtnText}>Reset All Keys</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    ...Typography.body,
    color: Colors.primary,
    width: 60,
  },
  headerTitle: {
    ...Typography.subheading,
    color: Colors.text,
  },
  pageDesc: {
    ...Typography.caption,
    color: Colors.textSecondary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    lineHeight: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  highlight: {
    color: Colors.success,
    fontWeight: '600',
  },
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
  sectionHeader: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sectionIcon: {
    fontSize: 20,
    marginTop: 2,
  },
  sectionTitle: {
    ...Typography.subheading,
    color: Colors.text,
  },
  sectionDesc: {
    ...Typography.caption,
    color: Colors.textMuted,
    lineHeight: 16,
    marginTop: 2,
  },
  inputGroup: {
    gap: Spacing.xs,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputLabel: {
    ...Typography.label,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  linkText: {
    ...Typography.caption,
    color: Colors.primary,
  },
  inputWrap: {
    position: 'relative',
  },
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
    fontFamily: 'monospace',
  },
  inputSecret: {
    letterSpacing: 3,
  },
  revealBtn: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  revealText: {
    fontSize: 16,
  },
  hintText: {
    ...Typography.caption,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  actions: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
    gap: Spacing.md,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnSuccess: {
    backgroundColor: Colors.success,
  },
  saveBtnText: {
    ...Typography.subheading,
    color: Colors.text,
  },
  resetBtn: {
    backgroundColor: Colors.error + '18',
    borderRadius: BorderRadius.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.error + '60',
  },
  resetBtnText: {
    ...Typography.subheading,
    color: Colors.error,
  },
});
