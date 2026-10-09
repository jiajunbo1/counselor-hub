import { useMemo, useState, type ReactNode } from "react";
import { Trash2, FileUp, Pencil, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ImportDialog from "@/components/ImportDialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { EmptyHint, FormField, Select } from "@/components/form";
import { PhotoAvatar, deleteStudentPhoto } from "@/lib/photos";
import type { Store } from "@/hooks/use-store";
import {
  dormLabel,
  POLITICAL_OPTIONS,
  RECORD_STATUS_LABEL,
  RECORD_TYPE_LABEL,
  type HonorItem,
  type Student,
  type StudentPhoto,
} from "@/lib/types";
import { STUDENT_COLUMNS } from "@/lib/import-export";
import { ALL_CLASS, useClassScope, inClassScope } from "@/hooks/use-class-scope";

interface StudentDraft {
  student_no: string;
  name: string;
  gender: string;
  class_name: string;
  major: string;
  grade: string;
  phone: string;
  political_status: string;
  native_place: string;
}

const EMPTY_DRAFT: StudentDraft = {
  student_no: "",
  name: "",
  gender: "男",
  class_name: "",
  major: "",
  grade: "",
  phone: "",
  political_status: "群众",
  native_place: "",
};

function draftOf(student: Student | null): StudentDraft {
  if (!student) return { ...EMPTY_DRAFT };
  return {
    student_no: student.student_no,
    name: student.name,
    gender: student.gender,
    class_name: student.class_name,
    major: student.major,
    grade: student.grade,
    phone: student.phone,
    political_status: student.political_status,
    native_place: student.native_place,
  };
}

function StudentFormDialog({
  student,
  onClose,
  store,
}: {
  student: Student | null | "new";
  onClose: () => void;
  store: Store;
}) {
  const isEdit = student !== "new" && student !== null;
  const [draft, setDraft] = useState<StudentDraft>(draftOf(isEdit ? student : null));
  const [busy, setBusy] = useState(false);
  const set = (key: keyof StudentDraft) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    if (!draft.student_no.trim() || !draft.name.trim()) {
      toast.error("学号与姓名为必填项。");
      return;
    }
    setBusy(true);
    const payload: Record<string, unknown> = { ...draft };
    const ok = isEdit
      ? await store.write("student.update", { id: (student as Student).id, ...payload })
      : await store.write("student.create", payload);
    setBusy(false);
    if (ok) {
      toast.success(isEdit ? "学生信息已更新" : "学生已添加");
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑：${(student as Student).name}` : "添加学生"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="学号" required>
            <Input value={draft.student_no} onChange={(e) => set("student_no")(e.target.value)} maxLength={32} />
          </FormField>
          <FormField label="姓名" required>
            <Input value={draft.name} onChange={(e) => set("name")(e.target.value)} maxLength={60} />
          </FormField>
          <FormField label="性别">
            <Select value={draft.gender} onValueChange={set("gender")} options={[{ value: "男", label: "男" }, { value: "女", label: "女" }]} />
          </FormField>
          <FormField label="班级">
            <Input value={draft.class_name} onChange={(e) => set("class_name")(e.target.value)} placeholder="如：计算机2401" maxLength={60} />
          </FormField>
          <FormField label="专业">
            <Input value={draft.major} onChange={(e) => set("major")(e.target.value)} maxLength={60} />
          </FormField>
          <FormField label="年级">
            <Input value={draft.grade} onChange={(e) => set("grade")(e.target.value)} placeholder="如：2024" maxLength={16} />
          </FormField>
          <FormField label="手机号">
            <Input value={draft.phone} onChange={(e) => set("phone")(e.target.value)} maxLength={32} inputMode="tel" />
          </FormField>
          <FormField label="政治面貌">
            <Select value={draft.political_status} onValueChange={set("political_status")} options={POLITICAL_OPTIONS.map((p) => ({ value: p, label: p }))} />
          </FormField>
          <FormField label="籍贯" className="sm:col-span-2">
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

export default function StudentsView({ store }: { store: Store }) {
  const { students, rooms, records } = store;
  const [q, setQ] = useState("");
  const scope = useClassScope();
  const [formStudent, setFormStudent] = useState<Student | null | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [deletingPhoto, setDeletingPhoto] = useState<Student | null>(null);
  const [busy, setBusy] = useState(false);

  const titlesByStudent = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of store.positions) {
      if (p.status !== "active") continue;
      if (!m.has(p.student_id)) m.set(p.student_id, []);
      m.get(p.student_id)!.push(p.title);
    }
    return m;
  }, [store.positions]);

  const honorsByStudent = useMemo(() => {
    const m = new Map<string, HonorItem[]>();
    for (const h of store.honors) {
      if (h.status !== "active") continue;
      if (!m.has(h.student_id)) m.set(h.student_id, []);
      m.get(h.student_id)!.push(h);
    }
    return m;
  }, [store.honors]);

  const photoByStudent = useMemo(() => {
    const m = new Map<string, StudentPhoto>();
    for (const p of store.photos) m.set(p.student_id, p);
    return m;
  }, [store.photos]);

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return students.filter((s) => {
      if (!inClassScope(scope, s.class_name)) return false;
      if (!keyword) return true;
      return [s.name, s.student_no, s.phone, s.major].some((v) => v.toLowerCase().includes(keyword));
    });
  }, [students, q, scope]);

  const detail = detailId ? students.find((s) => s.id === detailId) ?? null : null;
  const detailRecords = detail
    ? [...records.filter((r) => r.student_id === detail.id)].sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : -1))
    : [];
  const detailHonors = detail ? honorsByStudent.get(detail.id) ?? [] : [];

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const ok = await store.write("student.delete", { id: deleting.id });
    setBusy(false);
    if (ok) {
      toast.success(`已删除学生：${deleting.name}`);
      setDetailId(null);
    }
    setDeleting(null);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">学生档案</h1>
          <p className="text-sm text-muted-foreground">
            {scope.cls === ALL_CLASS ? `共 ${students.length} 名学生。` : `${scope.cls} 共 ${filtered.length} 名学生。`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => setImporting(true)}>
            <FileUp className="size-4" /> <span className="hidden sm:inline">导入</span>
          </Button>
          <Button onClick={() => setFormStudent("new")}>
            <Plus className="size-4" /> <span className="hidden sm:inline">添加学生</span><span className="sm:hidden">添加</span>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="搜索姓名 / 学号 / 手机号"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="搜索学生"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyHint
          text={students.length === 0 ? "还没有学生档案。" : "没有符合筛选条件的学生。"}
          icon={<Users className="size-5 text-white" />}
          action={
            students.length === 0 ? (
              <Button size="sm" onClick={() => setFormStudent("new")}>
                <Plus className="size-4" /> 添加学生
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="row-interactive flex w-full items-center gap-3 rounded-xl border bg-card py-2.5 pl-3 pr-4 text-left shadow-xs"
                onClick={() => setDetailId(s.id)}
              >
                <PhotoAvatar studentId={s.id} name={s.name} photo={photoByStudent.get(s.id) ?? null} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold">{s.name}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{s.student_no}</span>
                    {s.class_name ? (
                      <Badge variant="secondary" className="shrink-0 font-normal">{s.class_name}</Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">未填班级</Badge>
                    )}
                    {(titlesByStudent.get(s.id) ?? []).map((t) => (
                      <Badge key={t} variant="outline" className="shrink-0 border-transparent bg-primary/10 font-normal text-primary">{t}</Badge>
                    ))}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 truncate text-xs text-muted-foreground">
                    <span>{s.gender}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">宿舍：{dormLabel(s, rooms)}</span>
                  </span>
                </span>
                <Pencil className="size-4 shrink-0 text-muted-foreground" onClick={(e) => { e.stopPropagation(); setFormStudent(s); }} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {formStudent !== null ? (
        <StudentFormDialog
          key={formStudent === "new" ? "new" : formStudent.id}
          student={formStudent}
          onClose={() => setFormStudent(null)}
          store={store}
        />
      ) : null}

      {importing ? (
        <ImportDialog
          title="导入学生名单"
          description={"首行为表头（可下载模板对照）。学号需唯一，已存在或校验失败的行会被跳过并在结果中提示。性别限「男/女」；政治面貌可填：" + POLITICAL_OPTIONS.join(" / ") + "。"}
          columns={STUDENT_COLUMNS}
          action="student.bulk_create"
          chunkSize={100}
          template={{
            name: "学生导入模板",
            samples: ["2024010101", "张三", "男", "计算机2401", "计算机科学与技术", "2024", "13800000000", "共青团员", "河北石家庄"],
          }}
          buildRow={(row) => ({
            student_no: row.student_no ?? "",
            name: row.name ?? "",
            gender: row.gender ?? "",
            class_name: row.class_name ?? "",
            major: row.major ?? "",
            grade: row.grade ?? "",
            phone: row.phone ?? "",
            political_status: row.political_status ?? "",
            native_place: row.native_place ?? "",
          })}
          extraValidate={(row) => {
            if (row.gender && row.gender !== "男" && row.gender !== "女") return "性别需为 男/女";
            if (row.political_status && !POLITICAL_OPTIONS.includes(row.political_status)) return "政治面貌不在可选范围";
            return null;
          }}
          onClose={() => setImporting(false)}
          onDone={(created, skipped) => {
            void store.refresh();
            toast.success(`导入完成：新增 ${created} 名学生${skipped ? `，跳过 ${skipped} 条` : ""}`);
          }}
        />
      ) : null}

      <Sheet open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {detail ? (
            <>
              <SheetHeader>
                <SheetTitle>学生档案</SheetTitle>
              </SheetHeader>
              <div className="mt-3 flex gap-4">
                <div className="flex w-[104px] shrink-0 flex-col items-center rounded-xl border bg-card p-2.5 shadow-xs">
                  <PhotoAvatar
                    studentId={detail.id}
                    name={detail.name}
                    photo={photoByStudent.get(detail.id) ?? null}
                    size={84}
                    editable
                    onUploaded={() => void store.refresh()}
                  />
                  <p className="mt-2 w-full truncate text-center font-semibold leading-tight">{detail.name}</p>
                  <p className="w-full truncate text-center text-xs tabular-nums text-muted-foreground">{detail.student_no}</p>
                  <div className="mt-1.5 flex flex-wrap justify-center gap-1">
                    {detail.class_name ? (
                      <Badge variant="secondary" className="font-normal">{detail.class_name}</Badge>
                    ) : null}
                    {(titlesByStudent.get(detail.id) ?? []).map((t) => (
                      <Badge key={t} variant="outline" className="border-transparent bg-primary/10 font-normal text-primary">{t}</Badge>
                    ))}
                  </div>
                  {photoByStudent.get(detail.id) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 px-1 text-xs text-muted-foreground"
                      onClick={() => setDeletingPhoto(detail)}
                    >
                      <Trash2 className="size-3" /> 删除证件照
                    </Button>
                  ) : (
                    <p className="mt-2 text-center text-xs text-muted-foreground">未上传证件照</p>
                  )}
                </div>
                <dl className="grid min-w-0 flex-1 auto-rows-min grid-cols-1 gap-x-5 gap-y-2.5 text-sm sm:grid-cols-2">
                  <Field label="性别">{detail.gender}</Field>
                  <Field label="专业">{detail.major || "—"}</Field>
                  <Field label="年级">{detail.grade || "—"}</Field>
                  <Field label="政治面貌">{detail.political_status}</Field>
                  <Field label="手机号" className="tabular-nums">{detail.phone || "—"}</Field>
                  <Field label="籍贯">{detail.native_place || "—"}</Field>
                  <Field label="宿舍" className="sm:col-span-2">{dormLabel(detail, rooms)}</Field>
                  {photoByStudent.get(detail.id) ? (
                    <Field label="照片" className="sm:col-span-2 text-xs text-muted-foreground">
                      {photoByStudent.get(detail.id)!.uploader_name} 上传 · {photoByStudent.get(detail.id)!.updated_at.slice(0, 10)}
                    </Field>
                  ) : null}
                </dl>
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setFormStudent(detail)}>
                  <Pencil className="size-3.5" /> 编辑
                </Button>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleting(detail)}>
                  <Trash2 className="size-3.5" /> 删除
                </Button>
              </div>
              {detailHonors.length > 0 ? (
                <>
                  <h3 className="mt-6 text-sm font-semibold">该生荣誉（{detailHonors.length}）</h3>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {detailHonors.map((h) => (
                      <li key={h.id}>
                        <Badge variant="outline" className="border-transparent bg-amber-500/10 font-normal text-amber-700">
                          {h.title}
                          <span className="ml-1 text-[11px] text-muted-foreground">{h.level}{h.term ? ` · ${h.term}` : ""}</span>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <h3 className="mt-6 text-sm font-semibold">该生记录（{detailRecords.length}）</h3>
              {detailRecords.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">暂无记录。</p>
              ) : (
                <ul className="mt-2 divide-y">
                  {detailRecords.map((r) => (
                    <li key={r.id} className="py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm">{r.title}</p>
                        <div className="flex shrink-0 gap-1">
                          <Badge variant="outline" className="font-normal">{RECORD_TYPE_LABEL[r.type]}</Badge>
                          <Badge variant="secondary" className="font-normal">{RECORD_STATUS_LABEL[r.status] ?? r.status}</Badge>
                        </div>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.occurred_on}{r.content ? ` · ${r.content}` : ""}</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除学生「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>该学生的日常记录与成绩也会一并删除，此操作不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              {busy ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deletingPhoto !== null} onOpenChange={(open) => !open && setDeletingPhoto(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{deletingPhoto?.name}」的证件照？</AlertDialogTitle>
            <AlertDialogDescription>照片将从存储中清除，学生档案不受影响；可随时重新上传。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const target = deletingPhoto;
                setDeletingPhoto(null);
                if (target) void deleteStudentPhoto(target.id, () => void store.refresh());
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("break-words", className)}>{children}</dd>
    </div>
  );
}
