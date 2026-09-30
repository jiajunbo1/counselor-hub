import { useMemo, useState } from "react";
import { CornerDownLeft, Lightbulb, Send } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { EmptyHint, FormField, Select } from "@/components/form";
import type { Store } from "@/hooks/use-store";
import type { MemberUser } from "@/lib/session";
import { ApiError, apiPost } from "@/lib/api";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABEL,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABEL,
  ROLE_LABEL,
  type FeedbackCategory,
  type FeedbackItem,
  type FeedbackStatus,
} from "@/lib/types";

const dateTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

// 印章式水印配色：五色区分开发进度
const STAMP_COLORS: Record<FeedbackStatus, { color: string; opacity: number }> = {
  pending: { color: "#d97706", opacity: 0.38 },
  adopted: { color: "#8b5cf6", opacity: 0.55 },
  optimizing: { color: "#2563eb", opacity: 0.55 },
  done: { color: "#059669", opacity: 0.6 },
  no_plan: { color: "#64748b", opacity: 0.45 },
};

function StatusStamp({ status }: { status: FeedbackStatus }) {
  const { color, opacity } = STAMP_COLORS[status] ?? STAMP_COLORS.pending;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute bottom-1.5 right-2 select-none"
      style={{ transform: "rotate(-14deg)", opacity, color }}
    >
      <div className="flex size-[74px] items-center justify-center rounded-full border-[2.5px] p-[3px]">
        <div className="flex size-full items-center justify-center rounded-full border border-dashed px-1 text-center">
          <span className="text-[12px] font-black leading-tight tracking-wider">{FEEDBACK_STATUS_LABEL[status] ?? status}</span>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: FeedbackStatus }) {
  const cls =
    status === "done"
      ? "pill-success"
      : status === "adopted" || status === "optimizing"
        ? "border-transparent bg-primary/10 text-primary"
        : "border-transparent bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={"shrink-0 font-normal " + cls}>
      {FEEDBACK_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function FeedbackCard({
  f,
  showAuthor,
  onReply,
}: {
  f: FeedbackItem;
  showAuthor: boolean;
  onReply?: (f: FeedbackItem) => void;
}) {
  return (
    <li className="relative overflow-hidden rounded-xl border bg-card px-4 py-3 shadow-xs">
      <StatusStamp status={f.status} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Lightbulb className="size-4 shrink-0 text-muted-foreground" />
        <Badge variant="outline" className="shrink-0 font-normal">
          {FEEDBACK_CATEGORY_LABEL[f.category] ?? f.category}
        </Badge>
        {showAuthor ? (
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {f.user_name}
            {ROLE_LABEL[f.role as keyof typeof ROLE_LABEL] ? ` · ${ROLE_LABEL[f.role as keyof typeof ROLE_LABEL]}` : ""}
          </span>
        ) : null}
        <StatusBadge status={f.status} />
        <span className={"shrink-0 text-xs text-muted-foreground" + (showAuthor ? " ml-auto" : "")}>
          {dateTime(f.created_at)}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-6 whitespace-pre-wrap">{f.content}</p>
      {f.reply_note ? (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted/60 px-3 py-2">
          <CornerDownLeft className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">管理员回复</p>
            <p className="text-sm leading-6 whitespace-pre-wrap">{f.reply_note}</p>
            <p className="text-[11px] text-muted-foreground">{f.replied_at ? dateTime(f.replied_at) : ""}</p>
          </div>
        </div>
      ) : null}
      {onReply ? (
        <div className="mt-2">
          <Button size="sm" variant="outline" onClick={() => onReply(f)}>
            回复
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function ReplyDialog({ item, onClose }: { item: FeedbackItem; onClose: () => void }) {
  const [status, setStatus] = useState<FeedbackStatus>(item.status === "pending" ? "adopted" : item.status);
  const [note, setNote] = useState(item.reply_note || "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const reply = note.trim();
    if (!reply) {
      toast.error("请填写回复内容。");
      return;
    }
    setBusy(true);
    try {
      await apiPost("feedback.reply", { id: item.id, status, reply_note: reply });
      toast.success("已回复反馈");
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "回复失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>回复反馈</DialogTitle>
          <DialogDescription className="line-clamp-3">{item.content}</DialogDescription>
        </DialogHeader>
        <FormField label="开发进度" required>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as FeedbackStatus)}
            options={FEEDBACK_STATUSES.map((s) => ({ value: s, label: FEEDBACK_STATUS_LABEL[s] }))}
          />
        </FormField>
        <FormField label="回复内容" required>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="说明处理结论或后续安排，提交人可见。"
            autoFocus
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "提交中…" : "发送回复"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 管理员：后台「反馈」分区，全部反馈 + 筛选 + 回复
export function FeedbackAdminView({ store }: { store: Store }) {
  const [category, setCategory] = useState<string>("all");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [replying, setReplying] = useState<FeedbackItem | null>(null);

  const list = useMemo(() => {
    let items = store.feedback;
    if (category !== "all") items = items.filter((f) => f.category === category);
    if (onlyOpen) items = items.filter((f) => f.status === "pending");
    return items;
  }, [category, onlyOpen, store.feedback]);
  const openCount = store.feedback.filter((f) => f.status === "pending").length;

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">意见反馈</h1>
          <p className="text-sm text-muted-foreground">
            来自辅导员与学生的反馈{openCount > 0 ? ` · ${openCount} 条待处理` : ""}。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Select
            value={category}
            onValueChange={setCategory}
            options={[{ value: "all", label: "全部分类" }, ...FEEDBACK_CATEGORIES.map((c) => ({ value: c, label: FEEDBACK_CATEGORY_LABEL[c] }))]}
            className="h-8 w-28"
          />
          <Button variant="outline" size="sm" onClick={() => setOnlyOpen((v) => !v)}>
            {onlyOpen ? "查看全部" : "只看待处理"}
          </Button>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyHint text={store.feedback.length === 0 ? "还没有收到反馈。" : "没有符合条件的反馈。"} />
      ) : (
        <ul className="space-y-2">
          {list.map((f) => (
            <FeedbackCard key={f.id} f={f} showAuthor onReply={setReplying} />
          ))}
        </ul>
      )}

      {replying ? <ReplyDialog item={replying} onClose={() => setReplying(null)} /> : null}
    </section>
  );
}

// 辅导员/学生：提交反馈 + 查看自己的反馈与回复
export default function FeedbackView({
  store,
  member,
}: {
  store: Store;
  member: MemberUser;
}) {
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const content = draft.trim();
    if (!content) {
      toast.error("请填写反馈内容。");
      return;
    }
    setBusy(true);
    try {
      await apiPost("feedback.submit", { category, content });
      await store.refresh();
      setDraft("");
      toast.success("反馈已提交，管理员回复后这里会显示。");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "提交失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">意见反馈</h1>
        <p className="text-sm text-muted-foreground">向管理员反馈问题或建议。</p>
      </div>

      <div className="rounded-xl border bg-card p-3 shadow-xs">
        <FormField label="反馈类型" required>
          <div className="flex flex-wrap gap-1.5">
            {FEEDBACK_CATEGORIES.map((c) => (
              <Button
                key={c}
                type="button"
                size="sm"
                variant={category === c ? "default" : "outline"}
                onClick={() => setCategory(c)}
              >
                {FEEDBACK_CATEGORY_LABEL[c]}
              </Button>
            ))}
          </div>
        </FormField>
        <FormField label="反馈内容" required className="mt-3 grid gap-1.5">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="请描述遇到的问题或期望的功能…"
          />
        </FormField>
        <div className="mt-2 flex justify-end">
          <Button size="sm" disabled={busy} onClick={() => void submit()}>
            <Send className="size-3.5" /> {busy ? "提交中…" : "提交反馈"}
          </Button>
        </div>
      </div>

      {store.feedback.length === 0 ? (
        <EmptyHint text="还没有提交过反馈。" />
      ) : (
        <ul className="space-y-2">
          {store.feedback.map((f) => (
            <FeedbackCard key={f.id} f={f} showAuthor={false} />
          ))}
        </ul>
      )}
    </section>
  );
}
