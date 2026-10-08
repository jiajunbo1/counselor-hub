import type { Student } from "@/lib/types";
import type { TermSummary } from "@/lib/evaluation";
import { rankSummaries } from "@/lib/evaluation";

export interface RankRow {
  rank: number;
  total: number;
  composite: number | null;
}

/**
 * 按「同班同学」为单位算班内名次。summary 为 null（该学期无成绩）的学生不参与名次，
 * 名次留空，排序时统一落到末尾，避免被误读成「垫底」。
 */
export function rankRowsByClass(rows: { student: Student; summary: TermSummary | null }[]): Map<string, RankRow> {
  const byClass = new Map<string, TermSummary[]>();
  for (const r of rows) {
    if (!r.summary) continue;
    const key = r.student.class_name || "未分班";
    const group = byClass.get(key);
    if (group) group.push(r.summary);
    else byClass.set(key, [r.summary]);
  }

  const out = new Map<string, RankRow>();
  for (const [, group] of byClass) {
    const m = rankSummaries(group);
    for (const g of group) {
      out.set(g.student.id, { rank: m.get(g.student.id) ?? 0, total: group.length, composite: g.composite });
    }
  }
  return out;
}

export type RankSortMode = "class_rank" | "all_rank" | "composite" | "student_no";

export interface RankSortable {
  student: Student;
  rankRow: RankRow | null;
}

const zh = (a: string, b: string) => a.localeCompare(b, "zh");
const noAsc = (a: RankSortable, b: RankSortable) => a.student.student_no.localeCompare(b.student.student_no);
const classKey = (r: RankSortable) => r.student.class_name || "未分班";

/** rank 口径始终是班内名次；composite 直接比分，跨班时更贴近「年级排名」的直觉 */
export function compareRankSortable(mode: RankSortMode, groupByClass: boolean) {
  const useClass = mode === "class_rank" || (mode !== "all_rank" && groupByClass);
  return (a: RankSortable, b: RankSortable): number => {
    if (mode === "student_no") return zh(classKey(a), classKey(b)) || noAsc(a, b);
    if (useClass) {
      const c = zh(classKey(a), classKey(b));
      if (c) return c;
    }
    const ra = a.rankRow;
    const rb = b.rankRow;
    if (!ra || !rb) return ra ? -1 : rb ? 1 : noAsc(a, b);
    if (mode === "composite") {
      const d = (rb.composite ?? -Infinity) - (ra.composite ?? -Infinity);
      if (d) return d;
    }
    if (ra.rank !== rb.rank) return ra.rank - rb.rank;
    return noAsc(a, b);
  };
}
