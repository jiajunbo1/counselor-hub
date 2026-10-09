import { useState } from "react";
import { Megaphone, Pencil, Trash2 } from "lucide-react";
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
import { EmptyHint, FormField, Select } from "@/components/form";
import { ApiError, apiPost } from "@/lib/api";
import type { Store } from "@/hooks/use-store";
import {
  CHANGELOG_AUDIENCES,
  CHANGELOG_AUDIENCE_LABEL,
  type ChangelogAudience,
  type ChangelogItem,
} from "@/lib/types";

const dateTime = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

interface Draft {
  id?: string;
  title: string;
  body: string;
  audience: ChangelogAudience;
}

function NoticeDialog({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [audience, setAudience] = useState<ChangelogAudience>(draft.audience);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const t = title.trim();
    const b = body.trim();
    if (!t) {
      toast.error("请填写公告标题。");
      return;
    }
    if (!b) {
      toast.error("请填写公告内容。");
      return;
    }
    setBusy(true);
    try {
      await apiPost("changelog.save", { id: draft.id, title: t, content: b, audience });
      toast.success(draft.id ? "公告已更新" : "公告已发布");
      onSaved();
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
          <DialogTitle>{draft.id ? "编辑公告" : "发布公告"}</DialogTitle>
          <DialogDescription>发布后会在用户端自动弹出一次，并收录进铃铛历史。</DialogDescription>
        </DialogHeader>
        <FormField label="标题" required>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={60}
            placeholder="一句话说明本次更新，如：请假审批改为全局口径"
            autoFocus
          />
        </FormField>
        <FormField label="内容" required>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder="面向使用者的更新说明，避免内部术语…"
          />
        </FormField>
        <FormField label="可见范围" required>
          <Select
            value={audience}
            onValueChange={(v) => setAudience(v as ChangelogAudience)}
            options={CHANGELOG_AUDIENCES.map((a) => ({ value: a, label: CHANGELOG_AUDIENCE_LABEL[a] }))}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "保存中…" : draft.id ? "保存修改" : "立即发布"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 管理员：后台「更新公告」分区（批次 Z），发布/编辑/删除面向全站的更新说明
export function NoticesAdminView({ store }: { store: Store }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<ChangelogItem | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await apiPost("changelog.delete", { id: removing.id });
      toast.success("公告已删除");
      await store.refresh();
      setRemoving(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "删除失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">更新公告</h1>
          <p className="text-sm text-muted-foreground">
            发布后用户端铃铛会提示，并自动弹出一次·{store.changelog.length} 条在册。
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing({ title: "", body: "", audience: "all" })}>
          <Megaphone className="size-4" /> 发布公告
        </Button>
      </div>

      {store.changelog.length === 0 ? (
        <EmptyHint
          text="还没有发布过更新公告。"
          icon={<Megaphone className="size-5 text-white" />}
          action={
            <Button size="sm" onClick={() => setEditing({ title: "", body: "", audience: "all" })}>
              <Megaphone className="size-4" /> 发布公告
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {store.changelog.map((c) => (
            <li key={c.id} className="rounded-xl border bg-card px-4 py-3 shadow-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.title}</span>
                {c.audience !== "all" ? (
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    {CHANGELOG_AUDIENCE_LABEL[c.audience]}
                  </Badge>
                ) : null}
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{dateTime(c.created_at)}</span>
              </div>
              <p className="mt-1.5 text-xs leading-6 whitespace-pre-wrap text-muted-foreground">{c.body}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing({ id: c.id, title: c.title, body: c.body, audience: c.audience })}>
                  <Pencil className="size-3.5" /> 编辑
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setRemoving(c)}>
                  <Trash2 className="size-3.5" /> 删除
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <NoticeDialog
          draft={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void store.refresh()}
        />
      ) : null}

      {removing ? (
        <Dialog open onOpenChange={(open) => !open && !busy && setRemoving(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>删除公告</DialogTitle>
              <DialogDescription>「{removing.title}」将从用户端铃铛历史中移除，已弹出过的提示不会收回。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>取消</Button>
              <Button variant="destructive" onClick={() => void remove()} disabled={busy}>{busy ? "删除中…" : "删除"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
