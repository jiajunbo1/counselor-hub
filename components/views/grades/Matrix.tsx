import { useMemo, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Store } from "@/hooks/use-store";
import { ALL_CLASS, inClassScope, useClassScope } from "@/hooks/use-class-scope";
import { termNow, useTermScope } from "@/hooks/use-term-scope";
import type { Grade } from "@/lib/types";
import { summarizeTerm, type TermSummary } from "@/lib/evaluation";
import { compareRankSortable, rankRowsByClass, type RankSortMode } from "@/lib/rank-view";
import { RankSortControl, sortCaption, sortOptionsFor } from "./SortControl";
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
  const [groupByClass, setGroupByClass] = useState(true);
  const [detail, setDetail] = useState<ScoreDetail | null>(null);

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
    ranked.sort(compareRankSortable(sortMode, groupByClass));

    return { columns, rows: ranked };
  }, [store.grades, store.students, store.attendance, store.evaluation, coursesById, evalByStudentTerm, activeTerm, scope, sortMode, groupByClass]);

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
        <RankSortControl
          mode={sortMode}
          onMode={setSortMode}
          options={sortOptionsFor(scope.cls === ALL_CLASS, true)}
          groupByClass={groupByClass}
          onGroupByClass={setGroupByClass}
          showGroupToggle={scope.cls === ALL_CLASS && sortMode === "composite"}
        />
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
      ) : model.rows.length === 0 ? (
        <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground shadow-xs">
          该学期/班级还没有成绩记录，请到「成绩清单」录入或导入。
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/40 text-[11px] text-muted-foreground">
                  <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">姓名 / 学号</th>
                  <th className="px-2 py-2 text-left font-medium">班级</th>
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
                {model.rows.map((r) => {
                  const rk = r.rankRow;
                  return (
                    <tr key={r.student.id} className="border-t">
                      <td className="sticky left-0 z-10 bg-card px-3 py-1.5 whitespace-nowrap">
                        <span className="mr-1.5 text-xs font-semibold tabular-nums text-muted-foreground">{rk ? `#${rk.rank}/${rk.total}` : "未定"}</span>
                        <span className="font-medium">{r.student.name}</span>
                        <span className="ml-1 text-xs text-muted-foreground">{r.student.student_no}</span>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap">{r.student.class_name || "未分班"}</td>
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
              </tbody>
            </table>
          </div>
          <p className="px-1 text-[11px] text-muted-foreground">
            {evalFormulaNote(store.evaluation)}，排名按学期综合分 · 当前{sortCaption(sortMode, groupByClass)}。
          </p>
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
