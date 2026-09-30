"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError, apiPost } from "@/lib/api";
import type { StudentPhoto } from "@/lib/types";
import { StudentAvatar } from "@/components/student-avatar";

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_EXT_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function photoExt(fileName: string): string | null {
  const m = /\.([a-z0-9]{1,8})$/i.exec(fileName);
  const ext = m ? m[1].toLowerCase() : "";
  return PHOTO_EXT_TYPES[ext] ? ext : null;
}

// 本地压到 ≤600px 的 JPEG：证件照显示尺寸小，压缩可显著减少流量并稳定过 2MiB 上限。
// 失败或压完反而更大时回退原文件（png/webp 透明图保留原格式）。
async function compressPhoto(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === "image/jpeg") return file;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    bitmap.close();
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

export async function uploadStudentPhoto(studentId: string, file: File, onDone: () => void) {
  const picked = await compressPhoto(file);
  if (!photoExt(picked.name) || !picked.type.startsWith("image/")) {
    toast.error("证件照仅支持 jpg / png / webp 图片。");
    return;
  }
  if (picked.size === 0 || picked.size > PHOTO_MAX_BYTES) {
    toast.error("照片需大于 0 且不超过 2MB，建议使用近期免冠证件照原图。");
    return;
  }
  try {
    const prep = await apiPost("photo.prepare", { student_id: studentId, file_name: picked.name, size: picked.size });
    const put = await fetch(String(prep.upload_url), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": String(prep.content_type) },
      body: picked,
    });
    if (!put.ok) throw new ApiError("上传失败，请重试。", "upload_failed");
    await apiPost("photo.complete", { id: prep.id, student_id: studentId, file_name: picked.name, size: picked.size });
    toast.success("证件照已更新。");
    onDone();
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : "上传失败，请重试。");
  }
}

// ---- 签名 URL：photo.urls 批量签发 15 分钟；同帧内的缺失 id 自动合批，缓存 10 分钟 ----
const TTL_MS = 10 * 60 * 1000;
let cache = new Map<string, { url: string | null; at: number }>();
let waiting = new Map<string, Array<(v: string | null) => void>>();
let batchRunning = false;

export function invalidatePhotoUrls() {
  cache = new Map();
}

async function runBatch() {
  batchRunning = true;
  const ids = [...waiting.keys()].slice(0, 300);
  const resolvers = ids.map((id) => waiting.get(id)!);
  for (const id of ids) waiting.delete(id);
  let urls: Record<string, string> = {};
  let failed = false;
  try {
    urls = ((await apiPost("photo.urls", { student_ids: ids })).urls ?? {}) as Record<string, string>;
  } catch {
    failed = true;
  }
  const at = Date.now();
  // 请求失败不写缓存（下次重试）；成功但无照片记 null，避免反复请求
  if (!failed) for (const id of ids) cache.set(id, { url: urls[id] ?? null, at });
  ids.forEach((id, i) => {
    for (const cb of resolvers[i]) cb(urls[id] ?? null);
  });
  batchRunning = false;
  if (waiting.size > 0) void runBatch();
}

function fetchPhotoUrl(studentId: string): Promise<string | null> {
  const hit = cache.get(studentId);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    const list = waiting.get(studentId);
    if (list) list.push(resolve);
    else waiting.set(studentId, [resolve]);
    if (!batchRunning) void runBatch();
  });
}

export async function deleteStudentPhoto(studentId: string, onDone: () => void) {
  try {
    await apiPost("photo.delete", { student_id: studentId });
    invalidatePhotoUrls();
    toast.success("证件照已删除。");
    onDone();
  } catch (e) {
    toast.error(e instanceof ApiError ? e.message : "删除失败，请重试。");
  }
}

export function PhotoAvatar({
  studentId,
  name,
  photo,
  size = 56,
  editable = false,
  className,
  onUploaded,
}: {
  studentId: string;
  name: string;
  photo?: StudentPhoto | null;
  size?: number;
  editable?: boolean;
  className?: string;
  onUploaded?: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!photo) {
      setUrl(null);
      return;
    }
    let alive = true;
    void fetchPhotoUrl(studentId).then((u) => alive && setUrl(u));
    return () => { alive = false; };
    // 换照后行 id 不变（原地更新），故必须依赖 updated_at 才能重新取签名 URL
  }, [photo?.id, photo?.updated_at, studentId]);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void uploadStudentPhoto(studentId, f, () => { invalidatePhotoUrls(); onUploaded?.(); });
  };

  return (
    <span className={className}>
      <StudentAvatar
        name={name}
        src={photo ? url : null}
        size={size}
        editable={editable}
        onClick={editable ? () => fileRef.current?.click() : undefined}
      />
      {editable ? (
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick} />
      ) : null}
    </span>
  );
}
