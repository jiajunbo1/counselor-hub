import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TableShell } from "@/components/list-table";
import type { Store } from "@/hooks/use-store";
import { ALL_CLASS, inClassScope, useClassScope } from "@/hooks/use-class-scope";
import { termNow, useTermScope } from "@/hooks/use-term-scope";
import type { Grade } from "@/lib/types";
import { summarizeTerm, type TermSummary } from "@/lib/evaluation";
import { compareRankSortable, rankRowsByClass, type RankSortMode } from "@/lib/rank-view";
import { RankSortControl, sortCaption, SECTION_SORT_OPTIONS } from "./SortControl";
import { ClassChips, SectionBand, classNamesOf, sectionsByClass, useCollapsedSections } from "./class-section";
import { exportCsv } from "@/lib/import-export";
import { ALL, evalFormulaNote, fmt1, HOT_CLASS, ScoreCell } from "./parts";
import ScoreDetailDialog, { type GotoFn, type ScoreDetail } from "./ScoreDetail";

function HotValue({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={"inline-block rounded px-1 underline decoration-dotted decoration-from-font underline-offset-4 " + HOT_CLASS}>
      {children}
    </button>
  );
}

export default function MatrixView({ store, goto }: { store: Store; goto: GotoFn }) {
  const terms = useMemo(() => [...new Set(store.grades.map((g) => g.term).filter(Boolean))].sort(), [store.grades]);
  const latestTerm = terms.length > 0 ? terms[terms.length - 1] : "";
  // 学期跟随侧栏全局作用域；矩阵只能展示单学期，「全部学期」时给出提示
  const termScope = useTermScope();
  const term = termNow(termScope);
  const scope = useClassScope();
  const [sortMode, setSortMode] = useState<RankSortMode>("class_rank");
  const [detail, setDetail] = useState<ScoreDetail | null>(null);
  const { collapsed, toggle: toggleSection } = useCollapsedSections();

  const activeTerm = term === ALL ? "" : term;
  const coursesById = useMemo(() => new Map(store.courses.map((c) => [c.id, c])), [store.courses]);
  const evalByStudentTerm = useMemo(
    () => new Map(store.termEvals.map((e) => [`${e.student_id}|${e.term}`, e])),
    [store.termEvals]
  );

  const model = useMemo(() => {
    const grades: Grade[] = store.grades.filter((g) => g.term === activeTerm);
    const inScope = new Set(grades.map((g) => g.student_id));
    const students = store.students.filter((s) => inScope.has(s.id) && inClassScope(scope, s.class_name));
    const studentIds = new Set(students.map((s) => s.id));

    const colIds = [...new Set(grades.filter((g) => studentIds.has(g.student_id)).map((g) => g.course_id))];
    const columns = colIds
      .map((id) => ({ id, name: coursesById.get(id)?.name ?? "（课程已删除）", credit: coursesById.get(id)?.credit ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh"));

    const rows = students.map((s) => {
      const gs = grades.filter((g) => g.student_id === s.id);
      const cells = new Map<string, Grade>();
      for (const g of gs) cells.set(g.course_id, g);
      const summary: TermSummary | null = summarizeTerm(s, activeTerm, gs, evalByStudentTerm.get(`${s.id}|${activeTerm}`) ?? null, coursesById, store.attendance, store.evaluation);
      return { student: s, cells, summary };
    });

    const rankOf = rankRowsByClass(rows);
    const ranked = rows.map((r) => ({ ...r, rankRow: rankOf.get(r.student.id) ?? null }));
    ranked.sort(compareRankSortable(sortMode, true));

    return { columns, rows: ranked };
  }, [store.grades, store.students, store.attendance, store.evaluation, coursesById, evalByStudentTerm, activeTerm, scope, sortMode]);

  const sections = useMemo(() => sectionsByClass(model.rows, (r) => r.student.class_name), [model.rows]);
  const classNames = useMemo(() => classNamesOf(store.students), [store.students]);

  // 班级胶囊人数 = 该班在该学期有成绩的学生数（矩阵无搜索/其它子筛选；不受班级选择影响）
  const chipCounts = useMemo(() => {
    const byClass = new Map<string, Set<string>>();
    const all = new Set<string>();
    const studentsById = new Map(store.students.map((s) => [s.id, s]));
    for (const g of store.grades) {
      if (g.term !== activeTerm) continue;
      const s = studentsById.get(g.student_id);
      if (!s) continue;
      all.add(s.id);
      const cls = s.class_name || "未分班";
      const set = byClass.get(cls);
      if (set) set.add(s.id);
      else byClass.set(cls, new Set([s.id]));
    }
    return { byClass: new Map([...byClass].map(([k, v]) => [k, v.size])), all: all.size };
  }, [store.grades, store.students, activeTerm]);

  const exportMatrix = () => {
    if (model.rows.length === 0) return toast.error("当前范围内没有成绩数据。");
    exportCsv(
      `成绩公示-${activeTerm}-${scope.cls === ALL_CLASS ? "全部班级" : scope.cls}.csv`,
      ["学号", "姓名", "班级", ...model.columns.map((c) => c.name + (c.credit ? `(${c.credit})` : "")), "考试均分", "平时折算", "学期综合", "GPA", "排名"],
      model.rows.map((r) => {
        const rk = r.rankRow;
        return [
          r.student.student_no, r.student.name, r.student.class_name,
          ...model.columns.map((c) => {
            const gr = r.cells.get(c.id);
            return gr ? gr.score : "";
          }),
          r.summary ? String(r.summary.examAvg) : "",
          r.summary ? (r.summary.usualEff === null ? "未录" : String(r.summary.usualEff)) : "",
          r.summary ? String(r.summary.composite) : "",
          r.summary?.gpa !== undefined && r.summary?.gpa !== null ? String(r.summary.gpa) : "",
          rk ? `${rk.rank}/${rk.total}` : "",
        ];
      })
    );
    toast.success("公示表已开始下载。");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {term !== ALL ? <span className="text-xs font-semibold text-muted-foreground">{term}</span> : null}
        <RankSortControl mode={sortMode} onMode={setSortMode} options={SECTION_SORT_OPTIONS} />
        <Button variant="outline" size="sm" className="ml-auto" onClick={exportMatrix}>
          <Download className="size-4" /> 导出公示表
        </Button>
      </div>

      {term === ALL ? (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground shadow-xs">
          报表矩阵一次只展示一个学期，请在左侧「当前学期」选定具体学期。
          {latestTerm ? (
            <Button variant="outline" size="sm" onClick={() => termScope.setTerm(latestTerm)}>
              跳到最新学期（{latestTerm}）
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <ClassChips classNames={classNames} counts={chipCounts.byClass} allCount={chipCounts.all} />
          {model.rows.length === 0 ? (
            <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground shadow-xs">
              该学期/班级还没有成绩记录，请到「成绩清单」录入或导入。
            </div>
          ) : (
            <>
              <TableShell>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-[11px] text-muted-foreground">
                      <th className="col-sticky-left px-3 py-2 text-left font-medium">姓名 / 学号</th>
                      <th className="px-2 py-2 text-center font-medium">名次</th>
                      {model.columns.map((c) => (
                        <th key={c.id} className="min-w-16 px-2 py-2 text-center font-medium">
                          <span className="block max-w-24 truncate" title={c.name}>{c.name}</span>
                          {c.credit ? <span className="font-normal">({c.credit}学分)</span> : null}
                        </th>
                      ))}
                      <th className="px-2 py-2 text-center font-medium">考试均分</th>
                      <th className="px-2 py-2 text-center font-medium">平时</th>
                      <th className="px-2 py-2 text-center font-medium">综合</th>
                      <th className="px-2 py-2 text-center font-medium">GPA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sections.map((sec) => {
                      const isCollapsed = scope.cls === ALL_CLASS && collapsed.has(sec.cls);
                      return (
                      <Fragment key={sec.cls}>
                        {scope.cls === ALL_CLASS ? (
                          <SectionBand
                            colSpan={model.columns.length + 6}
                            cls={sec.cls}
                            count={sec.rows.length}
                            fails={sec.rows.filter((r) => (r.summary?.fails ?? 0) > 0).length}
                            collapsed={isCollapsed}
                            onToggle={() => toggleSection(sec.cls)}
                          />
                        ) : null}
                        {isCollapsed ? null : sec.rows.map((r) => {
                          const rk = r.rankRow;
                          return (
                            <tr key={r.student.id} className="border-t">
                              <td className="col-sticky-left px-3 py-1.5 whitespace-nowrap">
                                <span className="font-medium">{r.student.name}</span>
                                <span className="ml-1 text-xs text-muted-foreground">{r.student.student_no}</span>
                              </td>
                              <td className="px-2 py-1.5 text-center text-xs font-semibold tabular-nums text-muted-foreground whitespace-nowrap">
                                {rk ? `#${rk.rank}/${rk.total}` : "未定"}
                              </td>
                              {model.columns.map((c) => {
                                const gr = r.cells.get(c.id);
                                return (
                                  <td key={c.id} className="px-2 py-1.5 text-center">
                                    <ScoreCell value={gr ? Number(gr.score) : null} className="size-9 text-xs" onClick={gr ? () => setDetail({ kind: "grade", grade: gr }) : undefined} />
                                  </td>
                                );
                              })}
                              <td className="px-2 py-1.5 text-center tabular-nums">{r.summary ? fmt1(r.summary.examAvg) : "–"}</td>
                              <td className="px-2 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                                {r.summary ? (r.summary.usualEff === null ? <span className="text-amber-600">未录</span> : fmt1(r.summary.usualEff)) : "–"}
                              </td>
                              <td className="px-2 py-1.5 text-center font-semibold tabular-nums">
                                {r.summary ? <HotValue onClick={() => setDetail({ kind: "term", student: r.student, term: activeTerm })}>{fmt1(r.summary.composite)}</HotValue> : "–"}
                              </td>
                              <td className="px-2 py-1.5 text-center tabular-nums">{r.summary?.gpa ?? "–"}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </TableShell>
              <p className="px-1 text-[11px] text-muted-foreground">
                {evalFormulaNote(store.evaluation)}，排名按学期综合分 · 当前{sortCaption(sortMode)}。
              </p>
            </>
          )}
        </>
      )}
      {detail ? (
        <ScoreDetailDialog
          key={detail.kind === "grade" ? "g" + detail.grade.id : "t" + detail.student.id + "|" + detail.term}
          store={store}
          detail={detail}
          goto={goto}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </div>
  );
}
