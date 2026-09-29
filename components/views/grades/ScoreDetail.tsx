import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Store } from "@/hooks/use-store";
import type { Grade, Student } from "@/lib/types";
import {
  gpaPoint,
  gradesOfTerm,
  rankSummaries,
  summarizeTerm,
  termAttendDeduct,
  type TermSummary,
} from "@/lib/evaluation";
import { PASS_SCORE, fmt1, scoreTone } from "./parts";

export type ScoreDetail =
  | { kind: "term"; student: Student; term: string }
  | { kind: "grade"; grade: Grade };

export type GotoFn = (seg: string, opts?: { no?: string; term?: string }) => void;

function Line({ k, v, hint }: { k: string; v: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0 text-xs text-muted-foreground">
        {k}
        {hint ? <span className="ml-1 text-[10px] opacity-70">{hint}</span> : null}
      </span>
      <span className="min-w-0 text-right text-sm tabular-nums">{v}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="mb-0.5 mt-3 border-l-2 border-primary pl-2 text-xs font-semibold">{children}</p>;
}

export default function ScoreDetailDialog({ store, detail, goto, onClose }: { store: Store; detail: ScoreDetail; goto: GotoFn; onClose: () => void }) {
  const [expandedTerm, setExpandedTerm] = useState(false);
  const grade: Grade | null = detail.kind === "grade" && !expandedTerm ? detail.grade : null;
  const student: Student | null =
    detail.kind === "term" ? detail.student : detail.kind === "grade" ? store.students.find((s) => s.id === detail.grade.student_id) ?? null : null;
  const term = detail.kind === "term" ? detail.term : detail.grade.term;

  const termEval = useMemo(
    () => (student && !grade ? store.termEvals.find((e) => e.student_id === student.id && e.term === term) ?? null : null),
    [store.termEvals, student, term, grade]
  );
  const summary = useMemo(
    () =>
      student && !grade
        ? summarizeTerm(
            student,
            term,
            gradesOfTerm(store.grades, student.id, term),
            termEval,
            new Map(store.courses.map((c) => [c.id, c])),
            store.attendance,
            store.evaluation
          )
        : null,
    [student, grade, term, store.grades, store.courses, store.attendance, store.evaluation, termEval]
  );
  const rankInfo = useMemo(() => {
    if (!student || grade || !summary) return null;
    const cls = student.class_name || "未分班";
    const coursesById = new Map(store.courses.map((c) => [c.id, c]));
    const sums: TermSummary[] = [];
    for (const p of store.students) {
      if ((p.class_name || "未分班") !== cls) continue;
      const s = summarizeTerm(
        p,
        term,
        gradesOfTerm(store.grades, p.id, term),
        store.termEvals.find((e) => e.student_id === p.id && e.term === term) ?? null,
        coursesById,
        store.attendance,
        store.evaluation
      );
      if (s) sums.push(s);
    }
    const r = rankSummaries(sums).get(student.id);
    return r ? { rank: r, total: sums.length } : null;
  }, [student, grade, summary, term, store.students, store.grades, store.termEvals, store.courses, store.attendance, store.evaluation]);

  const closeAndGoto: GotoFn = (seg, opts) => {
    onClose();
    goto(seg, opts);
  };

  // ---- 单条考试记录 ----
  if (grade) {
    const course = store.courses.find((c) => c.id === grade.course_id) ?? null;
    const n = Number(grade.score);
    const pass = n >= PASS_SCORE;
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>考试成绩详情</DialogTitle>
            <DialogDescription>
              {grade.student_name}（{grade.student_no}）· {grade.class_name || "未分班"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-4 rounded-xl border bg-muted/30 px-4 py-3">
            <span className={"flex size-16 shrink-0 items-center justify-center rounded-xl border text-2xl font-bold tabular-nums " + scoreTone(n)}>
              {grade.score}
            </span>
            <div className="min-w-0 text-sm">
              <p className="truncate font-semibold">{course?.name ?? "（课程已删除）"}</p>
              <p className="text-xs text-muted-foreground">
                {course?.credit ? `${course.credit} 学分 · ` : ""}绩点 {gpaPoint(n).toFixed(1)}
              </p>
              <Badge variant="outline" className={"mt-1 border-transparent font-normal " + (pass ? "bg-emerald-500/10 text-emerald-700" : "bg-rose-500/10 text-rose-600")}>
                {pass ? "及格" : "不及格"}
              </Badge>
            </div>
          </div>
          <div className="mt-2">
            <Line k="学期" v={grade.term || "–"} />
            <Line k="考试日期" v={grade.exam_date || "–"} />
            <Line k="录入时间" v={grade.created_at ? grade.created_at.slice(0, 10) : "–"} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {student ? (
              <Button variant="outline" size="sm" onClick={() => setExpandedTerm(true)}>看学期综合明细</Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => closeAndGoto("list", { no: grade.student_no, term: grade.term })}>成绩清单中查看</Button>
            <Button size="sm" className="ml-auto" onClick={onClose}>关闭</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!student) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>详情</DialogTitle>
            <DialogDescription>该学生档案已删除，无法展示明细。</DialogDescription>
          </DialogHeader>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogContent>
      </Dialog>
    );
  }

  // ---- 学期综合明细 ----
  const ev = store.evaluation;
  const att = termAttendDeduct(student.id, term, store.attendance, ev);
  const deductParts = [
    att.counts.absent ? `旷课 ${att.counts.absent} 次 × ${ev.absent_deduct}` : null,
    att.counts.late + att.counts.early > 0 ? `迟到/早退 ${att.counts.late + att.counts.early} 次 × ${ev.late_deduct}` : null,
    att.counts.leave ? `请假 ${att.counts.leave} 次 × ${ev.leave_deduct}` : null,
  ].filter(Boolean) as string[];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {detail.kind === "grade" ? (
              <button type="button" className="inline-flex items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground" onClick={() => setExpandedTerm(false)}>
                <ChevronLeft className="size-4" /> 返回成绩记录
              </button>
            ) : null}
            学期综合明细 · {term || "未填学期"}
          </DialogTitle>
          <DialogDescription>
            {student.name}（{student.student_no}）· {student.class_name || "未分班"}
          </DialogDescription>
        </DialogHeader>

        <SectionTitle>考试（权重 {ev.exam_weight}%）</SectionTitle>
        {summary ? (
          <>
            {summary.rows.map((r) => (
              <Line
                key={r.grade.id}
                k={`${r.course?.name ?? "（课程已删除）"}${r.credit > 0 ? `（${r.credit} 学分）` : ""}`}
                v={
                  <span className={r.pass ? "" : "text-rose-600"}>
                    {fmt1(r.exam)} 分 · 绩点 {r.gpaPoint.toFixed(1)}
                  </span>
                }
              />
            ))}
            <Line k="学分加权考试均分" hint="Σ(分数×学分)÷Σ学分" v={<b>{fmt1(summary.examAvg)}</b>} />
            <Line k="GPA（学分加权）" v={summary.gpa ?? "–（课程均未填学分）"} />
            {summary.fails > 0 ? <p className="text-[11px] text-rose-600">本学期不及格 {summary.fails} 门（按考试分计）。</p> : null}
          </>
        ) : (
          <p className="py-1 text-sm text-amber-600">该学期还没有考试成绩。</p>
        )}

        <SectionTitle>平时（权重 {ev.usual_weight}%）</SectionTitle>
        <Line k="学期平时总评（原始）" v={summary ? (summary.usual === null ? <span className="text-amber-600">未录入</span> : fmt1(summary.usual)) : termEval?.usual_score ? fmt1(Number(termEval.usual_score)) : <span className="text-amber-600">未录入</span>} />
        <Line k="考勤扣分" hint={deductParts.join(" + ") || "本学期无扣分记录"} v={att.deduct > 0 ? <span className="font-semibold text-amber-600">−{fmt1(att.deduct)}</span> : "0"} />
        <Line k="折算平时" hint="原始−扣分，取 0-100" v={<b>{summary ? (summary.usualEff === null ? "–" : fmt1(summary.usualEff)) : "–"}</b>} />
        {termEval?.note ? <p className="text-[11px] text-muted-foreground">总评备注：{termEval.note}</p> : null}

        <SectionTitle>学期综合</SectionTitle>
        {summary ? (
          <>
            <p className="rounded-lg bg-muted/40 px-3 py-2 text-center text-sm tabular-nums">
              {summary.usualEff === null
                ? <>未录平时 → 综合 = 考试均分 = <b>{fmt1(summary.composite)}</b></>
                : <>{fmt1(summary.examAvg)} × {ev.exam_weight}% + {fmt1(summary.usualEff)} × {ev.usual_weight}% = <b className="text-base">{fmt1(summary.composite)}</b></>}
            </p>
            <div className="mt-1 flex justify-center gap-4 text-xs text-muted-foreground">
              <span>班级排名 <b className="tabular-nums text-foreground">{rankInfo ? `${rankInfo.rank}/${rankInfo.total}` : "–"}</b></span>
              <span>GPA <b className="tabular-nums text-foreground">{summary.gpa ?? "–"}</b></span>
            </div>
          </>
        ) : (
          <p className="py-1 text-sm text-muted-foreground">有考试成绩后才能合成学期综合分。</p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => closeAndGoto("list", { no: student.student_no, term })}>查看原始成绩</Button>
          <Button variant="outline" size="sm" onClick={() => closeAndGoto("attendance", { no: student.student_no, term })}>查看考勤记录</Button>
          <Button size="sm" className="ml-auto" onClick={onClose}>关闭</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
