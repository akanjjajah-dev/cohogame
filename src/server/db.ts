import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { SEED_LESSONS } from '../data/seedData.ts';
import {
  DifficultyLevel,
  ExcelImportRow,
  ExerciseItem,
  LeaderboardEntry,
  LessonItem,
  StudentProfile,
} from '../shared/types.ts';

interface LocalDatabase {
  lessons: LessonItem[];
  students: Record<string, StudentProfile>;
}

const LOCAL_STORE_PATH = path.resolve(process.cwd(), 'data', 'local_store.json');

let pgPool: Pool | null = null;
let pgInitialized = false;
let memoryStore: LocalDatabase | null = null;

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDefaultStudent(id: string, displayName = 'Học sinh Cơ Ho'): StudentProfile {
  return {
    id,
    displayName,
    xp: 0,
    streak: 1,
    hearts: 5,
    dailyGoalXp: 50,
    todayXp: 0,
    lastActiveDate: getTodayIso(),
    progress: {},
  };
}

function normalizePgConnectionString(raw: string): string {
  const match = raw.match(/^(postgres(?:ql)?:\/\/)([^:@]+):(.+)@([^@/]+)(\/.*)?$/i);
  if (!match) return raw;
  const [, proto, user, password, hostPort, dbPath = ''] = match;
  const safePassword = password.includes('%') ? password : encodeURIComponent(password);
  return `${proto}${encodeURIComponent(decodeURIComponent(user))}:${safePassword}@${hostPort}${dbPath}`;
}

function getPgPool(): Pool | null {
  const rawConnStr = process.env.DATABASE_URL?.trim();
  if (!rawConnStr || rawConnStr.includes('YOUR_PASSWORD') || rawConnStr.includes('YOUR_PROJECT')) {
    return null;
  }
  const connStr = normalizePgConnectionString(rawConnStr);
  if (!pgPool) {
    const isLocalhost = connStr.includes('localhost') || connStr.includes('127.0.0.1');
    pgPool = new Pool({
      connectionString: connStr,
      max: 5,
      connectionTimeoutMillis: 8000,
      ssl: isLocalhost ? false : { rejectUnauthorized: false },
    });
    pgPool.on('error', (err) => {
      console.error('PostgreSQL pool idle error:', err.message);
    });
  }
  return pgPool;
}

function readLocalStore(): LocalDatabase {
  if (memoryStore) {
    return memoryStore;
  }
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const raw = fs.readFileSync(LOCAL_STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as LocalDatabase;
      if (Array.isArray(parsed.lessons) && parsed.lessons.length > 0) {
        memoryStore = parsed;
        return memoryStore;
      }
    }
  } catch {
    // Fall through to seed
  }
  memoryStore = {
    lessons: structuredClone(SEED_LESSONS),
    students: {
      default: getDefaultStudent('default'),
    },
  };
  writeLocalStore(memoryStore);
  return memoryStore;
}

