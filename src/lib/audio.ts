export type CohoDialect = 'sre' | 'cil' | 'lach' | 'ma';

export interface DialectMeta {
  id: CohoDialect;
  name: string;
  shortLabel: string;
  region: string;
  standardSummary: string;
  speechRateMultiplier: number;
  pitchOffset: number;
}

export const COHO_DIALECTS: Record<CohoDialect, DialectMeta> = {
  sre: {
    id: 'sre',
    name: 'Cơ Ho Srê (Chuẩn phổ thông)',
    shortLabel: 'Srê (Chuẩn)',
    region: 'Di Linh · Bảo Lộc, Lâm Đồng',
    standardSummary:
      'Phương ngữ chuẩn được dùng trong giáo trình "Ngữ pháp tiếng Kơho" (UBND tỉnh Lâm Đồng – Viện Ngôn ngữ học) và từ điển Kơ Ho – Việt. Phát âm tròn vành, rõ tiền âm tiết (bơ-, kơ-, gơ-).',
    speechRateMultiplier: 1.0,
    pitchOffset: 0,
  },
  cil: {
    id: 'cil',
    name: 'Cơ Ho Cil (Chil)',
    shortLabel: 'Cil (Chil)',
    region: 'Lạc Dương · Đơn Dương · Đức Trọng · Lâm Hà',
    standardSummary:
      'Giọng vùng núi cao Bắc/Đông Bắc Lâm Viên. Nguyên âm đọc gọn và ngắn hơn chuẩn Srê, phụ âm cuối và âm tắc thanh hầu bật sắc nét.',
    speechRateMultiplier: 1.06,
    pitchOffset: 0.04,
  },
  lach: {
    id: 'lach',
    name: 'Cơ Ho Lạch (Làt)',
    shortLabel: 'Lạch (Làt)',
    region: 'Đà Lạt · Lang Biang · Lạc Dương',
    standardSummary:
      'Phương ngữ cao nguyên Lang Biang – Đà Lạt. Nhịp điệu thoáng, uyển chuyển, nguyên âm đôi luyến nhẹ và dễ tiếp cận.',
    speechRateMultiplier: 0.96,
    pitchOffset: 0.02,
  },
  ma: {
    id: 'ma',
    name: 'Tiếng Mạ (Châu Mạ)',
    shortLabel: 'Mạ',
    region: 'Bảo Lộc · Bảo Lâm · Đạ Huoai · Đạ Tẻh',
    standardSummary:
      'Cùng nhánh ngôn ngữ Nam Ba-na / Môn-Khơ Me với Cơ Ho. Nhấn rõ các cụm âm mũi đầu (mb-, mp-, nd-, ngg-) và ngắt tắc cuối từ dứt khoát.',
    speechRateMultiplier: 1.02,
    pitchOffset: -0.05,
  },
};

export interface CohoAudioSourceRef {
  name: string;
  description: string;
  url: string;
}

export const LAM_DONG_AUDIO_SOURCES: CohoAudioSourceRef[] = [
  {
    name: 'Từ điển K’Ho – Việt (tudienkho.com)',
    description: 'Cổng tra cứu từ vựng song ngữ K’Ho – Tiếng Việt phục vụ học tập và hành chính tại Lâm Đồng.',
    url: 'https://tudienkho.com',
  },
  {
    name: 'Báo & PTTH Lâm Đồng – Chuyên mục tiếng Cơ Ho',
    description: 'Các bản tin phát thanh – truyền hình tiếng Cơ Ho (giọng Srê, Cil, Lạch bản xứ tại Lâm Đồng).',
    url: 'https://www.youtube.com/results?search_query=%C4%90%C3%A0i+L%C3%A2m+%C4%90%E1%BB%93ng+ti%E1%BA%BFng+C%C6%A1+Ho',
  },
  {
    name: 'VTV5 Tây Nguyên – Chương trình tiếng Cơ Ho',
    description: 'Nguồn phát thanh – truyền hình chuẩn ngữ điệu bản địa của đồng bào Cơ Ho Tây Nguyên.',
    url: 'https://www.youtube.com/results?search_query=VTV5+ti%E1%BA%BFng+C%C6%A1+Ho',
  },
  {
    name: 'Glosbe K’Ho – Tiếng Việt',
    description: 'Kho ngữ liệu song ngữ K’Ho (mã ngôn ngữ kpm) kèm câu ví dụ thực tế.',
    url: 'https://glosbe.com/kpm/vi',
  },
];

