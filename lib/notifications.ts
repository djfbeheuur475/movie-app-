import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function setupNotificationChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('new-episodes', {
    name: 'New Episodes',
    description: 'Alerts when a tracked show has a new episode',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 100, 200],
    lightColor: '#7B5CE4',
  });
}

export interface EpisodeAlert {
  showName: string;
  season: number;
  episode: number;
  airDate: string; // YYYY-MM-DD
}

export async function scheduleEpisodeNotifications(alerts: EpisodeAlert[]) {
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = new Date();

  for (const alert of alerts) {
    const [y, m, d] = alert.airDate.split('-').map(Number);
    const epCode = `S${String(alert.season).padStart(2, '0')}E${String(alert.episode).padStart(2, '0')}`;

    // Fire at 9am on the air date; if today and already past 9am, fire immediately
    const fireAt = new Date(y, m - 1, d, 9, 0, 0, 0);
    const isToday = fireAt.toDateString() === now.toDateString();
    const alreadyPast = fireAt.getTime() <= now.getTime();

    if (alreadyPast && !isToday) continue; // past episodes, skip

    const content: Notifications.NotificationContentInput = {
      title: alert.showName,
      body: isToday && alreadyPast
        ? `${epCode} is available now`
        : `${epCode} airs today`,
      data: { type: 'new-episode', showName: alert.showName },
    };

    if (isToday && alreadyPast) {
      // Fire immediately with a short delay so the app has time to finish init
      await Notifications.scheduleNotificationAsync({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 5,
          channelId: 'new-episodes',
        },
      });
    } else {
      await Notifications.scheduleNotificationAsync({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: fireAt,
          channelId: 'new-episodes',
        },
      });
    }
  }
}
