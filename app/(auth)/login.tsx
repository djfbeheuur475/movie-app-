import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { tmdbApi, getPosterUrl } from '../../lib/tmdb';
import { Colors, Spacing, BorderRadius, Typography } from '../../constants/theme';

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URL = 'nextup://auth/callback';

const { width: W } = Dimensions.get('window');
const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';

// Shown instantly on mount, before the live trending fetch resolves — same
// role the old hardcoded list played, just smaller since it's only a
// first-frame placeholder now, not the permanent background.
// Deliberately no duplicate paths — two tiles showing the same fallback
// poster was part of what looked broken before the live pool arrived.
const FALLBACK_POSTER_PATHS = [
  '/d5NXSklXo0qyIYkgV61sZ9fEEzD.jpg',
  '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
  '/74xTEgt7R36Fpooo50r9T25onhq.jpg',
  '/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg',
  '/t6HIqrRAclMCA60NsSW-zecjOdX.jpg',
  '/62HCnUTziyWcpDaBO2i1DX17ljH.jpg',
  '/iuFNMS8U5cb6xfzi5YNI0Mk7S9A.jpg',
  '/dB6A9W78TGe6RR8INuCJNp7NmpB.jpg',
  '/9V9b7j9bTJxd3c8RmfGOlqKe19Q.jpg',
  '/qNBAXBIQlnOThrVvA6mA2B5ggkl.jpg',
  '/jXJxMcVoEuXzym3vFnjqDW4ifo6.jpg',
  '/mBaXZ95R2OxueZhvQbcEWy2DqyO.jpg',
  '/vDGr1YdrlfbU9wxTOdpf3zChmv9.jpg',
].map((p) => TMDB_IMG + p);

const COLS = 3;
const TILE_COUNT = 15; // 5 rows x 3 cols — enough to fill a tall screen
const POSTER_W = Math.ceil(W / COLS);
const POSTER_H = Math.ceil(POSTER_W * 1.5);

// Live pool: trending + popular, movies and TV mixed, several TMDB lists
// combined and deduped by title id — enough real volume that every tile can
// get its own private slice with zero overlap (see partitionIntoLanes).
async function fetchBackgroundPosterPool(): Promise<string[]> {
  const [trendWeek, trendDay, popMovies, popShows] = await Promise.all([
    tmdbApi.getTrending('all', 'week').catch(() => []),
    tmdbApi.getTrending('all', 'day').catch(() => []),
    tmdbApi.getPopularMovies(1).catch(() => []),
    tmdbApi.getPopularShows(1).catch(() => []),
  ]);
  const seen = new Set<number>();
  const urls: string[] = [];
  for (const item of [...trendWeek, ...trendDay, ...popMovies, ...popShows]) {
    if (seen.has(item.id) || !item.poster_path) continue;
    seen.add(item.id);
    const url = getPosterUrl(item.poster_path, 'medium');
    if (url) urls.push(url);
  }
  // Shuffle once — otherwise tiles would drift through TMDB's own ranking
  // order together, and neighbouring tiles would feel too similar.
  for (let i = urls.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [urls[i], urls[j]] = [urls[j], urls[i]];
  }
  return urls;
}

// Splits a pool into TILE_COUNT disjoint lanes (round-robin) so each tile
// only ever draws from its own private slice. Two tiles can never show the
// same poster at the same time — there's no shared index to collide on.
function partitionIntoLanes(pool: string[]): string[][] {
  const lanes: string[][] = Array.from({ length: TILE_COUNT }, () => []);
  pool.forEach((uri, i) => lanes[i % TILE_COUNT].push(uri));
  return lanes;
}

