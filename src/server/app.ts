import express, { NextFunction, Request, Response } from 'express';
import {
  AuthConflictError,
  TrialProgressInput,
  authenticateUserAccount,
  clearUserChatConversations,
  createUserSession,
  deleteUserChatConversation,
  deleteUserSession,
  getAllLessons,
  getLeaderboard,
  getSessionAccount,
  getStudentProfile,
  getUserChatConversations,
  importCurriculum,
  recordLessonCompletion,
  registerUserAccount,
  resetToSeedCurriculum,
  saveStudentName,
  upsertUserChatConversation,
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
import {
  GeminiApiRouteError,
  evaluatePronunciationAndChat,
  generateReplySuggestions,
  generateSpeechAudio,
  generateTopicStarter,
  generateChatTurn,
  isGeminiConfigured,
  translateMessageToVietnamese,
} from './geminiChat.ts';
import { CHAT_LANGUAGE_IDS, CHAT_TOPIC_IDS } from '../shared/chatTopics.ts';
import {
  AiChatConversation,
  AuthUser,
  ChatLanguageId,
  ChatTopicId,
  ExcelImportRow,
  StudentProfile,
} from '../shared/types.ts';

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

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
]);

const aiRateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkAiRateLimit(req: Request, res: Response): boolean {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const bucket = aiRateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    aiRateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= 40) {
    res.status(429).json({ error: 'Bạn đang gửi quá nhanh. Vui lòng đợi vài giây rồi thử lại.' });
    return false;
  }
  bucket.count += 1;
  return true;
}

function parseTopicId(raw: unknown): ChatTopicId {
  if (typeof raw === 'string' && CHAT_TOPIC_IDS.has(raw as ChatTopicId)) {
    return raw as ChatTopicId;
  }
  return 'daily_life';
}

function parseLanguageId(raw: unknown): ChatLanguageId {
  if (typeof raw === 'string' && CHAT_LANGUAGE_IDS.has(raw as ChatLanguageId)) {
    return raw as ChatLanguageId;
  }
  return 'en';
}

