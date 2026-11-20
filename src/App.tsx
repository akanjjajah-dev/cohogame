import React, { useEffect, useState } from 'react';
import {
  BookA,
  Compass,
  FileSpreadsheet,
  Flame,
  Heart,
  Sparkles,
  Trophy,
  User,
  Volume2,
  VolumeX,
  Check,
  Pencil,
  Search,
} from 'lucide-react';
import { LEVEL_METADATA, SEED_LESSONS } from './data/seedData';
import { LessonItem, StudentProfile } from './shared/types';
import { getSoundMuted, setSoundMuted, playTapSound } from './lib/audio';
import { LearningPathView } from './components/LearningPathView';
import { LookupView } from './components/LookupView';
import { AlphabetView } from './components/AlphabetView';
import { SkillPracticeView } from './components/SkillPracticeView';
import { ExcelManagerView } from './components/ExcelManagerView';
import { LessonPlayer } from './components/LessonPlayer';

type NavTab = 'learn' | 'lookup' | 'alphabet' | 'skills' | 'excel';

const STUDENT_ID_KEY = 'coho_student_id';

function getOrCreateStudentId(): string {
  if (typeof window === 'undefined') return 'default';
  let existing = window.localStorage.getItem(STUDENT_ID_KEY);
  if (!existing) {
    existing = 'hs-' + Math.random().toString(36).slice(2, 10);
    window.localStorage.setItem(STUDENT_ID_KEY, existing);
  }
  return existing;
}

