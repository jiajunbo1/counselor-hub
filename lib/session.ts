// 应用内登录会话：令牌仅存于当前浏览器标签页（sessionStorage），
// 关闭页面/浏览器后再打开即失效、需重新登录；页面刷新不丢会话。
import type { MemberRole } from "@/lib/types";

export interface MemberUser {
  id: string;
  username: string;
  display_name: string;
  role: MemberRole;
  status: "active" | "disabled";
  phone: string;
  must_change: boolean;
  student_id?: string | null;
  created_at: string;
}

export interface AppSession {
  token: string;
  member: MemberUser;
}

const KEY = "app_session_v1";

export function loadSession(): AppSession | null {
  try {
    // 一次性清理旧版 localStorage 令牌：关闭浏览器即失效的安全口径要求令牌不得长期驻留
    localStorage.removeItem(KEY);
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<AppSession>;
    if (
      typeof s?.token === "string" && /^[0-9a-f]{64}$/.test(s.token) &&
      s.member && typeof s.member.id === "string" && typeof s.member.username === "string"
    ) {
      return s as AppSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(session: AppSession): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
  sessionStorage.removeItem(KEY);
}

export function getToken(): string | null {
  return loadSession()?.token ?? null;
}
