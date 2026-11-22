import React, { useCallback, useEffect, useState } from 'react';
import {
  BookA,
  Compass,
  FileSpreadsheet,
  Flame,
  Heart,
  LogIn,
  LogOut,
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
import { AuthUser, LessonItem, StudentProfile } from './shared/types';
import { apiFetch } from './lib/api';
import { getSoundMuted, setSoundMuted, playTapSound } from './lib/audio';
import { AuthGateView, TrialProgressSyncItem } from './components/AuthGateView';
import { LearningPathView } from './components/LearningPathView';
import { LookupView } from './components/LookupView';
import { AlphabetView } from './components/AlphabetView';
import { SkillPracticeView } from './components/SkillPracticeView';
import { LeaderboardView } from './components/LeaderboardView';
import { ExcelManagerView } from './components/ExcelManagerView';
import { LessonPlayer } from './components/LessonPlayer';

type NavTab = 'learn' | 'lookup' | 'alphabet' | 'skills' | 'leaderboard' | 'excel';

const FREE_TRIAL_LESSON_LIMIT = 5;
const GUEST_TRIAL_STORAGE_KEY = 'coho_guest_trial_profile_v1';

interface StoredGuestTrial {
  profile: StudentProfile;
  xpByLesson: Record<string, number>;
}

function getDefaultGuestProfile(): StudentProfile {
  return {
    id: 'guest-trial',
    displayName: 'Khách chơi thử',
    xp: 0,
    streak: 1,
    hearts: 5,
    dailyGoalXp: 50,
    todayXp: 0,
    lastActiveDate: new Date().toISOString().slice(0, 10),
    progress: {},
  };
}

function loadGuestTrial(): StoredGuestTrial {
  const fallback: StoredGuestTrial = { profile: getDefaultGuestProfile(), xpByLesson: {} };
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(GUEST_TRIAL_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredGuestTrial>;
    if (!parsed.profile) return fallback;
    return {
      profile: {
        ...getDefaultGuestProfile(),
        ...parsed.profile,
        progress: parsed.profile.progress || {},
      },
      xpByLesson: parsed.xpByLesson || {},
    };
  } catch {
    return fallback;
  }
}

function saveGuestTrial(trial: StoredGuestTrial): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUEST_TRIAL_STORAGE_KEY, JSON.stringify(trial));
  } catch {
    // Ignore storage quota errors
  }
}

