import { useMemo, useState } from "react";
import { CalendarDays, CircleAlert, FileText, KeyRound, Pencil, ScrollText, Send, Trash2 } from "lucide-react";
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
import { AttachmentsSection } from "@/components/Attachments";
import { ChangePasswordDialog } from "@/components/account-dialogs";
import { PhotoAvatar } from "@/lib/photos";
import type { Store } from "@/hooks/use-store";
import type { MemberUser } from "@/lib/session";
import { ApiError, apiPost } from "@/lib/api";
import {
  POLITICAL_OPTIONS,
  RECORD_STATUS_LABEL,
  formatBytes,
  type LeaveRules,
  type RecordItem,
  type Student,
} from "@/lib/types";

const today = () => new Date().toISOString().slice(0, 10);
const dayCount = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;

const STATUS_BADGE: Record<string, string> = {
  pending: "pill-warning",
  approved: "pill-success",
  rejected: "pill-danger",
  done: "pill-info",
};

export function rulesSummary(rules: LeaveRules): string {
  const parts = [`单次最多 ${rules.max_days} 天`];
  if (Number(rules.advance_days) > 0) parts.push(`需提前 ${rules.advance_days} 天提交`);
  parts.push(rules.require_material ? "必须上传证明材料" : "材料视情况上传");
  if (rules.material_note) parts.push(rules.material_note);
  return parts.join(" · ");
}

