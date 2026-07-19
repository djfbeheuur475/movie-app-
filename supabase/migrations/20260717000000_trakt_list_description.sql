ALTER TABLE trakt_list_index ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
