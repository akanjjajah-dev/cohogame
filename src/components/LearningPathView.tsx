import React, { useState } from 'react';
import {
  CheckCircle2,
  Lock,
  Play,
  BookOpen,
  Award,
} from 'lucide-react';
import { LEVEL_METADATA } from '../data/seedData';
import { DifficultyLevel, LessonItem, StudentProfile } from '../shared/types';
import { playTapSound } from '../lib/audio';

const FREE_TRIAL_LESSON_LIMIT = 5;

interface LearningPathViewProps {
  lessons: LessonItem[];
  profile: StudentProfile;
  isAuthenticated: boolean;
  onSelectLesson: (lesson: LessonItem) => void;
}

export const LearningPathView: React.FC<LearningPathViewProps> = ({
  lessons,
  profile,
  isAuthenticated,
  onSelectLesson,
}) => {
  const [selectedLevel, setSelectedLevel] = useState<DifficultyLevel | 0>(0);
  const [bannerError, setBannerError] = useState(false);
  const [mascotError, setMascotError] = useState(false);

  const visibleLevels = LEVEL_METADATA.filter((meta) =>
    selectedLevel === 0 ? true : meta.level === selectedLevel
  );

  // Find the first uncompleted lesson as the recommended next step
  const isLessonDone = (lessonId: string) => {
    const p = profile.progress[lessonId];
    return Boolean(p && ((p.bestScore ?? 0) > 0 || p.completedAt || (p.stars ?? 0) > 0));
  };

  const nextRecommendedLesson =
    lessons.find((l) => !isLessonDone(l.id)) ||
    lessons[0];
  const nextRecommendedGlobalIdx = nextRecommendedLesson
    ? lessons.findIndex((l) => l.id === nextRecommendedLesson.id)
    : -1;
  const isNextLockedByAuth = !isAuthenticated && nextRecommendedGlobalIdx >= FREE_TRIAL_LESSON_LIMIT;

  return (
    <div className="space-y-6">
      {/* Highland Hero Card */}
      <div className="relative rounded-3xl overflow-hidden border border-stone-200 bg-emerald-900 text-white">
        {!bannerError ? (
          <img
            src="/src/assets/images/coho_banner_highlands_1795158940670.jpg"
            alt="Núi rừng Tây Nguyên quê hương tiếng Cơ Ho"
            referrerPolicy="no-referrer"
            onError={() => setBannerError(true)}
            className="w-full h-48 sm:h-52 object-cover"
          />
        ) : (
          <div className="w-full h-48 sm:h-52 bg-gradient-to-br from-emerald-800 to-emerald-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/15" />

        <div className="absolute inset-0 p-5 sm:p-6 flex items-end justify-between gap-4">
          <div className="space-y-2 max-w-lg">
            <div className="text-xs font-semibold text-emerald-200">
              Xin chào, {profile.displayName} · 5 cấp độ học tập
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white text-balance leading-snug">
              Hành trình chinh phục chữ Cơ Ho
            </h1>
            {nextRecommendedLesson && (
              <button
                type="button"
                onClick={() => {
                  playTapSound();
                  onSelectLesson(nextRecommendedLesson);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl border-b-3 border-emerald-800 active:translate-y-0.5 transition-all min-h-[44px]"
              >
                {isNextLockedByAuth ? (
                  <Lock className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
                <span>
                  {isNextLockedByAuth
                    ? `Đăng nhập để mở: ${nextRecommendedLesson.title}`
                    : `Học tiếp: ${nextRecommendedLesson.title}`}
                </span>
              </button>
            )}
          </div>

          <div className="hidden sm:block w-24 h-24 rounded-2xl bg-white p-1.5 border border-stone-200 shrink-0 overflow-hidden">
            {!mascotError ? (
              <img
                src="/src/assets/images/coho_mascot_bird_1795158940359.jpg"
                alt="Bạn chim nhỏ đồng hành học chữ Cơ Ho"
                referrerPolicy="no-referrer"
                onError={() => setMascotError(true)}
                className="w-full h-full object-contain rounded-xl"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-emerald-50 rounded-xl text-emerald-700">
                <Award className="w-10 h-10" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 5 Difficulty Level Filter Bar */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-stone-500">Chọn cấp độ khó</div>
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-stone-100 rounded-xl w-full sm:w-fit">
          <button
            type="button"
            onClick={() => {
              playTapSound();
              setSelectedLevel(0);
            }}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors min-h-[40px] whitespace-nowrap ${
              selectedLevel === 0
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Tất cả
          </button>
          {LEVEL_METADATA.map((meta) => (
            <button
              key={meta.level}
              type="button"
              onClick={() => {
                playTapSound();
                setSelectedLevel(meta.level);
              }}
              className={`px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors min-h-[40px] whitespace-nowrap ${
                selectedLevel === meta.level
                  ? 'bg-white text-stone-900 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Cấp {meta.level}
            </button>
          ))}
        </div>
      </div>

      {/* Units & Winding Lesson Nodes */}
      <div className="space-y-8">
        {visibleLevels.map((meta) => {
          const levelLessons = lessons.filter((l) => l.level === meta.level);
          const completedInLevel = levelLessons.filter((l) => isLessonDone(l.id)).length;

          return (
            <section key={meta.level} className="space-y-4">
              {/* Unit Header */}
              <div
                className="rounded-2xl p-4 sm:p-5 text-white flex flex-wrap items-center justify-between gap-3"
                style={{ backgroundColor: meta.accentHex }}
              >
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-white/85">
                    {meta.badgeText} · {completedInLevel}/{levelLessons.length} bài hoàn thành
                  </div>
                  <h2 className="text-lg sm:text-xl font-extrabold text-white">{meta.title}</h2>
                  <p className="text-xs sm:text-sm text-white/90">{meta.subtitle}</p>
                </div>
              </div>

              {/* Winding Lesson Cards */}
              {levelLessons.length === 0 ? (
                <div className="bg-white border border-stone-200 rounded-2xl p-6 text-center text-sm text-stone-500">
                  Chưa có bài học nào ở cấp độ {meta.level}. Em hoặc thầy cô có thể nhập thêm từ Excel.
                </div>
              ) : (
                <div className="space-y-3">
                  {levelLessons.map((lesson, idx) => {
                    const prog = profile.progress[lesson.id];
                    const bestScore = prog?.bestScore ?? 0;
                    const isCompleted = isLessonDone(lesson.id);
                    const isNext = nextRecommendedLesson?.id === lesson.id;
                    const globalIdx = lessons.findIndex((l) => l.id === lesson.id);
                    const isLockedForGuest = !isAuthenticated && globalIdx >= FREE_TRIAL_LESSON_LIMIT;

                    // Gentle horizontal winding offset on wider screens
                    const offsets = ['sm:ml-0', 'sm:ml-8', 'sm:ml-14', 'sm:ml-8'];
                    const offsetClass = offsets[idx % offsets.length];

                    return (
                      <div
                        key={lesson.id}
                        className={`bg-white border rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${offsetClass} ${
                          isNext && !isLockedForGuest
                            ? 'border-emerald-500 ring-2 ring-emerald-500/15'
                            : 'border-stone-200 hover:border-stone-300'
                        }`}
                      >
                        <div className="flex items-start sm:items-center gap-4">
                          <button
                            type="button"
                            onClick={() => {
                              playTapSound();
                              onSelectLesson(lesson);
                            }}
                            aria-label={isLockedForGuest ? `Đăng nhập để mở ${lesson.title}` : `Mở bài ${lesson.title}`}
                            className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 border-b-4 transition-transform active:translate-y-0.5 ${
                              isLockedForGuest
                                ? 'bg-stone-100 border-stone-300 text-stone-500'
                                : isCompleted
                                  ? 'bg-amber-400 border-amber-600 text-stone-950'
                                  : isNext
                                    ? 'bg-emerald-600 border-emerald-800 text-white'
                                    : 'bg-stone-100 border-stone-300 text-stone-700'
                            }`}
                          >
                            {isLockedForGuest ? (
                              <Lock className="w-6 h-6" />
                            ) : isCompleted ? (
                              <CheckCircle2 className="w-7 h-7" />
                            ) : (
                              <BookOpen className="w-6 h-6" />
                            )}
                          </button>

                          <div className="space-y-1">
                            <div className="text-xs font-semibold text-stone-500 tabular-nums">
                              Màn {globalIdx + 1} · {lesson.exercises.length} câu hỏi · +{lesson.xpReward} XP
                            </div>
                            <h3 className="text-base sm:text-lg font-extrabold text-stone-900">
                              {lesson.title}
                            </h3>
                            <p className="text-xs sm:text-sm text-stone-600">{lesson.description}</p>

                            {/* Numeric score & status text */}
                            <div className="flex items-center gap-2 pt-1 text-xs">
                              {isLockedForGuest ? (
                                <span className="font-semibold text-amber-700">
                                  Cần đăng nhập để mở khóa từ màn 6
                                </span>
                              ) : (
                                <>
                                  {isCompleted ? (
                                    <span className="font-mono font-bold tabular-nums text-amber-700">
                                      Điểm: {bestScore}/100
                                    </span>
                                  ) : (
                                    <span className="font-mono font-semibold tabular-nums text-stone-400">
                                      0/100 điểm
                                    </span>
                                  )}
                                  <span className="text-stone-300">·</span>
                                  <span className="font-semibold text-stone-500">
                                    {isCompleted
                                      ? bestScore >= 90
                                        ? 'Xuất sắc'
                                        : bestScore >= 70
                                          ? 'Khá tốt'
                                          : 'Hoàn thành'
                                      : isNext
                                        ? 'Bài tiếp theo'
                                        : globalIdx < FREE_TRIAL_LESSON_LIMIT && !isAuthenticated
                                          ? 'Chơi thử miễn phí'
                                          : 'Sẵn sàng học'}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            playTapSound();
                            onSelectLesson(lesson);
                          }}
                          className={`w-full sm:w-auto px-5 py-2.5 rounded-xl font-bold text-sm min-h-[44px] whitespace-nowrap shrink-0 transition-all inline-flex items-center justify-center gap-1.5 ${
                            isLockedForGuest
                              ? 'bg-stone-100 hover:bg-stone-200 text-stone-700 border border-stone-300'
                              : isNext
                                ? 'bg-emerald-700 hover:bg-emerald-800 text-white border-b-4 border-emerald-900 active:translate-y-0.5'
                                : isCompleted
                                  ? 'bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300'
                                  : 'bg-stone-100 hover:bg-stone-200 text-stone-900'
                          }`}
                        >
                          {isLockedForGuest ? (
                            <>
                              <Lock className="w-3.5 h-3.5" />
                              <span>Đăng nhập để mở</span>
                            </>
                          ) : isCompleted ? (
                            'Ôn lại'
                          ) : (
                            'Bắt đầu'
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};
