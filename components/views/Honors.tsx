import { useEffect, useMemo, useState } from "react";
import { Download, Medal, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { EmptyHint, FormField, Select, DateInput } from "@/components/form";
import { ALL, SegPills, fmt1 } from "@/components/views/grades/parts";
import { ApiError, apiPost } from "@/lib/api";
import { exportCsv } from "@/lib/import-export";
import { rankRowsByClass, type RankRow } from "@/lib/rank-view";
import { summarizeTerm, PASS_SCORE, type TermSummary } from "@/lib/evaluation";
import { HONOR_LEVELS, HONOR_PRESETS, type HonorItem, type Student } from "@/lib/types";
import type { Store } from "@/hooks/use-store";
import { ALL_CLASS, inClassScope, useClassScope } from "@/hooks/use-class-scope";
import { ALL_TERM, inTermScope, termNow, useTermScope } from "@/hooks/use-term-scope";

const TODAY = () => new Date().toISOString().slice(0, 10);
const CUSTOM = "__custom";
const NO_TERM = "";

type View = "ledger" | "grant";
type PickMode = "top_n" | "top_pct" | "min_score";

interface TermRow {
  student: Student;
  summary: TermSummary | null;
  rankRow: RankRow | null;
}

/** 学期成绩模型：与成绩四屏同一套名次口径（同班同学之间算班内名次，无成绩者名次留空） */
function useTermRows(store: Store, term: string): TermRow[] {
  const coursesById = useMemo(() => new Map(store.courses.map((c) => [c.id, c])), [store.courses]);
  const evalByKey = useMemo(
    () => new Map(store.termEvals.map((e) => [`${e.student_id}|${e.term}`, e])),
    [store.termEvals]
  );
  return useMemo(() => {
    const grades = store.grades.filter((g) => g.term === term);
    const scored = new Set(grades.map((g) => g.student_id));
    const base = store.students
      .filter((s) => scored.has(s.id))
      .map((s) => ({
        student: s,
        summary: summarizeTerm(
          s,
          term,
          grades.filter((g) => g.student_id === s.id),
          evalByKey.get(`${s.id}|${term}`) ?? null,
          coursesById,
          store.attendance,
          store.evaluation
        ),
      }));
    const rankOf = rankRowsByClass(base);
    const rows: TermRow[] = base.map((r) => ({ ...r, rankRow: rankOf.get(r.student.id) ?? null }));
    rows.sort((a, b) => {
      const c = (a.student.class_name || "未分班").localeCompare(b.student.class_name || "未分班", "zh");
      if (c) return c;
      const ra = a.rankRow?.rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.rankRow?.rank ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.student.student_no.localeCompare(b.student.student_no);
    });
    return rows;
  }, [store.students, store.grades, store.attendance, store.evaluation, coursesById, evalByKey, term]);
}

function honorTermsOf(honors: HonorItem[]): string[] {
  return [...new Set(honors.map((h) => h.term).filter(Boolean))].sort();
}

interface FailRecord {
  term: string;
  course: string;
  score: number;
}

/**
 * 学生 → 不及格课程清单。判分口径与成绩各屏一致（考试分 < PASS_SCORE 即挂科），
 * 授予页用它做一票否决，服务端 honor.* 写入时用同一口径复核。
 */
function useGradeFails(store: Store): Map<string, FailRecord[]> {
  const courseById = useMemo(() => new Map(store.courses.map((c) => [c.id, c])), [store.courses]);
  return useMemo(() => {
    const m = new Map<string, FailRecord[]>();
    for (const g of store.grades) {
      const score = Number(g.score);
      if (!Number.isFinite(score) || score >= PASS_SCORE) continue;
      const list = m.get(g.student_id) ?? [];
      list.push({ term: g.term || "未标学期", course: courseById.get(g.course_id)?.name ?? "（课程已删除）", score });
      m.set(g.student_id, list);
    }
    return m;
  }, [store.grades, courseById]);
}

/** 把挂科记录渲染成「高等数学（上）58」这样的简述 */
const failBrief = (fails: FailRecord[]) =>
  fails.map((f) => `${f.term ? f.term + " " : ""}${f.course} ${fmt1(f.score)}`).join("、");

/** 称号受控值用 `__custom:xxx` 前缀携带自定义文本，调用方用 resolveTitle 取真实名称 */
const CUSTOM_PREFIX = "__custom:";
const resolveTitle = (v: string) => (v.startsWith(CUSTOM_PREFIX) ? v.slice(CUSTOM_PREFIX.length).trim() : v);

function TitlePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isCustom = value !== CUSTOM && !HONOR_PRESETS.includes(value);
  const [choice, setChoice] = useState<string>(isCustom || value === CUSTOM ? CUSTOM : value || HONOR_PRESETS[0]);
  const [custom, setCustom] = useState(isCustom ? value.slice(CUSTOM_PREFIX.length) : "");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {HONOR_PRESETS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setCustom(""); setChoice(t); onChange(t); }}
            className={
              "rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 " +
              (choice === t ? "border-transparent bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")
            }
          >
            {t}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setChoice(CUSTOM); onChange(`${CUSTOM_PREFIX}${custom}`); }}
          className={
            "rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 " +
            (choice === CUSTOM ? "border-transparent bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")
          }
        >
          其他…
        </button>
      </div>
      {choice === CUSTOM ? (
        <Input
          value={custom}
          onChange={(e) => { setCustom(e.target.value); onChange(`${CUSTOM_PREFIX}${e.target.value}`); }}
          placeholder="自定义荣誉名称（30 字以内）"
          maxLength={30}
        />
      ) : null}
    </div>
  );
}

