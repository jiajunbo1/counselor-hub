import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ALL_CLASS, useClassScope } from "@/hooks/use-class-scope";

/** 班级胶囊的候选项 = 全校学生班级去重升序（与侧栏选择器同源；未分班不出胶囊） */
export function classNamesOf(students: { class_name?: string | null }[]): string[] {
  return [...new Set(students.map((s) => s.class_name).filter((c): c is string => !!c))].sort();
}

/** 按班分节表格的行分块：沿用已排序的行序切成连续节，未分班固定挪到最后 */
export function sectionsByClass<T>(rows: T[], clsOf: (r: T) => string): { cls: string; rows: T[] }[] {
  const out: { cls: string; rows: T[] }[] = [];
  for (const r of rows) {
    const cls = clsOf(r) || "未分班";
    const last = out[out.length - 1];
    if (last && last.cls === cls) last.rows.push(r);
    else out.push({ cls, rows: [r] });
  }
  const i = out.findIndex((s) => s.cls === "未分班");
  if (i >= 0 && i < out.length - 1) out.push(out.splice(i, 1)[0]);
  return out;
}

/** 节头折叠状态；key 由各屏给出（跨学期的屏用 `${term}|${cls}`）。折叠只在「全部班级」下生效，各屏自行加 scope 判断 */
export function useCollapsedSections() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { collapsed, toggle };
}

/** 节头内容：左缘渐变竖条 + 班名，右侧人数、挂科数（>0 才显示）与折叠箭头，整条可点按 */
function BandInner({ cls, count, fails, collapsed, onToggle }: { cls: string; count: number; fails: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={onToggle}
      title={collapsed ? "展开该班" : "收起该班"}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span aria-hidden className="h-3.5 w-1 shrink-0 rounded-full" style={{ backgroundImage: "var(--grad-primary)" }} />
      <span className="text-[13px] font-semibold text-foreground/90">{cls}</span>
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count} 人</span>
      {fails > 0 ? <span className="text-xs font-medium tabular-nums text-rose-600">挂科 {fails} 人</span> : null}
      <ChevronDown className={"size-3.5 shrink-0 text-muted-foreground transition-transform " + (collapsed ? "-rotate-90" : "")} />
    </button>
  );
}

/** 班级节头行（仅「全部班级」时渲染）；count=该节学生数，fails=班内挂科人数（0 不显示）；点击整行折叠/展开本节 */
export function SectionBand({ colSpan, cls, count, fails = 0, collapsed, onToggle }: { colSpan: number; cls: string; count: number; fails?: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <tr className="border-t bg-muted/40">
      <td colSpan={colSpan} className="p-0">
        <BandInner cls={cls} count={count} fails={fails} collapsed={collapsed} onToggle={onToggle} />
      </td>
    </tr>
  );
}

/** 卡片版式的班级节头（成绩单这类非表格场景，仅「全部班级」时渲染） */
export function SectionHeader({ cls, count, fails = 0, collapsed, onToggle }: { cls: string; count: number; fails?: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <div className="overflow-hidden rounded-lg bg-muted/40">
      <BandInner cls={cls} count={count} fails={fails} collapsed={collapsed} onToggle={onToggle} />
    </div>
  );
}

/**
 * 班级胶囊行：点=切全局「当前班级」作用域（全站联动）。
 * counts 由各屏按自己的筛选口径算好传入（不受班级选择与搜索框影响）。
 */
export function ClassChips({ classNames, counts, allCount }: { classNames: string[]; counts: Map<string, number>; allCount: number }) {
  const scope = useClassScope();
  const options = [{ value: ALL_CLASS, label: "全部班级", count: allCount }, ...classNames.map((c) => ({ value: c, label: c, count: counts.get(c) ?? 0 }))];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">班级</span>
      {options.map((c) => {
        const active = scope.cls === c.value;
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={active}
            onClick={() => scope.setCls(c.value)}
            className={
              "flex max-w-48 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50 " +
              (active ? "border-transparent text-white" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground")
            }
            style={active ? { backgroundImage: "var(--grad-primary)", boxShadow: "var(--shadow-glow)" } : undefined}
          >
            <span className="truncate">{c.label}</span>
            <span className={"shrink-0 tabular-nums " + (active ? "text-white/85" : "text-muted-foreground/70")}>{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}
