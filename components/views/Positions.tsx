import { useMemo, useState } from "react";
import { Award, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFlash } from "@/components/motion";
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
import { Switch } from "@/components/ui/switch";
import { ALL, SegPills } from "@/components/views/grades/parts";
import { TableShell } from "@/components/list-table";
import type { Store } from "@/hooks/use-store";
import { inClassScope, useClassScope } from "@/hooks/use-class-scope";
import type { PositionItem } from "@/lib/types";
import { POSITION_PRESETS } from "@/lib/types";

const CUSTOM = "__custom";
const TODAY = () => new Date().toISOString().slice(0, 10);

function AppointmentDialog({ store, onClose }: { store: Store; onClose: () => void }) {
  const [studentKw, setStudentKw] = useState("");
  const [studentId, setStudentId] = useState("");
  const [titleChoice, setTitleChoice] = useState<string>(POSITION_PRESETS[0]);
  const [customTitle, setCustomTitle] = useState("");
  const [appointedOn, setAppointedOn] = useState(TODAY());
  const [note, setNote] = useState("");
  const [attendReport, setAttendReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const students = useMemo(() => {
    const kw = studentKw.trim().toLowerCase();
    return store.students
      .filter((s) => !kw || `${s.name}${s.student_no}${s.class_name}`.toLowerCase().includes(kw))
      .sort((a, b) => a.class_name.localeCompare(b.class_name, "zh") || a.student_no.localeCompare(b.student_no));
  }, [store.students, studentKw]);

  const studentOptions = useMemo(
    () => [
      { value: "", label: "请选择学生" },
      ...students.map((s) => ({ value: s.id, label: `${s.name}（${s.student_no}）${s.class_name || "未分班"}` })),
    ],
    [students]
  );

  const title = titleChoice === CUSTOM ? customTitle.trim() : titleChoice;
  const activeTitles = new Set(store.positions.filter((p) => p.status === "active").map((p) => `${p.student_id}|${p.title}`));
  const duplicated = Boolean(studentId && title && activeTitles.has(`${studentId}|${title}`));

  const submit = async () => {
    setError("");
    if (!studentId) { setError("请先选择要委任的学生。"); return; }
    if (!title) { setError("请填写职务名称。"); return; }
    if (title.length > 20) { setError("职务名称不能超过 20 字。"); return; }
    if (!appointedOn) { setError("请选择委任日期。"); return; }
    if (duplicated) { setError("该学生已担任此职务，无需重复委任。"); return; }
    if (note.length > 200) { setError("备注不能超过 200 字。"); return; }
    setBusy(true);
    const ok = await store.write("position.create", {
      student_id: studentId, title, appointed_on: appointedOn, note: note.trim(), attend_report: attendReport,
    });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>委任学生职务</DialogTitle>
          <DialogDescription>为班级学生委任班委等职务，同一学生可担任多个职务。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="学生" required>
            <div className="space-y-1.5">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={studentKw}
                  onChange={(e) => setStudentKw(e.target.value)}
                  placeholder="搜索姓名 / 学号 / 班级"
                  maxLength={30}
                  className="pl-8 pr-7"
                />
                {studentKw ? (
                  <button type="button" aria-label="清空搜索" onClick={() => setStudentKw("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="size-4" />
                  </button>
                ) : null}
              </div>
              <Select value={studentId} onValueChange={setStudentId} options={studentOptions} />
            </div>
          </FormField>
          <FormField label="职务" required>
            <div className="flex flex-wrap gap-1.5">
              {POSITION_PRESETS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTitleChoice(t)}
                  className={
                    "rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 " +
                    (titleChoice === t ? "border-transparent bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")
                  }
                >
                  {t}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setTitleChoice(CUSTOM)}
                className={
                  "rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 " +
                  (titleChoice === CUSTOM ? "border-transparent bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent")
                }
              >
                其他…
              </button>
            </div>
            {titleChoice === CUSTOM ? (
              <Input
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="自定义职务名称（20 字以内）"
                maxLength={20}
                className="mt-2"
                autoFocus
              />
            ) : null}
          </FormField>
          <FormField label="委任日期" required>
            <DateInput value={appointedOn} onChange={setAppointedOn} className="sm:max-w-44" />
          </FormField>
          <FormField label="备注">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="委任说明（选填，200 字以内）"
              maxLength={200}
              rows={2}
            />
          </FormField>
          <FormField label="考勤上报权限">
            <label className="flex items-start gap-3">
              <Switch checked={attendReport} onCheckedChange={setAttendReport} className="mt-0.5" />
              <span className="min-w-0 text-xs leading-5 text-muted-foreground">
                开通后该生会出现「考勤上报」入口，可登记本班同学；撤销职务即收回权限，已上报记录保留。
              </span>
            </label>
          </FormField>
          {duplicated ? <p className="text-sm text-amber-600">该学生已担任此职务，无需重复委任。</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "提交中…" : "确认委任"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PositionCard({ p, onRevoke, onToggleReport, toggling }: { p: PositionItem; onRevoke: () => void; onToggleReport: (next: boolean) => void; toggling: boolean }) {
  // 开关写入后名单是整表刷新的，行不会重挂；闪光用来确认「这一下存下来了」
  const flash = useFlash(p.attend_report === true);
  return (
    <div className={"rounded-xl border bg-card px-4 py-3 shadow-xs " + flash}>
      <div className="flex items-center gap-2">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white"
          style={{ backgroundImage: "var(--grad-primary)" }}
          aria-hidden
        >
          <Award className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {p.student_name}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">{p.student_no}</span>
          </span>
          <span className="block text-xs text-muted-foreground">委任于 {p.appointed_on}</span>
        </span>
        <Badge variant="outline" className="shrink-0 border-transparent bg-primary/10 font-normal text-primary">{p.title}</Badge>
        <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground hover:text-destructive" onClick={onRevoke}>
          撤销
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-2.5 pl-10">
        <Switch checked={p.attend_report === true} disabled={toggling} onCheckedChange={(v) => onToggleReport(v)} />
        <span className="text-xs text-muted-foreground">
          {p.attend_report ? "已开通本班考勤上报" : "未开通考勤上报"}
        </span>
      </div>
      {p.note ? <p className="mt-1.5 pl-10 text-xs text-muted-foreground">{p.note}</p> : null}
    </div>
  );
}

export default function PositionsView({ store }: { store: Store }) {
  const [seg, setSeg] = useState<"active" | "revoked">("active");
  const [keyword, setKeyword] = useState("");
  const scope = useClassScope();
  const [titleFilter, setTitleFilter] = useState(ALL);
  const [appointing, setAppointing] = useState(false);
  const [revoking, setRevoking] = useState<PositionItem | null>(null);
  const [busy, setBusy] = useState(false);

  const active = useMemo(
    () => store.positions.filter((p) => p.status === "active" && inClassScope(scope, p.class_name)),
    [store.positions, scope],
  );
  const revoked = useMemo(
    () => store.positions.filter((p) => p.status === "revoked" && inClassScope(scope, p.class_name)),
    [store.positions, scope],
  );

  const titleOptions = useMemo(() => {
    const src = seg === "active" ? active : revoked;
    return [{ value: ALL, label: "全部职务" }, ...[...new Set(src.map((p) => p.title))].sort((a, b) => a.localeCompare(b, "zh")).map((t) => ({ value: t, label: t }))];
  }, [seg, active, revoked]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const src = seg === "active" ? active : revoked;
    return src.filter((p) => {
      if (kw && !`${p.student_name}${p.student_no}${p.title}${p.note}`.toLowerCase().includes(kw)) return false;
      if (titleFilter !== ALL && p.title !== titleFilter) return false;
      return true;
    });
  }, [seg, active, revoked, keyword, titleFilter]);

  const byClass = useMemo(() => {
    const m = new Map<string, PositionItem[]>();
    for (const p of filtered) {
      const key = p.class_name || "未分班";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh"));
  }, [filtered]);

  const confirmRevoke = async () => {
    if (!revoking) return;
    setBusy(true);
    await store.write("position.revoke", { id: revoking.id });
    setBusy(false);
    setRevoking(null);
  };

  const [togglingId, setTogglingId] = useState("");
  const toggleReport = async (p: PositionItem, next: boolean) => {
    setTogglingId(p.id);
    const ok = await store.write("position.set_attend_report", { id: p.id, attend_report: next });
    setTogglingId("");
    if (ok) toast.success(next ? `${p.student_name} 已可上报本班考勤。` : `${p.student_name} 的考勤上报入口已关闭。`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-72">
          <SegPills
            options={[
              { value: "active", label: "现任职务", count: active.length },
              { value: "revoked", label: "历史撤销", count: revoked.length },
            ]}
            value={seg}
            onChange={(v) => { setSeg(v as "active" | "revoked"); setTitleFilter(ALL); }}
          />
        </div>
        <Button size="sm" onClick={() => setAppointing(true)}>
          <Plus className="size-4" /> 新委任
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索姓名 / 学号 / 职务"
            maxLength={30}
            className="pl-8 pr-7"
          />
          {keyword ? (
            <button type="button" aria-label="清空搜索" onClick={() => setKeyword("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="w-32 sm:w-40">
          <Select value={titleFilter} onValueChange={setTitleFilter} options={titleOptions} />
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} 条</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyHint
          icon={<Award className="size-5 text-white" />}
          text={seg === "active"
            ? (store.positions.length === 0 ? "还没有委任记录。" : "没有符合条件的现任职务。")
            : "没有历史撤销的职务记录。"}
          action={
            seg === "active" && store.positions.length === 0 ? (
              <Button size="sm" onClick={() => setAppointing(true)}>
                <Plus className="size-4" /> 委任职务
              </Button>
            ) : undefined
          }
        />
      ) : seg === "active" ? (
        <div className="space-y-4">
          {byClass.map(([className, items]) => (
            <section key={className}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="min-w-0 truncate text-sm font-semibold">{className}</h3>
                <span className="num shrink-0 text-xs text-muted-foreground">{items.length} 个职务</span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {items.map((p) => (
                  <PositionCard
                    key={p.id}
                    p={p}
                    onRevoke={() => setRevoking(p)}
                    toggling={togglingId === p.id}
                    onToggleReport={(next) => void toggleReport(p, next)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <TableShell>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground">
                <th className="px-4 py-2 font-medium">职务</th>
                <th className="px-2 py-2 font-medium">学生</th>
                <th className="hidden px-2 py-2 font-medium sm:table-cell">班级</th>
                <th className="px-2 py-2 font-medium">委任</th>
                <th className="px-4 py-2 text-right font-medium">撤销于</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-2">
                    <Badge variant="outline" className="font-normal text-muted-foreground">{p.title}</Badge>
                  </td>
                  <td className="px-2 py-2">
                    <span className="font-medium">{p.student_name}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{p.student_no}</span>
                  </td>
                  <td className="hidden px-2 py-2 text-xs text-muted-foreground sm:table-cell">{p.class_name || "未分班"}</td>
                  <td className="px-2 py-2 text-xs tabular-nums text-muted-foreground">{p.appointed_on}</td>
                  <td className="px-4 py-2 text-right text-xs tabular-nums text-muted-foreground">
                    {p.revoked_at ? p.revoked_at.slice(0, 10) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}

      {appointing ? <AppointmentDialog store={store} onClose={() => setAppointing(false)} /> : null}
      <AlertDialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>撤销职务</AlertDialogTitle>
            <AlertDialogDescription>
              确定撤销 {revoking?.student_name} 的「{revoking?.title}」职务吗？撤销后转入历史留档，可随时重新委任。
              {revoking?.attend_report ? "该班委的考勤上报入口会同时收回，已上报的考勤记录保留不清除。" : ""}
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
    </div>
  );
}
