import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/theme';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

function TabIcon({
  label,
  icon,
  iconFocused,
  focused,
}: {
  label: string;
  icon: IoniconsName;
  iconFocused: IoniconsName;
  focused: boolean;
}) {
  return (
    <View style={styles.tabItem}>
      <Ionicons
        name={focused ? iconFocused : icon}
        size={22}
        color={focused ? Colors.primary : Colors.textMuted}
      />
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Home" icon="home-outline" iconFocused="home" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Discover" icon="compass-outline" iconFocused="compass" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="watchlist"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Watchlist" icon="bookmark-outline" iconFocused="bookmark" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Calendar" icon="calendar-outline" iconFocused="calendar" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="ai"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon label="AI" icon="sparkles-outline" iconFocused="sparkles" focused={focused} />
          ),
        }}
      />

      {/* Hidden tabs */}
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: 60,
    paddingBottom: 6,
    paddingTop: 4,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  tabLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  tabLabelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
});