function clearGuestTrial(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(GUEST_TRIAL_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('learn');
  const [lessons, setLessons] = useState<LessonItem[]>(SEED_LESSONS);
  const [profile, setProfile] = useState<StudentProfile>(() => loadGuestTrial().profile);
  const [guestXpByLesson, setGuestXpByLesson] = useState<Record<string, number>>(
    () => loadGuestTrial().xpByLesson
  );
  const [activeLesson, setActiveLesson] = useState<LessonItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [muted, setMuted] = useState(getSoundMuted());
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  // Auth modal state (triggered after completing lesson 5 or clicking lesson 6+ / login button)
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalReason, setAuthModalReason] = useState<'after_trial' | 'locked_lesson' | 'manual'>('manual');
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('register');
  const [pendingLessonAfterAuth, setPendingLessonAfterAuth] = useState<LessonItem | null>(null);
  const [justFinishedFifthTrial, setJustFinishedFifthTrial] = useState(false);

  const openAuthModal = useCallback(
    (
      reason: 'after_trial' | 'locked_lesson' | 'manual',
      mode: 'login' | 'register' = 'register',
      pendingLesson: LessonItem | null = null
    ) => {
      setAuthModalReason(reason);
      setAuthModalMode(mode);
      setPendingLessonAfterAuth(pendingLesson);
      setShowAuthModal(true);
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const [curRes, sessionRes] = await Promise.all([
          apiFetch('/api/curriculum'),
          apiFetch('/api/auth/session'),
        ]);
        if (!cancelled && curRes.ok) {
          const curData = await curRes.json();
          if (Array.isArray(curData.lessons) && curData.lessons.length > 0) {
            setLessons(curData.lessons);
          }
        }
        if (!cancelled && sessionRes.ok) {
          const sessionData = await sessionRes.json();
          if (sessionData.authenticated && sessionData.user && sessionData.profile) {
            setAuthUser(sessionData.user);
            setProfile(sessionData.profile);
            setNameInput(sessionData.profile.displayName || sessionData.user.username);
            return;
          }
        }
        if (!cancelled) {
          const trial = loadGuestTrial();
          setAuthUser(null);
          setProfile(trial.profile);
          setGuestXpByLesson(trial.xpByLesson);
          setNameInput(trial.profile.displayName);
        }
      } catch {
        // Keep seeded defaults & guest trial progress if offline
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const buildTrialProgressPayload = (): TrialProgressSyncItem[] => {
    if (authUser) return [];
    const firstFiveIds = lessons.slice(0, FREE_TRIAL_LESSON_LIMIT).map((l) => l.id);
    const items: TrialProgressSyncItem[] = [];
    for (const lessonId of firstFiveIds) {
      const prog = profile.progress[lessonId];
      if (prog) {
        items.push({
          lessonId,
          score: prog.bestScore ?? 0,
          earnedXp: guestXpByLesson[lessonId] ?? 15,
        });
      }
    }
    return items;
  };

  const handleAuthSuccess = async (user: AuthUser, nextProfile: StudentProfile) => {
    clearGuestTrial();
    setGuestXpByLesson({});
    setAuthUser(user);
    setProfile(nextProfile);
    setNameInput(nextProfile.displayName || user.username);
    setShowAuthModal(false);
    setJustFinishedFifthTrial(false);

    if (pendingLessonAfterAuth) {
      const target = pendingLessonAfterAuth;
      setPendingLessonAfterAuth(null);
      setActiveLesson(target);
    }
  };

  const handleLogout = async () => {
    playTapSound();
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network error on logout
    }
    const trial = loadGuestTrial();
    setActiveLesson(null);
    setAuthUser(null);
    setProfile(trial.profile);
    setGuestXpByLesson(trial.xpByLesson);
    setIsEditingName(false);
    setPendingLessonAfterAuth(null);
    setJustFinishedFifthTrial(false);
  };

  const handleToggleSound = () => {
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
  };

  const saveDisplayName = async (rawName: string) => {
    const clean = rawName.trim();
    if (!clean) return;

    if (!authUser) {
      const nextProfile = { ...profile, displayName: clean };
      setProfile(nextProfile);
      saveGuestTrial({ profile: nextProfile, xpByLesson: guestXpByLesson });
      return;
    }

    setProfile((prev) => ({ ...prev, displayName: clean }));
    try {
      const res = await apiFetch(`/api/student/${encodeURIComponent(authUser.studentId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: clean }),
      });
      if (res.status === 401) {
        setAuthUser(null);
        openAuthModal('manual', 'login');
        return;
      }
      if (res.ok) {
        const updated = await res.json();
        setProfile(updated);
      }
    } catch {
      // Ignore offline save failure
    }
  };

  const handleSaveName = async () => {
    setIsEditingName(false);
    await saveDisplayName(nameInput);
  };

  const handleSelectLesson = (lesson: LessonItem) => {
    const globalIdx = lessons.findIndex((l) => l.id === lesson.id);
    if (!authUser && globalIdx >= FREE_TRIAL_LESSON_LIMIT) {
      openAuthModal('locked_lesson', 'register', lesson);
      return;
    }
    setActiveLesson(lesson);
  };

  const handleLessonComplete = async (result: {
    score: number;
    earnedXp: number;
    heartsRemaining: number;
  }) => {
    if (!activeLesson) return;

    const stars = result.score >= 90 ? 3 : result.score >= 70 ? 2 : result.score >= 40 ? 1 : 0;

    if (!authUser) {
      const existing = profile.progress[activeLesson.id];
      const nextProfile: StudentProfile = {
        ...profile,
        xp: profile.xp + result.earnedXp,
        todayXp: profile.todayXp + result.earnedXp,
        hearts: result.heartsRemaining,
        progress: {
          ...profile.progress,
          [activeLesson.id]: {
            lessonId: activeLesson.id,
            stars: Math.max(existing?.stars ?? 0, stars),
            bestScore: Math.max(existing?.bestScore ?? 0, result.score),
            completedAt: new Date().toISOString(),
          },
        },
      };
      const nextXpMap = {
        ...guestXpByLesson,
        [activeLesson.id]: Math.max(guestXpByLesson[activeLesson.id] ?? 0, result.earnedXp),
      };
      setProfile(nextProfile);
      setGuestXpByLesson(nextXpMap);
      saveGuestTrial({ profile: nextProfile, xpByLesson: nextXpMap });

      const fifthLesson = lessons[FREE_TRIAL_LESSON_LIMIT - 1];
      if (fifthLesson && activeLesson.id === fifthLesson.id) {
        setJustFinishedFifthTrial(true);
      }
      return;
    }

    // Optimistic local update for authenticated user
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
      const res = await apiFetch(`/api/student/${encodeURIComponent(authUser.studentId)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessonId: activeLesson.id,
          score: result.score,
          earnedXp: result.earnedXp,
          heartsRemaining: result.heartsRemaining,
        }),
      });
      if (res.status === 401) {
        setAuthUser(null);
        openAuthModal('manual', 'login');
        return;
      }
      if (res.ok) {
        const updated = await res.json();
        setProfile(updated);
      }
    } catch {
      // Keep optimistic progress
    }
  };

  const handleExitLesson = () => {
    const finishedFifth = justFinishedFifthTrial;
    setJustFinishedFifthTrial(false);
    setActiveLesson(null);
    if (!authUser && finishedFifth) {
      const sixthLesson = lessons[FREE_TRIAL_LESSON_LIMIT] || null;
      openAuthModal('after_trial', 'register', sixthLesson);
    }
  };

  const navItems: {
    id: NavTab;
    label: string;
    mobileLabel?: string;
    showInMobileBottom?: boolean;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'learn', label: 'Học tập', showInMobileBottom: true, icon: Compass },
    { id: 'lookup', label: 'Tra từ 2 chiều', mobileLabel: 'Tra từ', showInMobileBottom: true, icon: Search },
    { id: 'alphabet', label: 'Chữ cái', showInMobileBottom: true, icon: BookA },
    { id: 'skills', label: '4 Kỹ năng', showInMobileBottom: true, icon: Sparkles },
    { id: 'leaderboard', label: 'Bảng xếp hạng', mobileLabel: 'Xếp hạng', showInMobileBottom: false, icon: Trophy },
    { id: 'excel', label: 'Dữ liệu Excel', mobileLabel: 'Excel', showInMobileBottom: true, icon: FileSpreadsheet },
  ];

  // Active Lesson Full-Focus Mode
  if (activeLesson) {
    return (
      <div className="min-h-screen bg-[#FAF9F5]">
        <LessonPlayer
          lesson={activeLesson}
          initialHearts={profile.hearts}
          onExit={handleExitLesson}
          onComplete={handleLessonComplete}
        />
      </div>
    );
  }

  const dailyPct = Math.min(100, Math.round((profile.todayXp / Math.max(1, profile.dailyGoalXp)) * 100));
  const completedCount = Object.values(profile.progress).filter(
    (p) => (p.bestScore ?? 0) > 0 || Boolean(p.completedAt) || (p.stars ?? 0) > 0
  ).length;
  const totalNumericScore = Object.values(profile.progress).reduce(
    (sum, p) => sum + (p.bestScore ?? 0),
    0
  );

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
          {/* Student Account / Trial Status Card */}
          <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-stone-500">
                <User className="w-4 h-4" />
                <span>{authUser ? 'Tài khoản học tập' : 'Chơi thử (Màn 1–5)'}</span>
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
              <div>
                <div className="text-sm font-bold text-stone-900 truncate">{profile.displayName}</div>
                {authUser ? (
                  <div className="text-[11px] font-medium text-stone-500 truncate">@{authUser.username}</div>
                ) : (
                  <div className="text-[11px] font-medium text-amber-700">Cần đăng nhập từ Màn 6</div>
                )}
              </div>
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

          {authUser ? (
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-50 rounded-xl min-h-[40px] transition-colors"
            >
              <span>Đăng xuất</span>
              <LogOut className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                playTapSound();
                openAuthModal('manual', 'login');
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl min-h-[40px] transition-colors"
            >
              <span>Đăng nhập / Đăng ký</span>
              <LogIn className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Compact Sticky Top Bar (<= 8% viewport height) */}
      <header className="lg:hidden sticky top-0 z-30 h-14 px-4 bg-white/95 backdrop-blur-md border-b border-stone-200 flex items-center justify-between gap-2">
        <span className="text-base font-extrabold tracking-tight text-emerald-800 whitespace-nowrap shrink-0">
          Học Chữ Cơ Ho
        </span>

        <div className="flex items-center gap-1.5 text-xs font-bold tabular-nums shrink-0">
          <div className="flex items-center gap-1 text-amber-600">
            <Flame className="w-4 h-4 fill-amber-500" />
            <span>{profile.streak}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              playTapSound();
              setActiveTab('leaderboard');
            }}
            aria-label="Xem bảng xếp hạng"
            className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'leaderboard'
                ? 'bg-emerald-100 text-emerald-800'
                : 'text-emerald-700 hover:bg-stone-100'
            }`}
          >
            <Trophy className="w-4 h-4" />
            <span>Xếp hạng</span>
          </button>
          <button
            type="button"
            onClick={handleToggleSound}
            aria-label={muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-stone-600 hover:bg-stone-100"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-700" />}
          </button>
          {authUser ? (
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Đăng xuất tài khoản"
              title="Đăng xuất"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-rose-600 hover:bg-rose-50"
            >
              <LogOut className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                playTapSound();
                openAuthModal('manual', 'login');
              }}
              aria-label="Đăng nhập hoặc đăng ký"
              title="Đăng nhập"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-emerald-700 hover:bg-emerald-50"
            >
              <LogIn className="w-4 h-4" />
            </button>
          )}
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
                  isAuthenticated={Boolean(authUser)}
                  onSelectLesson={handleSelectLesson}
                />
              )}
              {activeTab === 'lookup' && <LookupView lessons={lessons} />}
              {activeTab === 'alphabet' && <AlphabetView />}
              {activeTab === 'skills' && (
                <SkillPracticeView
                  lessons={lessons}
                  isAuthenticated={Boolean(authUser)}
                  onRequireAuth={() => openAuthModal('locked_lesson', 'register')}
                  onStartCustomLesson={(lesson) => setActiveLesson(lesson)}
                />
              )}
              {activeTab === 'leaderboard' && (
                <LeaderboardView
                  currentProfile={profile}
                  totalLessonsCount={lessons.length}
                  onUpdateDisplayName={saveDisplayName}
                />
              )}
              {activeTab === 'excel' && (
                <ExcelManagerView
                  lessons={lessons}
                  onImportSuccess={(nextLessons) => setLessons(nextLessons)}
                  onRequireAuth={() => openAuthModal('manual', 'login')}
                />
              )}
            </>
          )}
        </div>
      </main>

      {showAuthModal && (
        <AuthGateView
          initialMode={authModalMode}
          reason={authModalReason}
          trialProgress={buildTrialProgressPayload()}
          onClose={() => {
            setShowAuthModal(false);
            setPendingLessonAfterAuth(null);
          }}
          onAuthSuccess={handleAuthSuccess}
        />
      )}

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
          <p className="text-xs text-stone-600 tabular-nums">
            Hoàn thành {completedCount}/{lessons.length} bài · Tổng điểm bài học: {totalNumericScore}/{lessons.length * 100}
          </p>
        </div>

        {/* 5-Level Progress Breakdown */}
        <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-extrabold text-stone-900">Tiến độ 5 cấp độ</h3>
          <div className="space-y-2.5">
            {LEVEL_METADATA.map((meta) => {
              const lvlLessons = lessons.filter((l) => l.level === meta.level);
              const done = lvlLessons.filter((l) => {
                const p = profile.progress[l.id];
                return Boolean(p && ((p.bestScore ?? 0) > 0 || p.completedAt || (p.stars ?? 0) > 0));
              }).length;
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
        {navItems
          .filter((item) => item.showInMobileBottom)
          .map((item) => {
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
