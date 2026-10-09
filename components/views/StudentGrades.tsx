import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/section-card";
import { EmptyHint } from "@/components/form";
import type { Store } from "@/hooks/use-store";
import type { MemberUser } from "@/lib/session";
import { PASS_SCORE, gradesOfTerm, summarizeTerm, type CourseRow } from "@/lib/evaluation";
import type { Course } from "@/lib/types";

// 学生端成绩：只读、只见本人。汇总口径与辅导员端同一函数（lib/evaluation），
// 保证「学生看到的均分/综合」和「辅导员台账」不会出现两套数。
// 按用户口径不展示名次。
// 学生端不返回课程表（courses 为空），但本人成绩行带有后端联查的 course_name / course_credit，
// 用它们还原出课程信息，保证均分、绩点与辅导员台账是同一套口径。
export default function StudentGradesView({ store, member }: { store: Store; member: MemberUser }) {
  const self = store.students.find((s) => s.id === member.student_id) ?? null;
  const myGrades = useMemo(
    () => (self ? store.grades.filter((g) => g.student_id === self.id) : []),
    [store.grades, self]
  );
  const coursesById = useMemo(() => {
    const m = new Map<string, Course>();
    store.courses.forEach((c) => m.set(c.id, c));
    myGrades.forEach((g) => {
      if (!g.course_id || m.has(g.course_id)) return;
      m.set(g.course_id, {
        id: g.course_id,
        name: g.course_name ?? "",
        course_code: "",
        teacher: "",
        semester: g.term,
        class_name: "",
        schedule: "",
        classroom: "",
        credit: g.course_credit ?? "",
        created_at: "",
      });
    });
    return m;
  }, [store.courses, myGrades]);

  const groups = useMemo(() => {
    if (!self) return [];
    const myTerms = [...new Set(myGrades.map((g) => g.term || ""))].sort().reverse();
    const out: { term: string; examAvg: number; composite: number; gpa: number | null; fails: number; rows: CourseRow[] }[] = [];
    for (const term of myTerms) {
      const summary = summarizeTerm(
        self,
        term,
        gradesOfTerm(store.grades, self.id, term),
        store.termEvals.find((t) => t.student_id === self.id && t.term === term) ?? null,
        coursesById,
        store.attendance,
        store.evaluation
      );
      if (!summary) continue;
      out.push({
        term,
        examAvg: summary.examAvg,
        composite: summary.composite,
        gpa: summary.gpa,
        fails: summary.fails,
        rows: [...summary.rows].sort((a, b) => (a.course?.name ?? "").localeCompare(b.course?.name ?? "")),
      });
    }
    return out;
  }, [self, myGrades, store.grades, store.termEvals, store.attendance, store.evaluation, coursesById]);

  const totalRows = groups.reduce((n, g) => n + g.rows.length, 0);

  if (!self) {
    return (
      <section className="space-y-4">
        <h1 className="text-lg font-bold">我的成绩</h1>
        <EmptyHint text="账号尚未绑定学籍信息，无法查询成绩。请先在「我的信息」补全资料或联系辅导员确认学号。" />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">我的成绩</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {self.name} · 学号 {self.student_no}
          {totalRows > 0 ? ` · 共 ${totalRows} 门 / ${groups.length} 个学期` : ""}
        </p>
      </div>

      {groups.length === 0 ? (
        <EmptyHint text="辅导员还没有登记成绩。" />
      ) : (
        <div className="stack-page">
          {groups.map((g) => (
            <SectionCard
              key={g.term || "__none"}
              title={g.term || "未标学期"}
              subtitle={`考试均分 ${g.examAvg} · 学期综合 ${g.composite}${g.gpa !== null ? ` · 绩点 ${g.gpa.toFixed(2)}` : ""}`}
              count={`${g.rows.length} 门`}
              padded={false}
            >
              <ul>
                {g.rows.map((r) => (
                  <li key={r.grade.id} className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-sm first:border-t-0">
                    <span className="min-w-0 truncate">
                      {r.course?.name ?? "未关联课程"}
                      {r.credit > 0 ? <span className="ml-1 text-xs text-muted-foreground">{r.credit} 学分</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {!r.pass ? <Badge variant="outline" className="border-transparent bg-destructive/10 font-normal text-destructive">不及格</Badge> : null}
                      <span className={"num font-semibold " + (r.pass ? "" : "text-destructive")}>{r.grade.score}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ))}
        </div>
      )}

      {groups.length > 0 ? (
        <p className="text-xs leading-5 text-muted-foreground">
          考试均分按学分加权；学期综合含辅导员登记的平时总评（按辅导员设定的权重折算）；
          低于 {PASS_SCORE} 分的课程记为不及格。成绩以辅导员登记为准，如有疑问请在「留言」中说明。
        </p>
      ) : null}
    </section>
  );
}
