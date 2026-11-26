import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { SEED_LESSONS } from '../data/seedData.ts';
import {
  AiChatConversation,
  AuthUser,
  DifficultyLevel,
  ExcelImportRow,
  ExerciseItem,
  LeaderboardEntry,
  LessonItem,
  StudentProfile,
} from '../shared/types.ts';
import { verifyPassword } from './auth.ts';

interface StoredUserAccount {
  id: string;
  username: string;
  usernameLower: string;
  email: string;
  emailLower: string;
  passwordHash: string;
  studentId: string;
  createdAt: string;
}

interface StoredUserSession {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

interface LocalDatabase {
  lessons: LessonItem[];
  students: Record<string, StudentProfile>;
  accounts?: Record<string, StoredUserAccount>;
  sessions?: Record<string, StoredUserSession>;
  chatConversations?: Record<string, AiChatConversation[]>;
}

const LOCAL_STORE_PATH = process.env.VERCEL
  ? path.resolve('/tmp', 'coho_local_store.json')
  : path.resolve(process.cwd(), 'data', 'local_store.json');

let pgPool: Pool | null = null;
let pgInitialized = false;
let pgUnavailableUntil = 0;
let memoryStore: LocalDatabase | null = null;

function markPgUnavailable(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err || '');
  const code = (err as { code?: string })?.code || '';
  const isConnError =
    /timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|Connection terminated|socket/i.test(
      `${msg} ${code}`
    );
  if (isConnError || !pgInitialized) {
    pgUnavailableUntil = Date.now() + 120_000;
  }
}

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
  if (Date.now() < pgUnavailableUntil) {
    return null;
  }
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
      connectionTimeoutMillis: 2500,
      ssl: isLocalhost ? false : { rejectUnauthorized: false },
    });
    pgPool.on('error', (err) => {
      markPgUnavailable(err);
      console.error('PostgreSQL pool idle error:', err.message);
    });
  }
  return pgPool;
}

