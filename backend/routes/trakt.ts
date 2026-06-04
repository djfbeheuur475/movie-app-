import { Router, Request, Response } from 'express';
import fetch from 'node-fetch';

const router = Router();

const TRAKT_BASE = 'https://api.trakt.tv';
const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID || '';
const TRAKT_CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET || '';
const TRAKT_REDIRECT_URI = process.env.TRAKT_REDIRECT_URI || 'cineai://trakt/callback';

// Exchange auth code for tokens
router.post('/connect', async (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing code' });

  try {
    const tokenRes = await fetch(`${TRAKT_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: TRAKT_CLIENT_ID,
        client_secret: TRAKT_CLIENT_SECRET,
        redirect_uri: TRAKT_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json() as any;
    return res.json(tokens);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Get watched history (requires user's access token stored in Supabase)
router.get('/watched', async (req: Request, res: Response) => {
  const accessToken = req.headers['x-trakt-token'] as string;
  if (!accessToken) return res.status(401).json({ error: 'No Trakt token' });

  try {
    const moviesRes = await fetch(`${TRAKT_BASE}/sync/watched/movies`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'trakt-api-version': '2',
        'trakt-api-key': TRAKT_CLIENT_ID,
      },
    });
    const movies = await moviesRes.json();
    return res.json({ movies });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Get release calendar
router.get('/calendar', async (req: Request, res: Response) => {
  const { start_date = new Date().toISOString().slice(0, 10), days = '7' } = req.query;
  const accessToken = req.headers['x-trakt-token'] as string;

  const headers: Record<string, string> = {
    'trakt-api-version': '2',
    'trakt-api-key': TRAKT_CLIENT_ID,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  try {
    const endpoint = accessToken
      ? `${TRAKT_BASE}/calendars/my/shows/${start_date}/${days}`
      : `${TRAKT_BASE}/calendars/all/shows/${start_date}/${days}`;

    const calRes = await fetch(endpoint, { headers });
    const calendar = await calRes.json();
    return res.json(calendar);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/sync', async (req: Request, res: Response) => {
  // Placeholder — full sync would iterate watched history and store to Supabase
  return res.json({ synced: true, message: 'Sync queued' });
});

export default router;
