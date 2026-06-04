import { Router, Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Generate personalised recommendation list based on watch history / mood
router.post('/', async (req: Request, res: Response) => {
  const { watchHistory, genres, mood } = req.body;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = `You are a movie recommendation engine. Based on:
- Watch history TMDB IDs: ${JSON.stringify(watchHistory ?? [])}
- Preferred genres (TMDB IDs): ${JSON.stringify(genres ?? [])}
- Mood/theme: ${mood ?? 'general'}

Return a JSON object with:
{
  "tmdbIds": [array of 10 TMDB movie IDs to recommend],
  "explanation": "one sentence explaining why these were chosen"
}

Only return valid JSON, no markdown.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    return res.json(parsed);
  } catch (e: any) {
    return res.status(500).json({ error: e.message, tmdbIds: [], explanation: '' });
  }
});

// Get AI explanation for a specific title
router.get('/explain', async (req: Request, res: Response) => {
  const { tmdb_id, media_type } = req.query;
  if (!tmdb_id) return res.status(400).json({ error: 'Missing tmdb_id' });

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(
      `Write a compelling 1-2 sentence explanation for why someone should watch TMDB ${media_type} ID ${tmdb_id}. Be evocative and specific. No spoilers.`
    );
    return res.json({ explanation: result.response.text() });
  } catch (e: any) {
    return res.status(500).json({ explanation: '' });
  }
});

export default router;
