import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileSpreadsheet,
  Keyboard,
  Mic,
  PenTool,
  RotateCcw,
  Search,
  Square,
  Trash2,
  Turtle,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import { DictionaryEntry, EXCEL_DICTIONARY_ENTRIES } from '../data/seedData';
import { LessonItem } from '../shared/types';
import {
  COHO_DIALECTS,
  CohoDialect,
  getCohoPronunciationGuide,
  getCustomAudioForWord,
  getSelectedDialect,
  LAM_DONG_AUDIO_SOURCES,
  playTapSound,
  removeCustomAudioForWord,
  saveCustomAudioForWord,
  setSelectedDialect,
  speakCohoText,
  speakVietnameseText,
} from '../lib/audio';
import { parseDictionaryExcelFile } from '../lib/excel';
import { CohoKeyboard } from './CohoKeyboard';
import { HandwritingPad } from './HandwritingPad';

interface LookupViewProps {
  lessons: LessonItem[];
}

type LookupDirection = 'both' | 'coho_to_vi' | 'vi_to_coho';

interface EnrichedLookupEntry extends DictionaryEntry {
  sourcePriority: 1 | 2 | 3; // 3: uploaded Excel, 2: user's built-in Excel, 1: lesson
  sourceLabel: string;
}

const CUSTOM_DICT_KEY = 'coho_custom_excel_dictionary';

const CATEGORY_LABELS: Record<DictionaryEntry['category'], string> = {
  family: 'Gia đình & Con người',
  nature: 'Thiên nhiên & Loài vật',
  school: 'Trường học & Học tập',
  daily: 'Giao tiếp & Đời sống',
  culture: 'Văn hóa & Quê hương',
};

const QUICK_SUGGESTIONS = [
  'Àn',
  'Me',
  'Bắp',
  'Cau cil',
  'Dan să',
  'Ngăc yơ',
  'Brơn brăn',
  'Dà nhông (croh)',
  'Lòt',
  'Bonăr',
];

