// 综合测评口径（批次 M 修订版）：单科只记考试分；平时分=学期总评（辅导员期末评定），
// 考勤台账按学期自动扣分折算；学期综合 = 学分加权考试均分×exam_weight% + 折算平时×usual_weight%。
// 考勤去重（批次 O）：同一学生同一节课（课程+日期）只扣一次，班委上报与老师登记不重复扣分；
//   当天存在未填课程的记录时，整天并成一节课处理（宁可少扣，不对同一节课重复扣分）。
// 人工改判（批次 P）：先报旷课、学生后来又到课这类情况，辅导员可在台账一键指定「按这条扣」或
// 「这条不计」，人工标记优先于自动口径；改动记录的日期/课程后标记自动失效，回到自动口径。
// 全部前端实时计算，权重调整即时全班重算。
import type { AttendanceItem, Course, EvaluationSettings, Grade, Student, TermEvaluation } from "@/lib/types";

export const PASS_SCORE = 60;

// 百分制 → 4.0 绩点：60 分得 1.0，90 分及以上 4.0，不及格 0（只按考试分）
export function gpaPoint(score: number): number {
  if (score < PASS_SCORE) return 0;
  return Math.min(4, Math.round(((score - 50) / 10) * 10) / 10);
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export interface CourseRow {
  grade: Grade;
  course: Course | null;
  credit: number;
  exam: number;
  gpaPoint: number;
  pass: boolean;
}

export function courseCredit(course: Course | null): number {
  const n = Number(course?.credit ?? "");
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function buildCourseRow(g: Grade, coursesById: Map<string, Course>): CourseRow {
  const course = coursesById.get(g.course_id) ?? null;
  const exam = Number(g.score);
  return { grade: g, course, credit: courseCredit(course), exam, gpaPoint: gpaPoint(exam), pass: exam >= PASS_SCORE };
}

/** 单条考勤在当前标准下的扣分值 */
export function kindDeduct(kind: AttendanceItem["kind"], settings: EvaluationSettings): number {
  if (kind === "absent") return Number(settings.absent_deduct);
  if (kind === "leave") return Number(settings.leave_deduct);
  return Number(settings.late_deduct); // late / early 共用迟到标准
}

/**
 * 同一学生同一节课只计一次扣分：默认取当前标准下扣得最重的一条计扣，其余仅留档。
 * 「一节课」= 学生 + 日期 + 课程；当天有记录没填课程时，无法确定是不是另一节课，
 * 保守地把当天并成一节课处理（宁可少扣，也不对同一节课重复扣分）。
 * 人工改判（counted_override）优先于自动口径：
 *   true  → 这条计扣，同节课其他条一律转留档（即使扣得更多）；
 *   false → 这条永不计扣，其余行回到自动口径；
 *   全组都被标 false → 这节课不扣分。
 */
export interface AttendMark {
  counted: boolean;
  /** 自动口径下这节课的计扣候选（最重的一条），供 UI 说明「本来该按哪条扣」 */
  topId: string;
  /** 该条是否为人工指定结果（true/false 标记），用于区分「自动取最重」与「老师改判」 */
  manual: boolean;
  /** 这节课是否还有其他记录（只有存在同伴记录时人工改判才有「换一条」的意义） */
  dup: boolean;
}

export function dedupeAttendance(rows: AttendanceItem[], settings: EvaluationSettings): Map<string, AttendMark> {
  const byDay = new Map<string, AttendanceItem[]>();
  for (const a of rows) {
    const dayKey = `${a.student_id}|${a.occurred_on}`;
    const list = byDay.get(dayKey);
    if (list) list.push(a);
    else byDay.set(dayKey, [a]);
  }
  const groups = new Map<string, AttendanceItem[]>();
  for (const [dayKey, dayRows] of byDay) {
    const loose = dayRows.some((a) => !a.course_id);
    for (const a of dayRows) {
      const key = loose ? dayKey : `${dayKey}|${a.course_id}`;
      const list = groups.get(key);
      if (list) list.push(a);
      else groups.set(key, [a]);
    }
  }
  const marks = new Map<string, AttendMark>();
  for (const list of groups.values()) {
    const autoRows = list.filter((a) => a.counted_override == null);
    const manualCounted = list.filter((a) => a.counted_override === true);
    let top = autoRows[0];
    let topValue = top ? kindDeduct(top.kind, settings) : -1;
    for (const a of autoRows.slice(1)) {
      const v = kindDeduct(a.kind, settings);
      if (v > topValue) {
        top = a;
        topValue = v;
      }
    }
    const topId = (top ?? list[0]).id;
    const dup = list.length > 1;
    for (const a of list) {
      if (a.counted_override === true) {
        marks.set(a.id, { counted: true, topId, manual: true, dup });
      } else if (a.counted_override === false) {
        marks.set(a.id, { counted: false, topId, manual: true, dup });
      } else {
        marks.set(a.id, { counted: manualCounted.length === 0 && a.id === topId, topId, manual: false, dup });
      }
    }
  }
  return marks;
}

/** 整学期考勤汇总扣分（course_id 用于识别同一节课，重复记录不重复扣分） */
export function termAttendDeduct(studentId: string, term: string, attendance: AttendanceItem[], settings: EvaluationSettings) {
  const scoped = attendance.filter((a) => a.student_id === studentId && (a.term === term || a.term === ""));
  const marks = dedupeAttendance(scoped, settings);
  const counts = { absent: 0, late: 0, leave: 0, early: 0 };
  let deduct = 0;
  for (const a of scoped) {
    if (!marks.get(a.id)?.counted) continue;
    if (a.kind in counts) counts[a.kind as keyof typeof counts] += 1;
    deduct += kindDeduct(a.kind, settings);
  }
  return { counts, deduct: Math.min(Math.round(deduct * 10) / 10, 100), marks };
}

export interface TermSummary {
  student: Student;
  term: string;
  rows: CourseRow[];
  /** 学分加权考试均分 */
  examAvg: number;
  gpa: number | null;
  fails: number;
  /** 辅导员录入的学期平时总评（原始分）；未录入为 null */
  usual: number | null;
  deduct: number;
  usualEff: number | null;
  /** 学期综合分；无平时总评时 = 考试均分 */
  composite: number;
  counts: { absent: number; late: number; leave: number; early: number };
}

export function summarizeTerm(student: Student, term: string, grades: Grade[], termEval: TermEvaluation | null, coursesById: Map<string, Course>, attendance: AttendanceItem[], settings: EvaluationSettings): TermSummary | null {
  const rows = grades.map((g) => buildCourseRow(g, coursesById));
  if (rows.length === 0) return null;
  let examSum = 0;
  let creditSum = 0;
  let pointSum = 0;
  let pointCredits = 0;
  let fails = 0;
  for (const r of rows) {
    if (!Number.isFinite(r.exam)) continue;
    if (!r.pass) fails += 1;
    examSum += r.exam * (r.credit || 1);
    creditSum += r.credit || 1;
    if (r.credit > 0) {
      pointSum += r.gpaPoint * r.credit;
      pointCredits += r.credit;
    }
  }
  if (creditSum === 0) return null;
  const examAvg = round1(examSum / creditSum);
  const usual = termEval && termEval.usual_score !== "" && termEval.usual_score != null ? Number(termEval.usual_score) : null;
  const { counts, deduct } = termAttendDeduct(student.id, term, attendance, settings);
  const usualEff = usual === null ? null : Math.max(0, Math.min(100, round1(usual - deduct)));
  const ew = Number(settings.exam_weight);
  const uw = Number(settings.usual_weight);
  const composite = usualEff === null ? examAvg : round1((examAvg * ew + usualEff * uw) / 100);
  return {
    student, term, rows, examAvg,
    gpa: pointCredits === 0 ? null : Math.round((pointSum / pointCredits) * 100) / 100,
    fails, usual, deduct, usualEff, composite, counts,
  };
}

/** 汇总某学生在给定学期内的所有成绩行（按 grade.term 字段匹配） */
export function gradesOfTerm(grades: Grade[], studentId: string, term: string): Grade[] {
  return grades.filter((g) => g.student_id === studentId && g.term === term);
}

/** 在同班级（或全体）范围内按学期综合分降序排名，返回 学生id → 名次 */
export function rankSummaries(summaries: TermSummary[]): Map<string, number> {
  const sorted = [...summaries].sort((a, b) => b.composite - a.composite || a.student.student_no.localeCompare(b.student.student_no));
  const map = new Map<string, number>();
  sorted.forEach((s, i) => map.set(s.student.id, i + 1));
  return map;
}
