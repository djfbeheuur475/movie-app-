import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApiKeysStore } from '../store/apiKeysStore';
import { traktApi } from '../lib/trakt';
import {
  requestNotificationPermission,
  setupNotificationChannel,
  scheduleEpisodeNotifications,
  type EpisodeAlert,
} from '../lib/notifications';

function todayString(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function useEpisodeNotifications() {
  const { traktClientId, traktAccessToken, traktUsername } = useApiKeysStore();

  const hasAuth = !!traktClientId && (!!traktAccessToken || !!traktUsername);

  const { data: calendarShows } = useQuery({
    queryKey: ['trakt-calendar-notifications', traktClientId, todayString()],
    queryFn: () =>
      traktAccessToken
        ? traktApi.getMyShowCalendar(traktClientId, traktAccessToken, todayString(), 7)
        : traktApi.getAllShowCalendar(traktClientId, todayString(), 7),
    enabled: hasAuth,
    staleTime: 1000 * 60 * 60 * 12, // refetch twice a day
    gcTime: 1000 * 60 * 60 * 24,
  });

  useEffect(() => {
    if (!hasAuth || !calendarShows?.length) return;

    async function schedule() {
      const granted = await requestNotificationPermission();
      if (!granted) return;

      await setupNotificationChannel();

      const alerts: EpisodeAlert[] = (calendarShows ?? []).map((item) => ({
        showName: item.show.title,
        season: item.episode.season,
        episode: item.episode.number,
        airDate: item.first_aired.slice(0, 10),
      }));

      await scheduleEpisodeNotifications(alerts);
    }

    schedule().catch(console.warn);
  }, [calendarShows, hasAuth]);
}