function LeaveFormDialog({
  store,
  member,
  onClose,
}: {
  store: Store;
  member: MemberUser;
  onClose: () => void;
}) {
  const rules = store.rules;
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<RecordItem | null>(null);
  const days = start && end ? dayCount(start, end) : 0;
  const overLimit = days > Number(rules.max_days);

  const submit = async () => {
    if (!reason.trim()) {
      toast.error("请填写请假事由。");
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost("leave.submit", { start_date: start, end_date: end, content: reason.trim() });
      const item = res.item as RecordItem | undefined;
      await store.refresh();
      if (item) {
        setCreated(item);
        toast.success("请假申请已提交，等待辅导员审批");
      } else {
        onClose();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "提交失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{created ? "上传证明材料" : "提交请假申请"}</DialogTitle>
          {!created ? <DialogDescription>请假规则（辅导员设定）：{rulesSummary(rules)} · 待审批最多 5 条。</DialogDescription> : null}
        </DialogHeader>
        {created ? (
          <div className="grid gap-3">
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
              申请已提交（{created.title}）。
              {rules.require_material ? "按规则本次请假必须上传材料，辅导员通过前会检查。" : "如有医院证明等材料可在此上传。"}
            </p>
            <AttachmentsSection record={created} store={store} member={member} />
            <DialogFooter>
              <Button onClick={onClose}>完成</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="开始日期" required>
              <DateInput value={start} onChange={setStart} />
            </FormField>
            <FormField label="结束日期" required>
              <DateInput value={end} min={start} onChange={setEnd} />
            </FormField>
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              共 {days > 0 ? days : "-"} 天
              {overLimit ? <span className="ml-1 text-destructive">已超过单次上限 {rules.max_days} 天</span> : null}
            </p>
            <FormField className="sm:col-span-2" label="请假事由" required>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="如：家中有事需返校处理，附家长知情说明。"
              />
            </FormField>
            <DialogFooter className="sm:col-span-2">
              <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
              <Button onClick={() => void submit()} disabled={busy || overLimit || days < 1}>
                {busy ? "提交中…" : "提交申请"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProfileDialog({
  store,
  student,
  onClose,
}: {
  store: Store;
  student: Student;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
    name: student.name,
    gender: student.gender,
    class_name: student.class_name,
    major: student.major,
    grade: student.grade,
    phone: student.phone,
    political_status: student.political_status || "群众",
    native_place: student.native_place,
  });
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    setBusy(true);
    try {
      await apiPost("profile.submit", draft);
      await store.refresh();
      toast.success("个人信息已保存，将同步到辅导员端");
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "保存失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>完善个人信息</DialogTitle>
          <DialogDescription>学号不可修改。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="姓名" required>
            <Input value={draft.name} onChange={(e) => set("name")(e.target.value)} maxLength={60} />
          </FormField>
          <FormField label="性别" required>
            <Select
              value={draft.gender}
              onValueChange={set("gender")}
              options={[{ value: "男", label: "男" }, { value: "女", label: "女" }]}
            />
          </FormField>
          <FormField label="班级">
            <Input value={draft.class_name} onChange={(e) => set("class_name")(e.target.value)} maxLength={60} />
          </FormField>
          <FormField label="专业">
            <Input value={draft.major} onChange={(e) => set("major")(e.target.value)} maxLength={60} />
          </FormField>
          <FormField label="年级">
            <Input value={draft.grade} onChange={(e) => set("grade")(e.target.value)} maxLength={16} placeholder="如 2024" />
          </FormField>
          <FormField label="联系电话">
            <Input value={draft.phone} onChange={(e) => set("phone")(e.target.value)} maxLength={32} />
          </FormField>
          <FormField label="政治面貌">
            <Select
              value={draft.political_status}
              onValueChange={set("political_status")}
              options={POLITICAL_OPTIONS.map((v) => ({ value: v, label: v }))}
            />
          </FormField>
          <FormField label="籍贯">
            <Input value={draft.native_place} onChange={(e) => set("native_place")(e.target.value)} maxLength={60} />
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed py-2 text-sm last:border-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{value || "未填写"}</span>
    </div>
  );
}

export function StudentProfileView({
  store,
  member,
  onUpdateMember,
}: {
  store: Store;
  member: MemberUser;
  onUpdateMember: (member: MemberUser) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const self = store.students.find((s) => s.id === member.student_id) ?? null;
  const room = self?.dorm_room_id ? store.rooms.find((r) => r.id === self.dorm_room_id) : null;

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">我的信息</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={!self}>
          <Pencil className="size-4" /> 编辑
        </Button>
      </div>

      {!self ? (
        <EmptyHint text="账号尚未绑定学籍信息，请联系辅导员确认学号已登记后重新注册。" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-card px-4 py-3 shadow-xs sm:col-span-2">
            <p className="mb-1 text-sm font-semibold">证件照</p>
            <div className="flex items-center gap-4">
              <PhotoAvatar
                studentId={self.id}
                name={self.name}
                photo={store.photos.find((p) => p.student_id === self.id) ?? null}
                size={96}
                editable
                onUploaded={() => void store.refresh()}
              />
              <div className="min-w-0 text-sm">
                <p className="text-muted-foreground">点击头像上传或更换本人近期免冠证件照（jpg / png / webp，≤2MB）。</p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border bg-card px-4 py-3 shadow-xs">
            <p className="mb-1 text-sm font-semibold">学籍信息</p>
            <InfoRow label="学号" value={self.student_no} />
            <InfoRow label="姓名" value={self.name} />
            <InfoRow label="性别" value={self.gender} />
            <InfoRow label="班级" value={self.class_name} />
            <InfoRow label="专业" value={self.major} />
            <InfoRow label="年级" value={self.grade} />
          </div>
          <div className="rounded-xl border bg-card px-4 py-3 shadow-xs">
            <p className="mb-1 text-sm font-semibold">联系方式与其他</p>
            <InfoRow label="联系电话" value={self.phone} />
            <InfoRow label="政治面貌" value={self.political_status} />
            <InfoRow label="籍贯" value={self.native_place} />
            <InfoRow label="宿舍" value={room ? `${room.building} ${room.room_no}${self.bed_no ? ` · ${self.bed_no}号床` : ""}` : "未分配"} />
          </div>
          <div className="rounded-xl border bg-card px-4 py-3 shadow-xs sm:col-span-2">
            <p className="mb-1 text-sm font-semibold">班级干部职务</p>
            {store.positions.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground">暂无委任的职务。</p>
            ) : (
              <div className="space-y-0">
                {store.positions.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 border-b border-dashed py-2 text-sm last:border-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className={
                        "shrink-0 font-normal " +
                        (p.status === "active" ? "border-transparent bg-primary/10 text-primary" : "border-transparent bg-muted text-muted-foreground line-through")
                      }>{p.title}</Badge>
                      {p.note ? <span className="truncate text-xs text-muted-foreground">{p.note}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {p.status === "active" ? `委任于 ${p.appointed_on}` : `撤销于 ${p.revoked_at ? p.revoked_at.slice(0, 10) : "-"}`}
                    </span>
                  </div>
                ))}
                {store.positions.some((p) => p.status === "active" && p.attend_report) ? (
                  <p className="pt-2 text-xs text-muted-foreground">
                    已开通本班考勤上报，可在「考勤上报」页登记本班同学；撤销职务后入口自动关闭，已上报记录保留。
                  </p>
                ) : null}
              </div>
            )}
          </div>
          <div className="rounded-xl border bg-card px-4 py-3 shadow-xs sm:col-span-2">
            <p className="mb-1 text-sm font-semibold">账号与安全</p>
            <InfoRow label="登录账号" value={member.username} />
            <div className="flex items-center justify-between gap-3 border-b border-dashed py-2 text-sm last:border-0">
              <span className="shrink-0 text-muted-foreground">登录密码</span>
              <Button variant="outline" size="sm" onClick={() => setChangingPw(true)}>
                <KeyRound className="size-4" /> 修改密码
              </Button>
            </div>
          </div>
        </div>
      )}

      {editing && self ? <ProfileDialog store={store} student={self} onClose={() => setEditing(false)} /> : null}
      {changingPw ? (
        <ChangePasswordDialog
          onDone={(m) => {
            onUpdateMember(m);
            setChangingPw(false);
          }}
          onClose={() => setChangingPw(false)}
        />
      ) : null}
    </section>
  );
}

// 学生端「请假」：只管请假这一件事。
// 规则是「说明」不是「内容」，所以标题下方一行字呈现（辅导员端改规则即时同步），
// 不再做成与待审批行同形的卡片/胶囊。
export default function StudentView({
  store,
  member,
  onOpenMessages,
  onOpenProfile,
}: {
  store: Store;
  member: MemberUser;
  onOpenMessages: () => void;
  onOpenProfile: () => void;
}) {
  const [form, setForm] = useState(false);
  const [seg, setSeg] = useState<"pending" | "history">("pending");
  const [histStatus, setHistStatus] = useState("all");
  const [cancelling, setCancelling] = useState<RecordItem | null>(null);
  const [busy, setBusy] = useState(false);
  const self = store.students.find((s) => s.id === member.student_id) ?? null;
  const myLeaves = useMemo(
    () => store.records.filter((r) => r.type === "leave" && r.student_id === member.student_id),
    [store.records, member.student_id]
  );
  const unreadReplies = store.messages.filter((m) => m.replied === 1 && m.sender_role === "student").length;
  const pendingLeaves = myLeaves.filter((r) => r.status === "pending");
  const historyAll = useMemo(
    () => myLeaves.filter((r) => r.status !== "pending").sort((a, b) => (b.start_date || b.occurred_on).localeCompare(a.start_date || a.occurred_on)),
    [myLeaves]
  );
  const historyLeaves = histStatus === "all" ? historyAll : historyAll.filter((r) => r.status === histStatus);
  const profileIncomplete = !self || !self.gender || !self.class_name || !self.phone;

  const cancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    try {
      await apiPost("leave.cancel", { id: cancelling.id });
      await store.refresh();
      toast.success("已撤回请假申请");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "撤回失败，请稍后重试。");
    } finally {
      setBusy(false);
      setCancelling(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">我的请假</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {self ? `${self.name} · 学号 ${self.student_no}` : "未绑定学籍信息"}
            {pendingLeaves.length > 0 ? ` · ${pendingLeaves.length} 条待审批` : ""}
          </p>
          <p className="mt-1.5 text-[15px] font-semibold leading-6 text-foreground">
            <ScrollText className="mr-1 inline-block size-4 shrink-0 align-[-3px] text-muted-foreground" />
            请假规则（辅导员设定）：{rulesSummary(store.rules)} · 待审批最多 5 条
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={onOpenMessages}>
            <Send className="size-4" /> 留言
            {unreadReplies > 0 ? <Badge variant="outline" className="ml-1 border-transparent bg-primary/10 text-primary">{unreadReplies}</Badge> : null}
          </Button>
          <Button size="sm" onClick={() => setForm(true)}>
            <CalendarDays className="size-4" /> 请假
          </Button>
        </div>
      </div>

      {profileIncomplete ? (
        <button
          type="button"
          onClick={onOpenProfile}
          className="flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left text-sm text-[color:var(--warning-fg)] transition-colors hover:bg-muted/60"
          style={{ borderLeftColor: "var(--warning)" }}
        >
          <CircleAlert className="size-4 shrink-0" />
          请先补全个人信息，否则请假无法正常送达审批。
          <span className="ml-auto shrink-0 font-semibold">去填写 →</span>
        </button>
      ) : null}

      <div className="flex min-w-0 items-center gap-1 rounded-xl border bg-muted/40 p-1">
        {([
          { v: "pending", label: "待审批", n: pendingLeaves.length },
          { v: "history", label: "历史记录", n: historyAll.length },
        ] as const).map(({ v, label, n }) => {
          const active = seg === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setSeg(v)}
              aria-pressed={active}
              className={
                "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50 " +
                (active ? "text-white" : "text-muted-foreground hover:text-foreground")
              }
              style={active ? { backgroundImage: "var(--grad-primary)", boxShadow: "var(--shadow-glow)" } : undefined}
            >
              {v === "pending" && n > 0 ? <span className={"size-1.5 shrink-0 rounded-full " + (active ? "bg-white" : "bg-rose-500")} /> : null}
              <span>{label}</span>
              <span className={"shrink-0 text-[11px] tabular-nums " + (active ? "text-white/85" : "text-muted-foreground/70")}>{n}</span>
            </button>
          );
        })}
      </div>

      {seg === "history" && historyAll.length > 0 ? (
        <div className="w-32">
          <Select
            value={histStatus}
            onValueChange={setHistStatus}
            ariaLabel="历史请假状态筛选"
            options={[
              { value: "all", label: "全部结果" },
              { value: "approved", label: RECORD_STATUS_LABEL.approved },
              { value: "rejected", label: RECORD_STATUS_LABEL.rejected },
              { value: "done", label: RECORD_STATUS_LABEL.done },
            ]}
          />
        </div>
      ) : null}

      {(seg === "pending" ? pendingLeaves : historyLeaves).length === 0 ? (
        <EmptyHint
          text={
            seg === "pending"
              ? "暂无待审批的请假申请。"
              : historyAll.length === 0
                ? "还没有已处理的请假记录。"
                : "没有符合筛选的请假记录。"
          }
        />
      ) : (
        <ul className="space-y-2">
          {(seg === "pending" ? pendingLeaves : historyLeaves).map((r) => (
            <li key={r.id} className="rounded-xl border bg-card px-4 py-3 shadow-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="outline" className={"shrink-0 border-transparent font-normal " + (STATUS_BADGE[r.status] ?? "bg-muted text-muted-foreground")}>
                  {RECORD_STATUS_LABEL[r.status as keyof typeof RECORD_STATUS_LABEL] ?? r.status}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.title}</span>
                {r.source === "student" ? (
                  <Badge variant="outline" className="shrink-0 border-transparent bg-muted font-normal text-muted-foreground">
                    <FileText className="size-3" /> {r.leave_days ? `${r.leave_days} 天` : "学生提交"}
                  </Badge>
                ) : null}
                <span className="shrink-0 text-xs text-muted-foreground">
                  {r.start_date && r.end_date ? `${r.start_date} ~ ${r.end_date}` : r.occurred_on}
                </span>
                {r.status === "pending" && r.source === "student" ? (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => setCancelling(r)}>
                    <Trash2 className="size-3.5" /> 撤回
                  </Button>
                ) : null}
              </div>
              {r.content ? <p className="mt-1 text-sm text-muted-foreground">事由：{r.content}</p> : null}
              {r.review_note ? (
                <p className={"mt-1 text-sm " + (r.status === "rejected" ? "text-destructive" : "text-[color:var(--success-fg)]")}>
                  审批意见：{r.review_note}
                </p>
              ) : null}
              {/* 材料在审批后仍可查看，但学生端只读（见 AttachmentsSection 的 locked 口径） */}
              {r.source === "student" ? (
                <div className="mt-2 border-t pt-2">
                  <AttachmentsSection record={r} store={store} member={member} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {form ? <LeaveFormDialog store={store} member={member} onClose={() => setForm(false)} /> : null}
      <AlertDialog open={!!cancelling} onOpenChange={(open) => !open && !busy && setCancelling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>撤回请假申请？</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelling?.title}：撤回后记录与已上传材料将被删除，且不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void cancel();
              }}
            >
              {busy ? "撤回中…" : "确认撤回"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
