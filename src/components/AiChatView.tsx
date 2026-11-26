import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Briefcase,
  CheckCircle2,
  Compass,
  Film,
  History,
  Languages,
  Lightbulb,
  Loader2,
  MessageSquarePlus,
  Mic,
  RefreshCw,
  Send,
  ShoppingBag,
  Sparkles,
  Square,
  Trash2,
  Users,
  Utensils,
  Volume2,
  X,
} from 'lucide-react';
import {
  CHAT_LANGUAGES,
  CHAT_TOPICS,
  getChatLanguageMeta,
  getChatTopicMeta,
} from '../shared/chatTopics';
import {
  AiChatConversation,
  AiChatMessage,
  ChatLanguageId,
  ChatReplySuggestion,
  ChatTopicId,
} from '../shared/types';
import { apiFetch } from '../lib/api';
import { playTapSound, speakCohoText } from '../lib/audio';

interface AiChatViewProps {
  isAuthenticated: boolean;
  userId?: string | null;
}

const GUEST_CHAT_STORAGE_KEY = 'coho_ai_chat_conversations_v1';

const TOPIC_ICONS: Record<ChatTopicId, React.ComponentType<{ className?: string }>> = {
  daily_life: Sparkles,
  travel: Compass,
  food_restaurant: Utensils,
  school: BookOpen,
  shopping: ShoppingBag,
  work: Briefcase,
  friendship: Users,
  entertainment: Film,
};

const ISSUE_LABELS: Record<'grammar' | 'spelling' | 'word_choice', string> = {
  grammar: 'Ngữ pháp',
  spelling: 'Chính tả',
  word_choice: 'Dùng từ',
};

function createLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadLocalConversations(storageKey: string): AiChatConversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalConversations(storageKey: string, list: AiChatConversation[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(list.slice(0, 25)));
  } catch {
    // Ignore quota errors
  }
}

function formatShortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      if (commaIdx === -1) {
        reject(new Error('Không thể đọc dữ liệu âm thanh.'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(new Error('Lỗi đọc file ghi âm.'));
    reader.readAsDataURL(blob);
  });
}

async function parseJsonSafe<T>(res: Response): Promise<T & { error?: string }> {
  const raw = await res.text();
  if (!raw.trim()) {
    return {} as T & { error?: string };
  }
  try {
    return JSON.parse(raw) as T & { error?: string };
  } catch {
    throw new Error(`Máy chủ phản hồi lỗi (HTTP ${res.status}). Vui lòng thử lại.`);
  }
}