const DIALECT_STORAGE_KEY = 'coho_lamdong_dialect';
const CUSTOM_AUDIO_STORAGE_KEY = 'coho_custom_audio_map';

let audioCtx: AudioContext | null = null;
let isMuted = false;

export function setSoundMuted(muted: boolean): void {
  isMuted = muted;
}

export function getSoundMuted(): boolean {
  return isMuted;
}

export function getSelectedDialect(): CohoDialect {
  if (typeof window === 'undefined') return 'sre';
  const stored = window.localStorage.getItem(DIALECT_STORAGE_KEY);
  if (stored === 'sre' || stored === 'cil' || stored === 'lach' || stored === 'ma') {
    return stored;
  }
  return 'sre';
}

export function setSelectedDialect(dialect: CohoDialect): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DIALECT_STORAGE_KEY, dialect);
}

function readCustomAudioMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CUSTOM_AUDIO_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getCustomAudioForWord(word: string): string | undefined {
  const map = readCustomAudioMap();
  return map[word.trim().toLowerCase()];
}

export function saveCustomAudioForWord(word: string, audioUrlOrData: string): void {
  if (typeof window === 'undefined') return;
  const map = readCustomAudioMap();
  map[word.trim().toLowerCase()] = audioUrlOrData;
  window.localStorage.setItem(CUSTOM_AUDIO_STORAGE_KEY, JSON.stringify(map));
}

export function removeCustomAudioForWord(word: string): void {
  if (typeof window === 'undefined') return;
  const map = readCustomAudioMap();
  delete map[word.trim().toLowerCase()];
  window.localStorage.setItem(CUSTOM_AUDIO_STORAGE_KEY, JSON.stringify(map));
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextCtor) {
      audioCtx = new AudioContextCtor();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(freq: number, durationMs: number, type: OscillatorType = 'sine', delayMs = 0, gainVal = 0.08): void {
  if (isMuted) return;
  const ctx = getCtx();
  if (!ctx) return;

  const start = ctx.currentTime + delayMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);

  gain.gain.setValueAtTime(0.001, start);
  gain.gain.exponentialRampToValueAtTime(gainVal, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, start + durationMs / 1000);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000 + 0.02);
}

export function playTapSound(): void {
  playTone(540, 55, 'triangle', 0, 0.04);
}

export function playCorrectSound(): void {
  playTone(523.25, 120, 'sine', 0, 0.08);
  playTone(659.25, 160, 'sine', 90, 0.09);
}

export function playWrongSound(): void {
  playTone(240, 140, 'triangle', 0, 0.07);
  playTone(195, 180, 'triangle', 110, 0.07);
}

export function playCelebrateSound(): void {
  playTone(523.25, 120, 'sine', 0, 0.08);
  playTone(659.25, 120, 'sine', 100, 0.08);
  playTone(783.99, 140, 'sine', 200, 0.09);
  playTone(1046.5, 280, 'sine', 320, 0.1);
}

/**
 * Chuẩn hóa chữ viết K'Ho (theo tài liệu Lâm Đồng: Sre, Cil, Lạch, Mạ) sang chuỗi
 * âm tiết dễ đọc chính xác nhất qua bộ đọc tiếng Việt.
 */
