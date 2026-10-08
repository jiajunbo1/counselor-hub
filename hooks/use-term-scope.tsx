import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** 学期作用域哨兵：不限学期（等价于各页原来用的 parts.tsx ALL = "__all"） */
export const ALL_TERM = "__all";

const STORAGE_KEY = "term_scope_v1";

export interface TermScope {
  /** 选中的学期；ALL_TERM=全部学期；""=还没选出默认学期（首屏数据就绪后由 AppShell 落到最新学期） */
  term: string;
  setTerm: (v: string) => void;
}

const Ctx = createContext<TermScope | null>(null);

export function TermScopeProvider({ children }: { children: ReactNode }) {
  const [term, setTermState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      return ALL_TERM;
    }
  });
  const setTerm = useCallback((v: string) => {
    setTermState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* 无痕模式下忽略持久化失败 */
    }
  }, []);
  const value = useMemo(() => ({ term, setTerm }), [term, setTerm]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTermScope(): TermScope {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTermScope 必须在 TermScopeProvider 内使用");
  return v;
}

/** 视图取当前生效学期：把「未初始化」的空串折成 ALL，避免首屏渲染出非法值 */
export function termNow(scope: TermScope): string {
  return scope.term || ALL_TERM;
}

/** 行数据是否落在当前学期作用域内（行需带 term 字段） */
export function inTermScope(scope: TermScope, termOfRow: string | null | undefined): boolean {
  const t = termNow(scope);
  return t === ALL_TERM || termOfRow === t;
}
