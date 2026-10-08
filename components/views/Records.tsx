import { useMemo, useState } from "react";
import { Check, Paperclip, Plus, Search, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { DateInput, EmptyHint, FormField, Select } from "@/components/form";
import type { Store } from "@/hooks/use-store";
import { ALL_CLASS, useClassScope } from "@/hooks/use-class-scope";
import type { MemberUser } from "@/lib/session";
import { ApiError, apiPost } from "@/lib/api";
import { AttachmentsSection } from "@/components/Attachments";
import { StatusStamp, stampSafeWidth } from "@/components/StatusStamp";
import {
  RECORD_STATUS_LABEL,
  RECORD_TYPE_LABEL,
  studentName,
  type LeaveRules,
  type RecordItem,
  type RecordStatus,
  type RecordType,
} from "@/lib/types";

const ALL = "__all";
// 列表卡内容超过此长度才给「展开」，短事由不必多点一下
const CONTENT_CLAMP_AT = 80;

const TYPE_BADGE: Record<RecordType, string> = {
  leave: "pill-warning",
  talk: "pill-info",
  award: "pill-success",
  punish: "pill-danger",
};

// 请假状态印章：颜色与文字，尺寸/浓度统一由 components/StatusStamp.tsx 定义
// 待审批用琥珀色（与待审批卡边框、pill-warning 和反馈页一致），红色只留给「已驳回」，两种状态不再撞色
const LEAVE_STAMP: Record<RecordStatus, { color: string; label: string }> = {
  pending: { color: "#d97706", label: "待审批" },
  approved: { color: "#059669", label: "已通过" },
  rejected: { color: "#be123c", label: "已驳回" },
  done: { color: "#2563eb", label: "已办结" },
};

interface RecordDraft {
  student_id: string;
  type: string;
  title: string;
  content: string;
  occurred_on: string;
  status: string;
  review_note: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function ApproveDialog({
  approving,
  store,
  onClose,
}: {
  approving: { record: RecordItem; decision: "approved" | "rejected" };
  store: Store;
  onClose: () => void;
}) {
  const [note, setNote] = useState(approving.record.review_note ?? "");
  const [busy, setBusy] = useState(false);
  const approved = approving.decision === "approved";

  const submit = async () => {
    setBusy(true);
    const ok = await store.write("record.update", {
      id: approving.record.id,
      status: approving.decision,
      review_note: note.trim(),
    });
    setBusy(false);
    if (ok) {
      toast.success(approved ? "已通过请假申请" : "已驳回请假申请");
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{approved ? "通过请假申请" : "驳回请假申请"}</DialogTitle>
          <DialogDescription>
            {approving.record.title} · 审批意见会记录在案（可不填）。
          </DialogDescription>
        </DialogHeader>
        <FormField label="审批意见">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={approved ? "如：同意，注意安全" : "如：事由不充分，请补充医院证明"}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "提交中…" : approved ? "确认通过" : "确认驳回"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RulesDialog({
  store,
  onClose,
}: {
  store: Store;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<LeaveRules>(store.rules);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await apiPost("leave_rules.save", {
        max_days: Number(draft.max_days),
        advance_days: Number(draft.advance_days),
        require_material: draft.require_material,
        material_note: draft.material_note,
      });
      await store.refresh();
      toast.success("请假规则已保存，对学生端即时生效");
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>请假规则（学生端生效）</DialogTitle>
          <DialogDescription>学生提交请假时按这里的规则校验。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="单次最多天数" required>
              <Input
                type="number"
                min={1}
                max={90}
                value={draft.max_days}
                onChange={(e) => setDraft((d) => ({ ...d, max_days: e.target.value }))}
              />
            </FormField>
            <FormField label="需提前天数">
              <Input
                type="number"
                min={0}
                max={60}
                value={draft.advance_days}
                onChange={(e) => setDraft((d) => ({ ...d, advance_days: e.target.value }))}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.require_material}
              onChange={(e) => setDraft((d) => ({ ...d, require_material: e.target.checked }))}
            />
            请假必须上传证明材料（未上传时无法通过审批）
          </label>
          <FormField label="材料说明（展示给学生）">
            <Input
              value={draft.material_note}
              onChange={(e) => setDraft((d) => ({ ...d, material_note: e.target.value }))}
              maxLength={200}
              placeholder="如：病假需医院证明，事假需家长说明"
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "保存中…" : "保存规则"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordFormDialog({
  record,
  presetStudentId,
  presetType,
  lockType,
  onClose,
  store,
  member,
}: {
  record: RecordItem | null;
  presetStudentId?: string;
  presetType?: RecordType;
  lockType?: RecordType;
  onClose: () => void;
  store: Store;
  member: MemberUser;
}) {
  const isEdit = record !== null;
  const typeOptions = (Object.entries(RECORD_TYPE_LABEL) as [RecordType, string][])
    .filter(([value]) => (lockType ? value === lockType : value !== "leave"));
  const defaultType = lockType ?? presetType ?? "talk";
  const [draft, setDraft] = useState<RecordDraft>(
    record
      ? {
          student_id: record.student_id,
          type: record.type,
          title: record.title,
          content: record.content,
          occurred_on: record.occurred_on,
          status: record.status,
          review_note: record.review_note ?? "",
        }
      : {
          student_id: presetStudentId ?? (store.students[0]?.id ?? ALL),
          type: defaultType,
          title: "",
          content: "",
          occurred_on: today(),
          status: defaultType === "leave" ? "pending" : "done",
          review_note: "",
        }
  );
  const [busy, setBusy] = useState(false);
  const set = (key: keyof RecordDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const isLeave = draft.type === "leave";

  const submit = async () => {
    if (!draft.title.trim()) {
      toast.error("标题为必填项。");
      return;
    }
    if (draft.student_id === ALL) {
      toast.error("请先添加学生档案，再新增记录。");
      return;
    }
    setBusy(true);
    const payload: Record<string, unknown> = {
      student_id: draft.student_id,
      type: draft.type,
      title: draft.title,
      content: draft.content,
      occurred_on: draft.occurred_on,
    };
    let ok: boolean;
    if (isEdit) {
      payload.status = draft.status;
      payload.review_note = draft.review_note.trim();
      ok = await store.write("record.update", { id: record.id, ...payload });
    } else {
      ok = await store.write("record.create", payload);
    }
    setBusy(false);
    if (ok) {
      toast.success(isEdit ? "记录已更新" : "记录已添加");
      onClose();
    }
  };

  const studentOptions = [
    ...(draft.student_id === ALL ? [{ value: ALL, label: "暂无学生可选" }] : []),
    ...[...store.students]
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      .map((s) => ({ value: s.id, label: `${s.name}（${s.student_no}）${s.class_name ? " · " + s.class_name : ""}` })),
  ];

  const studentField = (
    <FormField label="学生" required>
      <Select value={draft.student_id} onValueChange={set("student_id")} options={studentOptions} />
    </FormField>
  );
  const typeField = lockType ? (
    <FormField label="类型" required>
      <Badge variant="outline" className={"h-9 w-fit items-center border-transparent font-normal " + TYPE_BADGE[lockType]}>
        {RECORD_TYPE_LABEL[lockType]}
      </Badge>
    </FormField>
  ) : (
    <FormField label="类型" required>
      <Select
        value={draft.type}
        onValueChange={(v) => {
          set("type")(v);
          if (!isEdit) set("status")(v === "leave" ? "pending" : "done");
        }}
        options={typeOptions.map(([value, label]) => ({ value, label }))}
      />
    </FormField>
  );
  const dateField = (
    <FormField label="日期">
      <DateInput value={draft.occurred_on} onChange={set("occurred_on")} />
    </FormField>
  );
  const titleField = (
    <FormField label="标题" required className="sm:col-span-2">
      <Input value={draft.title} onChange={(e) => set("title")(e.target.value)} placeholder={lockType === "leave" ? "如：请假：病假两天" : "如：谈心：学期初适应情况"} maxLength={120} />
    </FormField>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑记录" : lockType === "leave" ? "新增请假" : "新增记录"}</DialogTitle>
          <DialogDescription>{dialogHint(isEdit, lockType)}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {studentField}
          {typeField}
          {titleField}
          {dateField}
          {isEdit && isLeave ? (
            <FormField label="状态">
              <Select
                value={draft.status}
                onValueChange={set("status")}
                options={["pending", "approved", "rejected", "done"].map((v) => ({ value: v, label: RECORD_STATUS_LABEL[v as RecordStatus] }))}
              />
            </FormField>
          ) : null}
          {isEdit && draft.review_note ? (
            <FormField label="审批意见">
              <Input value={draft.review_note} onChange={(e) => set("review_note")(e.target.value)} maxLength={500} />
            </FormField>
          ) : null}
          <FormField label="内容" className="sm:col-span-2">
            <Textarea value={draft.content} onChange={(e) => set("content")(e.target.value)} rows={3} maxLength={2000} />
          </FormField>
          {isEdit ? <AttachmentsSection record={record} store={store} member={member} /> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "保存中…" : "保存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 默认状态说明只在新增时成立，编辑时改成可调整字段的提示
function dialogHint(isEdit: boolean, lockType?: RecordType): string {
  if (isEdit) return "状态与审批意见可直接调整，材料在下方增删。";
  return lockType === "leave" ? "手动代录的请假默认为「待审批」。" : "其余类型默认为「已办结」。";
}

export default function RecordsView({ store, member }: { store: Store; member: MemberUser }) {
  return <RecordsList store={store} member={member} mode="other" />;
}

export function LeavesView({ store, member }: { store: Store; member: MemberUser }) {
  return <RecordsList store={store} member={member} mode="leave" />;
}

function RecordsList({ store, member, mode }: { store: Store; member: MemberUser; mode: "leave" | "other" }) {
  const { records, students, attachments } = store;
  const isLeaveView = mode === "leave";
  const [type, setType] = useState<string>("talk");
  const [status, setStatus] = useState(ALL);
  const [leaveSeg, setLeaveSeg] = useState<"pending" | "handled">("pending");
  const [q, setQ] = useState("");
  const scope = useClassScope();
  const classById = useMemo(() => new Map(students.map((s) => [s.id, s.class_name])), [students]);
  const query = q.trim().toLowerCase();
  const matchIds = useMemo(() => {
    if (!query) return null;
    const set = new Set<string>();
    for (const s of students) {
      if (s.name.toLowerCase().includes(query) || s.student_no.toLowerCase().includes(query)) set.add(s.id);
    }
    return set;
  }, [students, query]);
  const focusStudent = matchIds && matchIds.size === 1 ? students.find((s) => matchIds.has(s.id)) ?? null : null;
  const inScope = (id: string) => {
    if (matchIds && !matchIds.has(id)) return false;
    if (scope.cls !== ALL_CLASS && classById.get(id) !== scope.cls) return false;
    return true;
  };
  const [form, setForm] = useState<{ record: RecordItem | null; preset?: string; presetType?: RecordType } | null>(null);
  const [deleting, setDeleting] = useState<RecordItem | null>(null);
  const [approving, setApproving] = useState<{ record: RecordItem; decision: "approved" | "rejected" } | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const filtered = useMemo(() => {
    let items = records.filter((r) => r.type === type && inScope(r.student_id));
    if (status !== ALL) items = items.filter((r) => r.status === status);
    return items;
  }, [records, type, status, matchIds, scope, classById]);
  const byDateDesc = (a: RecordItem, b: RecordItem) =>
    a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0;
  const pendingLeaves = useMemo(
    () => records.filter((r) => r.type === "leave" && r.status === "pending" && inScope(r.student_id)).sort(byDateDesc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, matchIds, scope, classById]
  );
  const handledLeaves = useMemo(
    () =>
      records
        .filter(
          (r) =>
            r.type === "leave" && r.status !== "pending" && (status === ALL || r.status === status) && inScope(r.student_id)
        )
        .sort(byDateDesc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, status, matchIds, scope, classById]
  );
  const handledLeaveCount = useMemo(
    () => records.filter((r) => r.type === "leave" && r.status !== "pending" && inScope(r.student_id)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, matchIds, scope, classById]
  );
  const typeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) if (r.type !== "leave" && inScope(r.student_id)) map.set(r.type, (map.get(r.type) ?? 0) + 1);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, matchIds, scope, classById]);
  const attachCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of attachments) map.set(a.record_id, (map.get(a.record_id) ?? 0) + 1);
    return map;
  }, [attachments]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    const ok = await store.write("record.delete", { id: deleting.id });
    setBusyId(null);
    if (ok) toast.success("记录已删除");
    setDeleting(null);
  };

  const renderRow = (r: RecordItem, withStamp: boolean) => {
    const stamp = withStamp ? LEAVE_STAMP[r.status] : undefined;
    const leaveRange =
      r.type === "leave" && r.start_date && r.end_date
        ? `${r.start_date} ~ ${r.end_date}${r.leave_days ? ` 共 ${r.leave_days} 天` : ""}`
        : r.occurred_on;
    const attachCount = attachCounts.get(r.id) ?? 0;
    const long = (r.content?.length ?? 0) > CONTENT_CLAMP_AT;
    const open = expanded.has(r.id);
    const editButton = (
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setForm({ record: r })}>
        编辑
      </Button>
    );
    const deleteButton = (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs text-destructive"
        onClick={() => setDeleting(r)}
      >
        删除
      </Button>
    );
    const textBlock = (
      <>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</span>
          {r.source === "student" ? (
            <Badge variant="outline" className="shrink-0 border-transparent bg-primary/10 font-normal text-primary">
              学生提交
            </Badge>
          ) : null}
          {!stamp ? (
            <Badge variant="secondary" className="shrink-0 font-normal">{RECORD_STATUS_LABEL[r.status] ?? r.status}</Badge>
          ) : null}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {studentName(students, r.student_id)} · {leaveRange}
        </p>
        {r.content ? (
          <p className={"mt-1 text-xs leading-relaxed text-muted-foreground" + (open || !long ? "" : " line-clamp-2")}>
            {r.content}
            {long ? (
              <button
                type="button"
                className="ml-1 shrink-0 text-primary hover:underline"
                onClick={() => toggleExpanded(r.id)}
              >
                {open ? "收起" : "展开"}
              </button>
            ) : null}
          </p>
        ) : null}
        {r.review_note ? (
          <p className="mt-1 text-xs text-muted-foreground">审批意见：{r.review_note}</p>
        ) : null}
      </>
    );

    // 印章是右上绝对定位的水印层，不决定卡片高度；正文让出的宽度由印章尺寸推导
    return (
      <li key={r.id} className="relative overflow-hidden rounded-xl border bg-card px-4 py-3 shadow-xs">
        {stamp ? <StatusStamp color={stamp.color} label={stamp.label} /> : null}
        <div className="relative z-10" style={stamp ? { paddingRight: stampSafeWidth } : undefined}>
          {textBlock}
        </div>
        <div className="relative z-10 mt-2 flex items-center gap-1">
          {attachCount > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => setForm({ record: r })}
            >
              材料 · {attachCount}
            </Button>
          ) : null}
          <div className="ml-auto flex shrink-0 gap-1">
            {editButton}
            {deleteButton}
          </div>
        </div>
      </li>
    );
  };

  const pendingStamp = LEAVE_STAMP.pending;
  const renderPendingCard = (r: RecordItem) => (
    <li key={r.id} className="relative overflow-hidden rounded-xl border-2 border-amber-400/60 bg-card px-4 py-3 shadow-sm">
      <StatusStamp color={pendingStamp.color} label={pendingStamp.label} />
      <div className="relative z-10" style={{ paddingRight: stampSafeWidth }}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-base font-semibold">{r.title}</span>
          {r.source === "student" ? (
            <Badge variant="outline" className="shrink-0 border-transparent bg-primary/10 font-normal text-primary">
              学生提交
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {studentName(students, r.student_id)} ·{" "}
          {r.start_date && r.end_date
            ? `${r.start_date} ~ ${r.end_date}${r.leave_days ? ` 共 ${r.leave_days} 天` : ""}`
            : r.occurred_on}
        </p>
        <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed">{r.content || "（未填写事由）"}</p>
      </div>
      <div className="relative z-10 mt-3 flex items-center gap-2">
        <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => setForm({ record: r })}>
          <Paperclip className="size-3.5" /> 材料与详情 · {attachCounts.get(r.id) ?? 0}
        </Button>
        <div className="ml-auto flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
            onClick={() => setApproving({ record: r, decision: "rejected" })}
          >
            <X className="size-4" /> 驳回
          </Button>
          <Button size="sm" className="h-8" onClick={() => setApproving({ record: r, decision: "approved" })}>
            <Check className="size-4" /> 通过
          </Button>
        </div>
      </div>
    </li>
  );

  const searchBox = (
    <div className="relative w-full shrink-0 sm:w-44">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索姓名/学号"
        maxLength={30}
        className="h-9 pl-8 pr-7 text-sm"
      />
      {q ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => setQ("")}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );

  const visibleCount = isLeaveView ? pendingLeaves.length + handledLeaveCount : filtered.length;
  const summaryRow = matchIds ? (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {focusStudent ? (
        <Badge variant="outline" className="gap-1.5 border-primary/40 bg-primary/10 py-1 font-normal text-primary">
          {focusStudent.name} · {focusStudent.student_no}
          {focusStudent.class_name ? ` · ${focusStudent.class_name}` : ""}
          <button type="button" aria-label="清空搜索" onClick={() => setQ("")} className="rounded-full p-0.5 hover:bg-primary/15">
            <X className="size-3" />
          </button>
        </Badge>
      ) : matchIds.size === 0 ? (
        <span>未找到匹配「{q.trim()}」的学生。</span>
      ) : (
        <span>命中 {matchIds.size} 人 · 共 {visibleCount} 条记录，输入更完整可定位单人。</span>
      )}
      <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setQ("")}>
        清空筛选
      </button>
    </div>
  ) : null;

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">{isLeaveView ? "请假审批" : "日常记录"}</h1>
        </div>
        <div className="flex shrink-0 gap-2">
          {isLeaveView ? (
            <Button variant="outline" onClick={() => setShowRules(true)}>
              <Settings2 className="size-4" /> <span className="hidden sm:inline">请假规则</span>
            </Button>
          ) : null}
          <Button onClick={() => setForm(isLeaveView ? { record: null } : { record: null, presetType: type as RecordType })}>
            <Plus className="size-4" /> <span className="hidden sm:inline">{isLeaveView ? "新增请假" : "新增记录"}</span><span className="sm:hidden">{isLeaveView ? "请假" : "新增"}</span>
          </Button>
        </div>
      </div>

      {isLeaveView ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl border bg-muted/40 p-1">
            {([
              { v: "pending", label: "待审批", n: pendingLeaves.length },
              { v: "handled", label: "已处理", n: handledLeaveCount },
            ] as const).map(({ v, label, n }) => {
              const active = leaveSeg === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setLeaveSeg(v)}
                  aria-pressed={active}
                  className={
                    "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50 " +
                    (active ? "text-white" : "text-muted-foreground hover:text-foreground")
                  }
                  style={active ? { backgroundImage: "var(--grad-primary)", boxShadow: "var(--shadow-glow)" } : undefined}
                >
                  {v === "pending" && n > 0 ? (
                    <span className={"size-1.5 shrink-0 rounded-full " + (active ? "bg-white" : "bg-rose-500")} />
                  ) : null}
                  <span>{label}</span>
                  <span className={"shrink-0 text-[11px] tabular-nums " + (active ? "text-white/85" : "text-muted-foreground/70")}>
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
          {leaveSeg === "handled" ? (
            <div className="w-28 shrink-0 sm:w-36">
              <Select
                value={status}
                onValueChange={setStatus}
                options={[
                  { value: ALL, label: "全部结果" },
                  ...(["approved", "rejected", "done"] as RecordStatus[]).map((v) => ({ value: v, label: RECORD_STATUS_LABEL[v] })),
                ]}
              />
            </div>
          ) : null}
          {searchBox}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl border bg-muted/40 p-1">
            {(["talk", "award", "punish"] as RecordType[]).map((v) => {
              const active = type === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setType(v)}
                  aria-pressed={active}
                  className={
                    "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50 " +
                    (active ? "text-white" : "text-muted-foreground hover:text-foreground")
                  }
                  style={active ? { backgroundImage: "var(--grad-primary)", boxShadow: "var(--shadow-glow)" } : undefined}
                >
                  <span className="truncate">{RECORD_TYPE_LABEL[v]}</span>
                  <span className={"shrink-0 text-[11px] tabular-nums " + (active ? "text-white/85" : "text-muted-foreground/70")}>
                    {typeCounts.get(v) ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="w-28 shrink-0 sm:w-36">
            <Select
              value={status}
              onValueChange={setStatus}
              options={[
                { value: ALL, label: "全部状态" },
                ...Object.entries(RECORD_STATUS_LABEL).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
          {searchBox}
        </div>
      )}

      {summaryRow}

      {isLeaveView ? (
        leaveSeg === "pending" ? (
          pendingLeaves.length === 0 ? (
            <EmptyHint text="暂无待审批的请假申请。" />
          ) : (
            <ul className="space-y-3">{pendingLeaves.map(renderPendingCard)}</ul>
          )
        ) : handledLeaves.length === 0 ? (
          <EmptyHint
            text={records.some((r) => r.type === "leave") ? "没有符合条件的已处理请假。" : "还没有请假申请。"}
          />
        ) : (
          <ul className="space-y-2">{handledLeaves.map((r) => renderRow(r, true))}</ul>
        )
      ) : filtered.length === 0 ? (
        <EmptyHint text={`还没有「${RECORD_TYPE_LABEL[type as RecordType]}」类记录。`} />
      ) : (
        <ul className="space-y-2">{filtered.map((r) => renderRow(r, false))}</ul>
      )}

      {form ? (
        <RecordFormDialog
          key={form.record?.id ?? `new-${form.preset ?? "none"}-${form.presetType ?? ""}`}
          record={form.record}
          presetStudentId={form.preset}
          presetType={form.presetType}
          lockType={isLeaveView ? "leave" : undefined}
          onClose={() => setForm(null)}
          store={store}
          member={member}
        />
      ) : null}

      {approving ? (
        <ApproveDialog
          key={approving.record.id + approving.decision}
          approving={approving}
          store={store}
          onClose={() => setApproving(null)}
        />
      ) : null}

      {showRules ? <RulesDialog store={store} onClose={() => setShowRules(false)} /> : null}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条记录？</AlertDialogTitle>
            <AlertDialogDescription>「{deleting?.title}」将被删除，此操作不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId !== null}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