function StudentPicker({ store, value, onChange }: { store: Store; value: string; onChange: (id: string) => void }) {
  const [kw, setKw] = useState("");
  const students = useMemo(() => {
    const q = kw.trim().toLowerCase();
    return store.students
      .filter((s) => !q || `${s.name}${s.student_no}${s.class_name}`.toLowerCase().includes(q))
      .sort((a, b) => a.class_name.localeCompare(b.class_name, "zh") || a.student_no.localeCompare(b.student_no));
  }, [store.students, kw]);
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="搜索姓名 / 学号 / 班级"
          maxLength={30}
          className="pl-8 pr-7"
        />
        {kw ? (
          <button type="button" aria-label="清空搜索" onClick={() => setKw("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <Select
        value={value}
        onValueChange={onChange}
        options={[
          { value: "", label: "请选择学生" },
          ...students.map((s) => ({ value: s.id, label: `${s.name}（${s.student_no}）${s.class_name || "未分班"}` })),
        ]}
      />
    </div>
  );
}

function HonorFormDialog({
  store,
  editing,
  onClose,
}: {
  store: Store;
  editing: HonorItem | null;
  onClose: () => void;
}) {
  const gradeTerms = useMemo(() => [...new Set(store.grades.map((g) => g.term).filter(Boolean))].sort(), [store.grades]);
  const termOptions = useMemo(() => {
    const uniq = [...new Set([...gradeTerms, ...honorTermsOf(store.honors)])].sort();
    return [{ value: NO_TERM, label: "不指定学期" }, ...uniq.map((t) => ({ value: t, label: t }))];
  }, [gradeTerms, store.honors]);

  const [studentId, setStudentId] = useState(editing?.student_id ?? "");
  const [title, setTitle] = useState(editing?.title ?? HONOR_PRESETS[0]);
  const [level, setLevel] = useState(editing?.level ?? "校级");
  const [term, setTerm] = useState(editing?.term ?? (gradeTerms.length ? gradeTerms[gradeTerms.length - 1] : NO_TERM));
  const [grantedOn, setGrantedOn] = useState(editing?.granted_on ?? TODAY());
  const [note, setNote] = useState(editing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ack, setAck] = useState(false);

  const allFails = useGradeFails(store);
  // 手动登记也按同一口径判挂科：选了学期只看该学期，「不指定学期」则看全部历史
  const { termFails, otherFails } = useMemo(() => {
    if (editing || !studentId) return { termFails: [] as FailRecord[], otherFails: [] as FailRecord[] };
    const list = allFails.get(studentId) ?? [];
    if (term === NO_TERM) return { termFails: list, otherFails: [] as FailRecord[] };
    return { termFails: list.filter((f) => f.term === term), otherFails: list.filter((f) => f.term !== term) };
  }, [editing, studentId, allFails, term]);

  const name = resolveTitle(title);

  const submit = async () => {
    setError("");
    if (!editing && !studentId) { setError("请先选择要授予荣誉的学生。"); return; }
    if (!name) { setError("请填写荣誉名称。"); return; }
    if (name.length > 30) { setError("荣誉名称不能超过 30 字。"); return; }
    if (!grantedOn) { setError("请选择授予日期。"); return; }
    if (note.length > 200) { setError("备注不能超过 200 字。"); return; }
    if (termFails.length && !ack) { setError(`该生${term === NO_TERM ? "" : "本学期"}有 ${termFails.length} 门不及格，按挂科规则不可授予；确需登记请勾选确认并写明原因。`); return; }
    if (termFails.length && ack && !note.trim()) { setError("勾选确认后请填写备注说明，写清为什么破例。"); return; }
    setBusy(true);
    const payload: Record<string, unknown> = { title: name, level, term, granted_on: grantedOn, note: note.trim() };
    const ok = editing
      ? await store.write("honor.update", { id: editing.id, ...payload })
      : await store.write("honor.create", { student_id: studentId, ...payload, ack_failed: ack });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "修改荣誉" : "授予荣誉"}</DialogTitle>
          <DialogDescription>{editing ? `${editing.student_name} 的这条荣誉` : "为单个学生登记一条荣誉，批量授予请用「按成绩授予」。"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {editing ? (
            <FormField label="学生">
              <p className="text-sm font-medium">
                {editing.student_name}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">{editing.student_no} · {editing.class_name || "未分班"}</span>
              </p>
            </FormField>
          ) : (
            <FormField label="学生" required>
              <StudentPicker store={store} value={studentId} onChange={setStudentId} />
            </FormField>
          )}
          <FormField label="荣誉名称" required>
            <TitlePicker value={title} onChange={setTitle} />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="级别" required>
              <Select value={level} onValueChange={setLevel} options={HONOR_LEVELS.map((l) => ({ value: l, label: l }))} />
            </FormField>
            <FormField label="学期">
              <Select value={term} onValueChange={setTerm} options={termOptions} />
            </FormField>
          </div>
          {termFails.length ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs">
              <p className="font-medium text-destructive">
                该生{term === NO_TERM ? "" : "该学期"}有 {termFails.length} 门不及格：{failBrief(termFails)}
              </p>
              {otherFails.length ? (
                <p className="mt-1 text-muted-foreground">其他学期还有 {otherFails.length} 门不及格：{failBrief(otherFails)}</p>
              ) : null}
              <label className="mt-2 flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                <span>已知悉挂科情况，仍要授予（需在备注写明原因，随记录留档）</span>
              </label>
            </div>
          ) : null}
          <FormField label="授予日期" required>
            <DateInput value={grantedOn} onChange={setGrantedOn} className="sm:max-w-44" />
          </FormField>
          <FormField label="备注">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="授予说明（选填，200 字以内）" maxLength={200} rows={2} />
          </FormField>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "提交中…" : editing ? "保存修改" : "确认授予"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LedgerPanel({ store }: { store: Store }) {
  const [status, setStatus] = useState<"active" | "revoked">("active");
  const [keyword, setKeyword] = useState("");
  const [level, setLevel] = useState<string>(ALL);
  const scope = useClassScope();
  // 学期跟随侧栏全局作用域（ALL=全部学期，未标学期的荣誉也只在 ALL 下出现）
  const termScope = useTermScope();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<HonorItem | null>(null);
  const [revoking, setRevoking] = useState<HonorItem | null>(null);
  const [deleting, setDeleting] = useState<HonorItem | null>(null);
  const [busy, setBusy] = useState(false);

  const active = useMemo(
    () => store.honors.filter((h) => h.status === "active" && inClassScope(scope, h.class_name) && inTermScope(termScope, h.term)),
    [store.honors, scope, termScope],
  );
  const revoked = useMemo(
    () => store.honors.filter((h) => h.status === "revoked" && inClassScope(scope, h.class_name) && inTermScope(termScope, h.term)),
    [store.honors, scope, termScope],
  );

  const levelOptions = useMemo(() => [{ value: ALL, label: "全部级别" }, ...HONOR_LEVELS.map((l) => ({ value: l, label: l }))], []);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const src = status === "active" ? active : revoked;
    return src.filter((h) => {
      if (kw && !`${h.student_name}${h.student_no}${h.title}${h.note}`.toLowerCase().includes(kw)) return false;
      if (level !== ALL && h.level !== level) return false;
      return true;
    });
  }, [status, active, revoked, keyword, level]);

  const exportLedger = () => {
    if (filtered.length === 0) return toast.error("当前筛选没有荣誉记录。");
    exportCsv(
      status === "active" ? "荣誉台账.csv" : "荣誉历史留档.csv",
      ["学号", "姓名", "班级", "荣誉名称", "级别", "学期", "授予日期", status === "active" ? "授予人" : "撤销日期", "备注"],
      filtered.map((h) => [
        h.student_no, h.student_name, h.class_name, h.title, h.level, h.term,
        h.granted_on, status === "active" ? h.granted_by : (h.revoked_at ? h.revoked_at.slice(0, 10) : ""), h.note,
      ])
    );
    toast.success("荣誉台账已开始下载。");
  };

  const confirmRevoke = async () => {
    if (!revoking) return;
    setBusy(true);
    await store.write("honor.revoke", { id: revoking.id });
    setBusy(false);
    setRevoking(null);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    await store.write("honor.delete", { id: deleting.id });
    setBusy(false);
    setDeleting(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-72">
          <SegPills
            options={[
              { value: "active", label: "现行荣誉", count: active.length },
              { value: "revoked", label: "历史留档", count: revoked.length },
            ]}
            value={status}
            onChange={(v) => setStatus(v as "active" | "revoked")}
          />
        </div>
        <Button size="sm" variant="outline" onClick={exportLedger}>
          <Download className="size-4" /> 导出
        </Button>
        {status === "active" ? (
          <Button size="sm" onClick={() => setCreating(true)}>新登记</Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索姓名 / 学号 / 荣誉"
            maxLength={30}
            className="pl-8 pr-7"
          />
          {keyword ? (
            <button type="button" aria-label="清空搜索" onClick={() => setKeyword("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="w-28 sm:w-32"><Select value={level} onValueChange={setLevel} options={levelOptions} /></div>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} 条</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyHint
          text={store.honors.length === 0
            ? "还没有荣誉记录，可用「按成绩授予」批量生成。"
            : status === "active" ? "没有符合条件的现行荣誉。" : "没有历史留档的荣誉记录。"}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground">
                <th className="px-4 py-2 font-medium">学生</th>
                <th className="px-2 py-2 font-medium">荣誉</th>
                <th className="hidden px-2 py-2 font-medium sm:table-cell">级别</th>
                <th className="hidden px-2 py-2 font-medium md:table-cell">学期</th>
                <th className="px-2 py-2 font-medium">授予</th>
                <th className="px-4 py-2 text-right font-medium">{status === "active" ? "操作" : "撤销于"}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((h) => (
                <tr key={h.id} className="border-t">
                  <td className="px-4 py-2">
                    <span className="font-medium">{h.student_name}</span>
                    <span className="ml-1 block text-xs text-muted-foreground sm:inline">{h.student_no} · {h.class_name || "未分班"}</span>
                  </td>
                  <td className="px-2 py-2">
                    <Badge variant="outline" className={h.status === "active" ? "border-transparent bg-primary/10 font-normal text-primary" : "font-normal text-muted-foreground"}>
                      {h.title}
                    </Badge>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground sm:hidden">{h.level}{h.term ? ` · ${h.term}` : ""}</span>
                    {h.note ? <span className="mt-0.5 block max-w-56 truncate text-[11px] text-muted-foreground">{h.note}</span> : null}
                  </td>
                  <td className="hidden px-2 py-2 text-xs text-muted-foreground sm:table-cell">{h.level}</td>
                  <td className="hidden px-2 py-2 text-xs tabular-nums text-muted-foreground md:table-cell">{h.term || "—"}</td>
                  <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">
                    {h.granted_on}
                    {h.granted_by ? <span className="block text-[11px]">{h.granted_by}</span> : null}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {h.status === "active" ? (
                      <span className="inline-flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => setEditing(h)}>修改</Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={() => setRevoking(h)}>撤销</Button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs tabular-nums text-muted-foreground">{h.revoked_at ? h.revoked_at.slice(0, 10) : "—"}</span>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" disabled={busy} onClick={() => setDeleting(h)}>删除</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-1 text-[11px] text-muted-foreground">误录的荣誉请先撤销转入历史留档，再在留档中删除。</p>

      {creating ? <HonorFormDialog store={store} editing={null} onClose={() => setCreating(false)} /> : null}
      {editing ? <HonorFormDialog key={editing.id} store={store} editing={editing} onClose={() => setEditing(null)} /> : null}
      <AlertDialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>撤销荣誉</AlertDialogTitle>
            <AlertDialogDescription>
              确定撤销 {revoking?.student_name} 的「{revoking?.title}」吗？撤销后转入历史留档，台账不再计入。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); void confirmRevoke(); }}
            >
              {busy ? "处理中…" : "确认撤销"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除荣誉记录</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除 {deleting?.student_name} 的「{deleting?.title}」留档吗？删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); void confirmDelete(); }}
            >
              {busy ? "处理中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GrantPanel({ store }: { store: Store }) {
  const gradeTerms = useMemo(() => [...new Set(store.grades.map((g) => g.term).filter(Boolean))].sort(), [store.grades]);
  const latestGradeTerm = gradeTerms.length ? gradeTerms[gradeTerms.length - 1] : "";
  // 学期跟随侧栏全局作用域；授予一次只针对一个学期，「全部学期」时提示选定
  const termScope = useTermScope();
  const term = termNow(termScope);
  const activeTerm = term === ALL_TERM ? "" : term;
  const rows = useTermRows(store, activeTerm);

  const [title, setTitle] = useState<string>(HONOR_PRESETS[0]);
  const [level, setLevel] = useState<string>("校级");
  const [grantedOn, setGrantedOn] = useState(TODAY());
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<PickMode>("top_n");
  const [topN, setTopN] = useState("3");
  const [topPct, setTopPct] = useState("20");
  const [minScore, setMinScore] = useState("85");
  const scope = useClassScope();
  const [includeHistoryFail, setIncludeHistoryFail] = useState(false);
  const [allowFailed, setAllowFailed] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  // 班级/学期作用域变化后，之前勾过的人可能已不在当前范围，清空勾选避免误授
  useEffect(() => setPicked(null), [scope.cls, term]);

  const allFails = useGradeFails(store);
  const scopeLabel = includeHistoryFail ? "本学期/历史学期" : "本学期";
  const failsOf = (studentId: string): FailRecord[] => {
    const list = allFails.get(studentId) ?? [];
    return includeHistoryFail ? list : list.filter((f) => f.term === activeTerm);
  };

  const name = resolveTitle(title);
  const existing = useMemo(
    () => new Set(store.honors.filter((h) => h.status === "active" && h.title === name && h.term === activeTerm).map((h) => h.student_id)),
    [store.honors, name, activeTerm]
  );

  /** 圈选在班内名次上进行，故先算全学期名次再按班级作用域筛选，避免筛选改变名次分母 */
  const matched = useMemo(() => {
    const n = Number(topN);
    const pct = Number(topPct);
    const floor = Number(minScore);
    return rows.filter((r) => {
      if (!inClassScope(scope, r.student.class_name)) return false;
      const rk = r.rankRow;
      if (!rk) return false;
      if (mode === "top_n") return Number.isInteger(n) && n > 0 && rk.rank <= n;
      if (mode === "top_pct") return Number.isFinite(pct) && pct > 0 && pct <= 100 && rk.rank <= Math.max(1, Math.ceil((rk.total * pct) / 100));
      return Number.isFinite(floor) && rk.composite !== null && rk.composite >= floor;
    });
  }, [rows, scope, mode, topN, topPct, minScore]);

  /** 挂科一票否决：不满足条件与否先看挂科，两种口径下都从名单里剔除，除非本次显式放开 */
  const blocked = useMemo(() => {
    if (allowFailed) return [];
    return matched.filter((r) => {
      const list = allFails.get(r.student.id) ?? [];
      return (includeHistoryFail ? list : list.filter((f) => f.term === activeTerm)).length > 0;
    });
  }, [matched, allowFailed, allFails, includeHistoryFail, activeTerm]);

  const recommended = useMemo(() => {
    if (blocked.length === 0) return matched;
    const cut = new Set(blocked.map((r) => r.student.id));
    return matched.filter((r) => !cut.has(r.student.id));
  }, [matched, blocked]);

  const grantable = useMemo(() => recommended.filter((r) => !existing.has(r.student.id)), [recommended, existing]);
  const shown = picked === null ? null : new Set(picked);
  const pickedCount = (picked ?? []).filter((id) => !existing.has(id)).length;

  const byClass = useMemo(() => {
    if (shown === null) return [];
    const m = new Map<string, TermRow[]>();
    for (const r of recommended) {
      const key = r.student.class_name || "未分班";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return [...m.entries()];
  }, [recommended, shown]);

  const previewCaption =
    mode === "top_n" ? `各班前 ${topN || "?"} 名` : mode === "top_pct" ? `各班前 ${topPct || "?"}%` : `综合分 ≥ ${minScore || "?"}`;

  const submit = async () => {
    if (!activeTerm) return toast.error("该学期还没有成绩数据，无法按成绩授予。");
    if (!name) return toast.error("请填写荣誉名称。");
    if (name.length > 30) return toast.error("荣誉名称不能超过 30 字。");
    if (!grantedOn) return toast.error("请选择授予日期。");
    if (note.length > 200) return toast.error("备注不能超过 200 字。");
    if (allowFailed && !note.trim()) return toast.error("勾选「允许挂科学生入选」需要填写备注说明。");
    const ids = (picked ?? []).filter((id) => !existing.has(id));
    if (ids.length === 0) return toast.error("请先勾选要授予的学生。");
    setBusy(true);
    try {
      const res = await apiPost("honor.bulk_create", {
        title: name, level, term: activeTerm, granted_on: grantedOn, note: note.trim(), student_ids: ids,
        include_history_fail: includeHistoryFail, allow_failed: allowFailed,
      });
      await store.refresh();
      const created = Number(res.created ?? 0);
      const skipped = Array.isArray(res.skipped) ? res.skipped.length : 0;
      toast.success(`已授予 ${created} 人${skipped ? `，跳过 ${skipped} 人` : ""}。`);
      if (created > 0) setPicked(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "授予失败，请稍后重试。");
    }
    setBusy(false);
  };

  if (term === ALL_TERM) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground shadow-xs">
        按成绩授予一次只针对一个学期，请在左侧「当前学期」选定具体学期。
        {latestGradeTerm ? (
          <Button variant="outline" size="sm" onClick={() => termScope.setTerm(latestGradeTerm)}>
            跳到最近有成绩的学期（{latestGradeTerm}）
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="学期" required>
            <div className="flex h-9 items-center justify-between rounded-md border bg-muted/40 px-3 text-sm">
              <span className="font-medium">{activeTerm || "暂无学期"}</span>
              <span className="text-[11px] text-muted-foreground">跟随左侧学期</span>
            </div>
          </FormField>
          <FormField label="授予日期" required>
            <DateInput value={grantedOn} onChange={setGrantedOn} className="sm:max-w-none" />
          </FormField>
        </div>
        <FormField label="荣誉名称" required>
          <TitlePicker value={title} onChange={setTitle} />
        </FormField>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <FormField label="级别" required>
            <Select value={level} onValueChange={setLevel} options={HONOR_LEVELS.map((l) => ({ value: l, label: l }))} />
          </FormField>
          <FormField label="班级范围">
            <div className="flex h-9 items-center justify-between rounded-md border bg-muted/40 px-3 text-sm">
              <span className={scope.cls === ALL_CLASS ? "text-muted-foreground" : "font-medium"}>
                {scope.cls === ALL_CLASS ? "全部班级（各班独立取名次）" : scope.cls}
              </span>
              <span className="text-[11px] text-muted-foreground">跟随左侧班级</span>
            </div>
          </FormField>
        </div>
        <FormField label="圈选方式">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { v: "top_n", label: "班级前", suffix: "名", val: topN, set: setTopN, max: 3 },
                { v: "top_pct", label: "班级前", suffix: "%", val: topPct, set: setTopPct, max: 3 },
                { v: "min_score", label: "综合分 ≥", suffix: "", val: minScore, set: setMinScore, max: 5 },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => { setMode(o.v); setPicked(null); }}
                className={
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 " +
                  (mode === o.v ? "border-transparent bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")
                }
              >
                <span>{o.label}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={o.val}
                  maxLength={o.max}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { o.set(e.target.value.replace(/[^\d.]/g, "")); setPicked(null); }}
                  className={"w-12 rounded border bg-background px-1.5 py-0.5 text-center text-xs tabular-nums text-foreground " + (mode === o.v ? "border-white/40" : "")}
                />
                <span>{o.suffix}</span>
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">
              {rows.length ? `该学期有成绩 ${rows.length} 人` : "该学期还没有成绩"}
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={includeHistoryFail}
                onChange={(e) => { setIncludeHistoryFail(e.target.checked); setPicked(null); }}
              />
              历史学期挂科也计入
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={allowFailed}
                onChange={(e) => { setAllowFailed(e.target.checked); setPicked(null); setShowExcluded(false); }}
              />
              本次允许挂科学生入选（须填备注说明）
            </label>
          </div>
        </FormField>
        <FormField label="备注">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="授予说明（选填，200 字以内）" maxLength={200} />
        </FormField>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPicked(grantable.map((r) => r.student.id))} disabled={!activeTerm || rows.length === 0}>
            按条件推荐
          </Button>
          <span className="text-xs text-muted-foreground">
            符合{previewCaption}的 {matched.length} 人
            {existing.size ? `，其中 ${Math.max(0, recommended.length - grantable.length)} 人已获同名荣誉` : ""}
            {blocked.length ? `，${blocked.length} 人${scopeLabel}挂科已排除` : ""}
          </span>
          {blocked.length ? (
            <button
              type="button"
              onClick={() => setShowExcluded((v) => !v)}
              className="text-xs text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {showExcluded ? "收起排除名单" : "查看排除名单"}
            </button>
          ) : null}
        </div>
        {showExcluded && blocked.length ? (
          <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <p className="mb-1 text-xs font-medium">挂科排除（{blocked.length} 人）</p>
            <ul className="space-y-1">
              {blocked.map((r) => (
                <li key={r.student.id} className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
                  <span className="font-medium">{r.student.name}</span>
                  <span className="text-muted-foreground">{r.student.student_no} · {r.student.class_name || "未分班"}</span>
                  <span className="text-destructive">{failBrief(failsOf(r.student.id))}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              确需破例：勾上「本次允许挂科学生入选」并在备注写明原因，授予记录会带着这条说明留档。
            </p>
          </div>
        ) : null}
      </div>

      {shown === null ? (
        <EmptyHint text="设好条件后点「按条件推荐」，名单会自动勾选，可再逐个调整。" />
      ) : recommended.length === 0 ? (
        <EmptyHint
          text={
            blocked.length
              ? `符合${previewCaption}的 ${matched.length} 人因${scopeLabel}挂科全部排除，如确需授予请勾选「本次允许挂科学生入选」。`
              : "按当前条件没有可选中的学生，请放宽名次或分数线。"
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setPicked(grantable.map((r) => r.student.id))}>全选可授予</Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked([])}>清空勾选</Button>
            <Button size="sm" className="ml-auto" onClick={() => void submit()} disabled={busy || pickedCount === 0}>
              {busy ? "授予中…" : `批量授予 ${pickedCount} 人`}
            </Button>
          </div>
          {byClass.map(([className, items]) => (
            <section key={className}>
              <div className="mb-1.5 flex items-center gap-2">
                <h3 className="text-sm font-semibold">{className}</h3>
                <span className="text-xs text-muted-foreground">{items.length} 人符合</span>
              </div>
              <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
                {items.map((r) => {
                  const id = r.student.id;
                  const has = existing.has(id);
                  const checked = shown.has(id);
                  return (
                    <label
                      key={id}
                      className={
                        "flex cursor-pointer items-center gap-3 border-t px-4 py-2 first:border-t-0 " +
                        (has ? "cursor-not-allowed opacity-60" : checked ? "bg-primary/5" : "hover:bg-accent/40")
                      }
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={checked && !has}
                        disabled={has}
                        onChange={() => setPicked((prev) => {
                          const list = prev ?? [];
                          return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
                        })}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="text-sm font-medium">{r.student.name}</span>
                        <span className="ml-1.5 text-xs text-muted-foreground">{r.student.student_no}</span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {r.rankRow ? `班内 ${r.rankRow.rank}/${r.rankRow.total}` : "未定"}
                      </span>
                      <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">{fmt1(r.rankRow?.composite ?? null)}</span>
                      {has ? <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">已有</Badge> : null}
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
          <p className="px-1 text-[11px] text-muted-foreground">
            名次按学期综合分在班内计算（{previewCaption}），与成绩各屏口径一致。
            {allowFailed ? "本次已放开挂科限制，备注会随授予记录留档。" : `考试分低于 ${PASS_SCORE} 即视为挂科，${scopeLabel}有挂科的学生不参与圈选。`}
          </p>
        </div>
      )}
    </div>
  );
}

export default function HonorsView({ store }: { store: Store }) {
  const [view, setView] = useState<View>("ledger");
  const scope = useClassScope();
  const termScope = useTermScope();
  const activeCount = useMemo(
    () => store.honors.filter((h) => h.status === "active" && inClassScope(scope, h.class_name) && inTermScope(termScope, h.term)).length,
    [store.honors, scope, termScope],
  );
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Medal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
          <SegPills
            options={[
              { value: "ledger", label: "荣誉台账", count: activeCount },
              { value: "grant", label: "按成绩授予" },
            ]}
            value={view}
            onChange={(v) => setView(v as View)}
          />
        </div>
      </div>
      {view === "ledger" ? <LedgerPanel store={store} /> : <GrantPanel store={store} />}
    </div>
  );
}
