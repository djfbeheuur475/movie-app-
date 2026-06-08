import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StyleSheet } from 'react-native';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="dark" hidden />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ animation: 'fade' }} />
        <Stack.Screen name="game/briefing" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="game/planning" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="game/simulation" options={{ animation: 'fade' }} />
        <Stack.Screen name="game/report" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="game/upgrades" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFBEB' },
});
