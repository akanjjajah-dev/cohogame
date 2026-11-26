import React, { useState } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User,
  X,
} from 'lucide-react';
import { AuthUser, StudentProfile } from '../shared/types';
import { apiFetch } from '../lib/api';
import { playTapSound } from '../lib/audio';

export interface TrialProgressSyncItem {
  lessonId: string;
  score: number;
  earnedXp: number;
}

interface AuthGateViewProps {
  initialMode?: 'login' | 'register';
  reason?: 'after_trial' | 'locked_lesson' | 'manual';
  trialProgress?: TrialProgressSyncItem[];
  onClose?: () => void;
  onAuthSuccess: (user: AuthUser, profile: StudentProfile) => void;
}

type AuthMode = 'login' | 'register';

export const AuthGateView: React.FC<AuthGateViewProps> = ({
  initialMode = 'register',
  reason = 'manual',
  trialProgress = [],
  onClose,
  onAuthSuccess,
}) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [bannerError, setBannerError] = useState(false);
  const [mascotError, setMascotError] = useState(false);

  // Login fields
  const [identifier, setIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register fields
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const switchMode = (nextMode: AuthMode) => {
    playTapSound();
    setMode(nextMode);
    setErrorMessage(null);
    setShowPassword(false);
  };

  const passwordHasMinLen = registerPassword.length >= 8;
  const passwordHasLetter = /[a-zA-Z]/.test(registerPassword);
  const passwordHasDigit = /[0-9]/.test(registerPassword);

  const reasonTitle =
    reason === 'after_trial'
      ? 'Hoàn thành 5 màn chơi thử!'
      : reason === 'locked_lesson'
        ? 'Mở khóa từ Màn 6 trở đi'
        : 'Lưu tài khoản & tiến trình học';

  const reasonDescription =
    reason === 'after_trial'
      ? 'Tuyệt vời! Em đã hoàn thành 5 màn làm quen miễn phí. Hãy đăng ký hoặc đăng nhập để lưu điểm và tiếp tục chinh phục từ Màn 6 trở đi.'
      : reason === 'locked_lesson'
        ? '5 màn đầu tiên được chơi thử miễn phí. Từ Màn 6 trở đi, vui lòng đăng ký hoặc đăng nhập để tiếp tục và lưu toàn bộ tiến trình.'
        : 'Đăng ký hoặc đăng nhập để lưu điểm số thang 100, chuỗi ngày học tập và ghi danh lên bảng xếp hạng.';

  const parseAuthResponse = async (res: Response) => {
    const raw = await res.text();
    let data: { user?: AuthUser; profile?: StudentProfile; error?: string } | null = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    return data;
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanIdentifier = identifier.trim();
    if (cleanIdentifier.length < 3) {
      setErrorMessage('Vui lòng nhập Email hoặc Tên đăng nhập hợp lệ.');
      return;
    }
    if (!loginPassword) {
      setErrorMessage('Vui lòng nhập mật khẩu.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: cleanIdentifier,
          password: loginPassword,
          trialProgress,
        }),
      });
      const data = await parseAuthResponse(res);
      if (!res.ok || !data?.user || !data?.profile) {
        setErrorMessage(
          data?.error ||
            (res.status >= 500
              ? `Máy chủ tạm thời phản hồi chậm (HTTP ${res.status}). Vui lòng thử lại.`
              : `Đăng nhập không thành công (HTTP ${res.status}).`)
        );
        return;
      }
      playTapSound();
      onAuthSuccess(data.user, data.profile);
    } catch {
      setErrorMessage('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanUsername = username.trim();
    const cleanEmail = email.trim();

    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(cleanUsername)) {
      setErrorMessage(
        'Tên đăng nhập dài 3–24 ký tự, chỉ dùng chữ cái không dấu, số và ký tự _ . -'
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setErrorMessage('Vui lòng nhập đúng định dạng Email (ví dụ: hocsinh@gmail.com).');
      return;
    }
    if (!passwordHasMinLen || !passwordHasLetter || !passwordHasDigit) {
      setErrorMessage('Mật khẩu phải có ít nhất 8 ký tự, gồm cả chữ cái và chữ số.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanUsername,
          email: cleanEmail,
          password: registerPassword,
          trialProgress,
        }),
      });
      const data = await parseAuthResponse(res);
      if (!res.ok || !data?.user || !data?.profile) {
        setErrorMessage(
          data?.error ||
            (res.status === 404
              ? 'Không tìm thấy API đăng ký trên máy chủ (HTTP 404).'
              : res.status >= 500
                ? `Máy chủ tạm thời phản hồi chậm (HTTP ${res.status}). Vui lòng thử lại.`
                : `Đăng ký tài khoản không thành công (HTTP ${res.status}).`)
        );
        return;
      }
      playTapSound();
      onAuthSuccess(data.user, data.profile);
    } catch {
      setErrorMessage('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-heading"
      className="fixed inset-0 z-50 bg-stone-950/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-4xl bg-white border border-stone-200 rounded-3xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 shadow-xl my-auto">
        {onClose && (
          <button
            type="button"
            onClick={() => {
              playTapSound();
              onClose();
            }}
            aria-label="Đóng để xem lại 5 màn chơi thử"
            className="absolute top-3.5 right-3.5 z-20 w-10 h-10 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-600 hover:text-stone-900 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Left Visual Showcase Column */}
        <div className="lg:col-span-5 relative min-h-[200px] lg:min-h-[540px] bg-emerald-950 text-white flex flex-col justify-between">
          {!bannerError ? (
            <img
              src="/src/assets/images/coho_banner_highlands_1795158940670.jpg"
              alt="Cảnh núi rừng Tây Nguyên quê hương tiếng Cơ Ho"
              referrerPolicy="no-referrer"
              onError={() => setBannerError(true)}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-800 to-emerald-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/55 to-black/30" />

          <div className="relative z-10 p-5 sm:p-6 flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white p-1 border border-stone-200 shrink-0 overflow-hidden">
              {!mascotError ? (
                <img
                  src="/src/assets/images/coho_mascot_bird_1795158940359.jpg"
                  alt="Chim nhỏ đồng hành học chữ Cơ Ho"
                  referrerPolicy="no-referrer"
                  onError={() => setMascotError(true)}
                  className="w-full h-full object-contain rounded-xl"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-emerald-50 rounded-xl text-emerald-700">
                  <Award className="w-6 h-6" />
                </div>
              )}
            </div>
            <div>
              <div className="text-lg font-extrabold tracking-tight text-white">
                Học Chữ Cơ Ho
              </div>
              <div className="text-xs font-medium text-emerald-200">
                5 cấp độ · Từ điển Lâm Đồng
              </div>
            </div>
          </div>

          <div className="relative z-10 p-5 sm:p-6 space-y-3">
            <h2
              id="auth-modal-heading"
              className="text-xl sm:text-2xl font-extrabold tracking-tight text-white text-balance leading-snug"
            >
              {reasonTitle}
            </h2>
            <p className="text-xs sm:text-sm text-stone-200 leading-relaxed">
              {reasonDescription}
            </p>
            {trialProgress.length > 0 && (
              <div className="pt-2 border-t border-white/15 text-xs font-semibold text-amber-300 tabular-nums">
                Đã ghi nhận {trialProgress.length} màn chơi thử — sẽ tự động lưu vào tài khoản sau khi xác thực.
              </div>
            )}
          </div>
        </div>

        {/* Right Auth Form Column */}
        <div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-center bg-white">
          <div className="w-full max-w-md mx-auto space-y-5">
            {/* Mode Segmented Switcher */}
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-stone-100 rounded-xl mr-8 lg:mr-10">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`py-2.5 px-4 text-sm font-bold rounded-lg transition-colors min-h-[42px] whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Đăng nhập
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`py-2.5 px-4 text-sm font-bold rounded-lg transition-colors min-h-[42px] whitespace-nowrap ${
                  mode === 'register'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Đăng ký
              </button>
            </div>

            <div>
              <h3 className="text-lg sm:text-xl font-extrabold text-stone-900">
                {mode === 'login' ? 'Đăng nhập tài khoản' : 'Tạo tài khoản mới'}
              </h3>
              <p className="text-xs sm:text-sm text-stone-500 mt-0.5">
                {mode === 'login'
                  ? 'Nhập Email hoặc Tên đăng nhập để mở khóa toàn bộ màn chơi.'
                  : 'Nhập Tên đăng nhập, Email và Mật khẩu để tiếp tục từ Màn 6 trở đi.'}
              </p>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm font-medium"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {mode === 'login' ? (
              <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <label
                    htmlFor="login-identifier"
                    className="block text-xs font-bold text-stone-700"
                  >
                    Email hoặc Tên đăng nhập
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-identifier"
                      type="text"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      autoComplete="username"
                      required
                      placeholder="Nhập email hoặc tên đăng nhập..."
                      className="w-full pl-10 pr-4 py-2.5 text-sm font-medium bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-bold text-stone-700"
                  >
                    Mật khẩu
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      placeholder="Nhập mật khẩu..."
                      className="w-full pl-10 pr-11 py-2.5 text-sm font-medium bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-stone-500 hover:text-stone-800"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-extrabold text-sm rounded-xl border-b-4 border-emerald-900 active:translate-y-0.5 transition-all min-h-[46px] whitespace-nowrap"
                >
                  {isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập và mở khóa'}
                </button>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="text-xs sm:text-sm font-semibold text-emerald-800 hover:text-emerald-950 hover:underline py-1.5"
                  >
                    Chưa có tài khoản? Đăng ký ngay
                  </button>
                  {onClose && (
                    <button
                      type="button"
                      onClick={() => {
                        playTapSound();
                        onClose();
                      }}
                      className="text-xs font-semibold text-stone-500 hover:text-stone-800 py-1.5"
                    >
                      Quay lại màn 1–5
                    </button>
                  )}
                </div>
              </form>
            ) : (
              <form onSubmit={handleRegisterSubmit} className="space-y-3.5" noValidate>
                <div className="space-y-1">
                  <label
                    htmlFor="reg-username"
                    className="block text-xs font-bold text-stone-700"
                  >
                    Tên đăng nhập
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="reg-username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      required
                      placeholder="Ví dụ: k_ho_hoc_vien"
                      className="w-full pl-10 pr-4 py-2.5 text-sm font-medium bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
                    />
                  </div>
                  <p className="text-[11px] text-stone-500">
                    3–24 ký tự gồm chữ cái không dấu, số, _, . hoặc -
                  </p>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="reg-email"
                    className="block text-xs font-bold text-stone-700"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="reg-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                      placeholder="ten@gmail.com"
                      className="w-full pl-10 pr-4 py-2.5 text-sm font-medium bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="reg-password"
                    className="block text-xs font-bold text-stone-700"
                  >
                    Mật khẩu
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="reg-password"
                      type={showPassword ? 'text' : 'password'}
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                      placeholder="Tối thiểu 8 ký tự gồm chữ và số..."
                      className="w-full pl-10 pr-11 py-2.5 text-sm font-medium bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-stone-500 hover:text-stone-800"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 pt-1 text-[11px] font-medium">
                    <div
                      className={`flex items-center gap-1 ${
                        passwordHasMinLen ? 'text-emerald-700' : 'text-stone-400'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>8+ ký tự</span>
                    </div>
                    <div
                      className={`flex items-center gap-1 ${
                        passwordHasLetter ? 'text-emerald-700' : 'text-stone-400'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Có chữ cái</span>
                    </div>
                    <div
                      className={`flex items-center gap-1 ${
                        passwordHasDigit ? 'text-emerald-700' : 'text-stone-400'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Có chữ số</span>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 px-5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-extrabold text-sm rounded-xl border-b-4 border-emerald-900 active:translate-y-0.5 transition-all min-h-[46px] whitespace-nowrap"
                >
                  {isSubmitting ? 'Đang tạo tài khoản...' : 'Đăng ký và mở khóa'}
                </button>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="text-xs sm:text-sm font-semibold text-emerald-800 hover:text-emerald-950 hover:underline py-1.5"
                  >
                    Đã có tài khoản? Đăng nhập
                  </button>
                  {onClose && (
                    <button
                      type="button"
                      onClick={() => {
                        playTapSound();
                        onClose();
                      }}
                      className="text-xs font-semibold text-stone-500 hover:text-stone-800 py-1.5"
                    >
                      Quay lại màn 1–5
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
