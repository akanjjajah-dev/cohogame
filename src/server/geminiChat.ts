import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { getChatLanguageMeta, getChatTopicMeta } from '../shared/chatTopics.ts';
import {
  ChatCorrection,
  ChatLanguageId,
  ChatPronunciationFeedback,
  ChatReplySuggestion,
  ChatTopicId,
  LessonItem,
} from '../shared/types.ts';

const PRIMARY_TEXT_MODEL = 'gemini-4-hydrogen';
const FALLBACK_TEXT_MODEL = 'gemini-3.1-flash-lite';
const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
const TTS_MODEL = 'gemini-3.8-flash-lite-tts';

export class GeminiApiRouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GeminiApiRouteError';
    this.status = status;
  }
}

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new GeminiApiRouteError(
      503,
      'Dịch vụ AI chưa được cấu hình GEMINI_API_KEY trên máy chủ. Vui lòng thiết lập khóa API trong phần Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrDetails(err: unknown): { status?: number; message: string } {
  const message = err instanceof Error ? err.message : String(err || '');
  const status = (err as { status?: number })?.status;
  return { status, message };
}

function isQuotaOrTransientError(err: unknown): boolean {
  const { status, message } = extractErrDetails(err);
  return (
    status === 429 ||
    status === 503 ||
    status === 500 ||
    status === 502 ||
    /ECONNRESET|ETIMEDOUT|UNAVAILABLE|RESOURCE_EXHAUSTED|quota|rate limit|503|429/i.test(message)
  );
}

function classifyGeminiError(err: unknown): GeminiApiRouteError {
  if (err instanceof GeminiApiRouteError) return err;

  const { status, message: rawMsg } = extractErrDetails(err);
  console.error('[GeminiChatError]', { status, message: rawMsg.slice(0, 300) });

  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(rawMsg) || status === 403) {
    return new GeminiApiRouteError(
      403,
      'Khóa GEMINI_API_KEY không hợp lệ hoặc chưa được cấp quyền. Vui lòng kiểm tra lại trong Settings > Secrets.'
    );
  }
  if (/RESOURCE_EXHAUSTED|quota|rate limit/i.test(rawMsg) || status === 429) {
    return new GeminiApiRouteError(
      429,
      'Hệ thống AI đang quá tải hoặc hết hạn mức tạm thời. Vui lòng đợi vài giây rồi thử lại.'
    );
  }
  if (/NOT_FOUND/i.test(rawMsg) || status === 404) {
    return new GeminiApiRouteError(502, 'Model AI không khả dụng trên máy chủ. Vui lòng thử lại sau.');
  }
  if (status === 400 || /INVALID_ARGUMENT/i.test(rawMsg)) {
    return new GeminiApiRouteError(400, 'Nội dung gửi lên AI không hợp lệ. Vui lòng kiểm tra lại.');
  }
  return new GeminiApiRouteError(
    502,
    'Không thể kết nối tới dịch vụ Gemini AI lúc này. Vui lòng thử lại sau ít giây.'
  );
}

let hydrogenCooldownUntil = 0;

async function generateTextWithFallback(
  ai: GoogleGenAI,
  buildRequest: (model: string, thinkingLevel: ThinkingLevel) => Parameters<GoogleGenAI['models']['generateContent']>[0]
) {
  const hydrogenOnCooldown = Date.now() < hydrogenCooldownUntil;
  const attempts: Array<{ model: string; thinking: ThinkingLevel; delayBeforeMs: number }> =
    hydrogenOnCooldown
      ? [
          { model: FALLBACK_TEXT_MODEL, thinking: ThinkingLevel.MINIMAL, delayBeforeMs: 0 },
          { model: FALLBACK_TEXT_MODEL, thinking: ThinkingLevel.MINIMAL, delayBeforeMs: 1800 },
          { model: PRIMARY_TEXT_MODEL, thinking: ThinkingLevel.LOW, delayBeforeMs: 1200 },
        ]
      : [
          { model: PRIMARY_TEXT_MODEL, thinking: ThinkingLevel.LOW, delayBeforeMs: 0 },
          { model: FALLBACK_TEXT_MODEL, thinking: ThinkingLevel.MINIMAL, delayBeforeMs: 150 },
          { model: FALLBACK_TEXT_MODEL, thinking: ThinkingLevel.MINIMAL, delayBeforeMs: 1800 },
        ];

  let lastError: unknown;
  for (const step of attempts) {
    if (step.delayBeforeMs > 0) {
      await sleep(step.delayBeforeMs);
    }
    try {
      return await ai.models.generateContent(buildRequest(step.model, step.thinking));
    } catch (err) {
      lastError = err;
      const { status, message } = extractErrDetails(err);
      if (step.model === PRIMARY_TEXT_MODEL && (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(message))) {
        hydrogenCooldownUntil = Date.now() + 300_000;
      }
      console.warn(`[GeminiChat] ${step.model} attempt failed (${status ?? 'err'}): ${message.slice(0, 180)}`);
      if (!isQuotaOrTransientError(err) && !/NOT_FOUND/i.test(message)) {
        throw classifyGeminiError(err);
      }
    }
  }
  throw classifyGeminiError(lastError);
}

