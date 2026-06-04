import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/authStore';
import { usePreferencesStore } from '../store/preferencesStore';
import { Colors } from '../constants/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 2,
    },
  },
});

export default function RootLayout() {
  const setSession = useAuthStore((s) => s.setSession);
  const loadFromStorage = usePreferencesStore((s) => s.loadFromStorage);

  useEffect(() => {
    loadFromStorage();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="title/[id]"
            options={{
              presentation: 'card',
              animation: 'slide_from_right',
            }}
          />
          <Stack.Screen
            name="ai-assistant"
            options={{
              presentation: 'modal',
              animation: 'slide_from_bottom',
            }}
          />
          <Stack.Screen
            name="person/[id]"
            options={{
              presentation: 'card',
              animation: 'slide_from_right',
            }}
          />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
});
