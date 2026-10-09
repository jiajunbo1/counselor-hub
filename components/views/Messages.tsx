import { useMemo, useState } from "react";
import { CornerDownLeft, MessageSquareText, Send } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyHint, FormField } from "@/components/form";
import { SectionCard } from "@/components/section-card";
import type { Store } from "@/hooks/use-store";
import type { MemberUser } from "@/lib/session";
import { ApiError, apiPost } from "@/lib/api";
import { studentName, type MessageItem } from "@/lib/types";

const dateTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

function ReplyDialog({
  message,
  store,
  onClose,
}: {
  message: MessageItem;
  store: Store;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const reply = note.trim();
    if (!reply) {
      toast.error("请填写回复内容。");
      return;
    }
    setBusy(true);
    try {
      await apiPost("message.reply", { id: message.id, reply_note: reply });
      await store.refresh();
      toast.success("已回复学生");
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
          <DialogTitle>回复留言</DialogTitle>
          <DialogDescription>{message.sender_name} 的留言，回复后学生端即可看到。</DialogDescription>
        </DialogHeader>
        <FormField label="回复内容" required>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="如：已收到，明天上午办公室详谈"
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

function MessageCard({
  m,
  showStudent,
  students,
  member,
  onReply,
}: {
  m: MessageItem;
  showStudent: boolean;
  students: Store["students"];
  member: MemberUser;
  onReply?: (m: MessageItem) => void;
}) {
  const mine = m.sender_role === "student" && m.sender_id === member.id;
  return (
    <li className={"rounded-xl border bg-card px-4 py-3 shadow-xs" + (mine ? " border-primary/40" : "")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <MessageSquareText className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-sm font-medium">
          {showStudent && m.sender_role === "student" ? studentName(students, m.student_id) : m.sender_name}
        </span>
        {m.sender_role !== "student" ? (
          <Badge variant="outline" className="shrink-0 border-transparent bg-primary/10 font-normal text-primary">
            {m.sender_role === "admin" ? "管理员回复" : "辅导员回复"}
          </Badge>
        ) : m.replied === 1 ? (
          <Badge variant="outline" className="shrink-0 border-transparent font-normal pill-success">
            已回复
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0 border-transparent bg-muted font-normal text-muted-foreground">
            待回复
          </Badge>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">{dateTime(m.created_at)}</span>
      </div>
      <p className="mt-1.5 text-sm leading-6 whitespace-pre-wrap">{m.body}</p>
      {m.reply_note ? (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted/60 px-3 py-2">
          <CornerDownLeft className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm leading-6 whitespace-pre-wrap">{m.reply_note}</p>
            <p className="text-[11px] text-muted-foreground">{m.replied_at ? dateTime(m.replied_at) : ""}</p>
          </div>
        </div>
      ) : null}
      {onReply && m.replied !== 1 ? (
        <div className="mt-2">
          <Button size="sm" variant="outline" onClick={() => onReply(m)}>
            回复
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export default function MessagesView({
  store,
  member,
}: {
  store: Store;
  member: MemberUser;
}) {
  const isStudent = member.role === "student";
  const [replying, setReplying] = useState<MessageItem | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);

  const list = useMemo(() => {
    const items = isStudent ? store.messages : store.messages;
    return onlyOpen ? items.filter((m) => m.replied !== 1) : items;
  }, [isStudent, onlyOpen, store.messages]);
  const openCount = store.messages.filter((m) => m.replied !== 1).length;

  const send = async () => {
    const body = draft.trim();
    if (!body) {
      toast.error("请填写留言内容。");
      return;
    }
    setBusy(true);
    try {
      await apiPost("message.send", { body });
      await store.refresh();
      setDraft("");
      toast.success("留言已发送给辅导员");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "留言失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">{isStudent ? "留言" : "学生留言"}</h1>
          {!isStudent ? (
            <p className="text-sm text-muted-foreground">
              来自学生的留言{openCount > 0 ? ` · ${openCount} 条待回复` : ""}。
            </p>
          ) : null}
        </div>
        {!isStudent ? (
          <Button variant="outline" size="sm" onClick={() => setOnlyOpen((v) => !v)}>
            {onlyOpen ? "查看全部" : "只看待回复"}
          </Button>
        ) : null}
      </div>

      {isStudent ? (
        <SectionCard
          title="给辅导员留言"
          action={
            <Button size="sm" disabled={busy} onClick={() => void send()}>
              <Send className="size-3.5" /> {busy ? "发送中…" : "发送留言"}
            </Button>
          }
        >
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            maxLength={1000}
            placeholder="写下您想咨询的事情…"
          />
        </SectionCard>
      ) : null}

      {list.length === 0 ? (
        <EmptyHint
          text={
            isStudent
              ? "还没有留言。"
              : store.messages.length === 0
                ? "暂无留言。"
                : "没有符合条件的留言。"
          }
        />
      ) : (
        <ul className="space-y-2">
          {list.map((m) => (
            <MessageCard
              key={m.id}
              m={m}
              showStudent={!isStudent}
              students={store.students}
              member={member}
              onReply={isStudent ? undefined : setReplying}
            />
          ))}
        </ul>
      )}

      {replying ? <ReplyDialog message={replying} store={store} onClose={() => setReplying(null)} /> : null}
    </section>
  );
}