function safeJsonParse<T>(rawText: string | undefined, fallbackMsg: string): T {
  const cleaned = (rawText ?? '').trim();
  if (!cleaned) {
    throw new GeminiApiRouteError(502, fallbackMsg);
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch {
        // fall through
      }
    }
    throw new GeminiApiRouteError(502, fallbackMsg);
  }
}

function buildCohoLexiconContext(lessons: LessonItem[]): string {
  const vocabLines: string[] = [];
  const seen = new Set<string>();
  for (const lesson of lessons) {
    for (const ex of lesson.exercises) {
      const coho = ex.cohoText?.trim();
      const vi = ex.vietnameseText?.trim();
      if (coho && vi && !seen.has(coho.toLowerCase())) {
        seen.add(coho.toLowerCase());
        vocabLines.push(`- ${coho} = ${vi}${ex.phonetic ? ` (${ex.phonetic})` : ''}`);
      }
      if (vocabLines.length >= 25) break;
    }
    if (vocabLines.length >= 25) break;
  }
  if (vocabLines.length === 0) return '';
  return `\nMột số từ vựng Tiếng Cơ Ho (Lâm Đồng) chuẩn từ giáo trình:\n${vocabLines.join('\n')}`;
}

function buildTeacherPersonaInstruction(
  languageId: ChatLanguageId,
  topicId: ChatTopicId,
  lessons: LessonItem[]
): string {
  const lang = getChatLanguageMeta(languageId);
  const topic = getChatTopicMeta(topicId);
  const cohoNote =
    languageId === 'kho'
      ? `${buildCohoLexiconContext(lessons)}\nLưu ý Tiếng Cơ Ho: ưu tiên từ vựng K'Ho Srê/Cil/Lạch Lâm Đồng tự nhiên, có thể kèm phiên âm ngắn trong ngoặc nếu là từ mới.`
      : '';

  return [
    `Bạn là ${lang.teacherName}, giáo viên ngoại ngữ tận tâm và là người bản xứ nói ${lang.label} (${lang.nativeName}).`,
    `Chủ đề hội thoại: "${topic.title}" (${topic.titleVi} — ${topic.descriptionVi}).`,
    `Quy tắc giao tiếp BẮT BUỘC:`,
    `1. Mặc định trả lời phần hội thoại chính ("reply") bằng ${lang.label} (${lang.nativeName}) tự nhiên như người bạn bản xứ (1–3 câu), kết thúc bằng 1 câu hỏi mở để duy trì hội thoại.`,
    `2. Chỉ trả lời chính bằng Tiếng Việt nếu người dùng trực tiếp yêu cầu giải thích hoặc nói Tiếng Việt.`,
    `3. Không chế giễu người học khi mắc lỗi; luôn khích lệ nhẹ nhàng, ngắn gọn, dễ hiểu.`,
    `4. Kiểm tra ngữ pháp (grammar), chính tả (spelling), cách dùng từ (word_choice): đưa câu sửa đúng ("correctedText"), giải thích lỗi bằng Tiếng Việt ("issues"), và gợi ý cách nói tự nhiên hơn ("naturalSuggestion").`,
    `5. Luôn giữ đúng ngữ cảnh hội thoại và trả lời đúng JSON schema.`,
    cohoNote,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface StartConversationResult {
  greeting: string;
  vietnameseTranslation: string;
  suggestions: ChatReplySuggestion[];
}

export async function generateTopicStarter(
  topicId: ChatTopicId,
  languageId: ChatLanguageId,
  lessons: LessonItem[]
): Promise<StartConversationResult> {
  const ai = getGeminiClient();
  const lang = getChatLanguageMeta(languageId);
  const topic = getChatTopicMeta(topicId);

  const systemInstruction = buildTeacherPersonaInstruction(languageId, topicId, lessons);
  const prompt = `Hãy bắt đầu một cuộc hội thoại tự nhiên về chủ đề "${topic.title}" (${topic.titleVi}) bằng ${lang.label} (${lang.nativeName}).
Hãy chào thân thiện như một người bạn bản xứ, đặt 1 câu hỏi mở nhẹ nhàng để người học dễ trả lời.
Đồng thời cung cấp bản dịch Tiếng Việt chính xác của lời chào và 3 gợi ý câu trả lời ngắn gọn bằng ${lang.label} kèm nghĩa Tiếng Việt.`;

  const response = await generateTextWithFallback(ai, (model, thinkingLevel) => ({
    model,
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          greeting: {
            type: Type.STRING,
            description: `Opening conversational greeting from the native speaker in ${lang.nativeName}.`,
          },
          vietnameseTranslation: {
            type: Type.STRING,
            description: 'Natural Vietnamese translation of the greeting.',
          },
          suggestions: {
            type: Type.ARRAY,
            description: 'Exactly 3 contextual reply suggestions for the learner.',
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING, description: `Reply in ${lang.nativeName}` },
                vietnameseMeaning: { type: Type.STRING, description: 'Meaning in Vietnamese' },
              },
              required: ['text', 'vietnameseMeaning'],
            },
          },
        },
        required: ['greeting', 'vietnameseTranslation', 'suggestions'],
      },
    },
  }));

  const parsed = safeJsonParse<StartConversationResult>(
    response.text,
    'Không thể khởi tạo hội thoại từ AI. Vui lòng thử lại.'
  );
  return {
    greeting: String(parsed.greeting || '').trim(),
    vietnameseTranslation: String(parsed.vietnameseTranslation || '').trim(),
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [],
  };
}

