import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Heart,
  HelpCircle,
  Mic,
  MicOff,
  RotateCcw,
  Turtle,
  Volume2,
  X,
  Star,
} from 'lucide-react';
import { ExerciseItem, LessonItem } from '../shared/types';
import {
  playCelebrateSound,
  playCorrectSound,
  playTapSound,
  playWrongSound,
  speakCohoText,
} from '../lib/audio';
import { HandwritingPad } from './HandwritingPad';
import { CohoKeyboard } from './CohoKeyboard';

interface LessonPlayerProps {
  lesson: LessonItem;
  initialHearts: number;
  onExit: () => void;
  onComplete: (result: { score: number; earnedXp: number; heartsRemaining: number }) => Promise<void> | void;
}

const SKILL_LABELS: Record<ExerciseItem['skill'], string> = {
  recognize: 'Nhận biết chữ Cơ Ho',
  listen: 'Nghe hiểu tiếng Cơ Ho',
  read: 'Đọc chữ Cơ Ho',
  write: 'Viết chữ Cơ Ho',
};

function normalizeAnswer(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/[?.!,]/g, '')
    .replace(/\s+/g, ' ');
}

export const LessonPlayer: React.FC<LessonPlayerProps> = ({
  lesson,
  initialHearts,
  onExit,
  onComplete,
}) => {
  const exercises = lesson.exercises;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hearts, setHearts] = useState(Math.max(1, Math.min(5, initialHearts || 5)));
  const [correctCount, setCorrectCount] = useState(0);
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [wordBankSelected, setWordBankSelected] = useState<number[]>([]);
  const [typedText, setTypedText] = useState<string>('');
  const [hasDrawn, setHasDrawn] = useState(false);
  const [spokenRecognized, setSpokenRecognized] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeakingAudio, setIsSpeakingAudio] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [feedback, setFeedback] = useState<'idle' | 'correct' | 'wrong'>('idle');
  const [isFinished, setIsFinished] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [gongImgError, setGongImgError] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const currentExercise = exercises[currentIndex];

  // Auto-play audio on listening exercises
  useEffect(() => {
    if (!currentExercise || isFinished) return;
    setSelectedOption('');
    setWordBankSelected([]);
    setTypedText('');
    setHasDrawn(false);
    setSpokenRecognized('');
    setShowHint(false);
    setFeedback('idle');

    if (currentExercise.exerciseType === 'listen_select' || currentExercise.skill === 'listen') {
      const timer = window.setTimeout(() => {
        speakCohoText(currentExercise.cohoText, {
          audioUrl: currentExercise.audioUrl,
          phonetic: currentExercise.phonetic,
          onStart: () => setIsSpeakingAudio(true),
          onEnd: () => setIsSpeakingAudio(false),
        });
      }, 260);
      return () => window.clearTimeout(timer);
    }
  }, [currentIndex, currentExercise, isFinished]);

  const wordBankAnswer = useMemo(() => {
    if (!currentExercise) return '';
    return wordBankSelected.map((idx) => currentExercise.options[idx]).join(' ');
  }, [wordBankSelected, currentExercise]);

  const canCheck = useMemo(() => {
    if (!currentExercise || feedback !== 'idle') return false;
    switch (currentExercise.exerciseType) {
      case 'multiple_choice':
      case 'listen_select':
        return selectedOption.length > 0;
      case 'word_bank':
        return wordBankSelected.length > 0;
      case 'type_coho':
        return typedText.trim().length > 0;
      case 'handwriting':
        return hasDrawn;
      case 'speak_read':
        return true;
      default:
        return false;
    }
  }, [currentExercise, feedback, selectedOption, wordBankSelected, typedText, hasDrawn]);

  const handleToggleWordTile = (idx: number) => {
    if (feedback !== 'idle') return;
    playTapSound();
    setWordBankSelected((prev) =>
      prev.includes(idx) ? prev.filter((item) => item !== idx) : [...prev, idx]
    );
  };

  const handleStartSpeechRecognition = () => {
    if (!currentExercise) return;
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;

    if (!SpeechRec) {
      setSpokenRecognized('Trình duyệt đã ghi nhận lượt luyện đọc của em.');
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.lang = 'vi-VN';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      setIsRecording(true);
      recognition.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        setSpokenRecognized(transcript || currentExercise.cohoText);
        setIsRecording(false);
      };
      recognition.onerror = () => {
        setIsRecording(false);
        setSpokenRecognized('Đã ghi nhận giọng đọc — hãy đối chiếu với loa mẫu nhé!');
      };
      recognition.onend = () => {
        setIsRecording(false);
      };
      recognition.start();
    } catch {
      setIsRecording(false);
      setSpokenRecognized('Đã ghi nhận lượt luyện đọc của em.');
    }
  };

  const handleCheck = () => {
    if (!currentExercise || feedback !== 'idle') return;

    let isCorrect = false;
    if (currentExercise.exerciseType === 'multiple_choice' || currentExercise.exerciseType === 'listen_select') {
      isCorrect = normalizeAnswer(selectedOption) === normalizeAnswer(currentExercise.correctAnswer);
    } else if (currentExercise.exerciseType === 'word_bank') {
      isCorrect = normalizeAnswer(wordBankAnswer) === normalizeAnswer(currentExercise.correctAnswer);
    } else if (currentExercise.exerciseType === 'type_coho') {
      isCorrect = normalizeAnswer(typedText) === normalizeAnswer(currentExercise.correctAnswer);
    } else if (currentExercise.exerciseType === 'handwriting') {
      isCorrect = hasDrawn;
    } else if (currentExercise.exerciseType === 'speak_read') {
      isCorrect = true;
    }

    if (isCorrect) {
      playCorrectSound();
      setCorrectCount((prev) => prev + 1);
      setFeedback('correct');
    } else {
      playWrongSound();
      setHearts((prev) => Math.max(1, prev - 1));
      setFeedback('wrong');
    }
  };

  const handleContinue = async () => {
    if (currentIndex + 1 < exercises.length) {
      setCurrentIndex((prev) => prev + 1);
      return;
    }

    playCelebrateSound();
    setIsFinished(true);
    setIsSaving(true);
    const total = Math.max(1, exercises.length);
    const score = Math.round((correctCount / total) * 100);
    const earnedXp = Math.max(10, Math.round((lesson.xpReward * Math.max(50, score)) / 100));
    try {
      await onComplete({
        score,
        earnedXp,
        heartsRemaining: hearts,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const insertCohoChar = (char: string) => {
    setTypedText((prev) => prev + char);
    inputRef.current?.focus();
  };

  if (!currentExercise && !isFinished) {
    return (
      <div className="max-w-xl mx-auto p-6 bg-white rounded-3xl border border-stone-200 text-center space-y-4">
        <p className="text-stone-700 font-medium">Bài học này chưa có câu hỏi nào.</p>
        <button
          type="button"
          onClick={onExit}
          className="px-5 py-2.5 bg-emerald-700 text-white font-bold rounded-xl"
        >
          Quay lại
        </button>
      </div>
    );
  }

  if (isFinished) {
    const total = Math.max(1, exercises.length);
    const accuracy = Math.round((correctCount / total) * 100);
    const stars = accuracy >= 90 ? 3 : accuracy >= 70 ? 2 : 1;
    const earnedXp = Math.max(10, Math.round((lesson.xpReward * Math.max(50, accuracy)) / 100));

    return (
      <div className="min-h-[82vh] flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md bg-white border border-stone-200 rounded-3xl p-6 sm:p-8 text-center space-y-6">
          <div className="w-32 h-32 mx-auto rounded-3xl bg-amber-50 border border-amber-200 overflow-hidden flex items-center justify-center">
            {!gongImgError ? (
              <img
                src="/src/assets/images/coho_trophy_gong_1795158939674.jpg"
                alt="Huy hiệu Cồng chiêng hoàn thành bài học"
                referrerPolicy="no-referrer"
                onError={() => setGongImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <Star className="w-14 h-14 text-amber-500 fill-amber-400" />
            )}
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-stone-900">
              Hoàn thành bài học!
            </h2>
            <p className="text-sm text-stone-600">{lesson.title}</p>
          </div>

          <div className="flex items-center justify-center gap-2">
            {[1, 2, 3].map((idx) => (
              <Star
                key={idx}
                className={`w-9 h-9 ${
                  idx <= stars ? 'text-amber-500 fill-amber-400' : 'text-stone-200 fill-stone-100'
                }`}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <div className="text-xs font-semibold text-emerald-800">Điểm XP nhận được</div>
              <div className="text-2xl font-extrabold text-emerald-700 font-mono tabular-nums mt-1">
                +{earnedXp} XP
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <div className="text-xs font-semibold text-amber-800">Độ chính xác</div>
              <div className="text-2xl font-extrabold text-amber-700 font-mono tabular-nums mt-1">
                {accuracy}%
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onExit}
            disabled={isSaving}
            className="w-full py-3.5 px-6 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-2xl border-b-4 border-emerald-900 active:translate-y-0.5 transition-all min-h-[48px]"
          >
            {isSaving ? 'Đang lưu kết quả...' : 'Tiếp tục hành trình'}
          </button>
        </div>
      </div>
    );
  }

  const progressPct = Math.round(((currentIndex + (feedback !== 'idle' ? 1 : 0)) / exercises.length) * 100);

  return (
    <div className="min-h-[88vh] flex flex-col justify-between max-w-3xl mx-auto px-4 py-4 sm:py-6">
      {/* Top Progress Bar & Hearts */}
      <div className="flex items-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={onExit}
          aria-label="Thoát bài học"
          className="w-11 h-11 rounded-xl bg-white border border-stone-200 flex items-center justify-center text-stone-600 hover:text-stone-900 hover:bg-stone-50 shrink-0"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex-1 h-4 bg-stone-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-600 rounded-full transition-all duration-300"
            style={{ width: `${Math.max(8, progressPct)}%` }}
          />
        </div>

        <div className="flex items-center gap-1.5 text-rose-600 font-bold font-mono tabular-nums shrink-0 px-2">
          <Heart className="w-5 h-5 fill-rose-500 text-rose-500" />
          <span>{hearts}</span>
        </div>
      </div>

      {/* Main Exercise Stage */}
      <div className="flex-1 flex flex-col justify-center py-6 sm:py-8 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-stone-500">
            <span>
              {SKILL_LABELS[currentExercise.skill]} · Câu {currentIndex + 1}/{exercises.length}
            </span>
            {currentExercise.hint && (
              <button
                type="button"
                onClick={() => setShowHint((prev) => !prev)}
                className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-800 font-semibold py-1 px-2 rounded-lg hover:bg-amber-50"
              >
                <HelpCircle className="w-4 h-4" />
                <span>{showHint ? 'Ẩn gợi ý' : 'Xem gợi ý'}</span>
              </button>
            )}
          </div>

          <h2 className="text-xl sm:text-2xl font-extrabold text-stone-900 text-balance leading-snug">
            {currentExercise.prompt}
          </h2>

          {showHint && currentExercise.hint && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-sm text-amber-900">
              <span className="font-bold">Gợi ý: </span>
              {currentExercise.hint}
            </div>
          )}
        </div>

        {/* Audio Bar (for listen, read, or typing exercises) */}
        {(currentExercise.exerciseType === 'listen_select' ||
          currentExercise.exerciseType === 'speak_read' ||
          currentExercise.exerciseType === 'type_coho' ||
          currentExercise.exerciseType === 'multiple_choice') && (
          <div className="bg-white border border-stone-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() =>
                  speakCohoText(currentExercise.cohoText, {
                    audioUrl: currentExercise.audioUrl,
                    phonetic: currentExercise.phonetic,
                    onStart: () => setIsSpeakingAudio(true),
                    onEnd: () => setIsSpeakingAudio(false),
                  })
                }
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors shrink-0 ${
                  isSpeakingAudio
                    ? 'bg-emerald-700 text-white'
                    : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                }`}
                aria-label="Nghe phát âm tiếng Cơ Ho"
              >
                <Volume2 className="w-6 h-6" />
              </button>

              <div>
                <div className="text-base sm:text-lg font-bold text-stone-900">
                  {currentExercise.exerciseType === 'listen_select'
                    ? 'Bấm loa để nghe tiếng Cơ Ho'
                    : currentExercise.cohoText}
                </div>
                {currentExercise.phonetic && currentExercise.exerciseType !== 'listen_select' && (
                  <div className="text-xs text-stone-500">
                    Phiên âm gợi ý: <span className="font-semibold">{currentExercise.phonetic}</span>
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() =>
                speakCohoText(currentExercise.cohoText, {
                  audioUrl: currentExercise.audioUrl,
                  phonetic: currentExercise.phonetic,
                  slow: true,
                  onStart: () => setIsSpeakingAudio(true),
                  onEnd: () => setIsSpeakingAudio(false),
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl min-h-[40px] whitespace-nowrap"
            >
              <Turtle className="w-4 h-4 text-emerald-700" />
              <span>Nghe chậm</span>
            </button>
          </div>
        )}

        {/* Type 1 & 2: Multiple Choice / Listen Select */}
        {(currentExercise.exerciseType === 'multiple_choice' ||
          currentExercise.exerciseType === 'listen_select') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {currentExercise.options.map((opt, idx) => {
              const isSelected = selectedOption === opt;
              return (
                <button
                  key={`${opt}-${idx}`}
                  type="button"
                  disabled={feedback !== 'idle'}
                  onClick={() => {
                    playTapSound();
                    setSelectedOption(opt);
                    if (currentExercise.exerciseType === 'listen_select') {
                      speakCohoText(opt);
                    }
                  }}
                  className={`p-4 text-left rounded-2xl border-2 transition-all min-h-[60px] flex items-center gap-3 ${
                    isSelected
                      ? 'bg-emerald-50 border-emerald-600 text-emerald-950'
                      : 'bg-white border-stone-200 hover:border-stone-300 text-stone-900'
                  }`}
                >
                  <span
                    className={`w-8 h-8 rounded-xl border text-xs font-bold flex items-center justify-center shrink-0 font-mono ${
                      isSelected
                        ? 'bg-emerald-700 border-emerald-700 text-white'
                        : 'bg-stone-50 border-stone-200 text-stone-600'
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <span className="text-base font-bold">{opt}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Type 3: Word Bank */}
        {currentExercise.exerciseType === 'word_bank' && (
          <div className="space-y-5">
            <div className="text-sm text-stone-600">
              Nghĩa tiếng Việt: <span className="font-bold text-stone-900">{currentExercise.vietnameseText}</span>
            </div>

            <div className="min-h-[72px] bg-white border-2 border-dashed border-stone-300 rounded-2xl p-3 flex flex-wrap items-center gap-2">
              {wordBankSelected.length === 0 ? (
                <span className="text-sm text-stone-400 px-2">
                  Chạm vào các thẻ từ bên dưới để ghép câu Cơ Ho...
                </span>
              ) : (
                wordBankSelected.map((optIdx, pos) => (
                  <button
                    key={`${optIdx}-${pos}`}
                    type="button"
                    disabled={feedback !== 'idle'}
                    onClick={() => handleToggleWordTile(optIdx)}
                    className="px-4 py-2.5 bg-emerald-50 border-2 border-emerald-600 text-emerald-900 font-bold rounded-xl min-h-[44px]"
                  >
                    {currentExercise.options[optIdx]}
                  </button>
                ))
              )}
            </div>

            <div className="flex flex-wrap gap-2.5 justify-center pt-2">
              {currentExercise.options.map((word, idx) => {
                const used = wordBankSelected.includes(idx);
                return (
                  <button
                    key={`${word}-${idx}`}
                    type="button"
                    disabled={used || feedback !== 'idle'}
                    onClick={() => handleToggleWordTile(idx)}
                    className={`px-4 py-2.5 font-bold rounded-xl border border-b-3 min-h-[44px] transition-all ${
                      used
                        ? 'bg-stone-100 border-stone-200 text-transparent select-none'
                        : 'bg-white border-stone-300 text-stone-900 hover:bg-stone-50 active:translate-y-0.5'
                    }`}
                  >
                    {word}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Type 4: Type K'Ho */}
        {currentExercise.exerciseType === 'type_coho' && (
          <div className="space-y-4">
            <div className="text-sm text-stone-600">
              Nghĩa tiếng Việt: <span className="font-bold text-stone-900">{currentExercise.vietnameseText}</span>
            </div>

            <input
              ref={inputRef}
              type="text"
              value={typedText}
              disabled={feedback !== 'idle'}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder="Nhập chữ Cơ Ho vào đây..."
              className="w-full px-4 py-3.5 text-lg font-bold bg-white border-2 border-stone-300 focus:border-emerald-600 focus:outline-none rounded-2xl text-stone-900"
            />

            {feedback === 'idle' && (
              <CohoKeyboard
                onInsert={insertCohoChar}
                onBackspace={() => setTypedText((prev) => prev.slice(0, -1))}
              />
            )}
          </div>
        )}

        {/* Type 5: Handwriting */}
        {currentExercise.exerciseType === 'handwriting' && (
          <div className="space-y-3">
            <div className="text-sm text-stone-600">
              Ý nghĩa: <span className="font-bold text-stone-900">{currentExercise.vietnameseText}</span>
            </div>
            <HandwritingPad
              templateText={currentExercise.cohoText}
              onDrawnChange={setHasDrawn}
            />
          </div>
        )}

        {/* Type 6: Speak / Read Aloud */}
        {currentExercise.exerciseType === 'speak_read' && (
          <div className="bg-white border border-stone-200 rounded-2xl p-6 text-center space-y-4">
            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-extrabold text-emerald-800">
                {currentExercise.cohoText}
              </div>
              <div className="text-sm font-medium text-stone-600">
                Nghĩa là: <span className="font-bold text-stone-900">{currentExercise.vietnameseText}</span>
              </div>
              {currentExercise.phonetic && (
                <div className="text-xs text-stone-500">
                  Cách đọc: <span className="font-semibold">{currentExercise.phonetic}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleStartSpeechRecognition}
                disabled={isRecording || feedback !== 'idle'}
                className={`inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-bold text-sm min-h-[48px] transition-all ${
                  isRecording
                    ? 'bg-rose-600 text-white'
                    : 'bg-emerald-50 text-emerald-800 border-2 border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                <span>{isRecording ? 'Đang lắng nghe em đọc...' : 'Bấm để đọc thành tiếng'}</span>
              </button>
            </div>

            {spokenRecognized && (
              <div className="text-xs font-medium text-emerald-800 bg-emerald-50 rounded-xl p-2.5">
                {spokenRecognized}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Sticky Action & Feedback Bar */}
      <div
        className={`rounded-2xl border p-4 transition-colors ${
          feedback === 'correct'
            ? 'bg-emerald-50 border-emerald-300'
            : feedback === 'wrong'
              ? 'bg-rose-50 border-rose-300'
              : 'bg-white border-stone-200'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {feedback === 'idle' && (
            <div className="text-sm text-stone-600">
              {currentExercise.exerciseType === 'handwriting'
                ? hasDrawn
                  ? 'Rất tốt! Bấm Kiểm tra để hoàn thành nét viết.'
                  : 'Hãy viết chữ lên bảng ô ly phía trên nhé.'
                : currentExercise.exerciseType === 'speak_read'
                  ? 'Bấm loa để nghe mẫu, đọc to rồi bấm Hoàn thành câu.'
                  : 'Chọn hoặc nhập câu trả lời của em.'}
            </div>
          )}

          {feedback === 'correct' && (
            <div className="flex items-center gap-3 text-emerald-900">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 shrink-0" />
              <div>
                <div className="font-extrabold text-base">Chính xác! Giỏi lắm!</div>
                <div className="text-xs text-emerald-800">
                  {currentExercise.cohoText} — {currentExercise.vietnameseText}
                </div>
              </div>
            </div>
          )}

          {feedback === 'wrong' && (
            <div className="flex items-center gap-3 text-rose-900">
              <AlertCircle className="w-7 h-7 text-rose-600 shrink-0" />
              <div>
                <div className="font-extrabold text-base">Chưa chính xác</div>
                <div className="text-xs text-rose-800">
                  Đáp án đúng: <span className="font-bold">{currentExercise.correctAnswer}</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 sm:ml-auto">
            {feedback === 'idle' ? (
              <button
                type="button"
                disabled={!canCheck}
                onClick={handleCheck}
                className={`w-full sm:w-auto px-7 py-3 rounded-2xl font-bold text-sm min-h-[48px] transition-all ${
                  canCheck
                    ? 'bg-emerald-700 hover:bg-emerald-800 text-white border-b-4 border-emerald-900 active:translate-y-0.5'
                    : 'bg-stone-200 text-stone-500 cursor-not-allowed'
                }`}
              >
                {currentExercise.exerciseType === 'speak_read' ? 'Em đã đọc xong' : 'Kiểm tra'}
              </button>
            ) : (
              <>
                {feedback === 'wrong' && (
                  <button
                    type="button"
                    onClick={() => setFeedback('idle')}
                    className="inline-flex items-center gap-1.5 px-4 py-3 rounded-2xl font-bold text-sm bg-white border border-rose-300 text-rose-800 hover:bg-rose-100 min-h-[48px]"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Thử lại</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleContinue}
                  className={`w-full sm:w-auto px-7 py-3 rounded-2xl font-bold text-sm text-white border-b-4 active:translate-y-0.5 min-h-[48px] ${
                    feedback === 'correct'
                      ? 'bg-emerald-700 hover:bg-emerald-800 border-emerald-900'
                      : 'bg-rose-600 hover:bg-rose-700 border-rose-800'
                  }`}
                >
                  {currentIndex + 1 < exercises.length ? 'Tiếp tục' : 'Xem kết quả'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
