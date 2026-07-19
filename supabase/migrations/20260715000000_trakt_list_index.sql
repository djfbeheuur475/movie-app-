-- Stores the pre-analysed Trakt list catalog.
-- Populated by the index_trakt edge function action (run once, refresh weekly).
-- Homepage reads from this table instead of calling the Trakt API on every request.

CREATE TABLE IF NOT EXISTS trakt_list_index (
  trakt_id  bigint       PRIMARY KEY,
  name      text         NOT NULL,
  item_count integer     NOT NULL DEFAULT 0,
  likes     integer      NOT NULL DEFAULT 0,
  tags      text[]       NOT NULL DEFAULT '{}',
  media_type text        NOT NULL DEFAULT 'mixed',  -- 'movie' | 'tv' | 'mixed'
  indexed_at timestamptz NOT NULL DEFAULT now()
);

-- Service role accesses directly; no user-facing RLS needed for this system table.
ALTER TABLE trakt_list_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON trakt_list_index
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