export interface ChatHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatTurnResult {
  reply: string;
  vietnameseTranslation: string;
  correction: ChatCorrection;
  suggestions: ChatReplySuggestion[];
}

export async function generateChatTurn(params: {
  topicId: ChatTopicId;
  languageId: ChatLanguageId;
  userMessage: string;
  history: ChatHistoryTurn[];
  lessons: LessonItem[];
}): Promise<ChatTurnResult> {
  const { topicId, languageId, userMessage, history, lessons } = params;
  const ai = getGeminiClient();
  const lang = getChatLanguageMeta(languageId);
  const systemInstruction = buildTeacherPersonaInstruction(languageId, topicId, lessons);

  const recentHistory = history
    .slice(-14)
    .map((h) => `${h.role === 'user' ? 'Người học' : lang.teacherName}: ${h.text}`)
    .join('\n');

  const prompt = [
    recentHistory ? `Lịch sử hội thoại gần đây:\n${recentHistory}\n` : '',
    `Tin nhắn mới nhất của người học:\n"${userMessage}"`,
    `\nHãy:`,
    `1. Phân tích lỗi ngữ pháp, chính tả, cách dùng từ của câu người học vừa viết (giải thích ngắn gọn bằng Tiếng Việt, đưa ra câu sửa đúng và 1 cách nói tự nhiên hơn như người bản xứ).`,
    `2. Trả lời tiếp tục mạch hội thoại bằng ${lang.label} tự nhiên, thân thiện (trừ khi người học yêu cầu nói Tiếng Việt).`,
    `3. Cung cấp bản dịch Tiếng Việt cho câu trả lời của bạn.`,
    `4. Đưa ra 3 gợi ý câu trả lời tiếp theo phù hợp ngữ cảnh.`,
  ].join('\n');

  const response = await generateTextWithFallback(ai, (model, thinkingLevel) => ({
    model,
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          reply: {
            type: Type.STRING,
            description: `Natural native reply continuing the conversation in ${lang.nativeName}.`,
          },
          vietnameseTranslation: {
            type: Type.STRING,
            description: 'Natural Vietnamese translation of the reply.',
          },
          correction: {
            type: Type.OBJECT,
            properties: {
              hasErrors: { type: Type.BOOLEAN },
              correctedText: {
                type: Type.STRING,
                description: `Corrected sentence in ${lang.nativeName}.`,
              },
              issues: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: {
                      type: Type.STRING,
                      description: "Must be one of: 'grammar', 'spelling', 'word_choice'",
                    },
                    explanationVi: {
                      type: Type.STRING,
                      description: 'Short, clear explanation in Vietnamese.',
                    },
                  },
                  required: ['type', 'explanationVi'],
                },
              },
              naturalSuggestion: {
                type: Type.STRING,
                description: `More natural native phrasing in ${lang.nativeName}.`,
              },
              naturalSuggestionVi: {
                type: Type.STRING,
                description: 'Vietnamese explanation/meaning of the natural suggestion.',
              },
              encouragementVi: {
                type: Type.STRING,
                description: 'Warm, brief encouragement in Vietnamese.',
              },
            },
            required: [
              'hasErrors',
              'correctedText',
              'issues',
              'naturalSuggestion',
              'naturalSuggestionVi',
              'encouragementVi',
            ],
          },
          suggestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                vietnameseMeaning: { type: Type.STRING },
              },
              required: ['text', 'vietnameseMeaning'],
            },
          },
        },
        required: ['reply', 'vietnameseTranslation', 'correction', 'suggestions'],
      },
    },
  }));

  const parsed = safeJsonParse<ChatTurnResult>(
    response.text,
    'Không thể đọc phản hồi từ AI. Vui lòng thử gửi lại.'
  );

  const normalizedIssues = Array.isArray(parsed.correction?.issues)
    ? parsed.correction.issues.map((item) => ({
        type:
          item.type === 'spelling' || item.type === 'word_choice' ? item.type : ('grammar' as const),
        explanationVi: String(item.explanationVi || '').trim(),
      }))
    : [];

  return {
    reply: String(parsed.reply || '').trim(),
    vietnameseTranslation: String(parsed.vietnameseTranslation || '').trim(),
    correction: {
      hasErrors: Boolean(parsed.correction?.hasErrors),
      correctedText: String(parsed.correction?.correctedText || userMessage).trim(),
      issues: normalizedIssues.filter((i) => i.explanationVi.length > 0),
      naturalSuggestion: String(parsed.correction?.naturalSuggestion || '').trim(),
      naturalSuggestionVi: String(parsed.correction?.naturalSuggestionVi || '').trim(),
      encouragementVi:
        String(parsed.correction?.encouragementVi || '').trim() ||
        'Bạn làm tốt lắm, hãy tiếp tục giao tiếp nhé!',
    },
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [],
  };
}

