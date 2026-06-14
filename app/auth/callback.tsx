import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { Colors } from '../../constants/theme';

// Deep-link landing route for nextup://auth/callback
// Safety net if the OS routes the deep link directly instead of Chrome Custom Tab capturing it.
// Handles both implicit flow (access_token in params) and PKCE (code in params).
export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    access_token?: string;
    refresh_token?: string;
    code?: string;
  }>();
  const router = useRouter();
  const { _refreshFromSession } = useAuthStore();

  useEffect(() => {
    async function handle() {
      try {
        if (params.access_token && params.refresh_token) {
          await supabase.auth.setSession({
            access_token: params.access_token,
            refresh_token: params.refresh_token,
          });
        } else if (params.code) {
          await supabase.auth.exchangeCodeForSession(params.code);
        }
        await _refreshFromSession();
      } catch (e) {
        console.warn('Auth callback error:', e);
      }
      router.replace('/(tabs)');
    }
    handle();
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
