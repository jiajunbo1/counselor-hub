import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, apiPost } from "@/lib/api";
import {
  clearSession,
  loadSession,
  saveSession,
  type AppSession,
  type MemberUser,
} from "@/lib/session";

export type LookupResult = { found: false } | { found: true; kind: "staff" | "student" };

export interface Auth {
  session: AppSession | null;
  lookup: (username: string) => Promise<LookupResult | null>;
  login: (username: string, password: string) => Promise<boolean>;
  bootstrap: (username: string, displayName: string, password: string) => Promise<boolean>;
  studentRegister: (studentNo: string, name: string) => Promise<boolean>;
  logout: () => Promise<void>;
  updateMember: (patch: Partial<MemberUser>) => void;
}

export function useAuth(): Auth {
  const [session, setSession] = useState<AppSession | null>(() => loadSession());

  useEffect(() => {
    const onUnauthorized = () => {
      clearSession();
      setSession(null);
    };
    window.addEventListener("app:unauthorized", onUnauthorized);
    return () => window.removeEventListener("app:unauthorized", onUnauthorized);
  }, []);

  const lookup = useCallback(async (username: string): Promise<LookupResult | null> => {
    try {
      const body = await apiPost("auth.lookup", { username });
      if (body.ok !== true || typeof body.found !== "boolean") {
        toast.error("身份识别失败，请稍后重试。");
        return null;
      }
      if (body.found === false) return { found: false };
      return { found: true, kind: body.kind === "student" ? "student" : "staff" };
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "身份识别失败，请稍后重试。");
      return null;
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const body = await apiPost("auth.login", { username, password });
      const token = typeof body.token === "string" ? body.token : null;
      const member = body.member as MemberUser | undefined;
      if (!token || !member) {
        toast.error("登录返回异常，请重试。");
        return false;
      }
      const next = { token, member };
      saveSession(next);
      setSession(next);
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "登录失败，请稍后重试。");
      return false;
    }
  }, []);

  const bootstrap = useCallback(
    async (username: string, displayName: string, password: string) => {
      try {
        await apiPost("auth.bootstrap", { username, display_name: displayName, password });
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "初始化失败，请稍后重试。");
        return false;
      }
      return await login(username, password);
    },
    [login]
  );

  const studentRegister = useCallback(
    async (studentNo: string, name: string) => {
      try {
        await apiPost("auth.student_register", { student_no: studentNo, name });
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "注册失败，请稍后重试。");
        return false;
      }
      toast.success("注册成功，初始密码为 123456，请使用学号登录并立即修改密码。");
      return true;
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await apiPost("auth.logout");
    } catch {
      // 会话可能已失效，忽略
    }
    clearSession();
    setSession(null);
  }, []);

  const updateMember = useCallback((patch: Partial<MemberUser>) => {
    setSession((s) => {
      if (!s) return s;
      const next = { ...s, member: { ...s.member, ...patch } };
      saveSession(next);
      return next;
    });
  }, []);

  return { session, lookup, login, bootstrap, studentRegister, logout, updateMember };
}