function sanitizeChatHistory(raw: unknown): Array<{ role: 'user' | 'assistant'; text: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  for (const item of raw.slice(-20)) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    const text = (item as { text?: unknown }).text;
    if ((role === 'user' || role === 'assistant') && typeof text === 'string' && text.trim()) {
      out.push({ role, text: text.trim().slice(0, 1200) });
    }
  }
  return out;
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));

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

  app.get('/api/ai-chat/status', (_req, res) => {
    res.json({
      ok: true,
      online: true,
      aiConfigured: isGeminiConfigured(),
    });
  });

  app.post('/api/ai-chat/start', async (req, res) => {
    if (!checkAiRateLimit(req, res)) return;
    try {
      const topicId = parseTopicId(req.body?.topicId);
      const languageId = parseLanguageId(req.body?.languageId);
      const { lessons } = languageId === 'kho' ? await getAllLessons() : { lessons: [] };
      const starter = await generateTopicStarter(topicId, languageId, lessons);
      return res.json(starter);
    } catch (error) {
      if (error instanceof GeminiApiRouteError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('Error starting AI chat:', error);
      return res.status(500).json({ error: 'Không thể bắt đầu cuộc hội thoại AI.' });
    }
  });

  app.post('/api/ai-chat/message', async (req, res) => {
    if (!checkAiRateLimit(req, res)) return;
    try {
      const topicId = parseTopicId(req.body?.topicId);
      const languageId = parseLanguageId(req.body?.languageId);
      const rawMessage = req.body?.message;
      if (typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
        return res.status(400).json({ error: 'Vui lòng nhập nội dung tin nhắn.' });
      }
      if (rawMessage.length > 1500) {
        return res.status(400).json({ error: 'Tin nhắn quá dài (tối đa 1500 ký tự).' });
      }

      const history = sanitizeChatHistory(req.body?.history);
      const { lessons } = languageId === 'kho' ? await getAllLessons() : { lessons: [] };
      const result = await generateChatTurn({
        topicId,
        languageId,
        userMessage: rawMessage.trim(),
        history,
        lessons,
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof GeminiApiRouteError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('Error generating AI reply:', error);
      return res.status(500).json({ error: 'Không thể nhận phản hồi từ AI lúc này.' });
    }
  });

  app.post('/api/ai-chat/translate', async (req, res) => {
    if (!checkAiRateLimit(req, res)) return;
    try {
      const text = req.body?.text;
      const languageId = parseLanguageId(req.body?.languageId);
      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Thiếu nội dung cần dịch.' });
      }
      const translation = await translateMessageToVietnamese(text.trim().slice(0, 2000), languageId);
      return res.json({ translation });
    } catch (error) {
      if (error instanceof GeminiApiRouteError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('Error translating AI message:', error);
      return res.status(500).json({ error: 'Không thể dịch tin nhắn lúc này.' });
    }
  });

  app.post('/api/ai-chat/suggestions', async (req, res) => {
    if (!checkAiRateLimit(req, res)) return;
    try {
      const topicId = parseTopicId(req.body?.topicId);
      const languageId = parseLanguageId(req.body?.languageId);
      const history = sanitizeChatHistory(req.body?.history);
      const { lessons } = languageId === 'kho' ? await getAllLessons() : { lessons: [] };
      const suggestions = await generateReplySuggestions({
        topicId,
        languageId,
        history,
        lessons,
      });
      return res.json({ suggestions });
    } catch (error) {
      if (error instanceof GeminiApiRouteError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('Error generating suggestions:', error);
      return res.status(500).json({ error: 'Không thể tạo gợi ý câu trả lời lúc này.' });
    }
  });

  app.post('/api/ai-chat/pronunciation', async (req, res) => {
    if (!checkAiRateLimit(req, res)) return;
    try {
      const topicId = parseTopicId(req.body?.topicId);
      const languageId = parseLanguageId(req.body?.languageId);
      const history = sanitizeChatHistory(req.body?.history);
      const rawAudioBase64 = typeof req.body?.audioBase64 === 'string' ? req.body.audioBase64.trim() : '';
      const rawMimeType =
        typeof req.body?.mimeType === 'string' ? req.body.mimeType.split(';')[0].trim().toLowerCase() : '';
      const browserTranscript =
        typeof req.body?.browserTranscript === 'string' ? req.body.browserTranscript.trim().slice(0, 1200) : '';

      if (!rawAudioBase64 && !browserTranscript) {
        return res.status(400).json({ error: 'Không có dữ liệu âm thanh hoặc giọng nói để phân tích.' });
      }
      if (rawAudioBase64) {
        if (rawAudioBase64.length > 8_000_000) {
          return res.status(400).json({ error: 'Đoạn ghi âm quá dài. Vui lòng nói ngắn gọn hơn (dưới 45 giây).' });
        }
        if (!ALLOWED_AUDIO_MIME_TYPES.has(rawMimeType)) {
          return res.status(400).json({ error: 'Định dạng âm thanh không được hỗ trợ.' });
        }
      }

      const { lessons } = languageId === 'kho' ? await getAllLessons() : { lessons: [] };
      const result = await evaluatePronunciationAndChat({
        topicId,
        languageId,
        history,
        lessons,
        audioBase64: rawAudioBase64 || undefined,
        mimeType: rawAudioBase64 ? rawMimeType : undefined,
        browserTranscript: browserTranscript || undefined,
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof GeminiApiRouteError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('Error evaluating pronunciation:', error);
      return res.status(500).json({ error: 'Không thể phân tích phát âm lúc này.' });
    }
  });

  app.post('/api/ai-chat/tts', async (req, res) => {
    if (!checkAiRateLimit(req, res)) return;
    try {
      const text = req.body?.text;
      const languageId = parseLanguageId(req.body?.languageId);
      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Thiếu văn bản để phát âm thanh.' });
      }
      const audio = await generateSpeechAudio(text.trim(), languageId);
      return res.json(audio);
    } catch (error) {
      if (error instanceof GeminiApiRouteError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('Error generating TTS audio:', error);
      return res.status(500).json({ error: 'Không thể tạo âm thanh đọc câu trả lời.' });
    }
  });

  app.get('/api/ai-chat/conversations', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const conversations = await getUserChatConversations(req.authUser!.id);
      return res.json({ conversations });
    } catch (error) {
      console.error('Error loading chat conversations:', error);
      return res.status(500).json({ error: 'Không thể tải lịch sử hội thoại.' });
    }
  });

  app.put('/api/ai-chat/conversations/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const convId = req.params.id?.trim();
      if (!convId || convId.length > 100) {
        return res.status(400).json({ error: 'Mã cuộc trò chuyện không hợp lệ.' });
      }
      const body = req.body as Partial<AiChatConversation>;
      if (!body || !Array.isArray(body.messages)) {
        return res.status(400).json({ error: 'Dữ liệu cuộc trò chuyện không hợp lệ.' });
      }
      const saved = await upsertUserChatConversation(req.authUser!.id, {
        id: convId,
        topicId: parseTopicId(body.topicId),
        languageId: parseLanguageId(body.languageId),
        title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Hội thoại AI',
        messages: body.messages,
        suggestions: Array.isArray(body.suggestions) ? body.suggestions : [],
        createdAt: typeof body.createdAt === 'string' ? body.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return res.json({ conversation: saved });
    } catch (error) {
      console.error('Error saving chat conversation:', error);
      return res.status(500).json({ error: 'Không thể lưu lịch sử hội thoại.' });
    }
  });

  app.delete('/api/ai-chat/conversations/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const convId = req.params.id?.trim();
      if (!convId) {
        return res.status(400).json({ error: 'Thiếu mã cuộc trò chuyện.' });
      }
      await deleteUserChatConversation(req.authUser!.id, convId);
      return res.json({ ok: true });
    } catch (error) {
      console.error('Error deleting chat conversation:', error);
      return res.status(500).json({ error: 'Không thể xóa cuộc trò chuyện.' });
    }
  });

  app.delete('/api/ai-chat/conversations', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      await clearUserChatConversations(req.authUser!.id);
      return res.json({ ok: true });
    } catch (error) {
      console.error('Error clearing chat conversations:', error);
      return res.status(500).json({ error: 'Không thể xóa lịch sử trò chuyện.' });
    }
  });

  return app;
}
