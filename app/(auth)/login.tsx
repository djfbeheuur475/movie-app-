import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { Colors, Spacing, BorderRadius } from '../../constants/theme';

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URL = 'nextup://auth/callback';

const { width: W } = Dimensions.get('window');
const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';

const POSTER_PATHS = [
  '/d5NXSklXo0qyIYkgV61sZ9fEEzD.jpg', // Dune
  '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', // Oppenheimer
  '/74xTEgt7R36Fpooo50r9T25onhq.jpg', // The Batman
  '/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg', // The Last of Us
  '/t6HIqrRAclMCA60NsSW-zecjOdX.jpg', // Avatar: Way of Water
  '/62HCnUTziyWcpDaBO2i1DX17ljH.jpg', // Top Gun: Maverick
  '/iuFNMS8U5cb6xfzi5YNI0Mk7S9A.jpg', // Barbie
  '/dB6A9W78TGe6RR8INuCJNp7NmpB.jpg', // Killers of the Flower Moon
  '/9V9b7j9bTJxd3c8RmfGOlqKe19Q.jpg', // Succession
  '/qNBAXBIQlnOThrVvA6mA2B5ggkl.jpg', // Andor
  '/jXJxMcVoEuXzym3vFnjqDW4ifo6.jpg', // House of the Dragon
  '/mBaXZ95R2OxueZhvQbcEWy2DqyO.jpg', // Severance
  '/vDGr1YdrlfbU9wxTOdpf3zChmv9.jpg', // Shogun
  '/9V9b7j9bTJxd3c8RmfGOlqKe19Q.jpg', // Succession (repeat to fill)
  '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg', // Oppenheimer (repeat)
];

const COLS = 3;
const POSTER_W = Math.ceil(W / COLS);
const POSTER_H = Math.ceil(POSTER_W * 1.5);

// Build a 3-column grid of poster URI strings
const POSTER_COLS: string[][] = [[], [], []];
POSTER_PATHS.forEach((path, i) => {
  POSTER_COLS[i % COLS].push(TMDB_IMG + path);
});

export default function LoginScreen() {
  const router = useRouter();
  const { _refreshFromSession } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: REDIRECT_URL,
          skipBrowserRedirect: true,
        },
      });

      if (error || !data.url) throw error ?? new Error('No auth URL returned');

      const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URL);
      if (result.type !== 'success' || !result.url) return;

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
    <View style={styles.root}>
      {/* Movie poster collage background */}
      <View style={styles.posterGrid}>
        {POSTER_COLS.map((col, ci) => (
          <View key={ci} style={styles.posterColumn}>
            {col.map((uri, ri) => (
              <Image
                key={ri}
                source={{ uri }}
                style={styles.poster}
                contentFit="cover"
                transition={400}
              />
            ))}
          </View>
        ))}
      </View>

      {/* Gradient overlay — heavy at bottom for readability */}
      <LinearGradient
        colors={[
          'rgba(0,0,0,0.45)',
          'rgba(0,0,0,0.65)',
          'rgba(0,0,0,0.90)',
          'rgba(0,0,0,0.98)',
        ]}
        locations={[0, 0.35, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Foreground content */}
      <View style={styles.content}>
        {/* Brand section — centered in upper-middle */}
        <View style={styles.brand}>
          <Image
            source={require('../../assets/splash-logo.png')}
            style={styles.logoImage}
            contentFit="contain"
          />
          <Text style={styles.appName}>NextUp</Text>
          <Text style={styles.tagline}>FINDING YOUR NEXT FAVOURITE</Text>
        </View>

        {/* Sign-in section pinned to bottom */}
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

          <TouchableOpacity style={styles.guestBtn} onPress={handleGuest} activeOpacity={0.8}>
            <Text style={styles.guestBtnText}>Continue without account</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            By signing in you agree to our Terms of Service and Privacy Policy.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },

  // Poster grid
  posterGrid: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  posterColumn: {
    width: POSTER_W,
    flexDirection: 'column',
  },
  poster: {
    width: POSTER_W,
    height: POSTER_H,
    backgroundColor: '#1a1a1a',
  },

  // Foreground layout
  content: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Platform.OS === 'ios' ? 48 : 32,
    justifyContent: 'flex-end',
  },

  // Brand
  brand: {
    alignItems: 'center',
    marginBottom: 52,
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

  // Sign-in
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
});
