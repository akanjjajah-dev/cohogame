import React, { useState } from 'react';
import { BookOpen, Eye, Headphones, PenTool, Play } from 'lucide-react';
import { DifficultyLevel, LessonItem, SkillType } from '../shared/types';
import { playTapSound } from '../lib/audio';

interface SkillPracticeViewProps {
  lessons: LessonItem[];
  isAuthenticated: boolean;
  onRequireAuth: () => void;
  onStartCustomLesson: (lesson: LessonItem) => void;
}

const SKILLS: {
  id: SkillType;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
}[] = [
  {
    id: 'recognize',
    title: 'Nhận biết chữ Cơ Ho',
    description: 'Phân biệt mặt chữ, nguyên âm đặc biệt và nghĩa tiếng Việt.',
    icon: Eye,
    accentClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  {
    id: 'listen',
    title: 'Nghe tiếng Cơ Ho',
    description: 'Nghe phát âm chuẩn & tốc độ chậm rồi chọn đáp án đúng.',
    icon: Headphones,
    accentClass: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  {
    id: 'read',
    title: 'Đọc chữ & Ghép câu',
    description: 'Đọc thành tiếng theo phiên âm và sắp xếp thẻ từ thành câu.',
    icon: BookOpen,
    accentClass: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  {
    id: 'write',
    title: 'Viết chữ Cơ Ho',
    description: 'Tập viết nét chữ trên bảng ô ly và gõ chữ với bàn phím Cơ Ho.',
    icon: PenTool,
    accentClass: 'bg-purple-50 text-purple-700 border-purple-200',
  },
];

export const SkillPracticeView: React.FC<SkillPracticeViewProps> = ({
  lessons,
  isAuthenticated,
  onRequireAuth,
  onStartCustomLesson,
}) => {
  const [selectedLevel, setSelectedLevel] = useState<DifficultyLevel | 0>(0);

  const handleLaunchSkill = (skill: SkillType) => {
    playTapSound();
    const accessibleLessons = isAuthenticated ? lessons : lessons.slice(0, 5);
    const matchingLessons = accessibleLessons.filter((l) =>
      selectedLevel === 0 ? true : l.level === selectedLevel
    );

    if (!isAuthenticated && matchingLessons.length === 0) {
      onRequireAuth();
      return;
    }

    const pool = matchingLessons
      .flatMap((l) => l.exercises)
      .filter((ex) => ex.skill === skill);

    const chosen = pool.slice(0, 6);
    if (chosen.length === 0) {
      if (!isAuthenticated) onRequireAuth();
      return;
    }

    const skillMeta = SKILLS.find((s) => s.id === skill)!;
    onStartCustomLesson({
      id: `practice-${skill}-lv${selectedLevel}`,
      level: (selectedLevel || 1) as DifficultyLevel,
      orderIndex: 99,
      title: `Luyện kỹ năng: ${skillMeta.title}`,
      description:
        selectedLevel === 0
          ? isAuthenticated
            ? 'Tổng hợp từ tất cả 5 cấp độ'
            : 'Tổng hợp từ 5 màn chơi thử đầu tiên'
          : `Ôn tập chuyên sâu Cấp độ ${selectedLevel}`,
      xpReward: 25,
      exercises: chosen,
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-stone-900 text-balance">
          Luyện tập theo 4 kỹ năng
        </h2>
        <p className="text-sm sm:text-base text-stone-600 max-w-2xl">
          Chọn cấp độ khó và kỹ năng em muốn rèn luyện riêng để nắm chắc mặt chữ, cách nghe, cách đọc và cách viết chữ Cơ Ho.
        </p>
      </div>

      {/* Level Selector */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-stone-100 rounded-xl w-fit">
        <button
          type="button"
          onClick={() => {
            playTapSound();
            setSelectedLevel(0);
          }}
          className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors min-h-[40px] whitespace-nowrap ${
            selectedLevel === 0
              ? 'bg-white text-stone-900 shadow-sm'
              : 'text-stone-600 hover:text-stone-900'
          }`}
        >
          Tất cả 5 cấp độ
        </button>
        {[1, 2, 3, 4, 5].map((lv) => (
          <button
            key={lv}
            type="button"
            onClick={() => {
              playTapSound();
              setSelectedLevel(lv as DifficultyLevel);
            }}
            className={`px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors min-h-[40px] whitespace-nowrap ${
              selectedLevel === lv
                ? 'bg-white text-stone-900 shadow-sm'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Cấp độ {lv}
          </button>
        ))}
      </div>

      {/* 4 Skill Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SKILLS.map((skill) => {
          const Icon = skill.icon;
          const count = lessons
            .filter((l) => (selectedLevel === 0 ? true : l.level === selectedLevel))
            .flatMap((l) => l.exercises)
            .filter((ex) => ex.skill === skill.id).length;

          return (
            <div
              key={skill.id}
              className="bg-white border border-stone-200 rounded-2xl p-5 flex flex-col justify-between gap-4"
            >
              <div className="flex items-start gap-4">
                <div
                  className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${skill.accentClass}`}
                >
                  <Icon className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-stone-900">{skill.title}</h3>
                  <p className="text-sm text-stone-600">{skill.description}</p>
                  <div className="text-xs text-stone-500 font-medium pt-1">
                    {count} câu hỏi sẵn sàng
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={count === 0}
                onClick={() => handleLaunchSkill(skill.id)}
                className={`w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm min-h-[44px] transition-all ${
                  count > 0
                    ? 'bg-emerald-700 hover:bg-emerald-800 text-white border-b-4 border-emerald-900 active:translate-y-0.5'
                    : 'bg-stone-100 text-stone-400 cursor-not-allowed'
                }`}
              >
                <Play className="w-4 h-4 fill-current" />
                <span>{count > 0 ? 'Bắt đầu luyện ngay' : 'Chưa có câu hỏi ở cấp này'}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
