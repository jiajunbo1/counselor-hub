// 附件上传/下载：prepare → 浏览器直传签名 URL → complete（服务端校验实际字节后落库）。
import { toast } from "sonner";
import { ApiError, apiPost } from "@/lib/api";
import { ATTACH_MAX_BYTES, attachExt, type Attachment } from "@/lib/types";

export async function uploadAttachment(recordId: string, file: File): Promise<boolean> {
  if (!attachExt(file.name)) {
    toast.error("附件仅支持图片 / PDF / Word / Excel，请换文件。");
    return false;
  }
  if (file.size === 0 || file.size > ATTACH_MAX_BYTES) {
    toast.error("单个附件需大于 0 且不超过 5MB。");
    return false;
  }
  try {
    const prep = await apiPost("attachment.prepare", { record_id: recordId, file_name: file.name, size: file.size });
    const put = await fetch(String(prep.upload_url), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": String(prep.content_type) },
      body: file,
    });
    if (!put.ok) throw new ApiError("上传失败，请重试。", "upload_failed");
    await apiPost("attachment.complete", { id: prep.id, record_id: recordId, file_name: file.name, size: file.size });
    toast.success("附件已上传。");
    return true;
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : "上传失败，请重试。");
    return false;
  }
}

export async function downloadAttachment(att: Attachment): Promise<void> {
  try {
    const res = await apiPost("attachment.download", { id: att.id });
    const r = await fetch(String(res.url), { credentials: "same-origin" });
    if (!r.ok) throw new Error("bad");
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = att.original_name || "附件";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  } catch {
    toast.error("下载失败，文件可能已被清理，请刷新后重试。");
  }
}
