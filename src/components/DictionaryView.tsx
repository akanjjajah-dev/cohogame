import React, { useMemo, useState } from 'react';
import { PenTool, Search, Volume2, X } from 'lucide-react';
import { DictionaryEntry, EXCEL_DICTIONARY_ENTRIES } from '../data/seedData';
import { playTapSound, speakCohoText } from '../lib/audio';
import { HandwritingPad } from './HandwritingPad';

const CATEGORY_TABS: { id: 'all' | DictionaryEntry['category']; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'family', label: 'Gia đình & Cơ thể' },
  { id: 'nature', label: 'Thiên nhiên & Con vật' },
  { id: 'school', label: 'Trường học' },
  { id: 'daily', label: 'Giao tiếp & Thời gian' },
  { id: 'culture', label: 'Văn hóa' },
];

export const DictionaryView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | DictionaryEntry['category']>('all');
  const [practiceEntry, setPracticeEntry] = useState<DictionaryEntry | null>(null);
  const [, setHasDrawn] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EXCEL_DICTIONARY_ENTRIES.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!q) return true;
      return (
        item.coho.toLowerCase().includes(q) ||
        item.vietnamese.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  return (
    <div className="space-y-5">
      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm từ tiếng K’Ho hoặc tiếng Việt (ví dụ: Mẹ, Bắp, Hiu, Lòt)..."
          className="w-full pl-10 pr-4 py-3 text-sm bg-white border border-stone-200 focus:border-emerald-600 focus:outline-none rounded-2xl text-stone-900"
        />
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-stone-100 rounded-xl w-full sm:w-fit">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              playTapSound();
              setCategory(tab.id);
            }}
            className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors min-h-[38px] whitespace-nowrap ${
              category === tab.id
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="text-xs font-medium text-stone-500 tabular-nums">
        Hiển thị {filtered.length}/{EXCEL_DICTIONARY_ENTRIES.length} từ vựng trích từ bảng Excel
      </div>

      {/* Vocabulary Cards */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-sm text-stone-500">
          Không tìm thấy từ phù hợp với "{query}".
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {filtered.map((item) => (
            <div
              key={`${item.coho}-${item.vietnamese}`}
              className="bg-white border border-stone-200 rounded-2xl p-4 flex flex-col justify-between gap-3 hover:border-emerald-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-extrabold text-emerald-800">{item.coho}</div>
                  <div className="text-sm font-medium text-stone-700 mt-0.5">{item.vietnamese}</div>
                  <div className="text-[11px] text-stone-400 font-medium mt-1">
                    Cấp độ {item.level}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => speakCohoText(item.coho)}
                  aria-label={`Nghe từ ${item.coho}`}
                  className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 flex items-center justify-center shrink-0"
                >
                  <Volume2 className="w-5 h-5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  playTapSound();
                  setPracticeEntry(item);
                }}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-stone-700 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-xl min-h-[38px]"
              >
                <PenTool className="w-3.5 h-3.5" />
                <span>Tập viết từ này</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Word Handwriting Modal */}
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
                onClick={() => speakCohoText(practiceEntry.coho)}
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
