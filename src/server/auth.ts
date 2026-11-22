import crypto from 'crypto';
import type { Request, Response } from 'express';

export const SESSION_COOKIE_NAME = 'coho_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function createSessionToken(): { rawToken: string; tokenHash: string; expiresAtIso: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const expiresAtIso = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  return { rawToken, tokenHash, expiresAtIso };
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function validateUsernameInput(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Tên đăng nhập không hợp lệ.' };
  }
  const clean = raw.trim();
  if (clean.length < 3 || clean.length > 24) {
    return { ok: false, error: 'Tên đăng nhập phải dài từ 3 đến 24 ký tự.' };
  }
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(clean)) {
    return {
      ok: false,
      error: 'Tên đăng nhập chỉ được dùng chữ cái không dấu, số và ký tự _ . -',
    };
  }
  return { ok: true, value: clean };
}

export function validateEmailInput(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Email không hợp lệ.' };
  }
  const clean = raw.trim();
  if (clean.length < 5 || clean.length > 120) {
    return { ok: false, error: 'Email không hợp lệ.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
    return { ok: false, error: 'Vui lòng nhập đúng định dạng Email (ví dụ: ten@gmail.com).' };
  }
  return { ok: true, value: clean };
}

export function validatePasswordInput(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Mật khẩu không hợp lệ.' };
  }
  if (raw.length < 8 || raw.length > 128) {
    return { ok: false, error: 'Mật khẩu phải có từ 8 đến 128 ký tự.' };
  }
  if (!/[a-zA-Z]/.test(raw) || !/[0-9]/.test(raw)) {
    return { ok: false, error: 'Mật khẩu phải có ít nhất 1 chữ cái và 1 chữ số để đảm bảo bảo mật.' };
  }
  return { ok: true, value: raw };
}

export function validateIdentifierInput(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Vui lòng nhập Email hoặc Tên đăng nhập.' };
  }
  const clean = raw.trim();
  if (clean.length < 3 || clean.length > 120) {
    return { ok: false, error: 'Email hoặc Tên đăng nhập không hợp lệ.' };
  }
  return { ok: true, value: clean };
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const pairs = cookieHeader.split(';');
  for (const part of pairs) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function getSessionTokenFromRequest(req: Request): string | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
    return null;
  }
  return token;
}

function isHttpsRequest(req: Request): boolean {
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return req.secure || protoHeader === 'https';
}

export function setSessionCookie(req: Request, res: Response, rawToken: string): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'HttpOnly',
  ];
  if (isHttpsRequest(req)) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
  ];
  if (isHttpsRequest(req)) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function verifyMutationCsrf(req: Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return true;
  }
  const hasCustomHeader = String(req.headers['x-requested-with'] || '').toLowerCase() === 'xmlhttprequest';
  if (hasCustomHeader) {
    return true;
  }
  const originHeader = req.headers.origin;
  if (originHeader) {
    try {
      const originHost = new URL(originHeader).host;
      const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      if (expectedHost && originHost === expectedHost) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}
