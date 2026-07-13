const BASE = 'https://api.trakt.tv';

export const TRAKT_DEFAULT_CLIENT_ID = 'f96bdbb3af4329d022c1a303d59e132435bf177003';
export const effectiveTraktClientId = (stored: string) => stored.trim() || TRAKT_DEFAULT_CLIENT_ID;

export class TraktUnauthorizedError extends Error {
  constructor() {
    super('Trakt token expired or invalid — reconnect required');
    this.name = 'TraktUnauthorizedError';
  }
}

function headers(clientId: string, accessToken?: string): HeadersInit {
  const h: HeadersInit = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': clientId,
  };
  if (accessToken) h['Authorization'] = `Bearer ${accessToken}`;
  return h;
}

async function get<T>(path: string, clientId: string, accessToken?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: headers(clientId, accessToken) });
  if (res.status === 401) throw new TraktUnauthorizedError();
  if (!res.ok) throw new Error(`Trakt ${res.status}: ${path}`);
  return res.json();
}

export async function refreshTraktToken(
  refreshToken: string,
  clientId: string,
  clientSecret = '',
): Promise<DeviceTokenResponse | null> {
  try {
    const res = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
        grant_type: 'refresh_token',
      }),
    });
    if (res.status === 200) return res.json();
    return null;
  } catch {
    return null;
  }
}

// ─── Device code OAuth ────────────────────────────────────────────────────────

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  created_at: number;
}

export async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const res = await fetch(`${BASE}/oauth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!res.ok) throw new Error('Failed to get device code');
  return res.json();
}

export async function pollDeviceToken(
  deviceCode: string,
  clientId: string,
  clientSecret = ''
): Promise<DeviceTokenResponse | null> {
  const res = await fetch(`${BASE}/oauth/device/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: deviceCode, client_id: clientId, client_secret: clientSecret }),
  });
  if (res.status === 200) return res.json();
  if (res.status === 400 || res.status === 429) return null; // still pending
  throw new Error(`Token poll failed: ${res.status}`);
}

// ─── User data ────────────────────────────────────────────────────────────────

export interface TraktWatchedMovie {
  plays: number;
  last_watched_at: string;
  movie: { title: string; year: number; ids: { tmdb: number; imdb: string; trakt: number } };
}

export interface TraktWatchedShow {
  plays: number;
  last_watched_at: string;
  show: { title: string; year: number; ids: { tmdb: number; imdb: string; trakt: number; tvdb: number } };
  seasons: { number: number; episodes: { number: number; plays: number }[] }[];
}

export interface TraktCalendarShow {
  first_aired: string;
  episode: { season: number; number: number; title: string; ids: { trakt: number; tmdb: number } };
  show: { title: string; year: number; ids: { tmdb: number; trakt: number; tvdb: number } };
}

export interface TraktCalendarMovie {
  released: string;
  movie: { title: string; year: number; ids: { tmdb: number; imdb: string; trakt: number } };
}

export const traktApi = {
  // Watch history (requires access token for private accounts)
  getWatchedMovies: (clientId: string, accessToken: string): Promise<TraktWatchedMovie[]> =>
    get('/sync/watched/movies', clientId, accessToken),

  getWatchedShows: (clientId: string, accessToken: string): Promise<TraktWatchedShow[]> =>
    get('/sync/watched/shows', clientId, accessToken),

  // Calendar — personal (requires access token)
  getMyShowCalendar: (
    clientId: string,
    accessToken: string,
    startDate: string,
    days = 14
  ): Promise<TraktCalendarShow[]> =>
    get(`/calendars/my/shows/${startDate}/${days}`, clientId, accessToken),

  getMyMovieCalendar: (
    clientId: string,
    accessToken: string,
    startDate: string,
    days = 30
  ): Promise<TraktCalendarMovie[]> =>
    get(`/calendars/my/movies/${startDate}/${days}`, clientId, accessToken),

};
