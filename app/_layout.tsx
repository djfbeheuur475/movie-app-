import { useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { StyleSheet, View } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useWatchlistStore } from '../store/watchlistStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { useApiKeysStore } from '../store/apiKeysStore';
import { Colors } from '../constants/theme';
import { useEpisodeNotifications } from '../hooks/useEpisodeNotifications';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 2,
    },
  },
});

function NavigationGuard() {
  const router = useRouter();
  const segments = useSegments();
  const { isSetupDone, isLoaded: keysLoaded } = useApiKeysStore();
  const { isAuthenticated, isLoaded: authLoaded } = useAuthStore();

  useEffect(() => {
    if (!keysLoaded || !authLoaded) return;

    const inAuth = segments[0] === '(auth)';
    const inWelcome = segments[0] === 'welcome';

    if (!isAuthenticated && !inAuth) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && !isSetupDone && !inWelcome) {
      router.replace('/welcome');
    } else if (isAuthenticated && isSetupDone && (inAuth || inWelcome)) {
      router.replace('/(tabs)');
    }
  }, [keysLoaded, authLoaded, isAuthenticated, isSetupDone, segments]);

  return null;
}

function NotificationScheduler() {
  useEpisodeNotifications();
  return null;
}

function NotificationTapHandler() {
  const router = useRouter();

  useEffect(() => {
    // Handle tapping a notification when the app is foregrounded or cold-started
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        type?: string;
        tmdbId?: number;
      };
      if (data?.type === 'new-episode' && data?.tmdbId) {
        router.push(`/title/${data.tmdbId}?type=tv`);
      }
    });
    return () => sub.remove();
  }, []);

  return null;
}

export default function RootLayout() {
  const loadUser = useAuthStore((s) => s.loadUser);
  const loadWatchlist = useWatchlistStore((s) => s.loadWatchlist);
  const loadFromStorage = usePreferencesStore((s) => s.loadFromStorage);
  const loadKeys = useApiKeysStore((s) => s.loadKeys);

  const [statusBarHidden, setStatusBarHidden] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatusBar = () => {
    setStatusBarHidden(false);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setStatusBarHidden(true), 3000);
  };

  // Activates only on a clear downward swipe (5+ pts) within the top gesture zone
  const swipeDownGesture = Gesture.Pan()
    .activeOffsetY([5, Infinity])
    .onStart(() => {
      runOnJS(showStatusBar)();
    });

  useEffect(() => {
    async function prepare() {
      try {
        await Promise.all([loadUser(), loadWatchlist(), loadFromStorage(), loadKeys()]);
      } catch (e) {
        console.warn('Startup load error:', e);
      } finally {
        await SplashScreen.hideAsync();
      }
    }
    prepare();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" hidden={statusBarHidden} animated />
        <NavigationGuard />
        <NotificationScheduler />
        <NotificationTapHandler />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
          <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
          <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="title/[id]"
            options={{ presentation: 'card', animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="ai-assistant"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="person/[id]"
            options={{ presentation: 'card', animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="episode"
            options={{ presentation: 'card', animation: 'slide_from_right' }}
          />
          <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        </Stack>
        {/* Invisible swipe zone — catches downward swipes from the top edge to reveal the status bar */}
        <GestureDetector gesture={swipeDownGesture}>
          <View style={styles.statusBarGestureZone} />
        </GestureDetector>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  statusBarGestureZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 30,
  },
});