export async function translateMessageToVietnamese(
  text: string,
  languageId: ChatLanguageId
): Promise<string> {
  const ai = getGeminiClient();
  const lang = getChatLanguageMeta(languageId);

  const response = await generateTextWithFallback(ai, (model, thinkingLevel) => ({
    model,
    contents: `Hãy dịch đoạn hội thoại sau từ ${lang.label} (${lang.nativeName}) sang Tiếng Việt tự nhiên, dễ hiểu:\n\n"${text}"`,
    config: {
      thinkingConfig: { thinkingLevel },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          translation: {
            type: Type.STRING,
            description: 'Natural Vietnamese translation only.',
          },
        },
        required: ['translation'],
      },
    },
  }));

  const parsed = safeJsonParse<{ translation?: string }>(
    response.text,
    'Không thể dịch tin nhắn lúc này.'
  );
  const out = String(parsed.translation || '').trim();
  if (!out) {
    throw new GeminiApiRouteError(502, 'Không thể dịch tin nhắn lúc này.');
  }
  return out;
}

export async function generateReplySuggestions(params: {
  topicId: ChatTopicId;
  languageId: ChatLanguageId;
  history: ChatHistoryTurn[];
  lessons: LessonItem[];
}): Promise<ChatReplySuggestion[]> {
  const { topicId, languageId, history, lessons } = params;
  const ai = getGeminiClient();
  const lang = getChatLanguageMeta(languageId);
  const topic = getChatTopicMeta(topicId);
  const systemInstruction = buildTeacherPersonaInstruction(languageId, topicId, lessons);

  const recentHistory = history
    .slice(-10)
    .map((h) => `${h.role === 'user' ? 'Người học' : lang.teacherName}: ${h.text}`)
    .join('\n');

  const prompt = [
    `Người học đang luyện nói chủ đề "${topic.title}" (${topic.titleVi}) bằng ${lang.label} và chưa biết trả lời thế nào.`,
    recentHistory ? `Đoạn hội thoại hiện tại:\n${recentHistory}` : '',
    `Hãy gợi ý đúng 3 câu trả lời khác nhau (từ dễ đến tự nhiên) bằng ${lang.label} phù hợp trực tiếp với câu hỏi/ngữ cảnh vừa rồi, kèm nghĩa Tiếng Việt ngắn gọn.`,
  ].join('\n\n');

  const response = await generateTextWithFallback(ai, (model, thinkingLevel) => ({
    model,
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          suggestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                vietnameseMeaning: { type: Type.STRING },
              },
              required: ['text', 'vietnameseMeaning'],
            },
          },
        },
        required: ['suggestions'],
      },
    },
  }));

  const parsed = safeJsonParse<{ suggestions?: ChatReplySuggestion[] }>(
    response.text,
    'Không thể tạo gợi ý câu trả lời lúc này.'
  );
  return Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [];
}