export function normalizeCohoForSpeech(text: string, dialect: CohoDialect = 'sre'): string {
  // Tách phần ghi chú đối nghĩa trong ngoặc nếu có, ví dụ "Adàr (Mhàr)" -> đọc phần chính "Adàr"
  const cleanHead = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() || text.trim();

  let out = cleanHead
    .replace(/ñ/g, 'nh')
    .replace(/Ñ/g, 'Nh')
    .replace(/b̀|b'/gi, 'b')
    .replace(/d̀|d'/gi, 'đ')
    .replace(/\bK’Ho\b|\bK'Ho\b/gi, 'Kơ Ho')
    // Cụm tiền âm mũi (prenasalized) đặc trưng Cơ Ho & Mạ
    .replace(/\bmp/gi, 'm-p')
    .replace(/\bmb/gi, 'm-b')
    .replace(/\bnd/gi, 'n-đ')
    .replace(/\bngg/gi, 'ng-g')
    .replace(/\bngk/gi, 'ng-k')
    .replace(/\bmh/gi, 'm-h')
    // Cụm phụ âm đầu tách nhẹ âm đệm 'ơ' theo âm vị học Nam Ba-na
    .replace(/\bsr/gi, 'sơ-r')
    .replace(/\bbr/gi, 'bơ-r')
    .replace(/\bpr/gi, 'pơ-r')
    .replace(/\bkr/gi, 'kơ-r')
    .replace(/\btr/gi, 'tơ-r')
    .replace(/\bdr/gi, 'đơ-r')
    .replace(/\bgr/gi, 'gơ-r')
    .replace(/\bcr/gi, 'chơ-r')
    .replace(/\bjr/gi, 'giơ-r')
    .replace(/\bmr/gi, 'mơ-r')
    .replace(/\bkl/gi, 'kơ-l')
    .replace(/\bbl/gi, 'bơ-l')
    .replace(/\bpl/gi, 'pơ-l')
    .replace(/\bgl/gi, 'gơ-l')
    // Mặt lưỡi c -> ch (trừ ch có sẵn), j -> gi
    .replace(/\bc(?![hi])/gi, 'ch')
    .replace(/\bj/gi, 'gi')
    .replace(/\bd(?![àâăeêioôơuưy])/gi, 'đ');

  // Biến thể nhẹ theo phương ngữ Lâm Đồng
  if (dialect === 'cil') {
    // Cil có xu hướng rút gọn tiền âm tiết hơn Srê
    out = out.replace(/bơ-/gi, 'b-').replace(/kơ-/gi, 'k-').replace(/gơ-/gi, 'g-');
  } else if (dialect === 'lach') {
    // Lạch đọc liền mạch, thoáng
    out = out.replace(/-/g, ' ');
  } else if (dialect === 'ma') {
    // Mạ nhấn rõ cụm âm mũi đầu
    out = out.replace(/m-p/gi, 'ơm-p').replace(/m-b/gi, 'ơm-b').replace(/n-đ/gi, 'ơn-đ');
  }

  return out.replace(/\s+/g, ' ').trim();
}

export interface PronunciationGuide {
  readableVi: string;
  ipaApprox: string;
  phoneticNotes: string[];
  dialectLabel: string;
}

export function getCohoPronunciationGuide(
  text: string,
  dialect: CohoDialect = 'sre',
  overridePhonetic?: string
): PronunciationGuide {
  const cleanHead = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim() || text.trim();
  const readableVi = overridePhonetic?.trim() || normalizeCohoForSpeech(cleanHead, dialect);

  // Chuyển đổi gần đúng sang IPA theo chuẩn mô tả ngữ âm Cơ Ho Lâm Đồng (Olsen / SIL / Viện Ngôn ngữ học)
  let ipa = cleanHead
    .toLowerCase()
    .replace(/ñ/g, 'ɲ')
    .replace(/ngg/g, 'ŋg')
    .replace(/ng/g, 'ŋ')
    .replace(/nh/g, 'ɲ')
    .replace(/ch/g, 'cʰ')
    .replace(/c/g, 'c')
    .replace(/j/g, 'ɟ')
    .replace(/đ/g, 'ɗ')
    .replace(/d/g, 'ɗ')
    .replace(/b/g, 'ɓ')
    .replace(/ơ/g, 'ə')
    .replace(/ư/g, 'ɯ')
    .replace(/ă/g, 'ă')
    .replace(/â/g, 'ə̆');

  const notes: string[] = [];
  if (/ñ/i.test(cleanHead)) notes.push('Chữ "ñ" đọc như âm "nh" mặt lưỡi (/ɲ/).');
  if (/\bc(?![h])/i.test(cleanHead)) notes.push('Âm "c" đứng đầu hoặc cuối đọc gọn như "ch" (/c/), không bật hơi mạnh.');
  if (/j/i.test(cleanHead)) notes.push('Âm "j" là âm tắc mặt lưỡi hữu thanh (/ɟ/), gần với "gi/d" nhưng chắc và gọn hơn.');
  if (/\b(mp|mb|nd|ngg|ngk|mh)/i.test(cleanHead)) {
    notes.push('Cụm phụ âm tiền mũi (mp-, mb-, nd-, ngg-): khép nhẹ âm mũi trước khi bật phụ âm sau.');
  }
  if (/[bđd]/.test(cleanHead.toLowerCase()) || /b̀|d̀/i.test(cleanHead)) {
    notes.push('Âm "b, đ" trong Cơ Ho Lâm Đồng thường là âm tắc hút vào (/ɓ, ɗ/), hít nhẹ hơi vào trong.');
  }
  if (/h\b/i.test(cleanHead)) notes.push('Âm "-h" ở cuối từ tạo hơi xát nhẹ thanh hầu khi kết thúc âm tiết.');
  if (/[rl]\b/i.test(cleanHead)) notes.push('Âm cuối "-r / -l" uốn nhẹ đầu lưỡi khi khép vần.');

  if (notes.length === 0) {
    notes.push('Nhấn trọng âm vào âm tiết cuối; giữ nguyên độ dài của nguyên âm ngắn (ă, â) và nguyên âm dài.');
  }

  return {
    readableVi,
    ipaApprox: `/${ipa}/`,
    phoneticNotes: notes,
    dialectLabel: COHO_DIALECTS[dialect].name,
  };
}

export function speakCohoText(
  text: string,
  options?: {
    audioUrl?: string;
    phonetic?: string;
    dialect?: CohoDialect;
    slow?: boolean;
    onStart?: () => void;
    onEnd?: () => void;
  }
): void {
  const dialect = options?.dialect ?? getSelectedDialect();
  const { audioUrl, phonetic, slow = false, onStart, onEnd } = options || {};

  // 1. Ưu tiên cao nhất: bản thu âm bản xứ do người dùng/giáo viên gắn cho từ này
  const customAudio = getCustomAudioForWord(text);
  const resolvedUrl = customAudio || audioUrl?.trim();

  if (resolvedUrl) {
    try {
      const audio = new Audio(resolvedUrl);
      audio.playbackRate = slow ? 0.72 : 1;
      onStart?.();
      audio.onended = () => onEnd?.();
      audio.onerror = () => {
        fallbackSpeech(
          phonetic || normalizeCohoForSpeech(text, dialect),
          slow,
          dialect,
          onStart,
          onEnd
        );
      };
      audio.play().catch(() => {
        fallbackSpeech(
          phonetic || normalizeCohoForSpeech(text, dialect),
          slow,
          dialect,
          onStart,
          onEnd
        );
      });
      return;
    } catch {
      // Fall through to dialect phonetic synthesis
    }
  }

  const spoken = phonetic || normalizeCohoForSpeech(text, dialect);
  fallbackSpeech(spoken, slow, dialect, onStart, onEnd);
}

export function speakVietnameseText(
  text: string,
  options?: { slow?: boolean; onStart?: () => void; onEnd?: () => void }
): void {
  const { slow = false, onStart, onEnd } = options || {};
  fallbackSpeech(text, slow, 'sre', onStart, onEnd);
}

function fallbackSpeech(
  spokenText: string,
  slow: boolean,
  dialect: CohoDialect,
  onStart?: () => void,
  onEnd?: () => void
): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    playTone(440, 120, 'sine');
    onEnd?.();
    return;
  }

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spokenText);
    const voices = window.speechSynthesis.getVoices();
    const viVoice = voices.find((v) => v.lang.toLowerCase().startsWith('vi'));
    if (viVoice) {
      utterance.voice = viVoice;
    }
    const meta = COHO_DIALECTS[dialect];
    utterance.lang = 'vi-VN';
    const baseRate = slow ? 0.6 : 0.86;
    utterance.rate = Math.max(0.5, Math.min(1.25, baseRate * meta.speechRateMultiplier));
    utterance.pitch = Math.max(0.85, Math.min(1.2, 1.0 + meta.pitchOffset));
    utterance.onstart = () => onStart?.();
    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onEnd?.();
    onStart?.();
    window.speechSynthesis.speak(utterance);
  } catch {
    onEnd?.();
  }
}
