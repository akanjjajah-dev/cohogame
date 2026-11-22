import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Flame,
  Medal,
  Pencil,
  RefreshCw,
  Trophy,
  User,
} from 'lucide-react';
import { LeaderboardEntry, StudentProfile } from '../shared/types';
import { apiFetch } from '../lib/api';
import { playTapSound } from '../lib/audio';

interface LeaderboardViewProps {
  currentProfile: StudentProfile;
  totalLessonsCount: number;
  onUpdateDisplayName: (nextName: string) => Promise<void> | void;
}

export const LeaderboardView: React.FC<LeaderboardViewProps> = ({
  currentProfile,
  totalLessonsCount,
  onUpdateDisplayName,
}) => {
  const [sortBy, setSortBy] = useState<'score' | 'xp'>('score');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(currentProfile.displayName);

  const fetchLeaderboard = useCallback(async (sort: 'score' | 'xp') => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/leaderboard?sort=${sort}&limit=50`);
      if (!res.ok) {
        throw new Error('Không thể tải bảng xếp hạng.');
      }
      const data = await res.json();
      if (Array.isArray(data.entries)) {
        setEntries(data.entries);
      }
    } catch (err) {
      setError((err as Error).message || 'Không thể kết nối bảng xếp hạng.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard(sortBy);
  }, [sortBy, fetchLeaderboard, currentProfile.xp, currentProfile.displayName]);

  const handleSaveName = async () => {
    const clean = nameInput.trim();
    if (!clean) {
      setIsEditingName(false);
      return;
    }
    await onUpdateDisplayName(clean);
    setIsEditingName(false);
    fetchLeaderboard(sortBy);
  };

  const myEntry = entries.find((e) => e.id === currentProfile.id);
  const myLocalScore = Object.values(currentProfile.progress).reduce(
    (sum, p) => sum + (p.bestScore ?? 0),
    0
  );
  const myCompleted = Object.values(currentProfile.progress).filter(
    (p) => (p.bestScore ?? 0) > 0 || Boolean(p.completedAt) || (p.stars ?? 0) > 0
  ).length;

  const topThree = entries.slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-stone-900 text-balance">
            Bảng xếp hạng học tập
          </h2>
          <p className="text-sm sm:text-base text-stone-600 max-w-2xl">
            Xếp hạng theo tổng điểm bài học (thang 100/bài) và điểm tích lũy XP của học sinh.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            playTapSound();
            fetchLeaderboard(sortBy);
          }}
          className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-bold text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-xl min-h-[42px] whitespace-nowrap"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-700' : ''}`} />
          <span>Làm mới</span>
        </button>
      </div>

      {/* Current Student Standing Card */}
      <div className="bg-emerald-900 text-white rounded-3xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-emerald-800 border border-emerald-700 flex items-center justify-center shrink-0">
              <User className="w-6 h-6 text-emerald-200" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-emerald-200">
                Thứ hạng của bạn · Hạng #{myEntry?.rank ?? 1}
              </div>
              {isEditingName ? (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                    className="px-2.5 py-1 text-sm font-bold text-stone-900 bg-white rounded-lg w-44"
                    placeholder="Tên hiển thị..."
                  />
                  <button
                    type="button"
                    onClick={handleSaveName}
                    aria-label="Lưu tên hiển thị"
                    className="p-1.5 bg-amber-400 text-stone-950 rounded-lg"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-lg sm:text-xl font-extrabold truncate">
                    {currentProfile.displayName}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setNameInput(currentProfile.displayName);
                      setIsEditingName(true);
                    }}
                    aria-label="Đổi tên trên bảng xếp hạng"
                    className="text-emerald-200 hover:text-white p-1"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 sm:gap-6 text-right">
            <div>
              <div className="text-[11px] font-semibold text-emerald-200">Tổng điểm</div>
              <div className="text-xl font-extrabold font-mono tabular-nums text-amber-300">
                {myEntry?.totalScore ?? myLocalScore}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-emerald-200">Điểm XP</div>
              <div className="text-xl font-extrabold font-mono tabular-nums">
                {myEntry?.xp ?? currentProfile.xp}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-emerald-200">Bài xong</div>
              <div className="text-xl font-extrabold font-mono tabular-nums">
                {myEntry?.completedLessons ?? myCompleted}/{totalLessonsCount}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sort Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 p-1 bg-stone-100 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => {
              playTapSound();
              setSortBy('score');
            }}
            className={`px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg min-h-[38px] whitespace-nowrap ${
              sortBy === 'score' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
            }`}
          >
            Xếp theo Tổng điểm
          </button>
          <button
            type="button"
            onClick={() => {
              playTapSound();
              setSortBy('xp');
            }}
            className={`px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg min-h-[38px] whitespace-nowrap ${
              sortBy === 'xp' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
            }`}
          >
            Xếp theo Điểm XP
          </button>
        </div>

        <div className="text-xs font-medium text-stone-500 tabular-nums">
          Tổng cộng {entries.length} học sinh tham gia
        </div>
      </div>

      {error ? (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center text-sm text-rose-800">
          {error}
        </div>
      ) : isLoading && entries.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-sm text-stone-500">
          Đang tải bảng xếp hạng...
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-sm text-stone-500">
          Chưa có dữ liệu học sinh nào. Hãy hoàn thành một bài học để ghi danh lên bảng xếp hạng!
        </div>
      ) : (
        <div className="space-y-5">
          {/* Top 3 Highlight Cards */}
          {topThree.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {topThree.map((item) => {
                const isMe = item.id === currentProfile.id;
                const medalColor =
                  item.rank === 1
                    ? 'bg-amber-400 text-stone-950 border-amber-500'
                    : item.rank === 2
                      ? 'bg-stone-200 text-stone-800 border-stone-300'
                      : 'bg-orange-200 text-orange-950 border-orange-300';

                return (
                  <div
                    key={item.id}
                    className={`bg-white border rounded-2xl p-4 space-y-3 ${
                      isMe ? 'border-emerald-500 ring-2 ring-emerald-500/15' : 'border-stone-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className={`w-9 h-9 rounded-xl border flex items-center justify-center font-extrabold text-sm font-mono tabular-nums ${medalColor}`}
                      >
                        #{item.rank}
                      </div>
                      {item.rank === 1 ? (
                        <Trophy className="w-5 h-5 text-amber-500" />
                      ) : (
                        <Medal className="w-5 h-5 text-stone-400" />
                      )}
                    </div>

                    <div>
                      <div className="text-base font-extrabold text-stone-900 truncate">
                        {item.displayName} {isMe ? '(Bạn)' : ''}
                      </div>
                      <div className="text-xs text-stone-500 mt-0.5 tabular-nums">
                        {item.completedLessons} bài · TB {item.averageScore}/100
                      </div>
                    </div>

                    <div className="pt-2 border-t border-stone-100 flex items-baseline justify-between">
                      <span className="text-lg font-extrabold text-emerald-700 font-mono tabular-nums">
                        {item.totalScore} điểm
                      </span>
                      <span className="text-xs font-bold text-stone-500 font-mono tabular-nums">
                        {item.xp} XP
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Full Ranking List */}
          <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden divide-y divide-stone-100">
            {entries.map((item) => {
              const isMe = item.id === currentProfile.id;
              return (
                <div
                  key={item.id}
                  className={`px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 ${
                    isMe ? 'bg-emerald-50/70' : 'bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-extrabold text-xs tabular-nums shrink-0 ${
                        item.rank === 1
                          ? 'bg-amber-400 text-stone-950'
                          : item.rank === 2
                            ? 'bg-stone-200 text-stone-800'
                            : item.rank === 3
                              ? 'bg-orange-200 text-orange-950'
                              : 'bg-stone-100 text-stone-600'
                      }`}
                    >
                      {item.rank}
                    </div>

                    <div className="min-w-0">
                      <div className="text-sm font-bold text-stone-900 truncate">
                        {item.displayName} {isMe ? '(Bạn)' : ''}
                      </div>
                      <div className="text-xs text-stone-500 tabular-nums">
                        Hoàn thành {item.completedLessons} bài · Trung bình {item.averageScore}/100 điểm
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0 text-right">
                    <div className="hidden sm:flex items-center gap-1 text-xs font-bold text-amber-600 font-mono tabular-nums">
                      <Flame className="w-3.5 h-3.5 fill-amber-500" />
                      <span>{item.streak}</span>
                    </div>
                    <div>
                      <div className="text-sm font-extrabold text-emerald-700 font-mono tabular-nums">
                        {item.totalScore} điểm
                      </div>
                      <div className="text-[11px] font-semibold text-stone-500 font-mono tabular-nums">
                        {item.xp} XP
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
