import { useMemo, useState } from "react";
import { Download, FileUp, MoreHorizontal, Pencil, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ImportDialog from "@/components/ImportDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ALL_CLASS, inClassScope, useClassScope } from "@/hooks/use-class-scope";
import { ALL_TERM, termNow, useTermScope } from "@/hooks/use-term-scope";
import type { AttendanceItem, AttendKind, Student } from "@/lib/types";
import { ATTEND_KIND_LABEL, ATTEND_SOURCE_LABEL } from "@/lib/types";
import { dedupeAttendance, gradesOfTerm, summarizeTerm, termAttendDeduct } from "@/lib/evaluation";
import { compareRankSortable, rankRowsByClass, type RankRow } from "@/lib/rank-view";
import { RankSortControl, sortCaption, sortOptionsFor } from "./SortControl";
import type { RankSortMode } from "@/lib/rank-view";
import { ATTENDANCE_COLUMNS, exportCsv, normalizeDate } from "@/lib/import-export";
import { ALL, SegPills, fmt1 } from "./parts";

const KIND_TONE: Record<AttendKind, string> = {
  late: "pill-warning",
  absent: "pill-danger",
  leave: "pill-info",
  early: "pill-warning",
};

const KIND_BY_LABEL = new Map(Object.entries(ATTEND_KIND_LABEL).map(([k, v]) => [v, k as AttendKind]));

function normalizeKind(raw: string): AttendKind | "" {
  const v = raw.trim();
  if (!v) return "";
  if (v in ATTEND_KIND_LABEL) return v as AttendKind;
  return KIND_BY_LABEL.get(v) ?? "";
}

interface AttendDraft {
  student_id: string;
  kind: AttendKind;
  occurred_on: string;
  course_id: string;
  term: string;
  note: string;
}

function AttendanceFormDialog({ item, onClose, store }: { item: AttendanceItem | null; onClose: () => void; store: Store }) {
  const isEdit = item !== null;
  const [draft, setDraft] = useState<AttendDraft>(
    item
      ? { student_id: item.student_id, kind: item.kind, occurred_on: item.occurred_on, course_id: item.course_id ?? "", term: item.term, note: item.note }
      : { student_id: "", kind: "absent", occurred_on: new Date().toISOString().slice(0, 10), course_id: "", term: "", note: "" }
  );
  const [busy, setBusy] = useState(false);

  const studentOptions = [
    { value: "", label: "请选择学生" },
    ...store.students.map((s) => ({ value: s.id, label: `${s.name}（${s.student_no}）· ${s.class_name || "未分班"}` })),
  ];
  const courseOptions = [
    { value: "", label: "不指定课程（院级/全班级考勤）" },
    ...store.courses.map((c) => ({ value: c.id, label: `${c.name}${c.semester ? ` · ${c.semester}` : ""}` })),
  ];

  const submit = async () => {
    if (!draft.student_id) return toast.error("请选择学生。");
    if (!draft.occurred_on) return toast.error("请选择考勤日期。");
    setBusy(true);
    const payload = { ...draft, course_id: draft.course_id || "", term: draft.term.trim(), note: draft.note.trim() };
    const ok = isEdit
      ? await store.write("attendance.update", { id: item.id, ...payload })
      : await store.write("attendance.create", payload);
    setBusy(false);
    if (ok) {
      toast.success(isEdit ? "考勤记录已更新" : "考勤已登记");
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "修改考勤记录" : "登记考勤"}</DialogTitle>
          <DialogDescription>旷课/迟到/早退会按「规则设置」里的口径，从该生该学期的平时总评中自动扣分，请假默认不扣。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="学生" required>
            <Select value={draft.student_id} onValueChange={(v) => setDraft((d) => ({ ...d, student_id: v }))} options={studentOptions} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="类型" required>
              <Select
                value={draft.kind}
                onValueChange={(v) => setDraft((d) => ({ ...d, kind: v as AttendKind }))}
                options={(Object.keys(ATTEND_KIND_LABEL) as AttendKind[]).map((k) => ({ value: k, label: ATTEND_KIND_LABEL[k] }))}
              />
            </FormField>
            <FormField label="日期" required>
              <DateInput value={draft.occurred_on} onChange={(v) => setDraft((d) => ({ ...d, occurred_on: v }))} />
            </FormField>
          </div>
          <FormField label="课程">
            <Select
              value={draft.course_id}
              onValueChange={(v) =>
                setDraft((d) => {
                  const c = store.courses.find((x) => x.id === v) ?? null;
                  return { ...d, course_id: v, term: c?.semester && !d.term ? c.semester : d.term };
                })
              }
              options={courseOptions}
            />
          </FormField>
          <FormField label="学期">
            <Input value={draft.term} onChange={(e) => setDraft((d) => ({ ...d, term: e.target.value }))} placeholder="如：2025-2026-2" maxLength={32} />
          </FormField>
          <FormField label="备注">
            <Input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="选填，如：连续旷课已谈话" maxLength={200} />
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

export function RulesDialog({ store, onClose }: { store: Store; onClose: () => void }) {
  const ev = store.evaluation;
  const [examWeight, setExamWeight] = useState(ev.exam_weight);
  const [absentDeduct, setAbsentDeduct] = useState(ev.absent_deduct);
  const [lateDeduct, setLateDeduct] = useState(ev.late_deduct);
  const [leaveDeduct, setLeaveDeduct] = useState(ev.leave_deduct);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const ew = Number(examWeight);
    if (!Number.isInteger(ew) || ew < 0 || ew > 100) return toast.error("考试权重需为 0-100 的整数百分比。");
    for (const [label, v] of [["旷课扣分", absentDeduct], ["迟到/早退扣分", lateDeduct], ["请假扣分", leaveDeduct]] as const) {
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(v) || Number(v) > 100) return toast.error(`${label}需为 0-100。`);
    }
    setBusy(true);
    const ok = await store.write("evaluation_settings.save", {
      exam_weight: String(ew),
      usual_weight: String(100 - ew),
      absent_deduct: absentDeduct,
      late_deduct: lateDeduct,
      leave_deduct: leaveDeduct,
    });
    setBusy(false);
    if (ok) {
      toast.success("综测口径已保存，全部综合分与排名实时重算。");
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>综合测评口径</DialogTitle>
          <DialogDescription>考勤按整学期汇总扣分（与课程无关）；GPA 只按考试分计算。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="考试权重（%）" required>
              <Input value={examWeight} onChange={(e) => setExamWeight(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" maxLength={3} />
            </FormField>
            <FormField label="平时权重（%）">
              <Input value={String(Math.max(0, 100 - (Number(examWeight) || 0)))} readOnly className="bg-muted" />
            </FormField>
          </div>
          <p className="text-xs text-muted-foreground">两者之和固定为 100%。</p>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="旷课每次扣">
              <Input value={absentDeduct} onChange={(e) => setAbsentDeduct(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" maxLength={5} />
            </FormField>
            <FormField label="迟到/早退每次扣">
              <Input value={lateDeduct} onChange={(e) => setLateDeduct(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" maxLength={5} />
            </FormField>
            <FormField label="请假每次扣">
              <Input value={leaveDeduct} onChange={(e) => setLeaveDeduct(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" maxLength={5} />
            </FormField>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "保存中…" : "保存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AttendanceView({ store, focusNo }: { store: Store; focusNo?: string }) {
  const [keyword, setKeyword] = useState(focusNo ?? "");
  const scope = useClassScope();
  // 学期跟随侧栏全局作用域（ALL=不限学期，跨学期行同表展示）
  const termScope = useTermScope();
  const term = termNow(termScope);
  const [kind, setKind] = useState(ALL);
  const [view, setView] = useState<"summary" | "detail">("summary");
  const [sortMode, setSortMode] = useState<RankSortMode>("class_rank");
  const [groupByClass, setGroupByClass] = useState(true);
  const [form, setForm] = useState<AttendanceItem | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [deleting, setDeleting] = useState<AttendanceItem | null>(null);
  const [busy, setBusy] = useState(false);

  const kindOptions = [
    { value: ALL, label: "全部类型" },
    ...(Object.entries(ATTEND_KIND_LABEL) as [AttendKind, string][]).map(([value, label]) => ({ value, label })),
  ];

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return store.attendance.filter((a) => {
      if (kw && !`${a.student_name}${a.student_no}${a.course_name}${a.note}`.toLowerCase().includes(kw)) return false;
      if (!inClassScope(scope, a.class_name)) return false;
      if (term !== ALL && a.term !== term) return false;
      if (kind !== ALL && a.kind !== kind) return false;
      return true;
    });
  }, [store.attendance, keyword, scope, term, kind]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of store.attendance) m.set(a.kind, (m.get(a.kind) ?? 0) + 1);
    return m;
  }, [store.attendance]);

  // 同一学生同一节课（课程+日期）只计一次扣分，台账如实标出哪条被计入
  const marks = useMemo(() => dedupeAttendance(store.attendance, store.evaluation), [store.attendance, store.evaluation]);

  const studentsById = useMemo(() => new Map(store.students.map((s) => [s.id, s])), [store.students]);
  const coursesById = useMemo(() => new Map(store.courses.map((c) => [c.id, c])), [store.courses]);
  const evalByStudentTerm = useMemo(
    () => new Map(store.termEvals.map((e) => [`${e.student_id}|${e.term}`, e])),
    [store.termEvals]
  );

  // 名次只属于「某学生 + 某学期」，所以按人汇总以 (学生, 学期) 为一行；名次用全班该学期数据算，不受筛选影响
  const rankByTerm = useMemo(() => {
    const cache = new Map<string, Map<string, RankRow>>();
    for (const t of [...new Set(filtered.map((a) => a.term))]) {
      cache.set(
        t,
        rankRowsByClass(
          store.students.map((s) => ({
            student: s,
            summary: summarizeTerm(
              s,
              t,
              gradesOfTerm(store.grades, s.id, t),
              evalByStudentTerm.get(`${s.id}|${t}`) ?? null,
              coursesById,
              store.attendance,
              store.evaluation
            ),
          }))
        )
      );
    }
    return cache;
  }, [filtered, store.students, store.grades, store.attendance, store.evaluation, coursesById, evalByStudentTerm]);

  const summaryRows = useMemo(() => {
    const groups = new Map<string, { student: Student; term: string; items: AttendanceItem[] }>();
    for (const a of filtered) {
      const s = studentsById.get(a.student_id);
      if (!s) continue;
      const key = `${a.student_id}|${a.term}`;
      const g = groups.get(key);
      if (g) g.items.push(a);
      else groups.set(key, { student: s, term: a.term, items: [a] });
    }
    const rows = [...groups.values()].map((g) => {
      const { counts, deduct } = termAttendDeduct(g.student.id, g.term, store.attendance, store.evaluation);
      return { ...g, counts, deduct, rankRow: rankByTerm.get(g.term)?.get(g.student.id) ?? null };
    });
    rows.sort(compareRankSortable(sortMode, groupByClass));
    return rows;
  }, [filtered, studentsById, store.attendance, store.evaluation, rankByTerm, sortMode, groupByClass]);

  const exportSummary = () => {
    if (summaryRows.length === 0) return toast.error("当前范围内没有考勤记录。");
    exportCsv(
      `考勤按人汇总-${scope.cls === ALL_CLASS ? "全部班级" : scope.cls}-${term === ALL ? "全部学期" : term}.csv`,
      ["名次", "学号", "姓名", "班级", "学期", "旷课", "迟到", "早退", "请假", "本学期扣分", "学期综合", "本次筛选条数"],
      summaryRows.map((r) => [
        r.rankRow ? `${r.rankRow.rank}/${r.rankRow.total}` : "未定",
        r.student.student_no,
        r.student.name,
        r.student.class_name,
        r.term || "未填学期",
        String(r.counts.absent), String(r.counts.late), String(r.counts.early), String(r.counts.leave),
        String(r.deduct),
        r.rankRow?.composite != null ? String(r.rankRow.composite) : "",
        String(r.items.length),
      ])
    );
    toast.success("汇总表已开始下载。");
  };

  // 人工改判：指定这节课按哪条扣分 / 本条不计 / 恢复自动
  const applyCounted = async (a: AttendanceItem, counted: boolean | null) => {
    const ok = await store.write("attendance.set_counted", { id: a.id, counted });
    if (ok) {
      toast.success(
        counted === true
          ? `已指定按这条（${ATTEND_KIND_LABEL[a.kind] ?? a.kind}）扣分，同节课其他记录转为留档`
          : counted === false
            ? "本条已改为不计扣分"
            : "已恢复自动口径（同节课取扣分最重的一条）"
      );
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const ok = await store.write("attendance.delete", { id: deleting.id });
    setBusy(false);
    if (ok) toast.success("考勤记录已删除");
    setDeleting(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索姓名 / 学号 / 课程 / 备注" maxLength={30} className="pl-8 pr-7" />
          {keyword ? (
            <button type="button" aria-label="清空搜索" onClick={() => setKeyword("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowRules(true)}>
            <Settings2 className="size-4" /> <span className="hidden sm:inline">规则设置</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
            <FileUp className="size-4" /> <span className="hidden sm:inline">导入</span>
          </Button>
          <Button size="sm" onClick={() => setForm("new")}>
            <Plus className="size-4" /> <span className="hidden sm:inline">登记考勤</span><span className="sm:hidden">登记</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-60">
          <SegPills
            options={[
              { value: "summary", label: "按人汇总", count: summaryRows.length },
              { value: "detail", label: "明细流水", count: filtered.length },
            ]}
            value={view}
            onChange={(v) => setView(v === "detail" ? "detail" : "summary")}
          />
        </div>
        <div className="w-full sm:w-96">
          <SegPills
            options={[
              { value: ALL, label: "全部", count: store.attendance.length },
              ...(Object.entries(ATTEND_KIND_LABEL) as [AttendKind, string][]).map((k) => ({ value: k[0], label: k[1], count: counts.get(k[0]) ?? 0 })),
            ]}
            value={kind}
            onChange={setKind}
          />
        </div>
        {view === "summary" ? (
          <RankSortControl
            mode={sortMode}
            onMode={setSortMode}
            options={sortOptionsFor(scope.cls === ALL_CLASS, true)}
            groupByClass={groupByClass}
            onGroupByClass={setGroupByClass}
            showGroupToggle={scope.cls === ALL_CLASS && sortMode === "composite"}
          />
        ) : null}
        {view === "summary" ? (
          <Button variant="outline" size="sm" className="ml-auto" onClick={exportSummary}>
            <Download className="size-4" /> 导出汇总
          </Button>
        ) : null}
      </div>

      <p className="px-1 text-[11px] text-muted-foreground">
        {view === "summary"
          ? `${summaryRows.length} 人 · 当前${sortCaption(sortMode, groupByClass)}；旷/迟/早/假与扣分是该生该学期的整学期口径（不随类型筛选变化），类型筛选只决定哪些人进入这张表。`
          : `${filtered.length} 条 · `}
        综合分口径：考试 {store.evaluation.exam_weight}% / 平时 {store.evaluation.usual_weight}%（旷课扣 {store.evaluation.absent_deduct}、迟到早退扣 {store.evaluation.late_deduct}、请假扣 {store.evaluation.leave_deduct}）· 同一节课只按一条扣分
      </p>

      {view === "summary" ? (
        summaryRows.length === 0 ? (
          <EmptyHint text={store.attendance.length === 0 ? "还没有考勤记录。" : "没有符合条件的考勤记录。"} />
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/40 text-left text-[11px] text-muted-foreground">
                  <th className="sticky left-0 z-10 bg-card px-3 py-2 font-medium">姓名 / 学号</th>
                  <th className="px-2 py-2 text-left font-medium">班级</th>
                  <th className="px-2 py-2 text-left font-medium">学期</th>
                  <th className="px-2 py-2 text-center font-medium">考勤（旷/迟/早/假）</th>
                  <th className="px-2 py-2 text-center font-medium">扣分</th>
                  <th className="px-2 py-2 text-center font-medium">学期综合</th>
                  <th className="px-2 py-2 text-center font-medium">条数</th>
                  <th className="px-2 py-2 text-center font-medium">明细</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((r) => (
                  <tr key={`${r.student.id}|${r.term}`} className="border-t">
                    <td className="sticky left-0 z-10 bg-card px-3 py-1.5 whitespace-nowrap">
                      <span className="mr-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
                        {r.rankRow ? `#${r.rankRow.rank}/${r.rankRow.total}` : "未定"}
                      </span>
                      <span className="font-medium">{r.student.name}</span>
                      <span className="ml-1 text-xs text-muted-foreground">{r.student.student_no}</span>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap">{r.student.class_name || "未分班"}</td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap">{r.term || "未填学期"}</td>
                    <td className="px-2 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                      {r.counts.absent || r.counts.late || r.counts.early || r.counts.leave
                        ? `${r.counts.absent}/${r.counts.late}/${r.counts.early}/${r.counts.leave}`
                        : "满勤"}
                    </td>
                    <td className="px-2 py-1.5 text-center text-xs tabular-nums">
                      {r.deduct > 0 ? <span className="font-semibold text-amber-600">-{fmt1(r.deduct)}</span> : <span className="text-muted-foreground">0</span>}
                    </td>
                    <td className="px-2 py-1.5 text-center text-sm font-semibold tabular-nums">
                      {r.rankRow?.composite != null ? fmt1(r.rankRow.composite) : "–"}
                    </td>
                    <td className="px-2 py-1.5 text-center text-xs tabular-nums text-muted-foreground">{r.items.length}</td>
                    <td className="px-2 py-1.5 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-primary"
                        onClick={() => {
                          setKeyword(r.student.student_no);
                          termScope.setTerm(r.term || ALL_TERM);
                          setKind(ALL);
                          setView("detail");
                        }}
                      >
                        看明细
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : filtered.length === 0 ? (
        <EmptyHint text={store.attendance.length === 0 ? "还没有考勤记录。" : "没有符合条件的考勤记录。"} />
      ) : (
        <ul className="space-y-2">
          {filtered.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 shadow-xs">
              <span className={"shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold " + (KIND_TONE[a.kind] ?? "pill-info")}>
                {ATTEND_KIND_LABEL[a.kind] ?? a.kind}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {a.student_name}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">{a.student_no} · {a.class_name || "未分班"}</span>
                  {a.source === "monitor" ? (
                    <span className="ml-1.5 text-xs font-normal text-primary">· {ATTEND_SOURCE_LABEL.monitor}{a.reporter_name ? `·${a.reporter_name}` : ""}</span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {a.occurred_on}{a.course_name ? ` · ${a.course_name}` : " · 未指定课程"}{a.term ? ` · ${a.term}` : ""}{a.note ? ` · ${a.note}` : ""}
                </p>
              </div>
              {marks.get(a.id)?.counted === false ? (
                marks.get(a.id)?.manual ? (
                  <span
                    className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
                    title="你已人工指定本条不计扣分，同节课按自动口径的其他记录（若有）扣分"
                  >
                    已改判·不计
                  </span>
                ) : (
                  <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600" title="同一学生同一节课只按一条扣分，本条留档不重复扣分">
                    重复·不计
                  </span>
                )
              ) : marks.get(a.id)?.manual ? (
                <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary" title="你已人工指定这节课按本条扣分，同节课其他记录转为留档">
                  按此改判扣分
                </span>
              ) : null}
              {(() => {
                const mark = marks.get(a.id);
                if (!mark || (!mark.dup && !mark.manual)) return null;
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="改判计扣方式">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                        同一节课只按一条扣分。指定本条后，同节课其他记录自动转为留档。
                      </DropdownMenuLabel>
                      <DropdownMenuItem disabled={mark.manual && mark.counted} onClick={() => void applyCounted(a, true)}>
                        按这条扣分（{ATTEND_KIND_LABEL[a.kind] ?? a.kind}）
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={mark.manual && !mark.counted} onClick={() => void applyCounted(a, false)}>
                        这条不计扣分
                      </DropdownMenuItem>
                      {mark.manual ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => void applyCounted(a, null)}>恢复自动（取最重的一条）</DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })()}
              <div className="flex shrink-0">
                <Button variant="ghost" size="icon" aria-label="修改考勤" onClick={() => setForm(a)}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="删除考勤" onClick={() => setDeleting(a)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form !== null ? (
        <AttendanceFormDialog
          key={form === "new" ? "new" : form.id}
          item={form === "new" ? null : form}
          onClose={() => setForm(null)}
          store={store}
        />
      ) : null}

      {importing ? (
        <ImportDialog
          title="导入考勤台账"
          description="按学号匹配学生、按课程名称匹配课程（可不填）。类型限：迟到 / 旷课 / 请假 / 早退。匹配不到或类型、日期非法的行会被跳过。"
          columns={ATTENDANCE_COLUMNS}
          action="attendance.bulk_create"
          chunkSize={150}
          template={{
            name: "考勤导入模板",
            samples: ["2024010101", "旷课", "2026-05-11", "高等数学（上）", "2025-2026-2", "未选课代表登记"],
          }}
          buildRow={(row) => ({
            student_no: row.student_no ?? "",
            kind: normalizeKind(row.kind ?? ""),
            occurred_on: normalizeDate(row.occurred_on ?? "") ?? row.occurred_on ?? "",
            course_name: row.course_name ?? "",
            term: row.term ?? "",
            note: row.note ?? "",
          })}
          extraValidate={(row) => {
            if (row.kind && !normalizeKind(row.kind)) return "类型限 迟到/旷课/请假/早退";
            return null;
          }}
          onClose={() => setImporting(false)}
          onDone={(created, skipped) => {
            void store.refresh();
            toast.success(`导入完成：新增 ${created} 条考勤${skipped ? `，跳过 ${skipped} 条` : ""}`);
          }}
        />
      ) : null}

      {showRules ? <RulesDialog store={store} onClose={() => setShowRules(false)} /> : null}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条考勤记录？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? `${deleting.student_name}（${deleting.student_no}）· ${ATTEND_KIND_LABEL[deleting.kind] ?? deleting.kind} · ${deleting.occurred_on}。` : ""}
              删除后相关平时分扣分即时恢复。此操作不可恢复。
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
    </div>
  );
}
