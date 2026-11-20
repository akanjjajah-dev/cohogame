import React from 'react';
import { COHO_SPECIAL_KEYS } from '../data/seedData';
import { playTapSound } from '../lib/audio';

interface CohoKeyboardProps {
  onInsert: (char: string) => void;
  onBackspace?: () => void;
}

export const CohoKeyboard: React.FC<CohoKeyboardProps> = ({ onInsert, onBackspace }) => {
  return (
    <div className="bg-stone-100/90 border border-stone-200 rounded-2xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-stone-600">
          Bàn phím ký tự Cơ Ho nhanh (bấm để chèn)
        </span>
        {onBackspace && (
          <button
            type="button"
            onClick={() => {
              playTapSound();
              onBackspace();
            }}
            className="px-2.5 py-1 text-xs font-semibold text-stone-700 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 active:scale-95 transition-transform"
          >
            Xóa 1 ký tự
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {COHO_SPECIAL_KEYS.map((char) => (
          <button
            key={char}
            type="button"
            onClick={() => {
              playTapSound();
              onInsert(char);
            }}
            className="min-w-[40px] min-h-[40px] px-2.5 py-1.5 text-base font-bold text-stone-900 bg-white border border-stone-200 border-b-2 rounded-xl hover:bg-emerald-50 hover:border-emerald-300 active:translate-y-0.5 transition-all"
          >
            {char}
          </button>
        ))}
      </div>
    </div>
  );
};
