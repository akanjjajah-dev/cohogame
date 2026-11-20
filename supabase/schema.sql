-- Schema PostgreSQL / Supabase cho Ứng dụng Học Chữ Cơ Ho (5 Cấp độ)

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
  order_index INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  xp_reward INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL DEFAULT 1,
  skill TEXT NOT NULL CHECK (skill IN ('recognize', 'listen', 'read', 'write')),
  exercise_type TEXT NOT NULL CHECK (exercise_type IN ('multiple_choice', 'listen_select', 'word_bank', 'type_coho', 'handwriting', 'speak_read')),
  prompt TEXT NOT NULL,
  coho_text TEXT NOT NULL,
  vietnamese_text TEXT NOT NULL,
  phonetic TEXT NOT NULL DEFAULT '',
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_answer TEXT NOT NULL,
  audio_url TEXT NOT NULL DEFAULT '',
  hint TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT 'Học sinh Cơ Ho',
  xp INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 1,
  hearts INTEGER NOT NULL DEFAULT 5,
  daily_goal_xp INTEGER NOT NULL DEFAULT 50,
  today_xp INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lesson_progress (
  student_id TEXT NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL DEFAULT 0 CHECK (stars BETWEEN 0 AND 3),
  best_score INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (student_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lessons_level ON lessons(level, order_index);
CREATE INDEX IF NOT EXISTS idx_exercises_lesson ON exercises(lesson_id, order_index);
