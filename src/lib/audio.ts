let audioCtx: AudioContext | null = null;
let isMuted = false;

export function setSoundMuted(muted: boolean): void {
  isMuted = muted;
}

export function getSoundMuted(): boolean {
  return isMuted;
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

export function normalizeCohoForSpeech(text: string): string {
  return text
    .replace(/ñ/g, 'nh')
    .replace(/Ñ/g, 'Nh')
    .replace(/b̀/g, 'b')
    .replace(/d̀/g, 'đ')
    .replace(/\bDak\b/gi, 'Đăk')
    .replace(/\bSră\b/gi, 'Sơ-ră')
    .replace(/\bBri\b/gi, 'Bơ-ri')
    .replace(/\bPrăm\b/gi, 'Pơ-răm')
    .replace(/\bCih\b/gi, 'Chih')
    .replace(/\bJơt\b/gi, 'Giơt')
    .replace(/\bJùn\b/gi, 'Giùn')
    .replace(/\bJơng\b/gi, 'Giơng')
    .replace(/\bKliư\b/gi, 'Kơ-liư')
    .replace(/\bKrih\b/gi, 'Kơ-rih')
    .replace(/\bBrê\b/gi, 'Bơ-rê')
    .replace(/\bBrơn\b/gi, 'Bơ-rơn')
    .replace(/\bBrăn\b/gi, 'Bơ-răn')
    .replace(/\bBrău\b/gi, 'Bơ-rău')
    .replace(/\bK’Ho\b/gi, 'Kơ Ho')
    .trim();
}

export function speakCohoText(
  text: string,
  options?: { audioUrl?: string; phonetic?: string; slow?: boolean; onStart?: () => void; onEnd?: () => void }
): void {
  const { audioUrl, phonetic, slow = false, onStart, onEnd } = options || {};

  if (audioUrl && audioUrl.trim()) {
    try {
      const audio = new Audio(audioUrl.trim());
      audio.playbackRate = slow ? 0.72 : 1;
      onStart?.();
      audio.onended = () => onEnd?.();
      audio.onerror = () => {
        fallbackSpeech(phonetic || text, slow, onStart, onEnd);
      };
      audio.play().catch(() => {
        fallbackSpeech(phonetic || text, slow, onStart, onEnd);
      });
      return;
    } catch {
      // Fall through to speechSynthesis
    }
  }

  fallbackSpeech(phonetic || normalizeCohoForSpeech(text), slow, onStart, onEnd);
}

export function speakVietnameseText(
  text: string,
  options?: { slow?: boolean; onStart?: () => void; onEnd?: () => void }
): void {
  const { slow = false, onStart, onEnd } = options || {};
  fallbackSpeech(text, slow, onStart, onEnd);
}

function fallbackSpeech(
  spokenText: string,
  slow: boolean,
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
    utterance.lang = 'vi-VN';
    utterance.rate = slow ? 0.62 : 0.88;
    utterance.pitch = 1.02;
    utterance.onstart = () => onStart?.();
    utterance.onend = () => onEnd?.();
    utterance.onerror = () => onEnd?.();
    onStart?.();
    window.speechSynthesis.speak(utterance);
  } catch {
    onEnd?.();
  }
}
