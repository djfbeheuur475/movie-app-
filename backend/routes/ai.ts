import { Router, Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const SYSTEM_PROMPT = `You are CineAI, an expert film and TV recommendation assistant with the taste of a Letterboxd critic and the knowledge of an IMDb editor.

When a user asks for recommendations:
1. Understand the mood, genre, or theme they describe
2. Suggest 3-5 specific titles with brief, compelling reasons
3. Include a mix of well-known and hidden gems when appropriate
4. Always include the TMDB ID in your response as a JSON array at the end like: TMDB_IDS: [123, 456, 789]

Be conversational, enthusiastic, and cinematic in tone. Keep responses concise but evocative.`;

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { messages } = req.body as {
      messages: { role: string; content: string }[];
    };

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const chat = model.startChat({
      systemInstruction: SYSTEM_PROMPT,
      history: messages.slice(0, -1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    });

    const lastMessage = messages[messages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    const text = result.response.text();

    // Extract TMDB IDs if present
    const tmdbMatch = text.match(/TMDB_IDS:\s*\[([^\]]+)\]/);
    const recommendations = tmdbMatch
      ? tmdbMatch[1].split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n))
      : [];

    // Clean reply (remove TMDB_IDS line)
    const reply = text.replace(/TMDB_IDS:\s*\[[^\]]+\]/, '').trim();

    return res.json({ reply, recommendations });
  } catch (error: any) {
    console.error('Gemini error:', error.message);
    return res.status(500).json({ error: 'AI service unavailable', reply: "I'm having trouble right now. Please try again shortly." });
  }
});

export default router;
