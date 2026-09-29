// 一次性校验 lib/evaluation.ts 的考勤去重口径（跑完即删）
import { dedupeAttendance, kindDeduct, termAttendDeduct } from "../lib/evaluation.ts";

const S = { exam_weight: "60", usual_weight: "40", absent_deduct: "4", late_deduct: "1.5", leave_deduct: "0.5" };
const out = [];
const A = (id, extra) => ({ id, student_id: "stu", kind: "late", occurred_on: "2026-05-11", course_id: "math", term: "2025-2026-2", ...extra });

// 1) 同一节课：班委迟到 + 老师旷课 → 只按最重的旷课扣一次
const g1 = [A("a", { kind: "late" }), A("b", { kind: "absent" })];
const m1 = dedupeAttendance(g1, S);
const t1 = termAttendDeduct("stu", "2025-2026-2", g1, S);
out.push(m1.get("a").counted === false && m1.get("b").counted === true && m1.get("a").topId === "b" ? "PASS same slot counts only heaviest" : `FAIL g1 ${JSON.stringify([...m1])}`);
out.push(t1.deduct === 4 && t1.counts.absent === 1 && t1.counts.late === 0 ? `PASS same slot deduct=4 got=${t1.deduct} counts=${JSON.stringify(t1.counts)}` : `FAIL t1 ${t1.deduct} ${JSON.stringify(t1.counts)}`);

// 2) 同课不同日期 = 不同节课，各扣一次
const g2 = [A("a", { occurred_on: "2026-05-11" }), A("b", { occurred_on: "2026-05-12" })];
out.push(termAttendDeduct("stu", "2025-2026-2", g2, S).deduct === 3 ? "PASS different dates both count" : `FAIL g2 ${termAttendDeduct("stu", "2025-2026-2", g2, S).deduct}`);

// 3) 不同课程同一天 = 两节不同的课，都扣
const g3 = [A("a", { course_id: "math" }), A("b", { course_id: "prog" })];
out.push(termAttendDeduct("stu", "2025-2026-2", g3, S).deduct === 3 ? "PASS different courses same day both count" : `FAIL g3 ${termAttendDeduct("stu", "2025-2026-2", g3, S).deduct}`);

// 4) 课程留空退化为按日归并
const g4 = [A("a", { course_id: "", kind: "late" }), A("b", { course_id: "prog", kind: "absent", occurred_on: "2026-05-11" })];
const t4 = termAttendDeduct("stu", "2025-2026-2", g4, S);
out.push(t4.deduct === 4 && t4.counts.absent === 1 && t4.counts.late === 0 ? `PASS blank course falls back to day slot (deduct=${t4.deduct})` : `FAIL g4 ${t4.deduct} ${JSON.stringify(t4.counts)}`);

// 5) 跨学期不互相顶掉；空学期行参与每个学期
const g5 = [A("a", { term: "2025-2026-1" }), A("b", { term: "2025-2026-2" }), A("c", { term: "", occurred_on: "2026-05-11" })];
const t5 = termAttendDeduct("stu", "2025-2026-2", g5, S);
out.push(t5.deduct === 1.5 && t5.counts.late === 1 ? `PASS other-term row excluded, blank-term row joins and dedupes by day (deduct=${t5.deduct})` : `FAIL g5 ${t5.deduct} ${JSON.stringify(t5.counts)}`);

// 6) 标准变更后，计扣的那一条跟着变（不写死严重度）
const m6 = dedupeAttendance([A("a", { kind: "absent" }), A("b", { kind: "leave" })], { ...S, leave_deduct: "9" });
out.push(m6.get("b").counted === true && m6.get("a").counted === false ? "PASS counted row follows current deduct standard" : `FAIL m6 ${JSON.stringify([...m6])}`);

// 7) 三名学生同课同天：每人各自计一次，互不影响
const g7 = [A("a", { student_id: "x" }), A("b", { student_id: "y" })];
out.push(dedupeAttendance(g7, S).get("a").counted && dedupeAttendance(g7, S).get("b").counted ? "PASS dedup is per student" : "FAIL per-student dedup");

