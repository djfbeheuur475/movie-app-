import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { useAuthStore } from '../store/authStore';
import { useWatchlistStore } from '../store/watchlistStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { useApiKeysStore } from '../store/apiKeysStore';
import { Colors } from '../constants/theme';

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
  const { isSetupDone, isLoaded } = useApiKeysStore();

  useEffect(() => {
    if (!isLoaded) return;
    const inWelcome = segments[0] === 'welcome';
    if (!isSetupDone && !inWelcome) {
      router.replace('/welcome');
    }
  }, [isLoaded, isSetupDone, segments]);

  return null;
}

export default function RootLayout() {
  const loadUser = useAuthStore((s) => s.loadUser);
  const loadWatchlist = useWatchlistStore((s) => s.loadWatchlist);
  const loadFromStorage = usePreferencesStore((s) => s.loadFromStorage);
  const loadKeys = useApiKeysStore((s) => s.loadKeys);

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
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <NavigationGuard />
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
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
});