function readLocalStore(): LocalDatabase {
  if (memoryStore) {
    memoryStore.accounts = memoryStore.accounts || {};
    memoryStore.sessions = memoryStore.sessions || {};
    return memoryStore;
  }
  try {
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      const raw = fs.readFileSync(LOCAL_STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as LocalDatabase;
      if (Array.isArray(parsed.lessons) && parsed.lessons.length > 0) {
        parsed.students = parsed.students || {};
        parsed.accounts = parsed.accounts || {};
        parsed.sessions = parsed.sessions || {};
        parsed.chatConversations = parsed.chatConversations || {};
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
    accounts: {},
    sessions: {},
    chatConversations: {},
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_lower TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      email_lower TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      student_id TEXT NOT NULL UNIQUE REFERENCES student_profiles(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_chat_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL,
      language_id TEXT NOT NULL,
      title TEXT NOT NULL,
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, expires_at);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_chat_user ON ai_chat_conversations(user_id, updated_at DESC);
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
      markPgUnavailable(err);
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
      markPgUnavailable(err);
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
      markPgUnavailable(err);
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
      markPgUnavailable(err);
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
      markPgUnavailable(err);
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
      markPgUnavailable(err);
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
      markPgUnavailable(err);
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

export class AuthConflictError extends Error {
  code: 'USERNAME_TAKEN' | 'EMAIL_TAKEN';

  constructor(code: 'USERNAME_TAKEN' | 'EMAIL_TAKEN', message: string) {
    super(message);
    this.code = code;
  }
}

export interface TrialProgressInput {
  lessonId: string;
  score: number;
  earnedXp: number;
}

async function applyTrialProgressToStudent(
  studentId: string,
  trialProgress?: TrialProgressInput[]
): Promise<void> {
  if (!Array.isArray(trialProgress) || trialProgress.length === 0) return;
  const { lessons } = await getAllLessons();
  const allowedTrialIds = new Set(lessons.slice(0, 5).map((l) => l.id));
  const validItems = trialProgress
    .filter((item) => item && typeof item.lessonId === 'string' && allowedTrialIds.has(item.lessonId))
    .slice(0, 5);

  if (validItems.length === 0) return;

  const existingProfile = await getStudentProfile(studentId);
  for (const item of validItems) {
    const alreadyDone = existingProfile.progress[item.lessonId];
    const safeScore = Math.max(0, Math.min(100, Math.round(Number(item.score) || 0)));
    const safeXp = Math.max(0, Math.min(80, Math.round(Number(item.earnedXp) || 0)));
    if (safeScore <= 0 && safeXp <= 0) continue;
    // On login, only award XP if this trial lesson wasn't already recorded for this account
    const xpToAdd = alreadyDone ? 0 : safeXp;
    await recordLessonCompletion({
      studentId,
      lessonId: item.lessonId,
      score: safeScore,
      earnedXp: xpToAdd,
      heartsRemaining: existingProfile.hearts || 5,
    });
  }
}

export async function registerUserAccount(params: {
  username: string;
  email: string;
  passwordHash: string;
  trialProgress?: TrialProgressInput[];
}): Promise<{ user: AuthUser; profile: StudentProfile }> {
  const cleanUsername = params.username.trim();
  const usernameLower = cleanUsername.toLowerCase();
  const cleanEmail = params.email.trim();
  const emailLower = cleanEmail.toLowerCase();
  const userId = `acc-${crypto.randomUUID()}`;
  const studentId = `usr-${crypto.randomUUID()}`;
  const today = getTodayIso();
  const nowIso = new Date().toISOString();

  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const existingUsername = await client.query(
          'SELECT id FROM user_accounts WHERE username_lower = $1 LIMIT 1',
          [usernameLower]
        );
        if (existingUsername.rows.length > 0) {
          await client.query('ROLLBACK');
          throw new AuthConflictError('USERNAME_TAKEN', 'Tên đăng nhập này đã có người sử dụng.');
        }

        const existingEmail = await client.query(
          'SELECT id FROM user_accounts WHERE email_lower = $1 LIMIT 1',
          [emailLower]
        );
        if (existingEmail.rows.length > 0) {
          await client.query('ROLLBACK');
          throw new AuthConflictError('EMAIL_TAKEN', 'Email này đã được đăng ký tài khoản.');
        }

        await client.query(
          `INSERT INTO student_profiles (id, display_name, xp, streak, hearts, daily_goal_xp, today_xp, last_active_date)
           VALUES ($1, $2, 0, 1, 5, 50, 0, $3)`,
          [studentId, cleanUsername, today]
        );

        await client.query(
          `INSERT INTO user_accounts (id, username, username_lower, email, email_lower, password_hash, student_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, cleanUsername, usernameLower, cleanEmail, emailLower, params.passwordHash, studentId]
        );

        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore rollback error
        }
        if (err instanceof AuthConflictError) {
          throw err;
        }
        const pgErr = err as { code?: string; constraint?: string };
        if (pgErr?.code === '23505') {
          if (pgErr.constraint?.includes('email')) {
            throw new AuthConflictError('EMAIL_TAKEN', 'Email này đã được đăng ký tài khoản.');
          }
          throw new AuthConflictError('USERNAME_TAKEN', 'Tên đăng nhập này đã có người sử dụng.');
        }
        throw err;
      } finally {
        client.release();
      }

      await applyTrialProgressToStudent(studentId, params.trialProgress);
      const profile = await getStudentProfile(studentId);
      return {
        user: {
          id: userId,
          username: cleanUsername,
          email: cleanEmail,
          studentId,
          createdAt: nowIso,
        },
        profile,
      };
    } catch (err) {
      if (err instanceof AuthConflictError) {
        throw err;
      }
      markPgUnavailable(err);
      console.error('Supabase user registration failed, falling back to local:', err);
    }
  }

  const local = readLocalStore();
  const accountsList = Object.values(local.accounts || {});
  if (accountsList.some((acc) => acc.usernameLower === usernameLower)) {
    throw new AuthConflictError('USERNAME_TAKEN', 'Tên đăng nhập này đã có người sử dụng.');
  }
  if (accountsList.some((acc) => acc.emailLower === emailLower)) {
    throw new AuthConflictError('EMAIL_TAKEN', 'Email này đã được đăng ký tài khoản.');
  }

  const profile = getDefaultStudent(studentId, cleanUsername);
  local.students[studentId] = profile;
  local.accounts = local.accounts || {};
  local.accounts[userId] = {
    id: userId,
    username: cleanUsername,
    usernameLower,
    email: cleanEmail,
    emailLower,
    passwordHash: params.passwordHash,
    studentId,
    createdAt: nowIso,
  };
  writeLocalStore(local);

  await applyTrialProgressToStudent(studentId, params.trialProgress);
  const syncedProfile = await getStudentProfile(studentId);

  return {
    user: {
      id: userId,
      username: cleanUsername,
      email: cleanEmail,
      studentId,
      createdAt: nowIso,
    },
    profile: syncedProfile,
  };
}

export async function authenticateUserAccount(
  identifier: string,
  password: string,
  trialProgress?: TrialProgressInput[]
): Promise<{ user: AuthUser; profile: StudentProfile } | null> {
  const cleanLower = identifier.trim().toLowerCase();
  if (!cleanLower) return null;

  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      const res = await pool.query(
        `SELECT id, username, email, password_hash, student_id, created_at
         FROM user_accounts
         WHERE email_lower = $1 OR username_lower = $1
         LIMIT 1`,
        [cleanLower]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        if (!verifyPassword(password, String(row.password_hash))) {
          return null;
        }
        const stId = String(row.student_id);
        await applyTrialProgressToStudent(stId, trialProgress);
        const profile = await getStudentProfile(stId);
        return {
          user: {
            id: String(row.id),
            username: String(row.username),
            email: String(row.email),
            studentId: stId,
            createdAt: new Date(row.created_at).toISOString(),
          },
          profile,
        };
      }
      return null;
    } catch (err) {
      markPgUnavailable(err);
      console.error('Supabase login failed, falling back to local:', err);
    }
  }

  const local = readLocalStore();
  const matched = Object.values(local.accounts || {}).find(
    (acc) => acc.emailLower === cleanLower || acc.usernameLower === cleanLower
  );
  if (!matched || !verifyPassword(password, matched.passwordHash)) {
    return null;
  }
  await applyTrialProgressToStudent(matched.studentId, trialProgress);
  const profile = await getStudentProfile(matched.studentId);
  return {
    user: {
      id: matched.id,
      username: matched.username,
      email: matched.email,
      studentId: matched.studentId,
      createdAt: matched.createdAt,
    },
    profile,
  };
}

export async function createUserSession(
  userId: string,
  tokenHash: string,
  expiresAtIso: string
): Promise<void> {
  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      await pool.query(
        `INSERT INTO user_sessions (token_hash, user_id, expires_at)
         VALUES ($1, $2, $3::timestamptz)
         ON CONFLICT (token_hash) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           expires_at = EXCLUDED.expires_at`,
        [tokenHash, userId, expiresAtIso]
      );
      await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
      return;
    } catch (err) {
      markPgUnavailable(err);
      console.error('Supabase create session failed, saving locally:', err);
    }
  }

  const local = readLocalStore();
  local.sessions = local.sessions || {};
  const nowMs = Date.now();
  for (const [k, s] of Object.entries(local.sessions)) {
    if (Date.parse(s.expiresAt) <= nowMs) {
      delete local.sessions[k];
    }
  }
  local.sessions[tokenHash] = {
    tokenHash,
    userId,
    expiresAt: expiresAtIso,
    createdAt: new Date().toISOString(),
  };
  writeLocalStore(local);
}

export async function getSessionAccount(
  tokenHash: string
): Promise<{ user: AuthUser; profile: StudentProfile } | null> {
  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      const res = await pool.query(
        `SELECT ua.id, ua.username, ua.email, ua.student_id, ua.created_at, us.expires_at
         FROM user_sessions us
         JOIN user_accounts ua ON ua.id = us.user_id
         WHERE us.token_hash = $1
         LIMIT 1`,
        [tokenHash]
      );
      if (res.rows.length === 0) {
        return null;
      }
      const row = res.rows[0];
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
        return null;
      }
      const profile = await getStudentProfile(String(row.student_id));
      return {
        user: {
          id: String(row.id),
          username: String(row.username),
          email: String(row.email),
          studentId: String(row.student_id),
          createdAt: new Date(row.created_at).toISOString(),
        },
        profile,
      };
    } catch (err) {
      markPgUnavailable(err);
      console.error('Supabase get session failed, falling back to local:', err);
    }
  }

  const local = readLocalStore();
  const session = local.sessions?.[tokenHash];
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) {
    delete local.sessions![tokenHash];
    writeLocalStore(local);
    return null;
  }
  const account = local.accounts?.[session.userId];
  if (!account) return null;
  const profile = await getStudentProfile(account.studentId);
  return {
    user: {
      id: account.id,
      username: account.username,
      email: account.email,
      studentId: account.studentId,
      createdAt: account.createdAt,
    },
    profile,
  };
}

export async function deleteUserSession(tokenHash: string): Promise<void> {
  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      await pool.query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
      return;
    } catch (err) {
      markPgUnavailable(err);
      console.error('Supabase delete session failed:', err);
    }
  }

  const local = readLocalStore();
  if (local.sessions && local.sessions[tokenHash]) {
    delete local.sessions[tokenHash];
    writeLocalStore(local);
  }
}

export async function getUserChatConversations(userId: string): Promise<AiChatConversation[]> {
  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      const res = await pool.query(
        `SELECT id, topic_id, language_id, title, messages, suggestions, created_at, updated_at
         FROM ai_chat_conversations
         WHERE user_id = $1
         ORDER BY updated_at DESC
         LIMIT 30`,
        [userId]
      );
      return res.rows.map((row) => ({
        id: String(row.id),
        topicId: String(row.topic_id) as AiChatConversation['topicId'],
        languageId: String(row.language_id) as AiChatConversation['languageId'],
        title: String(row.title),
        messages: Array.isArray(row.messages) ? row.messages : [],
        suggestions: Array.isArray(row.suggestions) ? row.suggestions : [],
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      }));
    } catch (err) {
      markPgUnavailable(err);
      console.error('Supabase getUserChatConversations failed, falling back to local:', err);
    }
  }

  const local = readLocalStore();
  const list = local.chatConversations?.[userId] || [];
  return [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 30);
}

export async function upsertUserChatConversation(
  userId: string,
  conversation: AiChatConversation
): Promise<AiChatConversation> {
  const nowIso = new Date().toISOString();
  const cleanConv: AiChatConversation = {
    ...conversation,
    updatedAt: conversation.updatedAt || nowIso,
    createdAt: conversation.createdAt || nowIso,
    messages: conversation.messages.slice(-80),
    suggestions: conversation.suggestions.slice(0, 3),
  };

  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      await pool.query(
        `INSERT INTO ai_chat_conversations (id, user_id, topic_id, language_id, title, messages, suggestions, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz, $9::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           topic_id = EXCLUDED.topic_id,
           language_id = EXCLUDED.language_id,
           title = EXCLUDED.title,
           messages = EXCLUDED.messages,
           suggestions = EXCLUDED.suggestions,
           updated_at = EXCLUDED.updated_at
         WHERE ai_chat_conversations.user_id = $2`,
        [
          cleanConv.id,
          userId,
          cleanConv.topicId,
          cleanConv.languageId,
          cleanConv.title.slice(0, 120),
          JSON.stringify(cleanConv.messages),
          JSON.stringify(cleanConv.suggestions),
          cleanConv.createdAt,
          cleanConv.updatedAt,
        ]
      );
      return cleanConv;
    } catch (err) {
      markPgUnavailable(err);
      console.error('Supabase upsertUserChatConversation failed, saving locally:', err);
    }
  }

  const local = readLocalStore();
  local.chatConversations = local.chatConversations || {};
  const existing = (local.chatConversations[userId] || []).filter((c) => c.id !== cleanConv.id);
  local.chatConversations[userId] = [cleanConv, ...existing].slice(0, 30);
  writeLocalStore(local);
  return cleanConv;
}

export async function deleteUserChatConversation(userId: string, conversationId: string): Promise<void> {
  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      await pool.query('DELETE FROM ai_chat_conversations WHERE id = $1 AND user_id = $2', [
        conversationId,
        userId,
      ]);
      return;
    } catch (err) {
      markPgUnavailable(err);
      console.error('Supabase deleteUserChatConversation failed:', err);
    }
  }

  const local = readLocalStore();
  if (local.chatConversations?.[userId]) {
    local.chatConversations[userId] = local.chatConversations[userId].filter(
      (c) => c.id !== conversationId
    );
    writeLocalStore(local);
  }
}

export async function clearUserChatConversations(userId: string): Promise<void> {
  const pool = getPgPool();
  if (pool) {
    try {
      await ensurePgSchemaAndSeed(pool);
      await pool.query('DELETE FROM ai_chat_conversations WHERE user_id = $1', [userId]);
      return;
    } catch (err) {
      markPgUnavailable(err);
      console.error('Supabase clearUserChatConversations failed:', err);
    }
  }

  const local = readLocalStore();
  if (local.chatConversations) {
    local.chatConversations[userId] = [];
    writeLocalStore(local);
  }
}