// 8) kindDeduct 覆盖四类
out.push(kindDeduct("early", S) === 1.5 && kindDeduct("leave", S) === 0.5 ? "PASS early uses late standard" : "FAIL kindDeduct");

// ---- 批次P：人工改判（counted_override）----
// 9) 先报旷课、学生后来到课 → 指定按班委补报的迟到扣，旷课条转留档
const g9 = [A("a", { kind: "absent" }), A("b", { kind: "late", counted_override: true })];
const t9 = termAttendDeduct("stu", "2025-2026-2", g9, S);
const m9 = dedupeAttendance(g9, S);
out.push(t9.deduct === 1.5 && t9.counts.late === 1 && t9.counts.absent === 0 ? `PASS manual switch to late deducts 1.5 (got ${t9.deduct})` : `FAIL g9 ${t9.deduct} ${JSON.stringify(t9.counts)}`);
out.push(m9.get("b").manual === true && m9.get("a").counted === false && m9.get("a").manual === false && m9.get("a").dup === true ? "PASS other rows in slot become 留档 and are marked dup" : `FAIL m9 ${JSON.stringify([...m9])}`);

// 10) 「这条不计」后，其余行回到自动口径取最重
const g10 = [A("a", { kind: "absent", counted_override: false }), A("b", { kind: "late" }), A("c", { kind: "leave" })];
const t10 = termAttendDeduct("stu", "2025-2026-2", g10, S);
out.push(t10.deduct === 1.5 && t10.counts.late === 1 ? `PASS excluded row falls back to heaviest of rest (got ${t10.deduct})` : `FAIL g10 ${t10.deduct} ${JSON.stringify(t10.counts)}`);

// 11) 整节课都被标不计 → 这节课不扣分
const g11 = [A("a", { kind: "absent", counted_override: false }), A("b", { kind: "late", counted_override: false })];
const t11 = termAttendDeduct("stu", "2025-2026-2", g11, S);
out.push(t11.deduct === 0 && t11.counts.absent === 0 && t11.counts.late === 0 ? "PASS all-excluded slot deducts nothing" : `FAIL g11 ${t11.deduct} ${JSON.stringify(t11.counts)}`);

// 12) 单条记录也可标不计（无同节课同伴时 dup=false，仍不参与扣分）
const g12 = [A("a", { kind: "early", counted_override: false })];
out.push(termAttendDeduct("stu", "2025-2026-2", g12, S).deduct === 0 && dedupeAttendance(g12, S).get("a").dup === false ? "PASS single excluded row deducts nothing" : "FAIL g12");

// 13) 改判只影响那一节课，其他日期照常按自动口径
const g13 = [
  A("a", { kind: "absent", occurred_on: "2026-05-11" }),
  A("b", { kind: "late", occurred_on: "2026-05-11", counted_override: true }),
  A("c", { kind: "absent", occurred_on: "2026-05-12" }),
];
out.push(termAttendDeduct("stu", "2025-2026-2", g13, S).deduct === 5.5 ? `PASS manual scope is one slot only (got ${termAttendDeduct("stu", "2025-2026-2", g13, S).deduct})` : "FAIL g13");

// 14) 未填课程按整天归并时，人工指定同样压过自动口径
const g14 = [A("a", { kind: "late", course_id: "", counted_override: true }), A("b", { kind: "absent", course_id: "prog" })];
out.push(termAttendDeduct("stu", "2025-2026-2", g14, S).deduct === 1.5 ? "PASS manual wins in day-merged slot" : `FAIL g14 ${termAttendDeduct("stu", "2025-2026-2", g14, S).deduct}`);

// 15) 恢复自动（null）后回到取最重口径
const g15 = [A("a", { kind: "absent", counted_override: null }), A("b", { kind: "late", counted_override: null })];
const t15 = termAttendDeduct("stu", "2025-2026-2", g15, S);
out.push(t15.deduct === 4 && dedupeAttendance(g15, S).get("a").manual === false ? "PASS null override restores automatic heaviest" : `FAIL g15 ${t15.deduct}`);

console.log(out.join("\n"));
console.log(out.every((r) => r.startsWith("PASS")) ? `ALL ${out.length} DEDUPE CASES PASS` : "SOME FAILED");