function readUploadedExcelDict(): DictionaryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_DICT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

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
  const [dialect, setDialect] = useState<CohoDialect>(getSelectedDialect);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<EnrichedLookupEntry | null>(null);
  const [practiceEntry, setPracticeEntry] = useState<EnrichedLookupEntry | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [uploadedEntries, setUploadedEntries] = useState<DictionaryEntry[]>(readUploadedExcelDict);
  const [excelNotice, setExcelNotice] = useState<string | null>(null);

  // Native audio upload/record state per selected entry
  const [showAudioEditor, setShowAudioEditor] = useState(false);
  const [customAudioInput, setCustomAudioInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [audioVersion, setAudioVersion] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const [, setHasDrawn] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Merge strictly prioritizing: 1) Uploaded Excel file -> 2) User's provided Excel sheet -> 3) Lessons
  const allEntries = useMemo<EnrichedLookupEntry[]>(() => {
    const map = new Map<string, EnrichedLookupEntry>();

    // Priority 3: Newly uploaded Excel file
    for (const item of uploadedEntries) {
      const key = `${item.coho.toLowerCase()}::${item.vietnamese.toLowerCase()}`;
      map.set(key, {
        ...item,
        sourcePriority: 3,
        sourceLabel: 'File Excel vừa nạp',
      });
    }

    // Priority 2: Built-in dictionary extracted directly from the user's Excel file
    for (const item of EXCEL_DICTIONARY_ENTRIES) {
      const key = `${item.coho.toLowerCase()}::${item.vietnamese.toLowerCase()}`;
      if (!map.has(key)) {
        map.set(key, {
          ...item,
          sourcePriority: 2,
          sourceLabel: 'Từ điển Excel cung cấp',
        });
      }
    }

    // Priority 1: Supplementary vocabulary from lessons
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
            phonetic: ex.phonetic,
            explanationVi: ex.hint || `Từ vựng trong bài "${lesson.title}" (Cấp độ ${lesson.level}).`,
            explanationKoho: `Jonau bơsram: ${coho} — ${vi}.`,
            audioUrl: ex.audioUrl,
            source: 'lesson',
            sourcePriority: 1,
            sourceLabel: `Bài học Cấp ${lesson.level}`,
          });
        } else {
          const existing = map.get(key)!;
          if (ex.audioUrl && !existing.audioUrl) existing.audioUrl = ex.audioUrl;
          if (ex.phonetic && !existing.phonetic) existing.phonetic = ex.phonetic;
        }
      }
    }

    return Array.from(map.values());
  }, [uploadedEntries, lessons]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qPlain = stripAccents(q);

    const filtered = allEntries
      .filter((item) => (categoryFilter === 'all' ? true : item.category === categoryFilter))
      .map((item) => {
        if (!q) {
          return { item, score: item.sourcePriority * 10, matchedBy: 'coho' as 'coho' | 'vi' };
        }
        const cohoScore = direction === 'vi_to_coho' ? 0 : scoreMatch(item.coho, q, qPlain);
        const viScore = direction === 'coho_to_vi' ? 0 : scoreMatch(item.vietnamese, q, qPlain);
        const baseScore = Math.max(cohoScore, viScore);
        // Prioritize Excel dictionary items when scores tie or are close
        const boosted = baseScore > 0 ? baseScore + item.sourcePriority * 8 : 0;
        return {
          item,
          score: boosted,
          matchedBy: (cohoScore >= viScore ? 'coho' : 'vi') as 'coho' | 'vi',
        };
      })
      .filter((entry) => entry.score > 0);

    if (q) {
      filtered.sort((a, b) => b.score - a.score || b.item.sourcePriority - a.item.sourcePriority);
    } else {
      filtered.sort((a, b) => b.item.sourcePriority - a.item.sourcePriority || a.item.level - b.item.level);
    }

    return filtered;
  }, [allEntries, query, direction, categoryFilter]);

  const activeDetail = selectedEntry || results[0]?.item || null;

  const pronunciationGuide = useMemo(() => {
    if (!activeDetail) return null;
    return getCohoPronunciationGuide(activeDetail.coho, dialect, activeDetail.phonetic);
  }, [activeDetail, dialect]);

  const activeCustomAudio = useMemo(() => {
    void audioVersion;
    if (!activeDetail) return undefined;
    return getCustomAudioForWord(activeDetail.coho) || activeDetail.audioUrl;
  }, [activeDetail, audioVersion]);

  const handleSelectDialect = (next: CohoDialect) => {
    playTapSound();
    setDialect(next);
    setSelectedDialect(next);
  };

  const handleSelectEntry = (entry: EnrichedLookupEntry) => {
    playTapSound();
    setSelectedEntry(entry);
    setShowAudioEditor(false);
    setCustomAudioInput(getCustomAudioForWord(entry.coho) || entry.audioUrl || '');
    const term = entry.coho;
    setRecentQueries((prev) => [term, ...prev.filter((t) => t !== term)].slice(0, 6));
  };

  const handleSwapDirection = () => {
    playTapSound();
    setDirection((prev) =>
      prev === 'coho_to_vi' ? 'vi_to_coho' : prev === 'vi_to_coho' ? 'coho_to_vi' : 'coho_to_vi'
    );
  };

  const handleUploadDictionaryExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExcelNotice(null);
    try {
      const { entries } = await parseDictionaryExcelFile(file);
      if (entries.length === 0) {
        setExcelNotice('Không tìm thấy cột từ vựng hợp lệ (Tiếng K’Ho | Nghĩa tiếng Việt) trong file.');
        return;
      }
      window.localStorage.setItem(CUSTOM_DICT_KEY, JSON.stringify(entries));
      setUploadedEntries(entries);
      setSelectedEntry(null);
      setExcelNotice(`Đã ưu tiên nạp ${entries.length} từ từ file "${file.name}" vào đầu danh sách tra cứu.`);
    } catch {
      setExcelNotice('Không thể đọc file Excel này. Vui lòng dùng định dạng .xlsx, .xls hoặc .csv.');
    } finally {
      e.target.value = '';
    }
  };

  const handleResetUploadedExcel = () => {
    playTapSound();
    window.localStorage.removeItem(CUSTOM_DICT_KEY);
    setUploadedEntries([]);
    setExcelNotice('Đã quay lại sử dụng bộ từ điển Excel chuẩn được cung cấp.');
  };

  const handleToggleRecording = async () => {
    if (!activeDetail) return;
    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setExcelNotice('Trình duyệt hiện tại không hỗ trợ ghi âm micro.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            saveCustomAudioForWord(activeDetail.coho, reader.result);
            setCustomAudioInput(reader.result);
            setAudioVersion((v) => v + 1);
          }
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setExcelNotice('Chưa được cấp quyền micro để ghi âm phát âm bản xứ.');
    }
  };

  const handleSaveAudioUrl = () => {
    if (!activeDetail) return;
    const clean = customAudioInput.trim();
    if (!clean) return;
    saveCustomAudioForWord(activeDetail.coho, clean);
    setAudioVersion((v) => v + 1);
    setShowAudioEditor(false);
  };

  const handleDeleteCustomAudio = () => {
    if (!activeDetail) return;
    removeCustomAudioForWord(activeDetail.coho);
    setCustomAudioInput('');
    setAudioVersion((v) => v + 1);
  };

  const getVietnameseExplanation = (entry: EnrichedLookupEntry): string => {
    if (entry.explanationVi) return entry.explanationVi;
    return `Từ "${entry.coho}" thuộc nhóm ${CATEGORY_LABELS[entry.category]} trong bảng từ điển Excel, mang nghĩa tiếng Việt là "${entry.vietnamese}".`;
  };

  const getKohoExplanation = (entry: EnrichedLookupEntry): string => {
    if (entry.explanationKoho) return entry.explanationKoho;
    return `Jonau K’Ho "${entry.coho}" — mblăng dà yuan lah "${entry.vietnamese}".`;
  };

  const activeDialectMeta = COHO_DIALECTS[dialect];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-stone-900 text-balance">
            Tra từ 2 chiều Cơ Ho ⇄ Tiếng Việt
          </h2>
          <p className="text-sm sm:text-base text-stone-600 max-w-2xl">
            Ưu tiên {allEntries.length} mục từ trong file Excel của bạn · Phát âm theo phương ngữ Lâm Đồng ({activeDialectMeta.shortLabel}).
          </p>
        </div>

        {/* Direct Excel Dictionary Upload Button */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl cursor-pointer min-h-[42px] whitespace-nowrap">
            <Upload className="w-4 h-4" />
            <span>Nạp file Excel từ điển</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleUploadDictionaryExcel}
              className="sr-only"
            />
          </label>
          {uploadedEntries.length > 0 && (
            <button
              type="button"
              onClick={handleResetUploadedExcel}
              title="Xóa file vừa nạp và dùng lại bảng Excel gốc"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl min-h-[42px] whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Dùng Excel gốc</span>
            </button>
          )}
        </div>
      </div>

      {excelNotice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{excelNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setExcelNotice(null)}
            className="text-emerald-700 hover:text-emerald-950 p-1"
            aria-label="Đóng thông báo"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Lâm Đồng Dialect Switcher & Reference Sources */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-extrabold text-stone-800">
            Phương ngữ phát âm chuẩn tỉnh Lâm Đồng
          </div>
          <button
            type="button"
            onClick={() => setShowSources((prev) => !prev)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900"
          >
            <span>Nguồn chuẩn Cil · Lạch · Mạ · Srê</span>
            {showSources ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(Object.keys(COHO_DIALECTS) as CohoDialect[]).map((code) => {
            const meta = COHO_DIALECTS[code];
            const active = dialect === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => handleSelectDialect(code)}
                className={`text-left px-3 py-2.5 rounded-xl border transition-colors min-h-[44px] ${
                  active
                    ? 'bg-emerald-50 border-emerald-600 text-emerald-950'
                    : 'bg-stone-50 border-stone-200 text-stone-700 hover:border-stone-300'
                }`}
              >
                <div className="text-xs font-extrabold whitespace-nowrap">{meta.shortLabel}</div>
                <div className="text-[11px] text-stone-500 truncate mt-0.5">{meta.region}</div>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-stone-600 leading-relaxed">
          <span className="font-bold text-stone-800">{activeDialectMeta.name}:</span> {activeDialectMeta.standardSummary}
        </p>

        {showSources && (
          <div className="pt-3 border-t border-stone-200 space-y-2.5">
            <div className="text-xs font-bold text-stone-800">
              Các nguồn tra cứu & âm thanh bản xứ chuẩn tỉnh Lâm Đồng:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {LAM_DONG_AUDIO_SOURCES.map((src) => (
                <a
                  key={src.url}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-stone-50 hover:bg-emerald-50/60 border border-stone-200 hover:border-emerald-300 rounded-xl p-3 flex items-start justify-between gap-2 transition-colors"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-xs font-bold text-emerald-800">{src.name}</div>
                    <div className="text-[11px] text-stone-600 leading-snug">{src.description}</div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
                </a>
              ))}
            </div>
            <div className="text-[11px] text-stone-500 leading-relaxed">
              Lưu ý kỹ thuật: Hiện các trình duyệt chưa tích hợp sẵn giọng đọc máy bản địa riêng cho mã ngôn ngữ Cơ Ho (kpm), nên công cụ sử dụng quy tắc chuyển tự âm vị học Lâm Đồng (Srê / Cil / Lạch / Mạ) kết hợp giọng đọc tiếng Việt để mô phỏng, đồng thời cho phép bạn ghi âm hoặc gắn trực tiếp file âm thanh bản xứ cho từng từ.
            </div>
          </div>
        )}
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
                ? 'Nhập từ tiếng Cơ Ho trong Excel (ví dụ: Àn, Cau cil, Mpông, Ndùl)...'
                : direction === 'vi_to_coho'
                  ? 'Nhập nghĩa tiếng Việt (ví dụ: Mẹ, Già làng, Bình yên, Nước suối)...'
                  : 'Nhập tiếng Cơ Ho hoặc tiếng Việt (có dấu hoặc không dấu)...'
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

      {/* Two-Column Lookup Workspace */}
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
          {/* Active Detail Card */}
          {activeDetail && pronunciationGuide && (
            <div className="lg:col-span-7 lg:order-2 bg-white border border-stone-200 rounded-3xl p-5 sm:p-6 space-y-5 lg:sticky lg:top-6">
              <div className="space-y-1">
                <div className="text-xs font-semibold text-stone-500">
                  {activeDetail.sourceLabel} · {CATEGORY_LABELS[activeDetail.category]}
                  {activeDetail.partOfSpeech ? ` · ${activeDetail.partOfSpeech}` : ''}
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
                  <h3 className="text-3xl sm:text-4xl font-extrabold text-emerald-800">
                    {activeDetail.coho}
                  </h3>
                  <span className="text-xs font-mono text-stone-500">
                    {pronunciationGuide.ipaApprox}
                  </span>
                </div>
                <div className="text-xl font-bold text-stone-900 pt-1">
                  {activeDetail.vietnamese}
                </div>
              </div>

              {/* Phonetic & Dialect Guide */}
              <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3.5 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-stone-800">
                    Cách đọc ({activeDialectMeta.shortLabel}):{' '}
                    <span className="font-mono text-emerald-800">/{pronunciationGuide.readableVi}/</span>
                  </span>
                  {activeCustomAudio && (
                    <span className="text-[11px] font-bold text-emerald-700">
                      Đang dùng âm thanh bản xứ
                    </span>
                  )}
                </div>
                <ul className="text-xs text-stone-600 space-y-0.5 list-disc list-inside">
                  {pronunciationGuide.phoneticNotes.map((note, idx) => (
                    <li key={idx}>{note}</li>
                  ))}
                </ul>
              </div>

              {/* Pronunciation Buttons */}
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    speakCohoText(activeDetail.coho, {
                      audioUrl: activeDetail.audioUrl,
                      phonetic: activeDetail.phonetic,
                      dialect,
                    })
                  }
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl border-b-3 border-emerald-900 active:translate-y-0.5 min-h-[44px]"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>Nghe ({activeDialectMeta.shortLabel})</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    speakCohoText(activeDetail.coho, {
                      audioUrl: activeDetail.audioUrl,
                      phonetic: activeDetail.phonetic,
                      dialect,
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

                <button
                  type="button"
                  onClick={() => setShowAudioEditor((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-xl min-h-[44px]"
                >
                  <Mic className="w-3.5 h-3.5 text-amber-600" />
                  <span>Ghi âm bản xứ</span>
                </button>
              </div>

              {/* Custom Native Audio Attachment / Recorder */}
              {showAudioEditor && (
                <div className="bg-amber-50/60 border border-amber-200 rounded-2xl p-4 space-y-3">
                  <div className="text-xs font-bold text-amber-950">
                    Gắn giọng phát âm chuẩn Lâm Đồng (Cil · Lạch · Mạ · Srê) cho từ "{activeDetail.coho}"
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleRecording}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl min-h-[38px] ${
                        isRecording
                          ? 'bg-rose-600 text-white'
                          : 'bg-white border border-amber-300 text-amber-900 hover:bg-amber-100'
                      }`}
                    >
                      {isRecording ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                      <span>{isRecording ? 'Dừng & lưu ghi âm' : 'Ghi âm trực tiếp'}</span>
                    </button>

                    {activeCustomAudio && (
                      <button
                        type="button"
                        onClick={handleDeleteCustomAudio}
                        className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 rounded-xl min-h-[38px]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Xóa âm thanh gắn</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      value={customAudioInput.startsWith('data:') ? '' : customAudioInput}
                      onChange={(e) => setCustomAudioInput(e.target.value)}
                      placeholder="Hoặc dán link file .mp3 / .wav phát âm chuẩn..."
                      className="flex-1 px-3 py-2 text-xs bg-white border border-amber-200 rounded-xl focus:outline-none focus:border-emerald-600"
                    />
                    <button
                      type="button"
                      onClick={handleSaveAudioUrl}
                      className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl min-h-[36px]"
                    >
                      Lưu link
                    </button>
                  </div>
                </div>
              )}

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
                      onClick={() =>
                        speakCohoText(getKohoExplanation(activeDetail), { dialect })
                      }
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
                        onClick={() => speakCohoText(activeDetail.exampleKoho!, { dialect })}
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
              Tìm thấy {results.length} kết quả (ưu tiên file Excel) · Chạm để xem chi tiết
            </div>
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {results.slice(0, 80).map(({ item, matchedBy }, idx) => {
                const isSelected =
                  activeDetail?.coho === item.coho && activeDetail?.vietnamese === item.vietnamese;
                return (
                  <div
                    key={`${item.coho}-${item.vietnamese}-${idx}`}
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
                          dialect,
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
                    dialect,
                  })
                }
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 min-h-[44px]"
              >
                <Volume2 className="w-4 h-4" />
                <span>Nghe phát âm ({activeDialectMeta.shortLabel})</span>
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