// One grid tile. Holds its poster steady most of the time; on its own
// randomized timer it quietly swaps to the next poster in its own lane
// (never one another tile is showing). expo-image handles the crossfade
// itself via `transition` — that's the whole animation, nothing layered
// or hand-rolled on top that could fight it and cause the double-fade
// flicker the earlier version had.
function ShelfTile({ lane, style }: { lane: string[]; style: any }) {
  const n = lane.length;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (n < 2) return;
    let cancelled = false;
    const next = (idx + 1) % n;
    const delay = 7000 + Math.random() * 7000; // 7–14s, staggered per tile
    const timer = setTimeout(async () => {
      await Image.prefetch(lane[next]).catch(() => {});
      if (!cancelled) setIdx(next);
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [idx, n]);

  if (n === 0) return <View style={style} />;

  return (
    <Image
      source={{ uri: lane[idx] }}
      style={style}
      contentFit="cover"
      transition={900}
      cachePolicy="memory-disk"
    />
  );
}

type EmailMode = 'signin' | 'signup';

export default function LoginScreen() {
  const router = useRouter();
  const { _refreshFromSession, continueAsGuest } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const insets = useSafeAreaInsets();

  const [emailMode, setEmailMode] = useState<EmailMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [signupSent, setSignupSent] = useState(false);

  // Live trending pool for the background grid — falls back to the static
  // list instantly, swaps in real data once the fetch resolves.
  const { data: posterPool } = useQuery({
    queryKey: ['login-bg-poster-pool'],
    queryFn: fetchBackgroundPosterPool,
    staleTime: 1000 * 60 * 60, // an hour is plenty fresh for a background
    retry: 1,
  });
  const pool = posterPool && posterPool.length > 0 ? posterPool : FALLBACK_POSTER_PATHS;

  // Disjoint per-tile slices — see partitionIntoLanes. Recomputed only when
  // the pool identity actually changes (fallback → live), not every render.
  const lanes = useMemo(() => partitionIntoLanes(pool), [pool]);

  // NavigationGuard (app/_layout.tsx) is the single source of truth for the
  // post-auth transition — it watches isAuthenticated/isSetupDone and routes
  // accordingly. Navigating manually here as well used to race it (two
  // router.replace calls landing back-to-back), which showed up as a visible
  // flash back to the login screen before settling. Once _refreshFromSession
  // resolves, just let the guard take over; keep the spinner up until this
  // screen unmounts so there's nothing to flash.
  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true },
      });
      if (error || !data.url) throw error ?? new Error('No auth URL returned');

      const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URL);
      if (result.type !== 'success' || !result.url) {
        setIsLoading(false);
        return;
      }

      const urlObj = new URL(result.url);
      const hash = urlObj.hash ? new URLSearchParams(urlObj.hash.slice(1)) : null;
      const query = urlObj.searchParams;
      const accessToken = hash?.get('access_token') ?? query.get('access_token');
      const refreshToken = hash?.get('refresh_token') ?? query.get('refresh_token');

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (sessionError) throw sessionError;
      } else {
        const code = query.get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }
      }

      await _refreshFromSession();
      // No router.replace here — see note above.
    } catch (e: any) {
      Alert.alert('Sign in failed', e.message ?? 'Please try again.');
      setIsLoading(false);
    }
  };

  const handleGuest = async () => {
    await continueAsGuest();
    router.replace('/(tabs)');
  };

  const handleEmailAuth = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      Alert.alert('Missing info', 'Enter both an email and a password.');
      return;
    }
    if (emailMode === 'signup' && password.length < 6) {
      Alert.alert('Password too short', 'Use at least 6 characters.');
      return;
    }

    setEmailLoading(true);
    try {
      if (emailMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: trimmedEmail, password });
        if (error) throw error;
        if (!data.session) {
          // Email confirmation required — no session yet, nothing to refresh.
          setSignupSent(true);
        } else {
          await _refreshFromSession();
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password });
        if (error) throw error;
        await _refreshFromSession();
        // No router.replace here — NavigationGuard handles the transition.
      }
    } catch (e: any) {
      Alert.alert(emailMode === 'signup' ? 'Sign up failed' : 'Sign in failed', e.message ?? 'Please try again.');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      Alert.alert('Enter your email', 'Type your email above, then tap "Forgot password?" again.');
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail);
      if (error) throw error;
      Alert.alert('Check your email', "We've sent a password reset link.");
    } catch (e: any) {
      Alert.alert('Could not send reset email', e.message ?? 'Please try again.');
    }
  };

  return (
    <View style={[styles.root, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      {/*
       * Layout strategy: poster grid + gradient are absolutely positioned
       * INSIDE the root flex container. The KeyboardAvoidingView + ScrollView
       * holds brand + signIn on top, bottom-pinned when short (flexGrow + a
       * flex-end content container) and scrollable once the email/password
       * fields and keyboard need more room than the screen has.
       */}

      {/* Background: poster columns, clipped to screen. Keyed on fallback-vs-live
          so tiles remount cleanly the moment the trending fetch resolves. */}
      <View style={styles.posterGrid} key={pool === FALLBACK_POSTER_PATHS ? 'fallback' : 'live'}>
        {Array.from({ length: COLS }, (_, ci) => (
          <View key={ci} style={styles.posterColumn}>
            {lanes
              .map((lane, seed) => ({ lane, seed }))
              .filter(({ seed }) => seed % COLS === ci)
              .map(({ lane, seed }) => (
                <ShelfTile key={seed} lane={lane} style={styles.poster} />
              ))}
          </View>
        ))}
      </View>

      {/* Gradient overlay */}
      <LinearGradient
        colors={['rgba(0,0,0,0.4)', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.95)', '#000000']}
        locations={[0, 0.35, 0.65, 1]}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand */}
          <View style={styles.brand}>
            <Image
              source={require('../../assets/splash-logo.png')}
              style={styles.logoImage}
              contentFit="contain"
            />
            <Text style={styles.appName}>NextUp</Text>
            <Text style={styles.tagline}>FINDING YOUR NEXT FAVOURITE</Text>
          </View>

          {/* Sign-in */}
          <View style={styles.signIn}>
            <TouchableOpacity
              style={styles.googleBtn}
              onPress={handleGoogleSignIn}
              disabled={isLoading}
              activeOpacity={0.85}
            >
              {isLoading ? (
                <ActivityIndicator color="#1a1a1a" />
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

            {signupSent ? (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmTitle}>Check your email</Text>
                <Text style={styles.confirmBody}>
                  We sent a confirmation link to {email.trim()}. Tap it, then come back and sign in.
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setSignupSent(false);
                    setEmailMode('signin');
                  }}
                >
                  <Text style={styles.linkText}>Back to sign in</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TextInput
                  style={styles.emailInput}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  selectionColor={Colors.primary}
                />
                <View style={styles.passwordWrap}>
                  <TextInput
                    style={[styles.emailInput, styles.passwordInput]}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Password"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry={!showPassword}
                    textContentType={emailMode === 'signup' ? 'newPassword' : 'password'}
                    selectionColor={Colors.primary}
                  />
                  <TouchableOpacity style={styles.showPasswordBtn} onPress={() => setShowPassword((s) => !s)}>
                    <Text style={styles.showPasswordText}>{showPassword ? '🙈' : '👁'}</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.emailBtn}
                  onPress={handleEmailAuth}
                  disabled={emailLoading}
                  activeOpacity={0.85}
                >
                  {emailLoading ? (
                    <ActivityIndicator color="#1a1a1a" />
                  ) : (
                    <Text style={styles.emailBtnText}>
                      {emailMode === 'signup' ? 'Create Account' : 'Sign In'}
                    </Text>
                  )}
                </TouchableOpacity>

                <View style={styles.emailLinksRow}>
                  <TouchableOpacity
                    onPress={() => setEmailMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
                  >
                    <Text style={styles.linkText}>
                      {emailMode === 'signin' ? 'Create an account' : 'Already have an account? Sign in'}
                    </Text>
                  </TouchableOpacity>
                  {emailMode === 'signin' && (
                    <TouchableOpacity onPress={handleForgotPassword}>
                      <Text style={styles.linkText}>Forgot password?</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}

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
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Root is a flex column: absolute bg layers + normal-flow brand + normal-flow signIn
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.xl,
  },

  // Backgrounds (absolute, behind everything)
  posterGrid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  posterColumn: {
    width: POSTER_W,
  },
  poster: {
    width: POSTER_W,
    height: POSTER_H,
    backgroundColor: '#1a1a1a',
  },

  // Brand — normal flow, sits above absolute bg layers
  brand: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoImage: {
    width: 110,
    height: 90,
    marginBottom: 12,
  },
  appName: {
    fontSize: 58,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -2,
    lineHeight: 62,
  },
  tagline: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 3.5,
    marginTop: 6,
  },

  // Sign-in — normal flow, pinned below brand
  signIn: {
    width: '100%',
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: '#ffffff',
    borderRadius: BorderRadius.md,
    height: 54,
  },
  googleIcon: {
    width: 20,
    height: 20,
  },
  googleBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 14,
    gap: Spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  dividerText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
  },
  guestBtn: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: BorderRadius.md,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
  },
  disclaimer: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 17,
  },

  // Email/password
  keyboardAvoider: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  emailInput: {
    height: 50,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: Spacing.md,
    marginBottom: 10,
    ...Typography.body,
    color: '#ffffff',
  },
  passwordWrap: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 44,
  },
  showPasswordBtn: {
    position: 'absolute',
    right: Spacing.md,
    top: 0,
    bottom: 10,
    justifyContent: 'center',
  },
  showPasswordText: {
    fontSize: 16,
  },
  emailBtn: {
    height: 50,
    borderRadius: BorderRadius.md,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  emailBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  emailLinksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  confirmBox: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  confirmTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 8,
  },
  confirmBody: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
  },
});