export interface PronunciationTurnResult extends ChatTurnResult {
  transcript: string;
  pronunciationFeedback: ChatPronunciationFeedback;
}

export async function evaluatePronunciationAndChat(params: {
  topicId: ChatTopicId;
  languageId: ChatLanguageId;
  history: ChatHistoryTurn[];
  lessons: LessonItem[];
  audioBase64?: string;
  mimeType?: string;
  browserTranscript?: string;
}): Promise<PronunciationTurnResult> {
  const { topicId, languageId, history, lessons, audioBase64, mimeType, browserTranscript } = params;
  const ai = getGeminiClient();
  const lang = getChatLanguageMeta(languageId);
  const systemInstruction = buildTeacherPersonaInstruction(languageId, topicId, lessons);

  let transcript = (browserTranscript || '').trim();
  const hasAudio = Boolean(audioBase64 && mimeType);

  if (hasAudio && audioBase64 && mimeType) {
    try {
      const transcribeResp = await ai.models.generateContent({
        model: TRANSCRIBE_MODEL,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: `Transcribe accurately what the speaker says in ${lang.nativeName} (or Vietnamese if they spoke Vietnamese). Return only the spoken text without timestamps or commentary.`,
            },
          ],
        },
      });
      const transcribedText = (transcribeResp.text ?? '').trim();
      if (transcribedText) {
        transcript = transcribedText;
      }
    } catch (err) {
      if (!transcript) {
        throw classifyGeminiError(err);
      }
    }
  }

  if (!transcript) {
    throw new GeminiApiRouteError(
      400,
      'Không nhận dạng được giọng nói từ bản ghi. Bạn hãy thử nói rõ hơn gần micro nhé!'
    );
  }

  const recentHistory = history
    .slice(-12)
    .map((h) => `${h.role === 'user' ? 'Người học' : lang.teacherName}: ${h.text}`)
    .join('\n');

  const promptParts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  if (hasAudio && audioBase64 && mimeType) {
    promptParts.push({
      inlineData: {
        mimeType,
        data: audioBase64,
      },
    });
  }

  promptParts.push({
    text: [
      recentHistory ? `Lịch sử hội thoại gần đây:\n${recentHistory}\n` : '',
      `Nội dung người học vừa nói (nhận dạng giọng nói): "${transcript}"`,
      `\nHãy thực hiện đồng thời:`,
      `1. Đánh giá phát âm bằng Tiếng Việt ngắn gọn, khích lệ (độ rõ ràng, từ nào cần chú ý nhấn âm/phát âm cuối, mẹo phát âm cụ thể).${
        hasAudio ? ' Dựa trên file ghi âm đính kèm và bản gỡ băng.' : ' Dựa trên bản nhận dạng giọng nói và ngữ âm chuẩn của câu vừa nói.'
      }`,
      `2. Kiểm tra ngữ pháp/dùng từ của câu vừa nói, sửa nếu cần và gợi ý câu tự nhiên hơn.`,
      `3. Tiếp tục hội thoại tự nhiên bằng ${lang.label} kèm bản dịch Tiếng Việt và 3 câu gợi ý trả lời tiếp theo.`,
    ].join('\n'),
  });

  const response = await generateTextWithFallback(ai, (model, thinkingLevel) => ({
    model,
    contents: { parts: promptParts },
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          pronunciationFeedback: {
            type: Type.OBJECT,
            properties: {
              accuracyNoteVi: {
                type: Type.STRING,
                description: 'Encouraging pronunciation assessment in Vietnamese.',
              },
              mispronouncedWords: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'List of up to 4 words/phrases to pay attention to.',
              },
              tipsVi: {
                type: Type.STRING,
                description: 'Practical pronunciation coaching tip in Vietnamese.',
              },
            },
            required: ['accuracyNoteVi', 'mispronouncedWords', 'tipsVi'],
          },
          reply: { type: Type.STRING },
          vietnameseTranslation: { type: Type.STRING },
          correction: {
            type: Type.OBJECT,
            properties: {
              hasErrors: { type: Type.BOOLEAN },
              correctedText: { type: Type.STRING },
              issues: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    explanationVi: { type: Type.STRING },
                  },
                  required: ['type', 'explanationVi'],
                },
              },
              naturalSuggestion: { type: Type.STRING },
              naturalSuggestionVi: { type: Type.STRING },
              encouragementVi: { type: Type.STRING },
            },
            required: [
              'hasErrors',
              'correctedText',
              'issues',
              'naturalSuggestion',
              'naturalSuggestionVi',
              'encouragementVi',
            ],
          },
          suggestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                vietnameseMeaning: { type: Type.STRING },
              },
              required: ['text', 'vietnameseMeaning'],
            },
          },
        },
        required: ['pronunciationFeedback', 'reply', 'vietnameseTranslation', 'correction', 'suggestions'],
      },
    },
  }));

  const parsed = safeJsonParse<Omit<PronunciationTurnResult, 'transcript'>>(
    response.text,
    'Không thể phân tích phát âm lúc này. Vui lòng thử lại.'
  );

  const normalizedIssues = Array.isArray(parsed.correction?.issues)
    ? parsed.correction.issues.map((item) => ({
        type:
          item.type === 'spelling' || item.type === 'word_choice' ? item.type : ('grammar' as const),
        explanationVi: String(item.explanationVi || '').trim(),
      }))
    : [];

  return {
    transcript,
    pronunciationFeedback: {
      accuracyNoteVi:
        String(parsed.pronunciationFeedback?.accuracyNoteVi || '').trim() ||
        'Hệ thống đã nhận diện được câu nói của bạn.',
      mispronouncedWords: Array.isArray(parsed.pronunciationFeedback?.mispronouncedWords)
        ? parsed.pronunciationFeedback.mispronouncedWords.slice(0, 4).map(String)
        : [],
      tipsVi:
        String(parsed.pronunciationFeedback?.tipsVi || '').trim() ||
        'Hãy đọc chậm và nhấn rõ âm cuối để giọng nghe tự nhiên hơn.',
    },
    reply: String(parsed.reply || '').trim(),
    vietnameseTranslation: String(parsed.vietnameseTranslation || '').trim(),
    correction: {
      hasErrors: Boolean(parsed.correction?.hasErrors),
      correctedText: String(parsed.correction?.correctedText || transcript).trim(),
      issues: normalizedIssues.filter((i) => i.explanationVi.length > 0),
      naturalSuggestion: String(parsed.correction?.naturalSuggestion || '').trim(),
      naturalSuggestionVi: String(parsed.correction?.naturalSuggestionVi || '').trim(),
      encouragementVi:
        String(parsed.correction?.encouragementVi || '').trim() ||
        'Rất tự tin! Hãy tiếp tục luyện nói nhé!',
    },
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [],
  };
}

export async function generateSpeechAudio(
  text: string,
  languageId: ChatLanguageId
): Promise<{ audioBase64: string; mimeType: string } | { fallbackToBrowserSpeech: true }> {
  // K'Ho uses specialized Lâm Đồng phonetic speech engine in src/lib/audio.ts
  if (languageId === 'kho') {
    return { fallbackToBrowserSpeech: true };
  }

  const ai = getGeminiClient();
  const cleanText = text.trim().slice(0, 800);

  try {
    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: cleanText,
              speechMetadata: {
                style: 'Warm, friendly native language teacher speaking clearly at a natural pace',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: languageId === 'ko' ? 'Puck' : 'Kore',
            },
          },
        },
      },
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) {
      return { fallbackToBrowserSpeech: true };
    }
    return {
      audioBase64: audioData,
      mimeType: 'audio/wav',
    };
  } catch {
    return { fallbackToBrowserSpeech: true };
  }
}
