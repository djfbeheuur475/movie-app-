import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── Routes ──────────────────────────────────────────────────────────────────
import aiRouter from './routes/ai';
import traktRouter from './routes/trakt';
import recommendationsRouter from './routes/recommendations';

app.use('/api/ai', aiRouter);
app.use('/api/trakt', traktRouter);
app.use('/api/recommendations', recommendationsRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok', version: '1.0.0' }));

app.listen(PORT, () => {
  console.log(`CineAI backend running on port ${PORT}`);
});

export default app;
