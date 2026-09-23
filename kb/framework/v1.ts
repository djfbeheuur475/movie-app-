// NextUp Entertainment Profile Framework — v1.0
//
// FROZEN once synced and used: never edit a dimension in place. To change the
// framework, copy this file to v1_1.ts (or v2.ts), bump `version`, and sync —
// `framework:sync` refuses to overwrite a version whose definition hash differs.
//
// Design rules (see kb/DESIGN.md §3):
// - Describe what a title is LIKE, not metadata TMDB already has (format,
//   runtime, animation/documentary, language, year are never asked).
// - Opposites are one bipolar axis (dark↔light), never two questions.
// - score = ordered degree (5 levels, stored 0–100 as expected value)
//   noul  = is-this-central probability (themes)
//   choice = mutually exclusive facet; the full distribution is stored.

export type QType = 'score' | 'noul' | 'choice';
export type AppliesTo = 'all' | 'movie' | 'tv';

export interface Dimension {
  key: string;
  category: string;
  type: QType;
  appliesTo: AppliesTo;
  instructions: string;
  /** score: ordered level descriptions (low → high); noul: {true,false}; choice: option → description */
  criteria: string[] | Record<string, string>;
}

export interface Framework {
  version: string;
  notes: string;
  dimensions: Dimension[];
}

// ── Shared scales ───────────────────────────────────────────────────────────

const GENRE_SCALE = [
  'Not present at all',
  'A minor element',
  'A noticeable secondary element',
  'A major element',
  'The defining genre',
];

const CONTENT_SCALE = ['None', 'Mild', 'Moderate', 'Strong', 'Extreme'];

const genre = (key: string, label: string): Dimension => ({
  key: `genre_${key}`,
  category: 'genre',
  type: 'score',
  appliesTo: 'all',
  instructions: `How much is this title ${label}?`,
  criteria: GENRE_SCALE,
});

/** Bipolar axis: five levels from `low` to `high`. */
const axis = (
  category: string,
  key: string,
  question: string,
  levels: [string, string, string, string, string],
  appliesTo: AppliesTo = 'all',
): Dimension => ({ key, category, type: 'score', appliesTo, instructions: question, criteria: levels });

const theme = (key: string, label: string): Dimension => ({
  key: `theme_${key}`,
  category: 'theme',
  type: 'noul',
  appliesTo: 'all',
  instructions: `Is ${label} a central theme of this title (not just incidental)?`,
  criteria: {
    true: `${label} is central to the story and what it is about`,
    false: `${label} is absent or only incidental`,
  },
});

const content = (key: string, label: string): Dimension => ({
  key: `content_${key}`,
  category: 'content',
  type: 'score',
  appliesTo: 'all',
  instructions: `How much ${label} does this title contain?`,
  criteria: CONTENT_SCALE,
});

// ── Framework ───────────────────────────────────────────────────────────────

