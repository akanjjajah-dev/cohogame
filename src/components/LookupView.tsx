import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  Keyboard,
  PenTool,
  Search,
  Turtle,
  Volume2,
  X,
} from 'lucide-react';
import { DictionaryEntry, EXCEL_DICTIONARY_ENTRIES } from '../data/seedData';
import { LessonItem } from '../shared/types';
import {
  normalizeCohoForSpeech,
  playTapSound,
  speakCohoText,
  speakVietnameseText,
} from '../lib/audio';
import { CohoKeyboard } from './CohoKeyboard';
import { HandwritingPad } from './HandwritingPad';

interface LookupViewProps {
  lessons: LessonItem[];
}

type LookupDirection = 'both' | 'coho_to_vi' | 'vi_to_coho';

interface EnrichedLookupEntry extends DictionaryEntry {
  audioUrl?: string;
  sourceLabel: string;
}

const CATEGORY_LABELS: Record<DictionaryEntry['category'], string> = {
  family: 'Gia đình & Con người',
  nature: 'Thiên nhiên & Loài vật',
  school: 'Trường học & Học tập',
  daily: 'Giao tiếp & Đời sống',
  culture: 'Văn hóa & Quê hương',
};

const QUICK_SUGGESTIONS = ['Àn', 'Me', 'Bắp', 'Dan să', 'Ngăc yơ', 'Brơn brăn', 'Hiu', 'Nước suối', 'Mạnh khỏe', 'Lễ hội'];

function stripAccents(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/ñ/g, 'nh');
}

function scoreMatch(text: string, query: string, queryPlain: string): number {
  const lower = text.toLowerCase();
  const plain = stripAccents(text);
  if (lower === query) return 100;
  if (plain === queryPlain) return 90;
  if (lower.startsWith(query)) return 75;
  if (plain.startsWith(queryPlain)) return 65;
  if (lower.includes(query)) return 50;
  if (plain.includes(queryPlain)) return 35;
  return 0;
}

