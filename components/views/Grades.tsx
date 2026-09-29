import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ImportDialog from "@/components/ImportDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { DateInput, EmptyHint, FormField, Select } from "@/components/form";
import type { Store } from "@/hooks/use-store";
import type { Grade } from "@/lib/types";
import { GRADE_COLUMNS, normalizeDate } from "@/lib/import-export";
import TranscriptView from "./grades/Transcript";
import MatrixView from "./grades/Matrix";
import AttendanceView from "./grades/Attendance";
import TermEvalView from "./grades/TermEval";
import ScoreDetailDialog, { type GotoFn, type ScoreDetail } from "./grades/ScoreDetail";
import { ALL, PASS_SCORE, SCORE_RE, scoreTone, SegPills } from "./grades/parts";

const SORT_OPTIONS = [
  { value: "exam_date", label: "按考试日期" },
  { value: "score", label: "按考试成绩" },
  { value: "student_no", label: "按学号" },
  { value: "course_name", label: "按课程" },
  { value: "class_name", label: "按班级" },
];

interface GradeDraft {
  student_id: string;
  course_id: string;
  term: string;
  score: string;
  exam_date: string;
}

function GradeFormDialog({ grade, onClose, store }: { grade: Grade | null; onClose: () => void; store: Store }) {
  const isEdit = grade !== null;
  const [draft, setDraft] = useState<GradeDraft>(
    grade
      ? { student_id: grade.student_id, course_id: grade.course_id, term: grade.term, score: grade.score, exam_date: grade.exam_date }
      : { student_id: "", course_id: "", term: "", score: "", exam_date: new Date().toISOString().slice(0, 10) }
  );
  const [busy, setBusy] = useState(false);

  const student = store.students.find((s) => s.id === draft.student_id) ?? null;
  const course = store.courses.find((c) => c.id === draft.course_id) ?? null;
  const studentOptions = [
    { value: "", label: "请选择学生" },
    ...store.students.map((s) => ({ value: s.id, label: `${s.name}（${s.student_no}）· ${s.class_name || "未分班"}` })),
  ];
  const courseOptions = [
    { value: "", label: "请选择课程" },
    ...store.courses.map((c) => ({ value: c.id, label: `${c.name}${c.semester ? ` · ${c.semester}` : ""}` })),
  ];

  const pickCourse = (courseId: string) => {
    const c = store.courses.find((x) => x.id === courseId) ?? null;
    setDraft((d) => ({ ...d, course_id: courseId, term: c?.semester ?? d.term }));
  };

  const submit = async () => {
    if (!draft.student_id) return toast.error("请选择学生。");
    if (!draft.course_id) return toast.error("请选择课程。");
    if (!SCORE_RE.test(draft.score) || Number(draft.score) > 100) return toast.error("考试分数需为 0-100，最多两位小数。");
    if (!draft.term.trim()) return toast.error("请填写学期，如 2025-2026-2。");
    setBusy(true);
    const payload = { ...draft, term: draft.term.trim(), score: draft.score };
    const ok = isEdit
      ? await store.write("grade.update", { id: grade.id, ...payload })
      : await store.write("grade.create", payload);
    setBusy(false);
    if (ok) {
      toast.success(isEdit ? "成绩已更新" : "成绩已录入");
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "修改成绩" : "录入成绩"}</DialogTitle>
          <DialogDescription>选择学生后，姓名、学号、班级自动从学生档案同步。这里只登记单科考试总分；学期平时总评请到「综合测评」分段录入。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="学生" required>
            <Select value={draft.student_id} onValueChange={(v) => setDraft((d) => ({ ...d, student_id: v }))} options={studentOptions} />
          </FormField>
          {student ? (
            <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              已自动同步：姓名 <span className="font-medium text-foreground">{student.name}</span> · 学号{" "}
              <span className="font-medium text-foreground">{student.student_no}</span> · 班级{" "}
              <span className="font-medium text-foreground">{student.class_name || "未分班"}</span>
            </div>
          ) : null}
          <FormField label="课程" required>
            <Select value={draft.course_id} onValueChange={pickCourse} options={courseOptions} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="学期" required>
              <Input
                value={draft.term}
                onChange={(e) => setDraft((d) => ({ ...d, term: e.target.value }))}
                placeholder={course?.semester || "如：2025-2026-2"}
                maxLength={32}
              />
            </FormField>
            <FormField label="考试日期">
              <DateInput value={draft.exam_date} onChange={(v) => setDraft((d) => ({ ...d, exam_date: v }))} />
            </FormField>
          </div>
          <FormField label="考试成绩" required>
            <Input
              value={draft.score}
              onChange={(e) => setDraft((d) => ({ ...d, score: e.target.value }))}
              inputMode="decimal"
              placeholder="0-100"
              maxLength={8}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "保存中…" : "保存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GradesListView({ store, goto, focusNo, focusTerm }: { store: Store; goto: GotoFn; focusNo?: string; focusTerm?: string }) {
  const { grades, courses } = store;
  const [keyword, setKeyword] = useState(focusNo ?? "");
  const [cls, setCls] = useState(ALL);
  const [courseId, setCourseId] = useState(ALL);
  const [term, setTerm] = useState(focusTerm ?? ALL);
  const [minScore, setMinScore] = useState("");
  const [maxScore, setMaxScore] = useState("");
  const [failOnly, setFailOnly] = useState(false);
  const [sortKey, setSortKey] = useState("exam_date");
  const [sortAsc, setSortAsc] = useState(false);
  const [formGrade, setFormGrade] = useState<Grade | null | "new">(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<Grade | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ScoreDetail | null>(null);

  const classOptions = useMemo(
    () => [{ value: ALL, label: "全部班级" }, ...[...new Set(grades.map((g) => g.class_name).filter(Boolean))].sort().map((c) => ({ value: c, label: c }))],
    [grades]
  );
  const courseOptions = useMemo(
    () => [{ value: ALL, label: "全部课程" }, ...courses.map((c) => ({ value: c.id, label: c.name }))],
    [courses]
  );
  const termOptions = useMemo(
    () => [{ value: ALL, label: "全部学期" }, ...[...new Set(grades.map((g) => g.term).filter(Boolean))].sort().map((t) => ({ value: t, label: t }))],
    [grades]
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const min = minScore === "" ? null : Number(minScore);
    const max = maxScore === "" ? null : Number(maxScore);
    let list = grades.filter((g) => {
      const n = Number(g.score);
      if (kw && !`${g.student_name}${g.student_no}${g.course_name}`.toLowerCase().includes(kw)) return false;
      if (cls !== ALL && g.class_name !== cls) return false;
      if (courseId !== ALL && g.course_id !== courseId) return false;
      if (term !== ALL && g.term !== term) return false;
      if (min !== null && !Number.isNaN(min) && n < min) return false;
      if (max !== null && !Number.isNaN(max) && n > max) return false;
      if (failOnly && n >= PASS_SCORE) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      let r = 0;
      if (sortKey === "score") r = Number(a.score) - Number(b.score);
      else if (sortKey === "student_no") r = a.student_no.localeCompare(b.student_no);
      else if (sortKey === "course_name") r = a.course_name.localeCompare(b.course_name, "zh");
      else if (sortKey === "class_name") r = a.class_name.localeCompare(b.class_name, "zh");
      else r = a.exam_date.localeCompare(b.exam_date);
      if (r === 0) r = a.student_no.localeCompare(b.student_no);
      return sortAsc ? r : -r;
    });
    return list;
  }, [grades, keyword, cls, courseId, term, minScore, maxScore, failOnly, sortKey, sortAsc]);

  const stats = useMemo(() => {
    if (filtered.length === 0) return null;
    const sum = filtered.reduce((acc, g) => acc + Number(g.score), 0);
    const pass = filtered.filter((g) => Number(g.score) >= PASS_SCORE).length;
    return {
      avg: Math.round((sum / filtered.length) * 10) / 10,
      passRate: Math.round((pass / filtered.length) * 100),
    };
  }, [filtered]);

  const resetFilters = () => {
    setKeyword(""); setCls(ALL); setCourseId(ALL); setTerm(ALL);
    setMinScore(""); setMaxScore(""); setFailOnly(false);
  };
  const hasFilter =
    keyword !== "" || cls !== ALL || courseId !== ALL || term !== ALL ||
    minScore !== "" || maxScore !== "" || failOnly;

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const ok = await store.write("grade.delete", { id: deleting.id });
    setBusy(false);
    if (ok) toast.success("成绩记录已删除");
    setDeleting(null);
  };

  return (
    <section className="space-y-3">
      <div className="flex shrink-0 justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
          <FileUp className="size-4" /> <span className="hidden sm:inline">导入</span>
        </Button>
        <Button size="sm" onClick={() => setFormGrade("new")}>
          <Plus className="size-4" /> <span className="hidden sm:inline">录入成绩</span><span className="sm:hidden">录入</span>
        </Button>
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-3 shadow-xs">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索姓名 / 学号 / 课程"
            className="sm:col-span-1"
          />
          <Select value={cls} onValueChange={setCls} options={classOptions} />
          <Select value={courseId} onValueChange={setCourseId} options={courseOptions} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Select value={term} onValueChange={setTerm} options={termOptions} />
          <Input value={minScore} onChange={(e) => setMinScore(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="最低分" maxLength={5} />
          <Input value={maxScore} onChange={(e) => setMaxScore(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="最高分" maxLength={5} />
          <Button
            variant={failOnly ? "secondary" : "outline"}
            className={failOnly ? "font-semibold text-rose-700" : "text-muted-foreground"}
            onClick={() => setFailOnly((v) => !v)}
            aria-pressed={failOnly}
          >
            只看来不及格
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">排序</span>
          <div className="w-36">
            <Select value={sortKey} onValueChange={setSortKey} options={SORT_OPTIONS} />
          </div>
          <Button variant="outline" size="sm" onClick={() => setSortAsc((v) => !v)} aria-label={sortAsc ? "当前升序，点击切换为降序" : "当前降序，点击切换为升序"}>
            {sortAsc ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
            {sortAsc ? "升序" : "降序"}
          </Button>
          {hasFilter ? (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetFilters}>清空筛选</Button>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} 条{stats ? ` · 平均 ${stats.avg} · 及格率 ${stats.passRate}%` : ""}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyHint text={grades.length === 0 ? "还没有成绩记录，点击「录入成绩」添加第一条。" : "没有符合筛选条件的成绩。"} />
      ) : (
        <div className="space-y-2">
          {filtered.map((g) => (
            <div key={g.id} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs">
              <button
                type="button"
                onClick={() => setDetail({ kind: "grade", grade: g })}
                className={
                  "flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-lg border text-sm font-bold tabular-nums outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring/50 " +
                  scoreTone(Number(g.score))
                }
                aria-label={`考试 ${g.score} 分，点击查看明细`}
              >
                <span className="leading-none">{g.score}</span>
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {g.student_name}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">{g.student_no}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {g.class_name || "未分班"} · {g.course_name}
                </p>
              </div>
              <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                {g.term ? <Badge variant="outline" className="mb-1 font-normal">{g.term}</Badge> : null}
                <p>{g.exam_date}</p>
              </div>
              <div className="flex shrink-0">
                <Button variant="ghost" size="icon" aria-label="修改成绩" onClick={() => setFormGrade(g)}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="删除成绩" onClick={() => setDeleting(g)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formGrade !== null ? (
        <GradeFormDialog
          key={formGrade === "new" ? "new" : formGrade.id}
          grade={formGrade === "new" ? null : formGrade}
          onClose={() => setFormGrade(null)}
          store={store}
        />
      ) : null}

      {importing ? (
        <ImportDialog
          title="导入成绩"
          description="按学号匹配学生、按课程名称匹配课程，姓名/学号/班级自动同步。只导入单科考试总分；学期平时总评请在「综合测评」分段导入。匹配不到或分数非法的行会被跳过。"
          columns={GRADE_COLUMNS}
          action="grade.bulk_create"
          chunkSize={150}
          template={{
            name: "成绩导入模板",
            samples: ["2024010101", "高等数学（上）", "2025-2026-2", "87.5", "2026-06-18"],
          }}
          buildRow={(row) => ({
            student_no: row.student_no ?? "",
            course_name: row.course_name ?? "",
            term: row.term ?? "",
            score: row.score ?? "",
            exam_date: normalizeDate(row.exam_date ?? "") ?? row.exam_date ?? "",
          })}
          extraValidate={(row) => {
            if (row.score && !SCORE_RE.test(row.score)) return "分数需为 0-100";
            return null;
          }}
          onClose={() => setImporting(false)}
          onDone={(created, skipped) => {
            void store.refresh();
            toast.success(`导入完成：新增 ${created} 条成绩${skipped ? `，跳过 ${skipped} 条` : ""}`);
          }}
        />
      ) : null}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条成绩记录？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? `${deleting.student_name}（${deleting.student_no}）· ${deleting.course_name} · 考试 ${deleting.score} 分。` : ""}此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {detail ? (
        <ScoreDetailDialog
          key={detail.kind === "grade" ? "g" + detail.grade.id : "t" + detail.student.id + "|" + detail.term}
          store={store}
          detail={detail}
          goto={goto}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </section>
  );
}

export default function GradesView({ store }: { store: Store }) {
  const [nav, setNav] = useState<{ seg: string; no?: string; term?: string; stamp: number }>({ seg: "transcript", stamp: 0 });
  const goto: GotoFn = (seg, opts) => setNav((n) => ({ seg, no: opts?.no, term: opts?.term, stamp: n.stamp + 1 }));
  const failCount = useMemo(() => store.grades.filter((g) => Number(g.score) < PASS_SCORE).length, [store.grades]);

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">成绩与综合测评</h1>
          <p className="text-sm text-muted-foreground">
            {store.grades.length} 条成绩 · {store.termEvals.length} 条学期总评 · {store.attendance.length} 条考勤 · {failCount > 0 ? `${failCount} 条不及格` : "无不及格记录"}。
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SegPills
            options={[
              { value: "transcript", label: "成绩单" },
              { value: "matrix", label: "报表矩阵" },
              { value: "list", label: "成绩清单", count: store.grades.length },
              { value: "term_eval", label: "综合测评", count: store.termEvals.length },
              { value: "attendance", label: "考勤台账", count: store.attendance.length },
            ]}
            value={nav.seg}
            onChange={(s) => goto(s)}
          />
        </div>
      </div>

      {nav.seg === "transcript" ? <TranscriptView key={`t${nav.stamp}`} store={store} goto={goto} /> : null}
      {nav.seg === "matrix" ? <MatrixView key={`m${nav.stamp}`} store={store} goto={goto} /> : null}
      {nav.seg === "list" ? <GradesListView key={`l${nav.stamp}`} store={store} goto={goto} focusNo={nav.no} focusTerm={nav.term} /> : null}
      {nav.seg === "term_eval" ? <TermEvalView key={`e${nav.stamp}`} store={store} goto={goto} focusNo={nav.no} focusTerm={nav.term} /> : null}
      {nav.seg === "attendance" ? <AttendanceView key={`a${nav.stamp}`} store={store} focusNo={nav.no} focusTerm={nav.term} /> : null}
    </section>
  );
}
