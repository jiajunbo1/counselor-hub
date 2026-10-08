import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** 班级作用域哨兵：等价于各页原来用的 parts.tsx ALL = "__all" */
export const ALL_CLASS = "__all";

const STORAGE_KEY = "class_scope_v1";

export interface ClassScope {
  /** 选中的班级名；ALL_CLASS 表示不限班级 */
  cls: string;
  setCls: (v: string) => void;
}

const Ctx = createContext<ClassScope | null>(null);

export function ClassScopeProvider({ children }: { children: ReactNode }) {
  const [cls, setClsState] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || ALL_CLASS;
    } catch {
      return ALL_CLASS;
    }
  });
  const setCls = useCallback((v: string) => {
    setClsState(v);
    try {
      if (v === ALL_CLASS) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* 无痕模式下忽略持久化失败 */
    }
  }, []);
  const value = useMemo(() => ({ cls, setCls }), [cls, setCls]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useClassScope(): ClassScope {
  const v = useContext(Ctx);
  if (!v) throw new Error("useClassScope 必须在 ClassScopeProvider 内使用");
  return v;
}

/** 行数据是否落在当前班级作用域内（行需带 class_name 字段） */
export function inClassScope(scope: ClassScope, classNameOfRow: string | null | undefined): boolean {
  return scope.cls === ALL_CLASS || classNameOfRow === scope.cls;
}