export const LookupView: React.FC<LookupViewProps> = ({ lessons }) => {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<LookupDirection>('both');
  const [categoryFilter, setCategoryFilter] = useState<'all' | DictionaryEntry['category']>('all');
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<EnrichedLookupEntry | null>(null);
  const [practiceEntry, setPracticeEntry] = useState<EnrichedLookupEntry | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [, setHasDrawn] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Merge Excel dictionary + live lesson vocabulary (so newly imported Excel rows are immediately searchable)
  const allEntries = useMemo<EnrichedLookupEntry[]>(() => {
    const map = new Map<string, EnrichedLookupEntry>();

    for (const item of EXCEL_DICTIONARY_ENTRIES) {
      const key = `${item.coho.toLowerCase()}::${item.vietnamese.toLowerCase()}`;
      map.set(key, {
        ...item,
        sourceLabel: 'Từ điển Excel',
      });
    }

    for (const lesson of lessons) {
      for (const ex of lesson.exercises) {
        const coho = ex.cohoText?.trim();
        const vi = ex.vietnameseText?.trim();
        if (!coho || !vi || coho.length <= 1) continue;
        const key = `${coho.toLowerCase()}::${vi.toLowerCase()}`;
        if (!map.has(key)) {
          map.set(key, {
            coho,
            vietnamese: vi,
            category: lesson.level >= 5 ? 'culture' : lesson.level >= 3 ? 'daily' : 'school',
            level: lesson.level,
            phonetic: ex.phonetic || normalizeCohoForSpeech(coho),
            explanationVi: ex.hint || `Từ vựng nằm trong bài "${lesson.title}" (Cấp độ ${lesson.level}).`,
            explanationKoho: `Jonau bơsram: ${coho} — ${vi}.`,
            audioUrl: ex.audioUrl,
            sourceLabel: `Bài học Cấp ${lesson.level}`,
          });
        } else {
          const existing = map.get(key)!;
          if (ex.audioUrl && !existing.audioUrl) {
            existing.audioUrl = ex.audioUrl;
          }
          if (ex.phonetic && !existing.phonetic) {
            existing.phonetic = ex.phonetic;
          }
        }
      }
    }

    return Array.from(map.values());
  }, [lessons]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qPlain = stripAccents(q);

    const filtered = allEntries
      .filter((item) => (categoryFilter === 'all' ? true : item.category === categoryFilter))
      .map((item) => {
        if (!q) {
          return { item, score: 1, matchedBy: 'coho' as 'coho' | 'vi' };
        }
        const cohoScore = direction === 'vi_to_coho' ? 0 : scoreMatch(item.coho, q, qPlain);
        const viScore = direction === 'coho_to_vi' ? 0 : scoreMatch(item.vietnamese, q, qPlain);
        const best = Math.max(cohoScore, viScore);
        return {
          item,
          score: best,
          matchedBy: (cohoScore >= viScore ? 'coho' : 'vi') as 'coho' | 'vi',
        };
      })
      .filter((entry) => entry.score > 0);

    if (q) {
      filtered.sort((a, b) => b.score - a.score || a.item.level - b.item.level);
    }

    return filtered;
  }, [allEntries, query, direction, categoryFilter]);

  const activeDetail = selectedEntry || results[0]?.item || null;

  const handleSelectEntry = (entry: EnrichedLookupEntry) => {
    playTapSound();
    setSelectedEntry(entry);
    const term = entry.coho;
    setRecentQueries((prev) => [term, ...prev.filter((t) => t !== term)].slice(0, 6));
  };

  const handleSwapDirection = () => {
    playTapSound();
    setDirection((prev) =>
      prev === 'coho_to_vi' ? 'vi_to_coho' : prev === 'vi_to_coho' ? 'coho_to_vi' : 'coho_to_vi'
    );
  };

  const getVietnameseExplanation = (entry: EnrichedLookupEntry): string => {
    if (entry.explanationVi) return entry.explanationVi;
    return `Từ "${entry.coho}" thuộc chủ đề ${CATEGORY_LABELS[entry.category]} (Cấp độ ${entry.level}), mang nghĩa tiếng Việt là "${entry.vietnamese}".`;
  };

  const getKohoExplanation = (entry: EnrichedLookupEntry): string => {
    if (entry.explanationKoho) return entry.explanationKoho;
    return `Jonau K’Ho "${entry.coho}" (${entry.vietnamese}) — dùng tăm ${CATEGORY_LABELS[entry.category].toLowerCase()}.`;
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-stone-900 text-balance">
          Tra từ 2 chiều Cơ Ho ⇄ Tiếng Việt
        </h2>
        <p className="text-sm sm:text-base text-stone-600 max-w-2xl">
          Nhập từ tiếng Cơ Ho hoặc tiếng Việt (có dấu hoặc không dấu) để nghe phát âm và xem giải nghĩa song ngữ.
        </p>
      </div>

      {/* Direction Switcher & Search Box */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-stone-100 rounded-xl">
            {[
              { id: 'both', label: '2 chiều tự động' },
              { id: 'coho_to_vi', label: 'Cơ Ho → Việt' },
              { id: 'vi_to_coho', label: 'Việt → Cơ Ho' },
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  playTapSound();
                  setDirection(mode.id as LookupDirection);
                }}
                className={`px-3 py-2 text-xs sm:text-sm font-bold rounded-lg transition-colors min-h-[38px] whitespace-nowrap ${
                  direction === mode.id
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSwapDirection}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl min-h-[38px] whitespace-nowrap"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>Đảo chiều</span>
            </button>
            <button
              type="button"
              onClick={() => {
                playTapSound();
                setShowKeyboard((prev) => !prev);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl min-h-[38px] whitespace-nowrap border ${
                showKeyboard
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
              }`}
            >
              <Keyboard className="w-3.5 h-3.5" />
              <span>Phím Cơ Ho</span>
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="w-5 h-5 text-stone-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedEntry(null);
            }}
            placeholder={
              direction === 'coho_to_vi'
                ? 'Nhập từ tiếng Cơ Ho (ví dụ: Àn, Bắp, Dan să, Hục dă)...'
                : direction === 'vi_to_coho'
                  ? 'Nhập nghĩa tiếng Việt (ví dụ: Mẹ, Xin lỗi, Nước suối)...'
                  : 'Nhập tiếng Cơ Ho hoặc tiếng Việt để tra nhanh...'
            }
            className="w-full pl-11 pr-11 py-3.5 text-base font-medium bg-stone-50 border-2 border-stone-200 focus:bg-white focus:border-emerald-600 focus:outline-none rounded-2xl text-stone-900"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSelectedEntry(null);
                inputRef.current?.focus();
              }}
              aria-label="Xóa từ khóa tìm kiếm"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-stone-400 hover:text-stone-700 absolute right-2 top-1/2 -translate-y-1/2"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {showKeyboard && (
          <CohoKeyboard
            onInsert={(char) => {
              setQuery((prev) => prev + char);
              inputRef.current?.focus();
            }}
            onBackspace={() => {
              setQuery((prev) => prev.slice(0, -1));
              inputRef.current?.focus();
            }}
          />
        )}

        {/* Quick Tap Suggestions & Recent Lookups */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs font-semibold text-stone-500 mr-1">
            {recentQueries.length > 0 ? 'Vừa tra:' : 'Tra nhanh:'}
          </span>
          {(recentQueries.length > 0 ? recentQueries : QUICK_SUGGESTIONS).map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => {
                playTapSound();
                setQuery(term);
                setSelectedEntry(null);
              }}
              className="px-3 py-1.5 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-emerald-50 hover:text-emerald-800 rounded-lg transition-colors min-h-[34px]"
            >
              {term}
            </button>
          ))}
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-stone-100 rounded-xl w-full sm:w-fit">
        <button
          type="button"
          onClick={() => {
            playTapSound();
            setCategoryFilter('all');
          }}
          className={`px-3 py-2 text-xs font-semibold rounded-lg min-h-[38px] whitespace-nowrap ${
            categoryFilter === 'all' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
          }`}
        >
          Tất cả ({allEntries.length})
        </button>
        {(Object.keys(CATEGORY_LABELS) as DictionaryEntry['category'][]).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => {
              playTapSound();
              setCategoryFilter(cat);
            }}
            className={`px-3 py-2 text-xs font-semibold rounded-lg min-h-[38px] whitespace-nowrap ${
              categoryFilter === cat ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Two-Column Lookup Workspace: Result List + Featured Bilingual Detail Card */}
      {results.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center space-y-2">
          <div className="text-base font-bold text-stone-800">
            Không tìm thấy từ phù hợp với "{query}"
          </div>
          <p className="text-sm text-stone-500">
            Thử chuyển sang chế độ "2 chiều tự động" hoặc gõ không dấu để mở rộng kết quả.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Active Detail Card (First on mobile for instant clarity, sticky right on desktop) */}
          {activeDetail && (
            <div className="lg:col-span-7 lg:order-2 bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 space-y-5 lg:sticky lg:top-6">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-stone-500">
                  {CATEGORY_LABELS[activeDetail.category]} · Cấp độ {activeDetail.level}
                  {activeDetail.partOfSpeech ? ` · ${activeDetail.partOfSpeech}` : ''}
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
                  <h3 className="text-3xl sm:text-4xl font-extrabold text-emerald-800">
                    {activeDetail.coho}
                  </h3>
                  <span className="text-xs font-mono text-stone-500">
                    /{activeDetail.phonetic || normalizeCohoForSpeech(activeDetail.coho)}/
                  </span>
                </div>
                <div className="text-xl font-bold text-stone-900 pt-1">
                  {activeDetail.vietnamese}
                </div>
              </div>

              {/* Pronunciation Buttons (Both K'Ho & Vietnamese) */}
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    speakCohoText(activeDetail.coho, {
                      audioUrl: activeDetail.audioUrl,
                      phonetic: activeDetail.phonetic,
                    })
                  }
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl border-b-3 border-emerald-900 active:translate-y-0.5 min-h-[44px]"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>Nghe tiếng Cơ Ho</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    speakCohoText(activeDetail.coho, {
                      audioUrl: activeDetail.audioUrl,
                      phonetic: activeDetail.phonetic,
                      slow: true,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold text-stone-800 bg-stone-100 hover:bg-stone-200 rounded-xl min-h-[44px]"
                >
                  <Turtle className="w-4 h-4 text-emerald-700" />
                  <span>Nghe chậm</span>
                </button>

                <button
                  type="button"
                  onClick={() => speakVietnameseText(activeDetail.vietnamese)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold text-sky-900 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl min-h-[44px]"
                >
                  <Volume2 className="w-4 h-4 text-sky-700" />
                  <span>Nghe tiếng Việt</span>
                </button>
              </div>

              {/* Bilingual Explanations */}
              <div className="space-y-3 pt-2 border-t border-stone-200">
                <div className="bg-stone-50 border border-stone-200 rounded-2xl p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-stone-700">
                      Giải nghĩa bằng tiếng Việt
                    </span>
                    <button
                      type="button"
                      onClick={() => speakVietnameseText(getVietnameseExplanation(activeDetail))}
                      aria-label="Nghe giải nghĩa tiếng Việt"
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Đọc</span>
                    </button>
                  </div>
                  <p className="text-sm text-stone-800 leading-relaxed">
                    {getVietnameseExplanation(activeDetail)}
                  </p>
                </div>

                <div className="bg-emerald-50/60 border border-emerald-200 rounded-2xl p-4 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-extrabold text-emerald-900">
                      Giải nghĩa & Ngữ cảnh bằng tiếng Cơ Ho
                    </span>
                    <button
                      type="button"
                      onClick={() => speakCohoText(getKohoExplanation(activeDetail))}
                      aria-label="Nghe giải nghĩa tiếng Cơ Ho"
                      className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Nghe</span>
                    </button>
                  </div>
                  <p className="text-sm font-semibold text-emerald-950 leading-relaxed">
                    {getKohoExplanation(activeDetail)}
                  </p>
                </div>

                {activeDetail.exampleKoho && (
                  <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-extrabold text-amber-900 inline-flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Câu ví dụ song ngữ</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => speakCohoText(activeDetail.exampleKoho!)}
                        className="text-xs font-semibold text-amber-800 hover:text-amber-950 inline-flex items-center gap-1"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>Nghe câu</span>
                      </button>
                    </div>
                    <div className="text-sm font-bold text-stone-900">{activeDetail.exampleKoho}</div>
                    {activeDetail.exampleVi && (
                      <div className="text-xs text-stone-700">{activeDetail.exampleVi}</div>
                    )}
                  </div>
                )}
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    playTapSound();
                    setPracticeEntry(activeDetail);
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-bold text-stone-800 bg-stone-100 hover:bg-stone-200 rounded-xl min-h-[44px]"
                >
                  <PenTool className="w-4 h-4" />
                  <span>Tập viết từ "{activeDetail.coho}" trên bảng ô ly</span>
                </button>
              </div>
            </div>
          )}

          {/* Scrollable Search Results List */}
          <div className="lg:col-span-5 lg:order-1 space-y-2.5">
            <div className="text-xs font-semibold text-stone-500 tabular-nums px-1">
              Tìm thấy {results.length} kết quả · Chạm để xem giải nghĩa
            </div>
            <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
              {results.slice(0, 60).map(({ item, matchedBy }) => {
                const isSelected =
                  activeDetail?.coho === item.coho && activeDetail?.vietnamese === item.vietnamese;
                return (
                  <div
                    key={`${item.coho}-${item.vietnamese}`}
                    className={`rounded-2xl border p-3.5 flex items-center justify-between gap-3 transition-colors ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-500'
                        : 'bg-white border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectEntry(item)}
                      className="text-left flex-1 min-w-0 space-y-0.5"
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-base font-extrabold text-emerald-800 truncate">
                          {item.coho}
                        </span>
                        <span className="text-[11px] text-stone-400 shrink-0">
                          {matchedBy === 'vi' ? 'Việt → Cơ Ho' : 'Cơ Ho → Việt'}
                        </span>
                      </div>
                      <div className="text-sm font-medium text-stone-700 truncate">
                        {item.vietnamese}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        speakCohoText(item.coho, {
                          audioUrl: item.audioUrl,
                          phonetic: item.phonetic,
                        })
                      }
                      aria-label={`Nghe phát âm ${item.coho}`}
                      className="w-10 h-10 rounded-xl bg-white border border-stone-200 hover:border-emerald-300 text-emerald-700 flex items-center justify-center shrink-0"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Handwriting Practice Modal */}
      {practiceEntry && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-[#FAF9F5] w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-stone-200 p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-stone-900">
                  Tập viết: "{practiceEntry.coho}"
                </h3>
                <p className="text-xs text-stone-600">
                  Nghĩa tiếng Việt: {practiceEntry.vietnamese}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPracticeEntry(null)}
                aria-label="Đóng bảng tập viết"
                className="w-10 h-10 rounded-xl bg-white border border-stone-200 flex items-center justify-center text-stone-600 hover:text-stone-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <HandwritingPad
              templateText={practiceEntry.coho}
              onDrawnChange={setHasDrawn}
            />

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() =>
                  speakCohoText(practiceEntry.coho, {
                    audioUrl: practiceEntry.audioUrl,
                    phonetic: practiceEntry.phonetic,
                  })
                }
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 min-h-[44px]"
              >
                <Volume2 className="w-4 h-4" />
                <span>Nghe phát âm</span>
              </button>
              <button
                type="button"
                onClick={() => setPracticeEntry(null)}
                className="px-5 py-2.5 text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl min-h-[44px]"
              >
                Xong
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
