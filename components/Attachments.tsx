import { useRef, useState } from "react";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Store } from "@/hooks/use-store";
import type { MemberUser } from "@/lib/session";
import { downloadAttachment, uploadAttachment } from "@/lib/attachments";
import { ATTACH_ACCEPT, formatBytes, type Attachment, type RecordItem } from "@/lib/types";

// 记录附件区：辅导员端（记录编辑）与学生端（请假材料）共用。
export function AttachmentsSection({
  record,
  store,
  member,
}: {
  record: RecordItem;
  store: Store;
  member: MemberUser;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const list = store.attachments.filter((a) => a.record_id === record.id);

  const onPick = async (file: File) => {
    setBusy(true);
    const ok = await uploadAttachment(record.id, file);
    if (ok) await store.refresh();
    setBusy(false);
  };

  const remove = async (a: Attachment) => {
    setBusy(true);
    await store.write("attachment.delete", { id: a.id });
    setBusy(false);
  };

  return (
    <div className="sm:col-span-2 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">附件</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="size-3.5" /> 上传附件
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ATTACH_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onPick(f);
          }}
        />
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无附件。支持图片、PDF、Word、Excel，单个不超过 5MB。</p>
      ) : (
        <ul className="space-y-1">
          {list.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm">{a.original_name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatBytes(Number(a.size_bytes) || 0)} · {a.uploader_name} {a.created_at.slice(0, 10)}
              </span>
              <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="下载附件" disabled={busy} onClick={() => void downloadAttachment(a)}>
                <Download className="size-3.5" />
              </Button>
              {a.uploader_id === member.id || member.role === "admin" ? (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" aria-label="删除附件" disabled={busy} onClick={() => void remove(a)}>
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