export const AiChatView: React.FC<AiChatViewProps> = ({ isAuthenticated, userId }) => {
  const storageKey = useMemo(
    () => (isAuthenticated && userId ? `${GUEST_CHAT_STORAGE_KEY}_${userId}` : GUEST_CHAT_STORAGE_KEY),
    [isAuthenticated, userId]
  );

  const [conversations, setConversations] = useState<AiChatConversation[]>(() =>
    loadLocalConversations(storageKey)
  );
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => {
    const initial = loadLocalConversations(storageKey);
    return initial[0]?.id || null;
  });

  const [selectedTopic, setSelectedTopic] = useState<ChatTopicId>(() => {
    const initial = loadLocalConversations(storageKey);
    return initial[0]?.topicId || 'daily_life';
  });
  const [selectedLanguage, setSelectedLanguage] = useState<ChatLanguageId>(() => {
    const initial = loadLocalConversations(storageKey);
    return initial[0]?.languageId || 'en';
  });

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isStartingTopic, setIsStartingTopic] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);

  const [onlineState, setOnlineState] = useState<'checking' | 'online' | 'missing_key' | 'offline'>('checking');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);

  // Translation state per message
  const [visibleTranslations, setVisibleTranslations] = useState<Record<string, boolean>>({});
  const [translatingIds, setTranslatingIds] = useState<Record<string, boolean>>({});

  // Audio playback state
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const audioCacheRef = useRef<Record<string, string>>({});
  const activeAudioElRef = useRef<HTMLAudioElement | null>(null);

  // Microphone recording & speech recognition state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const liveTranscriptRef = useRef('');
  const recordingTimerRef = useRef<number | null>(null);
  const cancelRecordingRef = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const didAutoStartRef = useRef(false);
  const startAbortRef = useRef<AbortController | null>(null);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId]
  );

  const currentLangMeta = useMemo(() => getChatLanguageMeta(selectedLanguage), [selectedLanguage]);
  const currentTopicMeta = useMemo(() => getChatTopicMeta(selectedTopic), [selectedTopic]);

  const checkAiStatus = useCallback(async () => {
    setOnlineState('checking');
    try {
      const res = await apiFetch('/api/ai-chat/status');
      if (!res.ok) {
        setOnlineState('offline');
        return;
      }
      const data = await parseJsonSafe<{ ok: boolean; online: boolean; aiConfigured: boolean }>(res);
      if (data.aiConfigured) {
        setOnlineState('online');
      } else {
        setOnlineState('missing_key');
      }
    } catch {
      setOnlineState('offline');
    }
  }, []);

  useEffect(() => {
    checkAiStatus();
  }, [checkAiStatus]);

  // Sync saved conversations from server when signed in, or from localStorage for guest
  useEffect(() => {
    let cancelled = false;
    const localList = loadLocalConversations(storageKey);
    setConversations(localList);
    if (localList[0]) {
      setActiveConversationId(localList[0].id);
      setSelectedTopic(localList[0].topicId);
      setSelectedLanguage(localList[0].languageId);
    } else {
      setActiveConversationId(null);
    }

    if (!isAuthenticated) return;

    async function loadServerHistory() {
      try {
        const res = await apiFetch('/api/ai-chat/conversations');
        if (!res.ok || cancelled) return;
        const data = await parseJsonSafe<{ conversations?: AiChatConversation[] }>(res);
        if (!cancelled && Array.isArray(data.conversations) && data.conversations.length > 0) {
          setConversations(data.conversations);
          saveLocalConversations(storageKey, data.conversations);
          setActiveConversationId((prev) => prev || data.conversations![0].id);
        }
      } catch {
        // Keep local cache if server history fetch fails
      }
    }
    loadServerHistory();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, storageKey]);

  const persistConversation = useCallback(
    async (conv: AiChatConversation) => {
      setConversations((prev) => {
        const next = [conv, ...prev.filter((c) => c.id !== conv.id)].slice(0, 25);
        saveLocalConversations(storageKey, next);
        return next;
      });

      if (isAuthenticated) {
        try {
          await apiFetch(`/api/ai-chat/conversations/${encodeURIComponent(conv.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(conv),
          });
        } catch {
          // Local copy already saved
        }
      }
    },
    [isAuthenticated, storageKey]
  );

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [activeConversation?.messages.length, isSending, isStartingTopic, isProcessingVoice, scrollToBottom]);

  // Stop any playing audio on unmount
  useEffect(() => {
    return () => {
      if (startAbortRef.current) {
        startAbortRef.current.abort();
      }
      if (activeAudioElRef.current) {
        activeAudioElRef.current.pause();
        activeAudioElRef.current = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const startNewConversation = useCallback(
    async (topicId: ChatTopicId, languageId: ChatLanguageId) => {
      playTapSound();
      if (startAbortRef.current) {
        startAbortRef.current.abort();
      }
      const controller = new AbortController();
      startAbortRef.current = controller;

      setSelectedTopic(topicId);
      setSelectedLanguage(languageId);
      setIsStartingTopic(true);
      setErrorBanner(null);
      setRetryAction(null);
      setShowSuggestions(false);
      setConfirmClearHistory(false);

      try {
        const res = await apiFetch('/api/ai-chat/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topicId, languageId }),
          signal: controller.signal,
        });
        const data = await parseJsonSafe<{
          greeting?: string;
          vietnameseTranslation?: string;
          suggestions?: ChatReplySuggestion[];
        }>(res);

        if (!res.ok || !data.greeting) {
          throw new Error(data.error || 'Không thể bắt đầu cuộc trò chuyện với AI.');
        }

        const topicMeta = getChatTopicMeta(topicId);
        const nowIso = new Date().toISOString();
        const firstMsg: AiChatMessage = {
          id: createLocalId('msg'),
          role: 'assistant',
          text: data.greeting,
          createdAt: nowIso,
          vietnameseTranslation: data.vietnameseTranslation || '',
        };

        const newConv: AiChatConversation = {
          id: createLocalId('chat'),
          topicId,
          languageId,
          title: `${topicMeta.title} (${getChatLanguageMeta(languageId).label})`,
          messages: [firstMsg],
          suggestions: Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : [],
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        setActiveConversationId(newConv.id);
        setOnlineState('online');
        await persistConversation(newConv);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          return;
        }
        const message =
          err instanceof Error ? err.message : 'Lỗi kết nối máy chủ AI. Vui lòng thử lại.';
        setErrorBanner(message);
        setRetryAction(() => () => startNewConversation(topicId, languageId));
      } finally {
        if (startAbortRef.current === controller) {
          setIsStartingTopic(false);
        }
      }
    },
    [persistConversation]
  );

  // Auto-start first conversation once if user opens tab with no conversations yet
  useEffect(() => {
    if (didAutoStartRef.current) return;
    if (conversations.length === 0 && onlineState === 'online') {
      didAutoStartRef.current = true;
      startNewConversation(selectedTopic, selectedLanguage);
    }
  }, [conversations.length, onlineState, selectedTopic, selectedLanguage, startNewConversation]);

  const stopAudioPlayback = useCallback(() => {
    if (activeAudioElRef.current) {
      activeAudioElRef.current.pause();
      activeAudioElRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setPlayingAudioId(null);
  }, []);

  const handleSpeakText = async (audioId: string, text: string) => {
    if (!text.trim()) return;
    if (playingAudioId === audioId) {
      stopAudioPlayback();
      return;
    }

    stopAudioPlayback();
    playTapSound();

    if (selectedLanguage === 'kho') {
      setPlayingAudioId(audioId);
      speakCohoText(text, {
        onStart: () => setPlayingAudioId(audioId),
        onEnd: () => setPlayingAudioId((prev) => (prev === audioId ? null : prev)),
      });
      return;
    }

    const cacheKey = `${selectedLanguage}:${text}`;
    const cachedDataUrl = audioCacheRef.current[cacheKey];
    if (cachedDataUrl) {
      const audio = new Audio(cachedDataUrl);
      activeAudioElRef.current = audio;
      setPlayingAudioId(audioId);
      audio.onended = () => setPlayingAudioId((prev) => (prev === audioId ? null : prev));
      audio.onerror = () => setPlayingAudioId((prev) => (prev === audioId ? null : prev));
      audio.play().catch(() => setPlayingAudioId(null));
      return;
    }

    setLoadingAudioId(audioId);
    try {
      const res = await apiFetch('/api/ai-chat/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, languageId: selectedLanguage }),
      });

      if (res.ok) {
        const data = await parseJsonSafe<{
          audioBase64?: string;
          mimeType?: string;
          fallbackToBrowserSpeech?: boolean;
        }>(res);
        if (data.audioBase64 && data.mimeType) {
          const dataUrl = `data:${data.mimeType};base64,${data.audioBase64}`;
          audioCacheRef.current[cacheKey] = dataUrl;
          const audio = new Audio(dataUrl);
          activeAudioElRef.current = audio;
          setPlayingAudioId(audioId);
          audio.onended = () => setPlayingAudioId((prev) => (prev === audioId ? null : prev));
          audio.onerror = () => setPlayingAudioId((prev) => (prev === audioId ? null : prev));
          await audio.play();
          setLoadingAudioId(null);
          return;
        }
      }
    } catch {
      // Fall back smoothly to Web Speech API
    } finally {
      setLoadingAudioId(null);
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = currentLangMeta.speechLang;
      utterance.rate = 0.94;
      const voices = window.speechSynthesis.getVoices();
      const matchedVoice = voices.find((v) =>
        v.lang.toLowerCase().startsWith(currentLangMeta.speechLang.slice(0, 2).toLowerCase())
      );
      if (matchedVoice) utterance.voice = matchedVoice;
      utterance.onstart = () => setPlayingAudioId(audioId);
      utterance.onend = () => setPlayingAudioId((prev) => (prev === audioId ? null : prev));
      utterance.onerror = () => setPlayingAudioId((prev) => (prev === audioId ? null : prev));
      setPlayingAudioId(audioId);
      window.speechSynthesis.speak(utterance);
    } else {
      setErrorBanner('Trình duyệt của bạn chưa hỗ trợ phát âm thanh.');
    }
  };

  const handleToggleTranslate = async (msg: AiChatMessage) => {
    playTapSound();
    const currentlyVisible = Boolean(visibleTranslations[msg.id]);
    if (currentlyVisible) {
      setVisibleTranslations((prev) => ({ ...prev, [msg.id]: false }));
      return;
    }

    if (msg.vietnameseTranslation && msg.vietnameseTranslation.trim()) {
      setVisibleTranslations((prev) => ({ ...prev, [msg.id]: true }));
      return;
    }

    setTranslatingIds((prev) => ({ ...prev, [msg.id]: true }));
    setErrorBanner(null);

    try {
      const res = await apiFetch('/api/ai-chat/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg.text, languageId: selectedLanguage }),
      });
      const data = await parseJsonSafe<{ translation?: string }>(res);
      if (!res.ok || !data.translation) {
        throw new Error(data.error || 'Không thể dịch câu trả lời này.');
      }

      if (activeConversation) {
        const updatedConv: AiChatConversation = {
          ...activeConversation,
          updatedAt: new Date().toISOString(),
          messages: activeConversation.messages.map((m) =>
            m.id === msg.id ? { ...m, vietnameseTranslation: data.translation } : m
          ),
        };
        await persistConversation(updatedConv);
      }
      setVisibleTranslations((prev) => ({ ...prev, [msg.id]: true }));
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Lỗi dịch thuật. Vui lòng thử lại.');
    } finally {
      setTranslatingIds((prev) => ({ ...prev, [msg.id]: false }));
    }
  };

  const handleSendTextMessage = async (overrideText?: string) => {
    const messageText = (overrideText ?? inputValue).trim();
    if (!messageText || isSending || isStartingTopic || isProcessingVoice) return;

    playTapSound();
    setErrorBanner(null);
    setRetryAction(null);
    if (!overrideText) {
      setInputValue('');
    }
    setShowSuggestions(false);
    setIsSending(true);

    const baseConv: AiChatConversation = activeConversation || {
      id: createLocalId('chat'),
      topicId: selectedTopic,
      languageId: selectedLanguage,
      title: `${currentTopicMeta.title} (${currentLangMeta.label})`,
      messages: [],
      suggestions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const userMsg: AiChatMessage = {
      id: createLocalId('msg'),
      role: 'user',
      text: messageText,
      createdAt: new Date().toISOString(),
    };

    const optimisticConv: AiChatConversation = {
      ...baseConv,
      messages: [...baseConv.messages, userMsg],
      updatedAt: new Date().toISOString(),
    };
    setActiveConversationId(optimisticConv.id);
    setConversations((prev) => [optimisticConv, ...prev.filter((c) => c.id !== optimisticConv.id)]);

    try {
      const historyPayload = baseConv.messages.slice(-14).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const res = await apiFetch('/api/ai-chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicId: baseConv.topicId,
          languageId: baseConv.languageId,
          message: messageText,
          history: historyPayload,
        }),
      });

      const data = await parseJsonSafe<{
        reply?: string;
        vietnameseTranslation?: string;
        correction?: AiChatMessage['correction'];
        suggestions?: ChatReplySuggestion[];
      }>(res);

      if (!res.ok || !data.reply) {
        throw new Error(data.error || 'Không nhận được phản hồi từ AI.');
      }

      const analyzedUserMsg: AiChatMessage = {
        ...userMsg,
        correction: data.correction,
      };
      const aiMsg: AiChatMessage = {
        id: createLocalId('msg'),
        role: 'assistant',
        text: data.reply,
        createdAt: new Date().toISOString(),
        vietnameseTranslation: data.vietnameseTranslation || '',
      };

      const completedConv: AiChatConversation = {
        ...optimisticConv,
        messages: [...baseConv.messages, analyzedUserMsg, aiMsg],
        suggestions: Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : [],
        updatedAt: new Date().toISOString(),
      };
      setOnlineState('online');
      await persistConversation(completedConv);
    } catch (err) {
      // Restore message back into input if failed so user never loses text
      setConversations((prev) => [baseConv, ...prev.filter((c) => c.id !== optimisticConv.id)]);
      if (!overrideText) setInputValue(messageText);
      const errMsg =
        err instanceof Error ? err.message : 'Lỗi kết nối khi gửi tin nhắn. Vui lòng thử lại.';
      setErrorBanner(errMsg);
      setRetryAction(() => () => handleSendTextMessage(messageText));
    } finally {
      setIsSending(false);
    }
  };

  const handleRequestSuggestions = async (forceRefresh = false) => {
    playTapSound();
    if (!forceRefresh && showSuggestions) {
      setShowSuggestions(false);
      return;
    }

    if (!forceRefresh && activeConversation && activeConversation.suggestions.length > 0) {
      setShowSuggestions(true);
      return;
    }

    setShowSuggestions(true);
    setIsLoadingSuggestions(true);
    setErrorBanner(null);

    try {
      const historyPayload = (activeConversation?.messages || []).slice(-10).map((m) => ({
        role: m.role,
        text: m.text,
      }));
      const res = await apiFetch('/api/ai-chat/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicId: selectedTopic,
          languageId: selectedLanguage,
          history: historyPayload,
        }),
      });
      const data = await parseJsonSafe<{ suggestions?: ChatReplySuggestion[] }>(res);
      if (!res.ok || !Array.isArray(data.suggestions)) {
        throw new Error(data.error || 'Không thể tải gợi ý câu trả lời.');
      }

      if (activeConversation) {
        const updatedConv: AiChatConversation = {
          ...activeConversation,
          suggestions: data.suggestions.slice(0, 3),
          updatedAt: new Date().toISOString(),
        };
        await persistConversation(updatedConv);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Không thể tạo gợi ý lúc này.');
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const cleanupRecordingHandles = () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  };

  const submitVoiceRecording = async (blob: Blob | null, transcriptFallback: string) => {
    setIsProcessingVoice(true);
    setErrorBanner(null);

    const baseConv: AiChatConversation = activeConversation || {
      id: createLocalId('chat'),
      topicId: selectedTopic,
      languageId: selectedLanguage,
      title: `${currentTopicMeta.title} (${currentLangMeta.label})`,
      messages: [],
      suggestions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      let audioBase64: string | undefined;
      let mimeType: string | undefined;
      if (blob && blob.size > 0) {
        audioBase64 = await blobToBase64(blob);
        mimeType = (blob.type || 'audio/webm').split(';')[0].trim().toLowerCase();
      }

      const historyPayload = baseConv.messages.slice(-12).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const res = await apiFetch('/api/ai-chat/pronunciation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topicId: baseConv.topicId,
          languageId: baseConv.languageId,
          history: historyPayload,
          audioBase64,
          mimeType,
          browserTranscript: transcriptFallback,
        }),
      });

      const data = await parseJsonSafe<{
        transcript?: string;
        pronunciationFeedback?: AiChatMessage['pronunciationFeedback'];
        reply?: string;
        vietnameseTranslation?: string;
        correction?: AiChatMessage['correction'];
        suggestions?: ChatReplySuggestion[];
      }>(res);

      if (!res.ok || !data.transcript || !data.reply) {
        throw new Error(data.error || 'Không thể phân tích giọng nói lúc này.');
      }

      const nowIso = new Date().toISOString();
      const userVoiceMsg: AiChatMessage = {
        id: createLocalId('msg'),
        role: 'user',
        text: data.transcript,
        createdAt: nowIso,
        spokenViaMic: true,
        correction: data.correction,
        pronunciationFeedback: data.pronunciationFeedback,
      };
      const aiMsg: AiChatMessage = {
        id: createLocalId('msg'),
        role: 'assistant',
        text: data.reply,
        createdAt: nowIso,
        vietnameseTranslation: data.vietnameseTranslation || '',
      };

      const updatedConv: AiChatConversation = {
        ...baseConv,
        messages: [...baseConv.messages, userVoiceMsg, aiMsg],
        suggestions: Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : [],
        updatedAt: nowIso,
      };
      setActiveConversationId(updatedConv.id);
      setOnlineState('online');
      await persistConversation(updatedConv);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Lỗi phân tích phát âm. Vui lòng thử ghi âm lại.'
      );
    } finally {
      setIsProcessingVoice(false);
      setLiveTranscript('');
      liveTranscriptRef.current = '';
    }
  };

  const startVoiceRecording = async () => {
    if (isRecording || isSending || isProcessingVoice) return;
    playTapSound();
    setErrorBanner(null);
    cancelRecordingRef.current = false;
    setLiveTranscript('');
    liveTranscriptRef.current = '';

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErrorBanner('Trình duyệt hiện tại không hỗ trợ ghi âm micro.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const supportedType = preferredTypes.find(
        (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)
      );
      const recorder = supportedType
        ? new MediaRecorder(stream, { mimeType: supportedType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const wasCancelled = cancelRecordingRef.current;
        const chunks = audioChunksRef.current;
        const mime = recorder.mimeType || 'audio/webm';
        const transcriptSnap = liveTranscriptRef.current;
        cleanupRecordingHandles();
        setIsRecording(false);
        setRecordingSeconds(0);

        if (wasCancelled) {
          setLiveTranscript('');
          liveTranscriptRef.current = '';
          return;
        }
        const blob = new Blob(chunks, { type: mime });
        submitVoiceRecording(blob, transcriptSnap);
      };

      // Optional parallel Web Speech Recognition for live transcript preview
      const SpeechCtor =
        (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
          .SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

      if (SpeechCtor) {
        try {
          const rec = new SpeechCtor() as {
            lang: string;
            interimResults: boolean;
            continuous: boolean;
            onresult: (ev: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void;
            onerror: () => void;
            start: () => void;
            stop: () => void;
            abort: () => void;
          };
          rec.lang = currentLangMeta.speechLang;
          rec.interimResults = true;
          rec.continuous = true;
          rec.onresult = (event) => {
            let text = '';
            for (let i = 0; i < event.results.length; i++) {
              text += (event.results[i]?.[0]?.transcript || '') + ' ';
            }
            const clean = text.trim();
            liveTranscriptRef.current = clean;
            setLiveTranscript(clean);
          };
          rec.onerror = () => {};
          rec.start();
          recognitionRef.current = rec;
        } catch {
          // Audio recording alone still works via Gemini transcription
        }
      }

      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      cleanupRecordingHandles();
      setErrorBanner(
        'Không thể truy cập micro. Vui lòng cấp quyền micro trong trình duyệt để luyện phát âm.'
      );
    }
  };

  const stopAndSendVoiceRecording = () => {
    cancelRecordingRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecordingHandles();
      setIsRecording(false);
    }
  };

  const cancelVoiceRecording = () => {
    cancelRecordingRef.current = true;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecordingHandles();
      setIsRecording(false);
      setRecordingSeconds(0);
      setLiveTranscript('');
      liveTranscriptRef.current = '';
    }
  };

  const handleSelectSavedConversation = (conv: AiChatConversation) => {
    playTapSound();
    stopAudioPlayback();
    setActiveConversationId(conv.id);
    setSelectedTopic(conv.topicId);
    setSelectedLanguage(conv.languageId);
    setShowHistoryDrawer(false);
    setShowSuggestions(false);
    setErrorBanner(null);
  };

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    playTapSound();
    const next = conversations.filter((c) => c.id !== convId);
    setConversations(next);
    saveLocalConversations(storageKey, next);
    if (activeConversationId === convId) {
      setActiveConversationId(next[0]?.id || null);
    }
    if (isAuthenticated) {
      try {
        await apiFetch(`/api/ai-chat/conversations/${encodeURIComponent(convId)}`, {
          method: 'DELETE',
        });
      } catch {
        // ignore
      }
    }
  };

  const handleClearAllHistory = async () => {
    playTapSound();
    stopAudioPlayback();
    setConfirmClearHistory(false);
    setConversations([]);
    setActiveConversationId(null);
    saveLocalConversations(storageKey, []);
    if (isAuthenticated) {
      try {
        await apiFetch('/api/ai-chat/conversations', { method: 'DELETE' });
      } catch {
        // ignore
      }
    }
    startNewConversation(selectedTopic, selectedLanguage);
  };

  const statusBadge = (() => {
    if (onlineState === 'online') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <span>Online</span>
        </span>
      );
    }
    if (onlineState === 'missing_key') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
          <span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" />
          <span>Chưa cấu hình AI key</span>
        </span>
      );
    }
    if (onlineState === 'offline') {
      return (
        <button
          type="button"
          onClick={checkAiStatus}
          className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:underline"
        >
          <span className="w-2 h-2 rounded-full bg-rose-500" aria-hidden="true" />
          <span>Mất kết nối · Thử lại</span>
        </button>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-stone-500">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Đang kết nối...</span>
      </span>
    );
  })();

  const activeSuggestions = activeConversation?.suggestions || [];

  return (
    <div className="space-y-4">
      {/* Studio Language & Topic Selector */}
      <section className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-stone-900">
              Luyện Giao Tiếp Với Giáo Viên AI Bản Xứ
            </h1>
            <p className="text-xs sm:text-sm text-stone-600 mt-0.5">
              Chọn ngoại ngữ và chủ đề để AI mở đầu hội thoại, sửa lỗi ngữ pháp và luyện phát âm cùng bạn.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="ai-language-select" className="text-xs font-semibold text-stone-600 whitespace-nowrap">
              Ngôn ngữ:
            </label>
            <select
              id="ai-language-select"
              value={selectedLanguage}
              onChange={(e) => {
                const nextLang = e.target.value as ChatLanguageId;
                startNewConversation(selectedTopic, nextLang);
              }}
              className="px-3 py-2 text-xs sm:text-sm font-bold text-stone-900 bg-stone-50 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600 min-h-[40px]"
            >
              {CHAT_LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.label} ({lang.nativeName})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 8 Conversation Topics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CHAT_TOPICS.map((topic) => {
            const Icon = TOPIC_ICONS[topic.id];
            const isActive = selectedTopic === topic.id;
            return (
              <button
                key={topic.id}
                type="button"
                disabled={isStartingTopic || isSending}
                onClick={() => startNewConversation(topic.id, selectedLanguage)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors min-h-[46px] disabled:opacity-60 ${
                  isActive
                    ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                    : 'bg-stone-50/70 border-stone-200 text-stone-700 hover:bg-stone-100 hover:text-stone-900'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-700' : 'text-stone-500'}`}
                />
                <div className="min-w-0">
                  <div className="text-xs font-extrabold truncate">{topic.title}</div>
                  <div className="text-[11px] text-stone-500 truncate">{topic.titleVi}</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Chat Window */}
      <section className="bg-white border border-stone-200 rounded-2xl overflow-hidden flex flex-col h-[calc(100vh-18rem)] min-h-[500px] max-h-[760px] relative">
        {/* Chat Header */}
        <header className="px-4 py-3 border-b border-stone-200 bg-white flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-emerald-700 text-white font-extrabold text-sm flex items-center justify-center shrink-0">
              {currentLangMeta.teacherName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-extrabold text-stone-900 truncate">
                  {currentLangMeta.teacherName}
                </h2>
                <span aria-hidden="true" className="text-stone-300">·</span>
                {statusBadge}
              </div>
              <p className="text-xs text-stone-500 truncate">
                {currentTopicMeta.title} · {currentLangMeta.label}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                playTapSound();
                setShowHistoryDrawer((v) => !v);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-bold border transition-colors min-h-[40px] whitespace-nowrap ${
                showHistoryDrawer
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
              }`}
              title="Xem lại cuộc hội thoại trước"
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Lịch sử</span>
              {conversations.length > 0 && (
                <span className="font-mono tabular-nums text-[11px] text-stone-500">
                  ({conversations.length})
                </span>
              )}
            </button>

            <button
              type="button"
              disabled={isStartingTopic || isSending}
              onClick={() => startNewConversation(selectedTopic, selectedLanguage)}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition-colors min-h-[40px] whitespace-nowrap disabled:opacity-50"
              title="Bắt đầu cuộc trò chuyện mới"
            >
              <MessageSquarePlus className="w-4 h-4" />
              <span className="hidden sm:inline">Cuộc trò chuyện mới</span>
            </button>

            {!confirmClearHistory ? (
              <button
                type="button"
                onClick={() => setConfirmClearHistory(true)}
                className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-stone-500 hover:text-rose-700 hover:bg-rose-50 border border-stone-200 transition-colors"
                aria-label="Xóa lịch sử chat"
                title="Xóa lịch sử chat"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            ) : (
              <div className="flex items-center gap-1 bg-rose-50 border border-rose-200 rounded-xl px-2 py-1">
                <button
                  type="button"
                  onClick={handleClearAllHistory}
                  className="px-2 py-1 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg whitespace-nowrap"
                >
                  Xóa hết
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearHistory(false)}
                  className="px-2 py-1 text-xs font-semibold text-stone-600 hover:text-stone-900"
                >
                  Hủy
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Connection / API Error Banner */}
        {errorBanner && (
          <div
            role="alert"
            className="mx-4 mt-3 px-3.5 py-2.5 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between gap-2 text-xs text-rose-800 shrink-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span className="font-medium break-words">{errorBanner}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {retryAction && (
                <button
                  type="button"
                  onClick={() => {
                    const fn = retryAction;
                    setErrorBanner(null);
                    fn();
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-700 text-white font-bold rounded-lg hover:bg-rose-800 whitespace-nowrap"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Thử lại</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                aria-label="Đóng thông báo lỗi"
                className="p-1 text-rose-600 hover:text-rose-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Past Conversations Overlay Drawer */}
        {showHistoryDrawer && (
          <div className="absolute inset-0 top-[65px] z-20 bg-white/98 backdrop-blur-sm flex flex-col">
            <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-stone-900">Lịch sử hội thoại đã lưu</h3>
                <p className="text-xs text-stone-500">
                  {isAuthenticated
                    ? 'Được đồng bộ tự động vào tài khoản của bạn'
                    : 'Lưu trên trình duyệt hiện tại (đăng nhập để đồng bộ nhiều thiết bị)'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryDrawer(false)}
                className="px-3 py-1.5 text-xs font-bold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg"
              >
                Đóng
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {conversations.length === 0 ? (
                <div className="text-center py-12 text-sm text-stone-500">
                  Chưa có cuộc trò chuyện nào được lưu.
                </div>
              ) : (
                conversations.map((conv) => {
                  const topic = getChatTopicMeta(conv.topicId);
                  const lang = getChatLanguageMeta(conv.languageId);
                  const isCurrent = conv.id === activeConversationId;
                  const lastPreview = conv.messages[conv.messages.length - 1]?.text || '';
                  return (
                    <div
                      key={conv.id}
                      onClick={() => handleSelectSavedConversation(conv)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') handleSelectSavedConversation(conv);
                      }}
                      className={`p-3.5 rounded-xl border transition-colors cursor-pointer flex items-start justify-between gap-3 ${
                        isCurrent
                          ? 'bg-emerald-50 border-emerald-400'
                          : 'bg-stone-50 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 text-xs font-extrabold text-stone-900">
                          <span>{topic.title}</span>
                          <span aria-hidden="true" className="text-stone-400">·</span>
                          <span className="text-emerald-800">{lang.label}</span>
                        </div>
                        <p className="text-xs text-stone-600 truncate">{lastPreview}</p>
                        <div className="text-[11px] text-stone-500 font-mono tabular-nums">
                          {conv.messages.length} tin nhắn · {formatShortDate(conv.updatedAt)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteConversation(conv.id, e)}
                        aria-label="Xóa cuộc hội thoại này"
                        className="p-2 text-stone-400 hover:text-rose-600 rounded-lg shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-[#FAF9F5]/60">
          {!activeConversation && !isStartingTopic && (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-3 py-8">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-base font-extrabold text-stone-900">
                Sẵn sàng luyện giao tiếp {currentLangMeta.label}
              </h3>
              <p className="text-xs sm:text-sm text-stone-600">
                Chọn một trong 8 chủ đề phía trên hoặc nhấn nút bên dưới để {currentLangMeta.teacherName} bắt đầu trò chuyện cùng bạn.
              </p>
              <button
                type="button"
                onClick={() => startNewConversation(selectedTopic, selectedLanguage)}
                className="px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold rounded-xl transition-colors min-h-[44px]"
              >
                Bắt đầu chủ đề {currentTopicMeta.title}
              </button>
            </div>
          )}

          {activeConversation?.messages.map((msg) => {
            const isUser = msg.role === 'user';
            const showTrans = Boolean(visibleTranslations[msg.id]);
            const isTranslating = Boolean(translatingIds[msg.id]);
            const isPlaying = playingAudioId === msg.id;
            const isLoadingAudio = loadingAudioId === msg.id;

            if (isUser) {
              const corr = msg.correction;
              const pron = msg.pronunciationFeedback;
              return (
                <div key={msg.id} className="flex flex-col items-end space-y-2">
                  <div className="max-w-[88%] sm:max-w-[78%] bg-emerald-700 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-xs">
                    {msg.spokenViaMic && (
                      <div className="flex items-center gap-1 text-[11px] text-emerald-100 font-semibold mb-1">
                        <Mic className="w-3 h-3" />
                        <span>Đã nói qua micro</span>
                      </div>
                    )}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                    <div className="text-[10px] text-emerald-100/80 text-right mt-1 font-mono tabular-nums">
                      {formatShortTime(msg.createdAt)}
                    </div>
                  </div>

                  {/* AI Error Correction & Pronunciation Feedback */}
                  {(corr || pron) && (
                    <div className="max-w-[92%] sm:max-w-[82%] bg-white border border-stone-200 rounded-2xl p-3.5 text-xs space-y-2.5 shadow-2xs">
                      {pron && (
                        <div className="space-y-1 pb-2 border-b border-stone-100">
                          <div className="flex items-center gap-1.5 font-extrabold text-sky-800">
                            <Mic className="w-3.5 h-3.5" />
                            <span>Phản hồi phát âm</span>
                          </div>
                          <p className="text-stone-700 leading-relaxed">{pron.accuracyNoteVi}</p>
                          {pron.mispronouncedWords.length > 0 && (
                            <p className="text-stone-600">
                              <span className="font-bold text-stone-800">Từ cần chú ý:</span>{' '}
                              {pron.mispronouncedWords.join(' · ')}
                            </p>
                          )}
                          <p className="text-sky-900 font-medium">{pron.tipsVi}</p>
                        </div>
                      )}

                      {corr && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div
                              className={`flex items-center gap-1.5 font-extrabold ${
                                corr.hasErrors ? 'text-amber-800' : 'text-emerald-800'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>
                                {corr.hasErrors ? 'Gợi ý sửa lỗi từ giáo viên' : 'Câu chuẩn xác'}
                              </span>
                            </div>

                            {corr.correctedText && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleSpeakText(`${msg.id}_corr`, corr.naturalSuggestion || corr.correctedText)
                                }
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold"
                              >
                                <Volume2 className="w-3.5 h-3.5" />
                                <span>Nghe câu chuẩn</span>
                              </button>
                            )}
                          </div>

                          {corr.hasErrors && corr.correctedText && (
                            <div className="bg-amber-50/70 rounded-xl px-3 py-2 text-stone-900">
                              <span className="font-bold text-amber-900">Câu đúng: </span>
                              <span className="font-semibold">{corr.correctedText}</span>
                            </div>
                          )}

                          {corr.issues.length > 0 && (
                            <ul className="space-y-1 text-stone-700">
                              {corr.issues.map((issue, idx) => (
                                <li key={idx} className="leading-relaxed">
                                  <span className="font-bold text-stone-900">
                                    {ISSUE_LABELS[issue.type] || 'Lưu ý'}:
                                  </span>{' '}
                                  {issue.explanationVi}
                                </li>
                              ))}
                            </ul>
                          )}

                          {corr.naturalSuggestion && (
                            <div className="bg-stone-50 rounded-xl px-3 py-2 space-y-0.5">
                              <div className="text-stone-900">
                                <span className="font-bold text-emerald-800">Cách nói tự nhiên hơn: </span>
                                <span className="font-semibold">{corr.naturalSuggestion}</span>
                              </div>
                              {corr.naturalSuggestionVi && (
                                <div className="text-stone-600">{corr.naturalSuggestionVi}</div>
                              )}
                            </div>
                          )}

                          {corr.encouragementVi && (
                            <p className="text-emerald-800 font-medium">{corr.encouragementVi}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={msg.id} className="flex flex-col items-start space-y-1.5">
                <div className="max-w-[90%] sm:max-w-[80%] bg-white border border-stone-200 text-stone-900 rounded-2xl rounded-tl-sm px-4 py-3 shadow-2xs space-y-2.5">
                  <div className="flex items-center justify-between gap-3 text-[11px] text-stone-500">
                    <span className="font-bold text-emerald-800">{currentLangMeta.teacherName}</span>
                    <span className="font-mono tabular-nums">{formatShortTime(msg.createdAt)}</span>
                  </div>

                  <p className="text-sm sm:text-[15px] leading-relaxed whitespace-pre-wrap break-words text-stone-900">
                    {msg.text}
                  </p>

                  {showTrans && msg.vietnameseTranslation && (
                    <div className="pt-2 border-t border-stone-100 text-xs sm:text-sm text-stone-700 bg-stone-50/80 -mx-1 px-3 py-2 rounded-xl">
                      <span className="font-bold text-stone-800">Nghĩa tiếng Việt: </span>
                      <span>{msg.vietnameseTranslation}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleSpeakText(msg.id, msg.text)}
                      disabled={isLoadingAudio}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors min-h-[34px] ${
                        isPlaying
                          ? 'bg-emerald-700 text-white'
                          : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                      }`}
                    >
                      {isLoadingAudio ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isPlaying ? (
                        <Square className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                      <span>{isPlaying ? 'Dừng đọc' : 'Nghe phát âm'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleTranslate(msg)}
                      disabled={isTranslating}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors min-h-[34px] ${
                        showTrans
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                      }`}
                    >
                      {isTranslating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Languages className="w-3.5 h-3.5" />
                      )}
                      <span>{showTrans ? 'Ẩn bản dịch' : 'Translate'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* AI Typing / Loading Indicator */}
          {(isStartingTopic || isSending || isProcessingVoice) && (
            <div className="flex items-start">
              <div className="bg-white border border-stone-200 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2.5 text-xs text-stone-600 shadow-2xs">
                <div className="flex items-center gap-1" aria-hidden="true">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 animate-bounce [animation-delay:-0.2s]" />
                  <span className="w-2 h-2 rounded-full bg-emerald-600 animate-bounce [animation-delay:-0.1s]" />
                  <span className="w-2 h-2 rounded-full bg-emerald-600 animate-bounce" />
                </div>
                <span className="font-semibold">
                  {isProcessingVoice
                    ? `${currentLangMeta.teacherName} đang nghe và phân tích phát âm...`
                    : isStartingTopic
                    ? `${currentLangMeta.teacherName} đang chuẩn bị chủ đề ${currentTopicMeta.title}...`
                    : `${currentLangMeta.teacherName} đang nhập tin nhắn...`}
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Reply Suggestions Drawer */}
        {showSuggestions && (
          <div className="px-4 py-3 border-t border-stone-200 bg-amber-50/50 space-y-2 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-900">
                <Lightbulb className="w-4 h-4 text-amber-600" />
                <span>3 gợi ý câu trả lời phù hợp ngữ cảnh</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isLoadingSuggestions}
                  onClick={() => handleRequestSuggestions(true)}
                  className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 hover:underline disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingSuggestions ? 'animate-spin' : ''}`} />
                  <span>Gợi ý khác</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSuggestions(false)}
                  className="text-xs font-semibold text-stone-500 hover:text-stone-900"
                >
                  Đóng
                </button>
              </div>
            </div>

            {isLoadingSuggestions ? (
              <div className="flex items-center gap-2 py-2 text-xs text-stone-600">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
                <span>Đang tạo 3 câu trả lời gợi ý...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {activeSuggestions.map((sug, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={isSending}
                    onClick={() => handleSendTextMessage(sug.text)}
                    className="p-2.5 bg-white hover:bg-emerald-50 border border-stone-200 hover:border-emerald-400 rounded-xl text-left transition-colors space-y-0.5 disabled:opacity-50"
                  >
                    <div className="text-xs font-bold text-stone-900">{sug.text}</div>
                    <div className="text-[11px] text-stone-500">{sug.vietnameseMeaning}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Bottom Composer */}
        <footer className="p-3 sm:p-4 border-t border-stone-200 bg-white space-y-2.5 shrink-0">
          {isRecording ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-extrabold text-rose-900 font-mono tabular-nums">
                    Đang ghi âm luyện nói... 0:{String(recordingSeconds).padStart(2, '0')}
                  </div>
                  {liveTranscript && (
                    <div className="text-xs text-stone-700 truncate">“{liveTranscript}”</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 justify-end">
                <button
                  type="button"
                  onClick={cancelVoiceRecording}
                  className="px-3 py-2 text-xs font-bold text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 min-h-[38px]"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={stopAndSendVoiceRecording}
                  className="px-3.5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg min-h-[38px] whitespace-nowrap"
                >
                  Gửi giọng nói
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => handleRequestSuggestions(false)}
                  disabled={isSending || isStartingTopic}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 hover:text-amber-900 disabled:opacity-50"
                >
                  <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
                  <span>Không biết nói gì? Gợi ý 3 câu trả lời</span>
                </button>
                <span className="text-[11px] text-stone-500 hidden sm:inline">
                  Nhấn Enter để gửi · Shift+Enter xuống dòng
                </span>
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={startVoiceRecording}
                  disabled={isSending || isStartingTopic || isProcessingVoice}
                  aria-label="Luyện nói qua micro"
                  title="Ghi âm luyện nói & kiểm tra phát âm"
                  className="w-11 h-11 shrink-0 rounded-xl bg-stone-100 hover:bg-emerald-50 text-stone-700 hover:text-emerald-800 border border-stone-200 flex items-center justify-center transition-colors disabled:opacity-50"
                >
                  <Mic className="w-5 h-5" />
                </button>

                <textarea
                  rows={1}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendTextMessage();
                    }
                  }}
                  disabled={isSending || isStartingTopic || isProcessingVoice}
                  placeholder={`Nhập câu trả lời bằng ${currentLangMeta.label}...`}
                  className="flex-1 min-h-[44px] max-h-28 px-3.5 py-2.5 text-sm bg-stone-50 border border-stone-300 rounded-xl text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600 resize-none disabled:opacity-60"
                />

                <button
                  type="button"
                  onClick={() => handleSendTextMessage()}
                  disabled={!inputValue.trim() || isSending || isStartingTopic || isProcessingVoice}
                  aria-label="Gửi tin nhắn"
                  className="h-11 px-4 shrink-0 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">Gửi</span>
                </button>
              </div>
            </>
          )}
        </footer>
      </section>
    </div>
  );
};
