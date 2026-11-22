import express, { NextFunction, Request, Response } from 'express';
import {
  AuthConflictError,
  TrialProgressInput,
  authenticateUserAccount,
  createUserSession,
  deleteUserSession,
  getAllLessons,
  getLeaderboard,
  getSessionAccount,
  getStudentProfile,
  importCurriculum,
  recordLessonCompletion,
  registerUserAccount,
  resetToSeedCurriculum,
  saveStudentName,
} from './db.ts';
import {
  clearSessionCookie,
  createSessionToken,
  getSessionTokenFromRequest,
  hashPassword,
  hashSessionToken,
  setSessionCookie,
  validateEmailInput,
  validateIdentifierInput,
  validatePasswordInput,
  validateUsernameInput,
  verifyMutationCsrf,
} from './auth.ts';
import { AuthUser, ExcelImportRow, StudentProfile } from '../shared/types.ts';

interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
  authProfile?: StudentProfile;
}

async function resolveAuthSession(req: Request): Promise<{ user: AuthUser; profile: StudentProfile } | null> {
  const rawToken = getSessionTokenFromRequest(req);
  if (!rawToken) return null;
  const tokenHash = hashSessionToken(rawToken);
  return getSessionAccount(tokenHash);
}

async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const session = await resolveAuthSession(req);
    if (!session) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
    }
    req.authUser = session.user;
    req.authProfile = session.profile;
    return next();
  } catch (error) {
    console.error('Auth verification error:', error);
    return res.status(500).json({ error: 'Lỗi xác thực phiên đăng nhập.' });
  }
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));

  // CSRF check for all API mutations (POST/PUT/PATCH/DELETE)
  app.use('/api', (req, res, next) => {
    if (!verifyMutationCsrf(req)) {
      return res.status(403).json({ error: 'Yêu cầu không hợp lệ (Origin/CSRF).' });
    }
    return next();
  });

  app.get('/api/health', async (_req, res) => {
    try {
      const { lessons, storage } = await getAllLessons();
      res.json({ ok: true, storage, lessonCount: lessons.length });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  });

  app.get('/api/auth/session', async (req, res) => {
    try {
      const session = await resolveAuthSession(req);
      if (!session) {
        return res.json({ authenticated: false, user: null, profile: null });
      }
      return res.json({
        authenticated: true,
        user: session.user,
        profile: session.profile,
      });
    } catch (error) {
      console.error('Error checking auth session:', error);
      return res.status(500).json({ error: 'Không thể kiểm tra phiên đăng nhập.' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { username, email, password, trialProgress } = req.body as {
        username?: unknown;
        email?: unknown;
        password?: unknown;
        trialProgress?: TrialProgressInput[];
      };

      const usernameCheck = validateUsernameInput(username);
      if (!usernameCheck.ok) {
        return res.status(400).json({ error: usernameCheck.error });
      }

      const emailCheck = validateEmailInput(email);
      if (!emailCheck.ok) {
        return res.status(400).json({ error: emailCheck.error });
      }

      const passwordCheck = validatePasswordInput(password);
      if (!passwordCheck.ok) {
        return res.status(400).json({ error: passwordCheck.error });
      }

      const passwordHash = hashPassword(passwordCheck.value);
      const { user, profile } = await registerUserAccount({
        username: usernameCheck.value,
        email: emailCheck.value,
        passwordHash,
        trialProgress: Array.isArray(trialProgress) ? trialProgress : undefined,
      });

      const { rawToken, tokenHash, expiresAtIso } = createSessionToken();
      await createUserSession(user.id, tokenHash, expiresAtIso);
      setSessionCookie(req, res, rawToken);

      return res.status(201).json({
        authenticated: true,
        user,
        profile,
      });
    } catch (error) {
      if (error instanceof AuthConflictError) {
        return res.status(409).json({ error: error.message });
      }
      console.error('Error registering user:', error);
      return res.status(500).json({ error: 'Không thể đăng ký tài khoản. Vui lòng thử lại.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { identifier, password, trialProgress } = req.body as {
        identifier?: unknown;
        password?: unknown;
        trialProgress?: TrialProgressInput[];
      };

      const idCheck = validateIdentifierInput(identifier);
      if (!idCheck.ok) {
        return res.status(400).json({ error: idCheck.error });
      }

      if (typeof password !== 'string' || password.length === 0 || password.length > 128) {
        return res.status(400).json({ error: 'Vui lòng nhập mật khẩu.' });
      }

      const authResult = await authenticateUserAccount(
        idCheck.value,
        password,
        Array.isArray(trialProgress) ? trialProgress : undefined
      );
      if (!authResult) {
        return res.status(401).json({ error: 'Email/tên đăng nhập hoặc mật khẩu không đúng.' });
      }

      const { rawToken, tokenHash, expiresAtIso } = createSessionToken();
      await createUserSession(authResult.user.id, tokenHash, expiresAtIso);
      setSessionCookie(req, res, rawToken);

      return res.json({
        authenticated: true,
        user: authResult.user,
        profile: authResult.profile,
      });
    } catch (error) {
      console.error('Error logging in user:', error);
      return res.status(500).json({ error: 'Không thể đăng nhập. Vui lòng thử lại.' });
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    try {
      const rawToken = getSessionTokenFromRequest(req);
      if (rawToken) {
        await deleteUserSession(hashSessionToken(rawToken));
      }
      clearSessionCookie(req, res);
      return res.json({ ok: true });
    } catch (error) {
      console.error('Error logging out:', error);
      clearSessionCookie(req, res);
      return res.json({ ok: true });
    }
  });

  app.get('/api/curriculum', async (_req, res) => {
    try {
      const data = await getAllLessons();
      res.json(data);
    } catch (error) {
      console.error('Error getting curriculum:', error);
      res.status(500).json({ error: 'Không thể tải danh sách bài học.' });
    }
  });

  app.post('/api/curriculum/import', requireAuth, async (req, res) => {
    try {
      const { rows, mode } = req.body as {
        rows?: ExcelImportRow[];
        mode?: 'append' | 'replace';
      };

      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'Dữ liệu Excel trống hoặc không hợp lệ.' });
      }

      const result = await importCurriculum(rows, mode === 'replace' ? 'replace' : 'append');
      res.json(result);
    } catch (error) {
      console.error('Error importing curriculum:', error);
      res.status(500).json({ error: 'Không thể lưu dữ liệu Excel vào hệ thống.' });
    }
  });

  app.post('/api/curriculum/reset', requireAuth, async (_req, res) => {
    try {
      const result = await resetToSeedCurriculum();
      res.json(result);
    } catch (error) {
      console.error('Error resetting curriculum:', error);
      res.status(500).json({ error: 'Không thể khôi phục dữ liệu mẫu.' });
    }
  });

  app.get('/api/student/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.authUser?.studentId !== req.params.id) {
        return res.status(403).json({ error: 'Không có quyền truy cập hồ sơ của người chơi khác.' });
      }
      const profile = await getStudentProfile(req.params.id);
      res.json(profile);
    } catch (error) {
      console.error('Error getting student profile:', error);
      res.status(500).json({ error: 'Không thể tải hồ sơ học sinh.' });
    }
  });

  app.put('/api/student/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.authUser?.studentId !== req.params.id) {
        return res.status(403).json({ error: 'Không có quyền chỉnh sửa hồ sơ của người chơi khác.' });
      }
      const { displayName } = req.body as { displayName?: string };
      if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
        return res.status(400).json({ error: 'Tên học sinh không hợp lệ.' });
      }
      const profile = await saveStudentName(req.params.id, displayName);
      res.json(profile);
    } catch (error) {
      console.error('Error updating student profile:', error);
      res.status(500).json({ error: 'Không thể cập nhật tên học sinh.' });
    }
  });

  app.post('/api/student/:id/complete', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      if (req.authUser?.studentId !== req.params.id) {
        return res.status(403).json({ error: 'Không có quyền cập nhật tiến trình của người chơi khác.' });
      }
      const { lessonId, score, earnedXp, heartsRemaining } = req.body as {
        lessonId?: string;
        score?: number;
        earnedXp?: number;
        heartsRemaining?: number;
      };
      if (!lessonId || typeof lessonId !== 'string' || typeof score !== 'number' || typeof earnedXp !== 'number') {
        return res.status(400).json({ error: 'Thiếu thông tin hoàn thành bài học.' });
      }
      const safeScore = Math.max(0, Math.min(100, Math.round(score)));
      const safeXp = Math.max(0, Math.min(200, Math.round(earnedXp)));
      const safeHearts = typeof heartsRemaining === 'number' ? Math.max(0, Math.min(5, Math.round(heartsRemaining))) : 5;

      const profile = await recordLessonCompletion({
        studentId: req.params.id,
        lessonId: lessonId.slice(0, 120),
        score: safeScore,
        earnedXp: safeXp,
        heartsRemaining: safeHearts,
      });
      res.json(profile);
    } catch (error) {
      console.error('Error completing lesson:', error);
      res.status(500).json({ error: 'Không thể lưu tiến độ học tập.' });
    }
  });

  app.get('/api/leaderboard', async (req, res) => {
    try {
      const sortParam = req.query.sort === 'xp' ? 'xp' : 'score';
      const limitParam = Number(req.query.limit) || 50;
      const data = await getLeaderboard(limitParam, sortParam);
      res.json(data);
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      res.status(500).json({ error: 'Không thể tải bảng xếp hạng.' });
    }
  });

  return app;
}