const DEFAULT_PROFILE: StudentProfile = {
  id: 'default',
  displayName: 'Học sinh Cơ Ho',
  xp: 0,
  streak: 1,
  hearts: 5,
  dailyGoalXp: 50,
  todayXp: 0,
  lastActiveDate: new Date().toISOString().slice(0, 10),
  progress: {},
};

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('learn');
  const [lessons, setLessons] = useState<LessonItem[]>(SEED_LESSONS);
  const [profile, setProfile] = useState<StudentProfile>(DEFAULT_PROFILE);
  const [activeLesson, setActiveLesson] = useState<LessonItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [muted, setMuted] = useState(getSoundMuted());
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [studentId] = useState<string>(getOrCreateStudentId);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const [curRes, profRes] = await Promise.all([
          fetch('/api/curriculum'),
          fetch(`/api/student/${encodeURIComponent(studentId)}`),
        ]);
        if (!cancelled && curRes.ok) {
          const curData = await curRes.json();
          if (Array.isArray(curData.lessons) && curData.lessons.length > 0) {
            setLessons(curData.lessons);
          }
        }
        if (!cancelled && profRes.ok) {
          const profData = await profRes.json();
          if (profData && profData.id) {
            setProfile(profData);
            setNameInput(profData.displayName || 'Học sinh Cơ Ho');
          }
        }
      } catch {
        // Keep seeded defaults if offline
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const handleToggleSound = () => {
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
  };

  const handleSaveName = async () => {
    const clean = nameInput.trim();
    if (!clean) {
      setIsEditingName(false);
      return;
    }
    setProfile((prev) => ({ ...prev, displayName: clean }));
    setIsEditingName(false);
    try {
      const res = await fetch(`/api/student/${encodeURIComponent(studentId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: clean }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProfile(updated);
      }
    } catch {
      // Ignore offline save failure
    }
  };

  const handleLessonComplete = async (result: {
    score: number;
    earnedXp: number;
    heartsRemaining: number;
  }) => {
    if (!activeLesson) return;

    // Optimistic local update first
    const stars = result.score >= 90 ? 3 : result.score >= 70 ? 2 : result.score >= 40 ? 1 : 0;
    setProfile((prev) => {
      const existing = prev.progress[activeLesson.id];
      return {
        ...prev,
        xp: prev.xp + result.earnedXp,
        todayXp: prev.todayXp + result.earnedXp,
        hearts: result.heartsRemaining,
        progress: {
          ...prev.progress,
          [activeLesson.id]: {
            lessonId: activeLesson.id,
            stars: Math.max(existing?.stars ?? 0, stars),
            bestScore: Math.max(existing?.bestScore ?? 0, result.score),
            completedAt: new Date().toISOString(),
          },
        },
      };
    });

    try {
      const res = await fetch(`/api/student/${encodeURIComponent(studentId)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: activeLesson.id,
          score: result.score,
          earnedXp: result.earnedXp,
          heartsRemaining: result.heartsRemaining,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProfile(updated);
      }
    } catch {
      // Keep optimistic progress
    }
  };

  const navItems: {
    id: NavTab;
    label: string;
    mobileLabel?: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'learn', label: 'Học tập', icon: Compass },
    { id: 'lookup', label: 'Tra từ 2 chiều', mobileLabel: 'Tra từ', icon: Search },
    { id: 'alphabet', label: 'Chữ cái', icon: BookA },
    { id: 'skills', label: '4 Kỹ năng', icon: Sparkles },
    { id: 'excel', label: 'Dữ liệu Excel', mobileLabel: 'Excel', icon: FileSpreadsheet },
  ];

  // Active Lesson Full-Focus Mode
  if (activeLesson) {
    return (
      <div className="min-h-screen bg-[#FAF9F5]">
        <LessonPlayer
          lesson={activeLesson}
          initialHearts={profile.hearts}
          onExit={() => setActiveLesson(null)}
          onComplete={handleLessonComplete}
        />
      </div>
    );
  }

  const dailyPct = Math.min(100, Math.round((profile.todayXp / Math.max(1, profile.dailyGoalXp)) * 100));
  const completedCount = Object.values(profile.progress).filter((p) => p.stars > 0).length;

  return (
    <div className="min-h-screen bg-[#FAF9F5] text-stone-900 flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 lg:sticky lg:top-0 lg:h-screen bg-white border-r border-stone-200 p-5 justify-between">
        <div className="space-y-6">
          <div className="px-2">
            <span className="text-xl font-extrabold tracking-tight text-emerald-800 whitespace-nowrap">
              Học Chữ Cơ Ho
            </span>
          </div>

          <nav className="space-y-1.5" aria-label="Điều hướng chính">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    playTapSound();
                    setActiveTab(item.id);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-bold transition-colors min-h-[44px] whitespace-nowrap ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
                  }`}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3 pt-4 border-t border-stone-200">
          {/* Student Name Switcher */}
          <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-stone-500">
                <User className="w-4 h-4" />
                <span>Học sinh</span>
              </div>
              {!isEditingName && (
                <button
                  type="button"
                  onClick={() => {
                    setNameInput(profile.displayName);
                    setIsEditingName(true);
                  }}
                  aria-label="Đổi tên học sinh"
                  className="text-stone-500 hover:text-stone-900 p-1"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {isEditingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                  className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white border border-stone-300 rounded-lg"
                  placeholder="Tên của em..."
                />
                <button
                  type="button"
                  onClick={handleSaveName}
                  className="p-1.5 bg-emerald-700 text-white rounded-lg"
                  aria-label="Lưu tên"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="text-sm font-bold text-stone-900 truncate">{profile.displayName}</div>
            )}
          </div>

          <button
            type="button"
            onClick={handleToggleSound}
            className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl min-h-[40px]"
          >
            <span>Âm thanh hiệu ứng</span>
            {muted ? <VolumeX className="w-4 h-4 text-stone-400" /> : <Volume2 className="w-4 h-4 text-emerald-700" />}
          </button>
        </div>
      </aside>

      {/* Mobile Compact Sticky Top Bar (<= 8% viewport height) */}
      <header className="lg:hidden sticky top-0 z-30 h-14 px-4 bg-white/95 backdrop-blur-md border-b border-stone-200 flex items-center justify-between gap-4">
        <span className="text-base font-extrabold tracking-tight text-emerald-800 whitespace-nowrap shrink-0">
          Học Chữ Cơ Ho
        </span>

        <div className="flex items-center gap-3 text-xs font-bold tabular-nums shrink-0">
          <div className="flex items-center gap-1 text-amber-600">
            <Flame className="w-4 h-4 fill-amber-500" />
            <span>{profile.streak}</span>
          </div>
          <div className="flex items-center gap-1 text-emerald-700">
            <Trophy className="w-4 h-4" />
            <span>{profile.xp} XP</span>
          </div>
          <button
            type="button"
            onClick={handleToggleSound}
            aria-label={muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-stone-600 hover:bg-stone-100"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-700" />}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6 pb-24 lg:pb-10">
        <div className="max-w-3xl mx-auto">
          {isLoading ? (
            <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-sm text-stone-500">
              Đang tải bài học chữ Cơ Ho...
            </div>
          ) : (
            <>
              {activeTab === 'learn' && (
                <LearningPathView
                  lessons={lessons}
                  profile={profile}
                  onSelectLesson={(lesson) => setActiveLesson(lesson)}
                />
              )}
              {activeTab === 'lookup' && <LookupView lessons={lessons} />}
              {activeTab === 'alphabet' && <AlphabetView />}
              {activeTab === 'skills' && (
                <SkillPracticeView
                  lessons={lessons}
                  onStartCustomLesson={(lesson) => setActiveLesson(lesson)}
                />
              )}
              {activeTab === 'excel' && (
                <ExcelManagerView
                  lessons={lessons}
                  onImportSuccess={(nextLessons) => setLessons(nextLessons)}
                />
              )}
            </>
          )}
        </div>
      </main>

      {/* Desktop Right Stats Rail */}
      <aside className="hidden xl:flex xl:flex-col xl:w-80 xl:shrink-0 p-6 pl-0 space-y-5">
        {/* Top Metrics */}
        <div className="bg-white border border-stone-200 rounded-2xl p-4 grid grid-cols-3 gap-2 text-center">
          <div className="p-2">
            <div className="flex items-center justify-center gap-1 text-amber-600 font-extrabold text-lg font-mono tabular-nums">
              <Flame className="w-5 h-5 fill-amber-500" />
              <span>{profile.streak}</span>
            </div>
            <div className="text-[11px] font-semibold text-stone-500 mt-0.5">Chuỗi ngày</div>
          </div>
          <div className="p-2 border-x border-stone-100">
            <div className="flex items-center justify-center gap-1 text-emerald-700 font-extrabold text-lg font-mono tabular-nums">
              <Trophy className="w-5 h-5" />
              <span>{profile.xp}</span>
            </div>
            <div className="text-[11px] font-semibold text-stone-500 mt-0.5">Tổng XP</div>
          </div>
          <div className="p-2">
            <div className="flex items-center justify-center gap-1 text-rose-600 font-extrabold text-lg font-mono tabular-nums">
              <Heart className="w-5 h-5 fill-rose-500" />
              <span>{profile.hearts}</span>
            </div>
            <div className="text-[11px] font-semibold text-stone-500 mt-0.5">Tim</div>
          </div>
        </div>

        {/* Daily Goal */}
        <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-extrabold text-stone-900">Mục tiêu hôm nay</span>
            <span className="text-xs font-bold font-mono tabular-nums text-emerald-700">
              {profile.todayXp}/{profile.dailyGoalXp} XP
            </span>
          </div>
          <div className="h-3 bg-stone-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-600 rounded-full transition-all duration-300"
              style={{ width: `${Math.max(4, dailyPct)}%` }}
            />
          </div>
          <p className="text-xs text-stone-600">
            Hoàn thành {completedCount}/{lessons.length} bài học trên hành trình.
          </p>
        </div>

        {/* 5-Level Progress Breakdown */}
        <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-extrabold text-stone-900">Tiến độ 5 cấp độ</h3>
          <div className="space-y-2.5">
            {LEVEL_METADATA.map((meta) => {
              const lvlLessons = lessons.filter((l) => l.level === meta.level);
              const done = lvlLessons.filter((l) => (profile.progress[l.id]?.stars ?? 0) > 0).length;
              const pct = lvlLessons.length > 0 ? Math.round((done / lvlLessons.length) * 100) : 0;

              return (
                <div key={meta.level} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-stone-700">
                      Cấp {meta.level} · {meta.badgeText}
                    </span>
                    <span className="font-mono tabular-nums text-stone-500">
                      {done}/{lvlLessons.length}
                    </span>
                  </div>
                  <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${pct}%`, backgroundColor: meta.accentHex }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Mobile Fixed Bottom Navigation Bar (<= 8% viewport height) */}
      <nav
        aria-label="Điều hướng di động"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 h-16 bg-white/95 backdrop-blur-md border-t border-stone-200 grid grid-cols-5 items-center px-1"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                playTapSound();
                setActiveTab(item.id);
              }}
              className={`flex flex-col items-center justify-center gap-1 min-h-[48px] rounded-xl transition-colors ${
                isActive ? 'text-emerald-700 font-bold' : 'text-stone-500 font-medium'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[11px] leading-none whitespace-nowrap">
                {item.mobileLabel || item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
