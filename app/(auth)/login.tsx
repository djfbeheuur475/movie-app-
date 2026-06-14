import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { Colors, Spacing, Typography, BorderRadius } from '../../constants/theme';

WebBrowser.maybeCompleteAuthSession();

// Hardcoded to avoid Linking.createURL producing nextup:///auth/callback (triple-slash) on Android
const REDIRECT_URL = 'nextup://auth/callback';

export default function LoginScreen() {
  const router = useRouter();
  const { _refreshFromSession } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      console.log('[Auth] REDIRECT_URL:', REDIRECT_URL);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: REDIRECT_URL,
          skipBrowserRedirect: true,
        },
      });

      console.log('[Auth] signInWithOAuth error:', error);
      console.log('[Auth] signInWithOAuth data.url:', data?.url?.slice(0, 120));

      if (error || !data.url) {
        throw error ?? new Error('No auth URL returned');
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URL);
      console.log('[Auth] result type:', result.type);

      if (result.type !== 'success' || !result.url) return;

      console.log('[Auth] result.url:', result.url.slice(0, 150));

      // Implicit flow: Supabase puts tokens in hash fragment or query params
      const urlObj = new URL(result.url);
      const hash = urlObj.hash ? new URLSearchParams(urlObj.hash.slice(1)) : null;
      const query = urlObj.searchParams;

      const accessToken = hash?.get('access_token') ?? query.get('access_token');
      const refreshToken = hash?.get('refresh_token') ?? query.get('refresh_token');

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) throw sessionError;
      } else {
        // Fallback: PKCE code in query params
        const code = query.get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }
      }

      await _refreshFromSession();
      router.replace('/(tabs)');
    } catch (e: any) {
      Alert.alert('Sign in failed', e.message ?? 'Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuest = () => {
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#1a0f00', Colors.background]} style={StyleSheet.absoluteFill} />

      <View style={styles.logoArea}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logoImage}
          contentFit="contain"
        />
        <Text style={styles.logoText}>
          Next<Text style={styles.logoAccent}>Up</Text>
        </Text>
        <Text style={styles.logoTagline}>DISCOVER · TRACK · EXPERIENCE</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Sign in to NextUp</Text>
        <Text style={styles.panelSub}>
          Sync your watchlist and preferences across devices.
        </Text>

        <TouchableOpacity
          style={styles.googleBtn}
          onPress={handleGoogleSignIn}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <>
              <Image
                source={{ uri: 'https://www.google.com/favicon.ico' }}
                style={styles.googleIcon}
                contentFit="contain"
              />
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity style={styles.guestBtn} onPress={handleGuest} activeOpacity={0.8}>
          <Text style={styles.guestBtnText}>Continue without account</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          By signing in you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'flex-end',
  },
  logoArea: {
    alignItems: 'center',
    paddingBottom: 48,
  },
  logoImage: {
    width: 72,
    height: 72,
    borderRadius: 18,
    marginBottom: 14,
  },
  logoText: {
    fontSize: 52,
    fontWeight: '900',
    color: Colors.text,
    letterSpacing: -2,
  },
  logoAccent: { color: Colors.primary },
  logoTagline: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: 4,
    letterSpacing: 2,
  },
  panel: {
    padding: Spacing.xl,
    paddingBottom: 48,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: Colors.border,
  },
  panelTitle: {
    ...Typography.heading,
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  panelSub: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginBottom: Spacing.xl,
    lineHeight: 18,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.md,
    height: 52,
  },
  googleIcon: {
    width: 20,
    height: 20,
  },
  googleBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.md,
    gap: Spacing.sm,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { ...Typography.caption, color: Colors.textMuted },
  guestBtn: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestBtnText: { ...Typography.subheading, color: Colors.textSecondary },
  disclaimer: {
    ...Typography.caption,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.lg,
    lineHeight: 18,
  },
});