function writeLocalStore(data: LocalDatabase): void {
  memoryStore = data;
  try {
    const dir = path.dirname(LOCAL_STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // Ignore write failure on read-only serverless file systems
  }
}

async function ensurePgSchemaAndSeed(pool: Pool): Promise<void> {
  if (pgInitialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
      order_index INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      xp_reward INTEGER NOT NULL DEFAULT 20,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS exercises (
      id TEXT PRIMARY KEY,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL DEFAULT 1,
      skill TEXT NOT NULL,
      exercise_type TEXT NOT NULL,
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
  `);

  await pool.query(`
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
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lesson_progress (
      student_id TEXT NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      stars INTEGER NOT NULL DEFAULT 0,
      best_score INTEGER NOT NULL DEFAULT 0,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (student_id, lesson_id)
    );
  `);

  const countRes = await pool.query('SELECT COUNT(*)::int AS cnt FROM lessons');
  if ((countRes.rows[0]?.cnt ?? 0) === 0) {
    await insertLessonsPg(pool, SEED_LESSONS);
  }

  pgInitialized = true;
}

async function insertLessonsPg(pool: Pool, lessons: LessonItem[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const lesson of lessons) {
      await client.query(
        `INSERT INTO lessons (id, level, order_index, title, description, xp_reward)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           level = EXCLUDED.level,
           order_index = EXCLUDED.order_index,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           xp_reward = EXCLUDED.xp_reward`,
        [lesson.id, lesson.level, lesson.orderIndex, lesson.title, lesson.description, lesson.xpReward]
      );
      for (const ex of lesson.exercises) {
        await client.query(
          `INSERT INTO exercises (id, lesson_id, order_index, skill, exercise_type, prompt, coho_text, vietnamese_text, phonetic, options, correct_answer, audio_url, hint)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)
           ON CONFLICT (id) DO UPDATE SET
             lesson_id = EXCLUDED.lesson_id,
             order_index = EXCLUDED.order_index,
             skill = EXCLUDED.skill,
             exercise_type = EXCLUDED.exercise_type,
             prompt = EXCLUDED.prompt,
             coho_text = EXCLUDED.coho_text,
             vietnamese_text = EXCLUDED.vietnamese_text,
             phonetic = EXCLUDED.phonetic,
             options = EXCLUDED.options,
             correct_answer = EXCLUDED.correct_answer,
             audio_url = EXCLUDED.audio_url,
             hint = EXCLUDED.hint`,
          [
            ex.id,
            lesson.id,
            ex.orderIndex,
            ex.skill,
            ex.exerciseType,
            ex.prompt,
            ex.cohoText,
            ex.vietnameseText,
            ex.phonetic || '',
            JSON.stringify(ex.options || []),
            ex.correctAnswer,
            ex.audioUrl || '',
            ex.hint || '',
          ]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getAllLessons(): Promise<{ lessons: LessonItem[]; storage: 'supabase' | 'local' }> {
  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      const lessonsRes = await pool.query(
        'SELECT id, level, order_index, title, description, xp_reward FROM lessons ORDER BY level ASC, order_index ASC'
      );
      const exRes = await pool.query(
        'SELECT id, lesson_id, order_index, skill, exercise_type, prompt, coho_text, vietnamese_text, phonetic, options, correct_answer, audio_url, hint FROM exercises ORDER BY order_index ASC'
      );

      const exByLesson = new Map<string, ExerciseItem[]>();
      for (const row of exRes.rows) {
        const list = exByLesson.get(row.lesson_id) ?? [];
        list.push({
          id: row.id,
          lessonId: row.lesson_id,
          orderIndex: row.order_index,
          skill: row.skill,
          exerciseType: row.exercise_type,
          prompt: row.prompt,
          cohoText: row.coho_text,
          vietnameseText: row.vietnamese_text,
          phonetic: row.phonetic || '',
          options: Array.isArray(row.options) ? row.options : [],
          correctAnswer: row.correct_answer,
          audioUrl: row.audio_url || '',
          hint: row.hint || '',
        });
        exByLesson.set(row.lesson_id, list);
      }

      const lessons: LessonItem[] = lessonsRes.rows.map((row) => ({
        id: row.id,
        level: row.level as DifficultyLevel,
        orderIndex: row.order_index,
        title: row.title,
        description: row.description || '',
        xpReward: row.xp_reward,
        exercises: exByLesson.get(row.id) ?? [],
      }));

      return { lessons, storage: 'supabase' };
    } catch (err) {
      console.error('Supabase fetch failed, falling back to local store:', err);
    }
  }

  const local = readLocalStore();
  return { lessons: local.lessons, storage: 'local' };
}

export function convertRowsToLessons(rows: ExcelImportRow[], existingLessons: LessonItem[] = []): LessonItem[] {
  const lessonMap = new Map<string, LessonItem>();

  for (const existing of existingLessons) {
    const key = `${existing.level}::${existing.title.trim().toLowerCase()}`;
    lessonMap.set(key, structuredClone(existing));
  }

  const levelCounters = new Map<number, number>();
  for (const l of lessonMap.values()) {
    levelCounters.set(l.level, Math.max(levelCounters.get(l.level) ?? 0, l.orderIndex));
  }

  rows.forEach((row, idx) => {
    const level = Math.min(5, Math.max(1, Number(row.level) || 1)) as DifficultyLevel;
    const title = (row.lessonTitle || `Bài học cấp độ ${level}`).trim();
    const key = `${level}::${title.toLowerCase()}`;

    let lesson = lessonMap.get(key);
    if (!lesson) {
      const nextOrder = (levelCounters.get(level) ?? 0) + 1;
      levelCounters.set(level, nextOrder);
      lesson = {
        id: `lv${level}-custom-${Date.now()}-${nextOrder}`,
        level,
        orderIndex: nextOrder,
        title,
        description: row.lessonDescription?.trim() || `Bài học cấp độ ${level} nhập từ Excel.`,
        xpReward: 15 + level * 5,
        exercises: [],
      };
      lessonMap.set(key, lesson);
    }

    const exOrder = lesson.exercises.length + 1;
    lesson.exercises.push({
      id: `${lesson.id}-ex-${idx + 1}-${Date.now().toString(36).slice(-4)}`,
      lessonId: lesson.id,
      orderIndex: exOrder,
      skill: row.skill,
      exerciseType: row.exerciseType,
      prompt: row.prompt,
      cohoText: row.cohoText,
      vietnameseText: row.vietnameseText,
      phonetic: row.phonetic || '',
      options: row.options || [],
      correctAnswer: row.correctAnswer,
      audioUrl: row.audioUrl || '',
      hint: row.hint || '',
    });
  });

  return Array.from(lessonMap.values()).sort((a, b) =>
    a.level !== b.level ? a.level - b.level : a.orderIndex - b.orderIndex
  );
}

export async function importCurriculum(
  rows: ExcelImportRow[],
  mode: 'append' | 'replace'
): Promise<{ lessons: LessonItem[]; importedCount: number; storage: 'supabase' | 'local' }> {
  const { lessons: currentLessons } = await getAllLessons();
  const baseLessons = mode === 'append' ? currentLessons : [];
  const nextLessons = convertRowsToLessons(rows, baseLessons);

  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      if (mode === 'replace') {
        await pool.query('DELETE FROM exercises');
        await pool.query('DELETE FROM lessons');
      }
      await insertLessonsPg(pool, nextLessons);
      return { lessons: nextLessons, importedCount: rows.length, storage: 'supabase' };
    } catch (err) {
      console.error('Supabase import failed, saving locally:', err);
    }
  }

  const local = readLocalStore();
  local.lessons = nextLessons;
  writeLocalStore(local);
  return { lessons: nextLessons, importedCount: rows.length, storage: 'local' };
}

export async function resetToSeedCurriculum(): Promise<{ lessons: LessonItem[]; storage: 'supabase' | 'local' }> {
  const fresh = structuredClone(SEED_LESSONS);
  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      await pool.query('DELETE FROM exercises');
      await pool.query('DELETE FROM lessons');
      await insertLessonsPg(pool, fresh);
      return { lessons: fresh, storage: 'supabase' };
    } catch (err) {
      console.error('Supabase reset failed, falling back to local:', err);
    }
  }
  const local = readLocalStore();
  local.lessons = fresh;
  writeLocalStore(local);
  return { lessons: fresh, storage: 'local' };
}

export async function getStudentProfile(studentId: string): Promise<StudentProfile> {
  const cleanId = studentId.trim() || 'default';
  const today = getTodayIso();

  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      await pool.query(
        `INSERT INTO student_profiles (id, display_name, xp, streak, hearts, daily_goal_xp, today_xp, last_active_date)
         VALUES ($1, $2, 0, 1, 5, 50, 0, $3)
         ON CONFLICT (id) DO NOTHING`,
        [cleanId, 'Học sinh Cơ Ho', today]
      );

      const profileRes = await pool.query('SELECT * FROM student_profiles WHERE id = $1', [cleanId]);
      const progRes = await pool.query('SELECT * FROM lesson_progress WHERE student_id = $1', [cleanId]);
      const row = profileRes.rows[0];
      const progress: StudentProfile['progress'] = {};
      for (const p of progRes.rows) {
        progress[p.lesson_id] = {
          lessonId: p.lesson_id,
          stars: p.stars,
          bestScore: p.best_score,
          completedAt: new Date(p.completed_at).toISOString(),
        };
      }
      return {
        id: row.id,
        displayName: row.display_name,
        xp: row.xp,
        streak: row.streak,
        hearts: row.hearts,
        dailyGoalXp: row.daily_goal_xp,
        todayXp: row.last_active_date === today ? row.today_xp : 0,
        lastActiveDate: row.last_active_date || today,
        progress,
      };
    } catch (err) {
      console.error('Supabase profile fetch failed, using local:', err);
    }
  }

  const local = readLocalStore();
  if (!local.students[cleanId]) {
    local.students[cleanId] = getDefaultStudent(cleanId);
    writeLocalStore(local);
  }
  const student = local.students[cleanId];
  if (student.lastActiveDate !== today) {
    student.todayXp = 0;
  }
  return student;
}

export async function saveStudentName(studentId: string, displayName: string): Promise<StudentProfile> {
  const profile = await getStudentProfile(studentId);
  const nextName = displayName.trim().slice(0, 40) || 'Học sinh Cơ Ho';
  profile.displayName = nextName;

  const pool = getPgPool();
  if (pool) {
    try {
      await pool.query(
        'UPDATE student_profiles SET display_name = $1, updated_at = NOW() WHERE id = $2',
        [nextName, profile.id]
      );
      return profile;
    } catch (err) {
      console.error('Supabase rename failed:', err);
    }
  }

  const local = readLocalStore();
  local.students[profile.id] = profile;
  writeLocalStore(local);
  return profile;
}

export async function recordLessonCompletion(params: {
  studentId: string;
  lessonId: string;
  score: number;
  earnedXp: number;
  heartsRemaining: number;
}): Promise<StudentProfile> {
  const profile = await getStudentProfile(params.studentId);
  const today = getTodayIso();
  const stars = params.score >= 90 ? 3 : params.score >= 70 ? 2 : params.score >= 40 ? 1 : 0;

  let nextStreak = profile.streak;
  if (profile.lastActiveDate && profile.lastActiveDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    nextStreak = profile.lastActiveDate === yesterday ? profile.streak + 1 : 1;
  }

  const nextTodayXp = (profile.lastActiveDate === today ? profile.todayXp : 0) + params.earnedXp;
  const nextXp = profile.xp + params.earnedXp;
  const nextHearts = Math.max(1, Math.min(5, params.heartsRemaining));

  const existingProg = profile.progress[params.lessonId];
  const bestStars = Math.max(existingProg?.stars ?? 0, stars);
  const bestScore = Math.max(existingProg?.bestScore ?? 0, params.score);

  profile.xp = nextXp;
  profile.streak = nextStreak;
  profile.hearts = nextHearts;
  profile.todayXp = nextTodayXp;
  profile.lastActiveDate = today;
  profile.progress[params.lessonId] = {
    lessonId: params.lessonId,
    stars: bestStars,
    bestScore,
    completedAt: new Date().toISOString(),
  };

  const pool = getPgPool();
  if (pool) {
    try {
      await pool.query(
        `UPDATE student_profiles
         SET xp = $1, streak = $2, hearts = $3, today_xp = $4, last_active_date = $5, updated_at = NOW()
         WHERE id = $6`,
        [nextXp, nextStreak, nextHearts, nextTodayXp, today, profile.id]
      );
      await pool.query(
        `INSERT INTO lesson_progress (student_id, lesson_id, stars, best_score, completed_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (student_id, lesson_id) DO UPDATE SET
           stars = GREATEST(lesson_progress.stars, EXCLUDED.stars),
           best_score = GREATEST(lesson_progress.best_score, EXCLUDED.best_score),
           completed_at = NOW()`,
        [profile.id, params.lessonId, bestStars, bestScore]
      );
      return profile;
    } catch (err) {
      console.error('Supabase progress save failed:', err);
    }
  }

  const local = readLocalStore();
  local.students[profile.id] = profile;
  writeLocalStore(local);
  return profile;
}

export async function getLeaderboard(
  limit = 50,
  sortBy: 'score' | 'xp' = 'score'
): Promise<{ entries: LeaderboardEntry[]; storage: 'supabase' | 'local' }> {
  const safeLimit = Math.max(1, Math.min(100, limit));
  const pool = getPgPool();

  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      const orderClause =
        sortBy === 'xp'
          ? 'sp.xp DESC, total_score DESC, sp.streak DESC, sp.updated_at ASC'
          : 'total_score DESC, sp.xp DESC, sp.streak DESC, sp.updated_at ASC';

      const result = await pool.query(
        `SELECT
           sp.id,
           sp.display_name,
           sp.xp,
           sp.streak,
           sp.last_active_date,
           COALESCE(SUM(lp.best_score), 0)::int AS total_score,
           COUNT(lp.lesson_id)::int AS completed_lessons
         FROM student_profiles sp
         LEFT JOIN lesson_progress lp ON lp.student_id = sp.id
         GROUP BY sp.id, sp.display_name, sp.xp, sp.streak, sp.last_active_date, sp.updated_at
         ORDER BY ${orderClause}
         LIMIT $1`,
        [safeLimit]
      );

      const entries: LeaderboardEntry[] = result.rows.map((row, idx) => {
        const totalScore = Number(row.total_score) || 0;
        const completedLessons = Number(row.completed_lessons) || 0;
        return {
          rank: idx + 1,
          id: String(row.id),
          displayName: String(row.display_name || 'Học sinh Cơ Ho'),
          totalScore,
          xp: Number(row.xp) || 0,
          streak: Number(row.streak) || 1,
          completedLessons,
          averageScore: completedLessons > 0 ? Math.round(totalScore / completedLessons) : 0,
          lastActiveDate: String(row.last_active_date || getTodayIso()),
        };
      });

      return { entries, storage: 'supabase' };
    } catch (err) {
      console.error('Supabase leaderboard fetch failed, falling back to local:', err);
    }
  }

  const local = readLocalStore();
  const rows = Object.values(local.students).map((st) => {
    const progList = Object.values(st.progress || {});
    const totalScore = progList.reduce((sum, p) => sum + (p.bestScore ?? 0), 0);
    const completedLessons = progList.filter(
      (p) => (p.bestScore ?? 0) > 0 || Boolean(p.completedAt) || (p.stars ?? 0) > 0
    ).length;
    return {
      id: st.id,
      displayName: st.displayName || 'Học sinh Cơ Ho',
      totalScore,
      xp: st.xp || 0,
      streak: st.streak || 1,
      completedLessons,
      averageScore: completedLessons > 0 ? Math.round(totalScore / completedLessons) : 0,
      lastActiveDate: st.lastActiveDate || getTodayIso(),
    };
  });

  rows.sort((a, b) => {
    if (sortBy === 'xp') {
      return b.xp - a.xp || b.totalScore - a.totalScore || b.streak - a.streak;
    }
    return b.totalScore - a.totalScore || b.xp - a.xp || b.streak - a.streak;
  });

  const entries: LeaderboardEntry[] = rows.slice(0, safeLimit).map((item, idx) => ({
    rank: idx + 1,
    ...item,
  }));

  return { entries, storage: 'local' };
}
