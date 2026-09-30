import { useEffect, useRef, useState } from "react";
import { Download, FileText, Minus, Plus, RefreshCw, Trash2, Upload, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Store } from "@/hooks/use-store";
import type { MemberUser } from "@/lib/session";
import { attachmentUrl, downloadAttachment, replaceAttachment, uploadAttachment } from "@/lib/attachments";
import { ATTACH_ACCEPT, RECORD_STATUS_LABEL, formatBytes, type Attachment, type RecordItem } from "@/lib/types";

const isImage = (att: Attachment) => att.content_type.startsWith("image/");

// 图片附件的签名 URL（服务端签 300 秒，lib/attachments 内缓存 4 分钟）
function usePreviewUrl(att: Attachment, retry: number): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage(att)) {
      setUrl(null);
      return;
    }
    let alive = true;
    void attachmentUrl(att).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
    // 更换材料会生成新行 id，故按 id 取 URL；retry 变化时重新取一次
  }, [att, retry]);
  return url;
}

// 原图查看：附件上传时不做压缩，这里直接展示原始分辨率
function AttachmentViewer({ att, onClose }: { att: Attachment; onClose: () => void }) {
  const [retry, setRetry] = useState(0);
  const url = usePreviewUrl(att, retry);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState<number | null>(null);
  const zoom = (factor: number) => setScale((s) => Math.min(8, Math.max(0.2, (s ?? 1) * factor)));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-3 max-w-[95vw] sm:max-w-[95vw]">
        <DialogHeader>
          <DialogTitle className="pr-8">{att.original_name}</DialogTitle>
          <DialogDescription>
            {natural.w > 0 ? `原图 ${natural.w}×${natural.h} · ` : ""}
            {formatBytes(att.size_bytes)}，未经压缩
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 px-2" aria-label="缩小" onClick={() => zoom(1 / 1.4)}>
            <Minus className="size-3.5" />
          </Button>
          <span className="w-14 text-center text-xs tabular-nums">{scale === null ? "适应" : `${Math.round(scale * 100)}%`}</span>
          <Button size="sm" variant="outline" className="h-7 px-2" aria-label="放大" onClick={() => zoom(1.4)}>
            <Plus className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setScale(1)}>
            100%
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setScale(null)}>
            适应窗口
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={() => void downloadAttachment(att)}>
            <Download className="size-3.5" /> 下载
          </Button>
        </div>
        <div className="max-h-[70vh] overflow-auto rounded-lg border bg-muted/40 p-2">
          {url ? (
            <img
              src={url}
              alt={att.original_name}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onClick={() => setScale((s) => (s === null ? 1 : null))}
              className={"mx-auto block " + (scale === null ? "cursor-zoom-in" : "cursor-zoom-out")}
              // 放大时必须解除 preflight 给 img 加的 max-width:100%，否则 100% 视图会被容器宽度压回去
              style={scale !== null && natural.w > 0 ? { width: Math.round(natural.w * scale), maxWidth: "none" } : { maxHeight: "66vh", maxWidth: "100%", objectFit: "contain" }}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 p-10 text-sm text-muted-foreground">
              <p>图片未载入，可能是网络或存储服务暂不可用。</p>
              <Button size="sm" variant="outline" onClick={() => setRetry((n) => n + 1)}>
                <RefreshCw className="size-3.5" /> 重试
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const list = store.attachments.filter((a) => a.record_id === record.id);
  // 辅导员处理完毕（状态非待审批）后，学生端材料冻结；辅导员与管理员仍可补充或清理
  const locked = member.role === "student" && record.status !== "pending";

  const onPick = async (file: File) => {
    setBusy(true);
    const ok = await uploadAttachment(record.id, file);
    if (ok) await store.refresh();
    setBusy(false);
  };

  const replaceWith = async (old: Attachment, file: File) => {
    setBusy(true);
    await replaceAttachment(record.id, old, file, store.write);
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
        {!locked ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="size-3.5" /> 上传附件
          </Button>
        ) : null}
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
        <p className="text-xs text-muted-foreground">
          {locked ? "未上传材料。" : "暂无附件。支持图片、PDF、Word、Excel，单个不超过 5MB。"}
        </p>
      ) : (
        <ul className="space-y-1">
          {list.map((a) => (
            <AttachmentRow
              key={a.id}
              att={a}
              busy={busy}
              canReplace={!locked}
              canDelete={!locked && (a.uploader_id === member.id || member.role !== "student")}
              onPreview={() => setViewing(a)}
              onReplaceFile={(f) => void replaceWith(a, f)}
              onDelete={() => void remove(a)}
            />
          ))}
        </ul>
      )}
      {locked ? (
        <p className="text-xs text-muted-foreground">
          {RECORD_STATUS_LABEL[record.status]}，证明材料不可再更改，如需变更请联系辅导员。
        </p>
      ) : null}
      {viewing ? <AttachmentViewer att={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}

function AttachmentRow({
  att,
  busy,
  canReplace,
  canDelete,
  onPreview,
  onReplaceFile,
  onDelete,
}: {
  att: Attachment;
  busy: boolean;
  canReplace: boolean;
  canDelete: boolean;
  onPreview: () => void;
  onReplaceFile: (file: File) => void;
  onDelete: () => void;
}) {
  const url = usePreviewUrl(att, 0);
  const replaceRef = useRef<HTMLInputElement>(null);

  return (
    <li className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2 py-2">
      {isImage(att) ? (
        <button
          type="button"
          onClick={onPreview}
          aria-label={`查看 ${att.original_name} 原图`}
          className="relative size-14 shrink-0 overflow-hidden rounded-md border bg-background"
        >
          {url ? (
            <img src={url} alt={att.original_name} className="size-full object-cover" />
          ) : (
            <span className="size-full animate-pulse bg-muted" />
          )}
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-black/50 py-0.5">
            <ZoomIn className="size-3 text-white" />
          </span>
        </button>
      ) : (
        <FileText className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{att.original_name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatBytes(Number(att.size_bytes) || 0)} · {att.uploader_name} {att.created_at.slice(0, 10)}
      </span>
      <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="查看原图" title="查看原图" disabled={!isImage(att)} onClick={onPreview}>
        <ZoomIn className="size-3.5" />
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="下载附件" disabled={busy} onClick={() => void downloadAttachment(att)}>
        <Download className="size-3.5" />
      </Button>
      {canReplace ? (
        <>
          <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="更换附件" disabled={busy} onClick={() => replaceRef.current?.click()}>
            <RefreshCw className="size-3.5" />
          </Button>
          <input
            ref={replaceRef}
            type="file"
            accept={ATTACH_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onReplaceFile(f);
            }}
          />
        </>
      ) : null}
      {canDelete ? (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" aria-label="删除附件" disabled={busy} onClick={onDelete}>
          <Trash2 className="size-3.5" />
        </Button>
      ) : null}
    </li>
  );
}
