-- profile_metadata JSONB on taste_dna (stores TasteProfile + thematicInterests + recentShift)
ALTER TABLE public.taste_dna
  ADD COLUMN IF NOT EXISTS profile_metadata JSONB;

-- RLS on user_settings (currently unprotected)
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_settings_self" ON public.user_settings;
CREATE POLICY "user_settings_self" ON public.user_settings
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- RLS on user_preferences (currently unprotected)
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_preferences_self" ON public.user_preferences;
CREATE POLICY "user_preferences_self" ON public.user_preferences
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- RLS on watchlist (currently unprotected)
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "watchlist_self" ON public.watchlist;
CREATE POLICY "watchlist_self" ON public.watchlist
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
