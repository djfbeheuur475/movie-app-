const BASE = 'https://api.trakt.tv';

export const TRAKT_DEFAULT_CLIENT_ID = 'f2709b8b2160742dabafd2f96bdbb3af4329d022c1a303d59e132435bf177003';
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
    // Trakt's WAF blocks requests with a missing/generic User-Agent (e.g. React
    // Native's default) on anonymous, client-id-only calls — a browser-style
    // UA passes.
    'User-Agent': 'Mozilla/5.0 (Linux; Android 14) NextUp/1.0',
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

// Trakt caps `limit` at 250 server-side regardless of what's requested, and
// silently truncates to a single page if you don't ask for more — there's no
// error, no warning, just a smaller-than-real watched history. Loop pages
// until X-Pagination-Page-Count says there's nothing left.
async function getAllPages<T>(path: string, clientId: string, accessToken: string): Promise<T[]> {
  const limit = 250;
  const results: T[] = [];
  let page = 1;
  let pageCount = 1;

  do {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${BASE}${path}${sep}page=${page}&limit=${limit}`, {
      headers: headers(clientId, accessToken),
    });
    if (res.status === 401) throw new TraktUnauthorizedError();
    if (!res.ok) throw new Error(`Trakt ${res.status}: ${path}`);
    const data: T[] = await res.json();
    results.push(...data);
    const pc = res.headers.get('x-pagination-page-count');
    pageCount = pc ? parseInt(pc, 10) : 1;
    page++;
  } while (page <= pageCount);

  return results;
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

export interface TraktListItem {
  type: 'movie' | 'show';
  movie?: { title: string; year: number; ids: { tmdb: number } };
  show?: { title: string; year: number; ids: { tmdb: number } };
}

// Public list browsing — no access token needed, just the client-id header.
// Used for curated community "hidden gems" style rows in Discover.
export async function getListItemsPage(
  listId: number,
  page: number,
  limit = 20,
): Promise<{ items: TraktListItem[]; pageCount: number }> {
  const res = await fetch(
    `${BASE}/lists/${listId}/items?page=${page}&limit=${limit}`,
    { headers: headers(TRAKT_DEFAULT_CLIENT_ID) },
  );
  if (!res.ok) throw new Error(`Trakt ${res.status}: /lists/${listId}/items`);
  const items = (await res.json()) as TraktListItem[];
  const pageCount = Number(res.headers.get('x-pagination-page-count') ?? '1');
  return { items, pageCount };
}

export const traktApi = {
  // Watch history (requires access token for private accounts). Paginated —
  // see getAllPages; a large history silently came back truncated to the
  // first 100-250 items without this.
  getWatchedMovies: (clientId: string, accessToken: string): Promise<TraktWatchedMovie[]> =>
    getAllPages('/sync/watched/movies', clientId, accessToken),

  getWatchedShows: (clientId: string, accessToken: string): Promise<TraktWatchedShow[]> =>
    getAllPages('/sync/watched/shows', clientId, accessToken),

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
