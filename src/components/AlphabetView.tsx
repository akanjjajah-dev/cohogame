import React, { useState } from 'react';
import { Volume2, PenTool, X } from 'lucide-react';
import { COHO_ALPHABET, EXCEL_DICTIONARY_ENTRIES } from '../data/seedData';
import { speakCohoText, playTapSound } from '../lib/audio';
import { AlphabetEntry } from '../shared/types';
import { HandwritingPad } from './HandwritingPad';
import { DictionaryView } from './DictionaryView';

export const AlphabetView: React.FC = () => {
  const [section, setSection] = useState<'alphabet' | 'dictionary'>('alphabet');
  const [filter, setFilter] = useState<'all' | 'vowel' | 'special_consonant' | 'consonant'>('all');
  const [activePracticeChar, setActivePracticeChar] = useState<AlphabetEntry | null>(null);
  const [, setHasDrawn] = useState(false);

  const filtered = COHO_ALPHABET.filter((item) =>
    filter === 'all' ? true : item.category === filter
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-stone-900 text-balance">
            Bảng chữ cái & Từ điển K’Ho
          </h2>
          <p className="text-sm sm:text-base text-stone-600 max-w-2xl">
            Bấm vào chữ cái hoặc từ vựng để nghe phát âm và tập viết trực tiếp trên bảng ô ly.
          </p>
        </div>

        {/* Section Switch: Alphabet vs Excel Dictionary */}
        <div className="flex items-center gap-1.5 p-1.5 bg-stone-200/70 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => {
              playTapSound();
              setSection('alphabet');
            }}
            className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors min-h-[40px] whitespace-nowrap ${
              section === 'alphabet'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Bảng chữ cái ({COHO_ALPHABET.length})
          </button>
          <button
            type="button"
            onClick={() => {
              playTapSound();
              setSection('dictionary');
            }}
            className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors min-h-[40px] whitespace-nowrap ${
              section === 'dictionary'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Từ điển Excel ({EXCEL_DICTIONARY_ENTRIES.length} từ)
          </button>
        </div>
      </div>

      {section === 'dictionary' ? (
        <DictionaryView />
      ) : (
        <>
          {/* Category Filter Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-stone-100 rounded-xl w-fit">
            {[
              { id: 'all', label: `Tất cả (${COHO_ALPHABET.length})` },
              { id: 'vowel', label: 'Nguyên âm' },
              { id: 'special_consonant', label: 'Ký tự đặc biệt' },
              { id: 'consonant', label: 'Phụ âm' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  playTapSound();
                  setFilter(tab.id as typeof filter);
                }}
                className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors min-h-[40px] whitespace-nowrap ${
                  filter === tab.id
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Alphabet Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {filtered.map((entry) => (
              <div
                key={entry.char}
                className="bg-white border border-stone-200 rounded-2xl p-4 flex flex-col justify-between gap-3 hover:border-emerald-300 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => speakCohoText(entry.exampleWord)}
                  className="text-left group space-y-2 w-full"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-4xl font-extrabold text-emerald-700 group-hover:scale-105 transition-transform inline-block">
                      {entry.char}
                    </span>
                    <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center group-hover:bg-emerald-100 transition-colors shrink-0">
                      <Volume2 className="w-5 h-5" />
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-stone-900">
                      {entry.exampleWord}{' '}
                      <span className="font-normal text-stone-500">· {entry.exampleMeaning}</span>
                    </div>
                    <p className="text-xs text-stone-600 mt-1 line-clamp-2">{entry.soundGuide}</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playTapSound();
                    setActivePracticeChar(entry);
                  }}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-semibold text-stone-700 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-xl transition-colors min-h-[40px]"
                >
                  <PenTool className="w-3.5 h-3.5" />
                  <span>Tập viết chữ {entry.char}</span>
                </button>
              </div>
            ))}
          </div>

          {/* Handwriting Modal */}
          {activePracticeChar && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
              <div className="bg-[#FAF9F5] w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-stone-200 p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-stone-900">
                      Tập viết chữ "{activePracticeChar.char}"
                    </h3>
                    <p className="text-xs text-stone-600">
                      Ví dụ: {activePracticeChar.exampleWord} ({activePracticeChar.exampleMeaning})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActivePracticeChar(null)}
                    aria-label="Đóng bảng tập viết"
                    className="w-10 h-10 rounded-xl bg-white border border-stone-200 flex items-center justify-center text-stone-600 hover:text-stone-900"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <HandwritingPad
                  templateText={activePracticeChar.char}
                  onDrawnChange={setHasDrawn}
                />

                <div className="flex items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => speakCohoText(activePracticeChar.exampleWord)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 min-h-[44px]"
                  >
                    <Volume2 className="w-4 h-4" />
                    <span>Nghe phát âm</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePracticeChar(null)}
                    className="px-5 py-2.5 text-sm font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl min-h-[44px]"
                  >
                    Xong
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