export const FRAMEWORK_V1: Framework = {
  version: '1.0',
  notes: 'Initial framework: 87 dimensions (17 genre, 11 tone, 12 narrative, 13 style, 20 theme, 8 content, 6 audience).',
  dimensions: [
    // Genre — degree, not binary: captures blends (a crime-comedy vs a crime drama).
    genre('crime', 'a crime story'),
    genre('thriller', 'a thriller'),
    genre('mystery', 'a mystery'),
    genre('drama', 'a drama'),
    genre('comedy', 'a comedy'),
    genre('scifi', 'science fiction'),
    genre('fantasy', 'fantasy'),
    genre('horror', 'horror'),
    genre('romance', 'a romance'),
    genre('action', 'an action title'),
    genre('adventure', 'an adventure'),
    genre('war', 'a war story'),
    genre('western', 'a western'),
    genre('musical', 'a musical or music-driven story'),
    genre('historical', 'a historical or period piece'),
    genre('biographical', 'based on a true story or real people'),
    genre('sports', 'a sports story'),

    // Tone / mood
    axis('tone', 'darkness', 'How dark is the overall tone?',
      ['Light and breezy', 'Mostly light', 'Balanced', 'Dark', 'Pitch black']),
    axis('tone', 'hopefulness', 'How hopeful versus bleak is its outlook?',
      ['Bleak or nihilistic', 'Mostly pessimistic', 'Mixed', 'Mostly hopeful', 'Uplifting']),
    axis('tone', 'tension', 'How much suspense and tension does it sustain?',
      ['Relaxed, no tension', 'Occasional tension', 'Moderate tension', 'Frequently tense', 'Relentlessly tense']),
    axis('tone', 'adrenaline', 'How much high-energy excitement and thrills does it deliver?',
      ['Calm throughout', 'A little excitement', 'Some thrilling set-pieces', 'Frequently thrilling', 'High-octane throughout']),
    axis('tone', 'humour', 'How funny is it?',
      ['Not funny at all', 'Occasional light moments', 'Some humour', 'Often funny', 'Constantly funny']),
    axis('tone', 'satire', 'How satirical is it — mocking people, institutions or society?',
      ['Not satirical', 'Slight satirical edge', 'Some satire', 'Strongly satirical', 'Biting satire at its core']),
    axis('tone', 'sadness', 'How sad or melancholic is it?',
      ['Not sad at all', 'Briefly sad', 'Some melancholy', 'Very sad', 'Devastating']),
    axis('tone', 'emotional_intensity', 'How emotionally intense is it?',
      ['Emotionally light', 'Mildly emotional', 'Moderately emotional', 'Very intense', 'Overwhelming']),
    axis('tone', 'warmth', 'How warm versus cold or detached does it feel?',
      ['Cold and detached', 'Somewhat cool', 'Neutral', 'Warm', 'Very warm and affectionate']),
    axis('tone', 'unsettling', 'How unsettling or disturbing does it feel to watch?',
      ['Comfortable', 'Slightly uneasy', 'Somewhat unsettling', 'Very unsettling', 'Deeply disturbing']),
    axis('tone', 'whimsy', 'How whimsical or playful is it?',
      ['Not at all whimsical', 'A touch of whimsy', 'Somewhat whimsical', 'Very whimsical', 'Pure whimsy']),

    // Narrative
    axis('narrative', 'plot_complexity', 'How complex is the plot to follow?',
      ['Very simple', 'Straightforward', 'Moderately complex', 'Complex', 'Intricate and layered']),
    axis('narrative', 'pacing', 'How fast is the pacing?',
      ['Very slow burn', 'Slow', 'Measured', 'Brisk', 'Breakneck']),
    axis('narrative', 'twistiness', 'How much does it rely on twists and surprises?',
      ['No twists, entirely predictable', 'Mostly predictable', 'A few surprises', 'Several major twists', 'Built around twists']),
    axis('narrative', 'worldbuilding', 'How much invented world, lore or mythology does it build?',
      ['None, our everyday world', 'Minimal', 'Some distinct world details', 'Rich world-building', 'Vast, deep mythology']),
    axis('narrative', 'nonlinearity', 'How non-linear is the storytelling (flashbacks, timelines, fractured structure)?',
      ['Strictly linear', 'Mostly linear', 'Some flashbacks', 'Frequently non-linear', 'Structurally fractured']),
    axis('narrative', 'serialization', 'How serialized is the show?',
      ['Fully standalone episodes', 'Mostly standalone', 'Mix of standalone and arcs', 'Mostly serialized', 'One continuous story'], 'tv'),
    axis('narrative', 'ensemble', 'How much is it an ensemble piece rather than about one protagonist?',
      ['Single protagonist', 'Protagonist with key support', 'Small core group', 'Ensemble', 'Large sprawling ensemble']),
    axis('narrative', 'dialogue_density', 'How dialogue-driven is it versus visual and quiet?',
      ['Nearly wordless, visual', 'Sparse dialogue', 'Balanced', 'Dialogue-heavy', 'Rapid-fire talk']),
    axis('narrative', 'character_depth', 'How deep and psychologically developed are the main characters?',
      ['Thin archetypes', 'Simple', 'Moderately developed', 'Rich and layered', 'Profound character study']),
    axis('narrative', 'moral_ambiguity', 'How morally grey are the main characters and choices?',
      ['Clear heroes and villains', 'Mostly clear-cut', 'Some grey areas', 'Very morally grey', 'No one is good']),
    {
      key: 'narrative_engine', category: 'narrative', type: 'choice', appliesTo: 'all',
      instructions: 'What primarily drives this title and keeps viewers watching?',
      criteria: {
        character: 'Characters, relationships and inner lives',
        plot: 'Plot mechanics — what happens next',
        atmosphere: 'Mood, atmosphere and sensation',
        ideas: 'Ideas, concepts and questions',
        spectacle: 'Spectacle, action and set-pieces',
        comedy: 'Jokes and comedic situations',
      },
    },
    {
      key: 'ending', category: 'narrative', type: 'choice', appliesTo: 'all',
      instructions: 'How does it end (or, for ongoing shows, how does it tend to resolve)?',
      criteria: {
        uplifting: 'Happy or triumphant',
        bittersweet: 'Bittersweet',
        tragic: 'Tragic or bleak',
        ambiguous: 'Ambiguous or open to interpretation',
        ongoing: 'Unresolved, cliffhanger or ongoing',
      },
    },

    // Style / vibe
    axis('style', 'realism', 'How grounded and realistic versus heightened and stylised is it?',
      ['Documentary-real', 'Grounded', 'Somewhat heightened', 'Heightened', 'Wildly stylised or fantastical']),
    axis('style', 'grit', 'How gritty versus polished does it look and feel?',
      ['Glossy and polished', 'Clean', 'Neutral', 'Gritty', 'Grimy and raw']),
    axis('style', 'prestige', 'How prestige versus pulpy is it?',
      ['Pure pulp or trash', 'Genre entertainment', 'Solid mainstream', 'Prestige', 'Awards-level prestige']),
    axis('style', 'camp', 'How campy or knowingly over-the-top is it?',
      ['Completely sincere', 'Slightly heightened', 'Some camp', 'Very campy', 'Pure camp']),
    axis('style', 'quirkiness', 'How quirky or offbeat is it?',
      ['Entirely conventional', 'Mostly conventional', 'Somewhat offbeat', 'Quirky', 'Deeply eccentric']),
    axis('style', 'cerebral', 'How cerebral versus visceral is it?',
      ['Pure gut and sensation', 'Mostly visceral', 'Balanced', 'Thoughtful', 'Highly cerebral']),
    axis('style', 'comfort', 'How much is it a comfort watch — cosy, reassuring, easy to relax into?',
      ['The opposite of comforting', 'Not comforting', 'Neutral', 'Comforting', 'The ultimate comfort watch']),
    axis('style', 'claustrophobia', 'How confined or claustrophobic does it feel?',
      ['Wide open', 'Mostly open', 'Neutral', 'Confined', 'Suffocatingly claustrophobic']),
    axis('style', 'scope', 'How intimate versus epic is its scope?',
      ['Tiny and intimate', 'Small-scale', 'Mid-scale', 'Large-scale', 'Sweeping epic']),
    axis('style', 'surrealism', 'How surreal or dreamlike is it?',
      ['Entirely literal', 'Slight oddness', 'Some dreamlike moments', 'Very surreal', 'Pure dream logic']),
    axis('style', 'arthouse', 'How mainstream versus arthouse is it?',
      ['Broad mainstream', 'Mainstream', 'Crossover', 'Arthouse leaning', 'Pure arthouse']),
    axis('style', 'visual_ambition', 'How visually striking or ambitious is it?',
      ['Purely functional visuals', 'Unremarkable', 'Good-looking', 'Striking', 'Visually extraordinary']),
    {
      key: 'setting', category: 'style', type: 'choice', appliesTo: 'all',
      instructions: 'What kind of setting dominates the story?',
      criteria: {
        city: 'A big city',
        small_town: 'A small town or suburb',
        wilderness: 'Rural land, wilderness or nature',
        workplace: 'A workplace or institution (office, hospital, school, precinct)',
        domestic: 'Homes and family life',
        space_future: 'Outer space or a futuristic world',
        fantasy_world: 'An invented fantasy or mythic world',
        confined: 'A single confined place (ship, house, bunker, vehicle)',
        multiple: 'Many locations, globe-trotting',
      },
    },

    // Themes — probability the theme is central
    theme('justice', 'justice or the law'),
    theme('revenge', 'revenge'),
    theme('power', 'power and corruption'),
    theme('family', 'family'),
    theme('friendship', 'friendship and loyalty'),
    theme('love', 'love and relationships'),
    theme('betrayal', 'betrayal'),
    theme('identity', 'identity and self-discovery'),
    theme('society', 'society and politics'),
    theme('class', 'class and inequality'),
    theme('ambition', 'ambition and success'),
    theme('survival', 'survival'),
    theme('obsession', 'obsession'),
    theme('grief', 'grief and loss'),
    theme('redemption', 'redemption'),
    theme('coming_of_age', 'coming of age'),
    theme('isolation', 'isolation and loneliness'),
    theme('technology', 'technology and what it does to people'),
    theme('conspiracy', 'conspiracy and paranoia'),
    theme('mental_health', 'mental health'),

    // Content
    content('violence', 'violence'),
    content('gore', 'gore and graphic injury'),
    content('sexual', 'sexual content and nudity'),
    content('profanity', 'strong language'),
    content('drugs', 'drug and alcohol use'),
    content('disturbing', 'disturbing material (abuse, suicide, cruelty)'),
    content('scariness', 'frightening content and scares'),
    {
      key: 'age_suitability', category: 'content', type: 'choice', appliesTo: 'all',
      instructions: 'Who is this suitable for?',
      criteria: {
        all_ages: 'All ages, including young children',
        older_kids: 'Older children (8+)',
        teens: 'Teens (13+)',
        adults: 'Adults only',
      },
    },

    // Audience / viewing experience
    axis('audience', 'intellectual_demand', 'How intellectually demanding is it to watch?',
      ['Switch-your-brain-off easy', 'Easy', 'Some thought required', 'Demanding', 'Very demanding']),
    axis('audience', 'attention_required', 'How much full attention does it need (versus background watching)?',
      ['Fine as background', 'Mostly casual', 'Needs some attention', 'Needs full attention', 'Miss a minute and you are lost']),
    axis('audience', 'rewatchability', 'How rewatchable is it?',
      ['Once is enough', 'Rarely rewatched', 'Occasionally rewatchable', 'Very rewatchable', 'Endlessly rewatchable']),
    axis('audience', 'originality', 'How original versus formulaic is it?',
      ['Entirely formulaic', 'Familiar', 'Some fresh ideas', 'Original', 'Genuinely unique']),
    {
      key: 'viewing_context', category: 'audience', type: 'choice', appliesTo: 'all',
      instructions: 'What viewing situation is it best suited to?',
      criteria: {
        solo: 'Watching alone',
        partner: 'Watching with a partner',
        friends: 'Watching with a group of friends',
        family: 'Watching with the whole family',
      },
    },
    {
      key: 'humour_style', category: 'audience', type: 'choice', appliesTo: 'all',
      instructions: 'What is the dominant style of humour?',
      criteria: {
        none: 'Little or no humour',
        dry: 'Dry or deadpan',
        witty: 'Witty, verbal banter',
        slapstick: 'Slapstick or physical',
        dark: 'Dark humour',
        cringe: 'Cringe or awkward',
        absurd: 'Absurd or surreal',
        satirical: 'Satire or parody',
      },
    },
  ],
};
