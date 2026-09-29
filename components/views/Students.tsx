import { useMemo, useState } from "react";
import { FileUp, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ImportDialog from "@/components/ImportDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
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
import type { Store } from "@/hooks/use-store";
import {
  dormLabel,
  POLITICAL_OPTIONS,
  RECORD_STATUS_LABEL,
  RECORD_TYPE_LABEL,
  type Student,
} from "@/lib/types";
import { STUDENT_COLUMNS } from "@/lib/import-export";

const ALL = "__all";

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
          <DialogDescription>标注 * 的为必填项。</DialogDescription>
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
  const [cls, setCls] = useState(ALL);
  const [formStudent, setFormStudent] = useState<Student | null | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [busy, setBusy] = useState(false);

  const classOptions = useMemo(() => {
    const set = new Set(students.map((s) => s.class_name).filter(Boolean));
    return [{ value: ALL, label: "全部班级" }, ...[...set].sort().map((c) => ({ value: c, label: c }))];
  }, [students]);

  const titlesByStudent = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of store.positions) {
      if (p.status !== "active") continue;
      if (!m.has(p.student_id)) m.set(p.student_id, []);
      m.get(p.student_id)!.push(p.title);
    }
    return m;
  }, [store.positions]);

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return students.filter((s) => {
      if (cls !== ALL && s.class_name !== cls) return false;
      if (!keyword) return true;
      return [s.name, s.student_no, s.phone, s.major].some((v) => v.toLowerCase().includes(keyword));
    });
  }, [students, q, cls]);

  const detail = detailId ? students.find((s) => s.id === detailId) ?? null : null;
  const detailRecords = detail
    ? [...records.filter((r) => r.student_id === detail.id)].sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : -1))
    : [];

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
          <p className="text-sm text-muted-foreground">共 {students.length} 名学生。</p>
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
        <div className="sm:w-48">
          <Select value={cls} onValueChange={setCls} options={classOptions} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyHint text={students.length === 0 ? "还没有学生档案，点击右上角「添加」开始建立。" : "没有符合筛选条件的学生。"} />
      ) : (
        <ul className="space-y-2">
          {filtered.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card px-4 py-3 text-left shadow-xs transition-colors hover:bg-accent/40"
                onClick={() => setDetailId(s.id)}
              >
                <span className="w-24 shrink-0 font-semibold">{s.name}</span>
                <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{s.student_no}</span>
                <Badge variant="secondary" className="shrink-0 font-normal">{s.gender}</Badge>
                <span className="hidden w-28 shrink-0 text-xs text-muted-foreground sm:inline">{s.class_name || "未填班级"}</span>
                {(titlesByStudent.get(s.id) ?? []).map((t) => (
                  <Badge key={t} variant="outline" className="shrink-0 border-transparent bg-primary/10 font-normal text-primary">{t}</Badge>
                ))}
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">宿舍：{dormLabel(s, rooms)}</span>
                <Pencil className="size-3.5 shrink-0 text-muted-foreground" onClick={(e) => { e.stopPropagation(); setFormStudent(s); }} />
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
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {detail ? (
            <>
              <SheetHeader>
                <SheetTitle>{detail.name}</SheetTitle>
                <SheetDescription>{detail.class_name || "未填班级"} · {detail.student_no}</SheetDescription>
              </SheetHeader>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted-foreground">性别</dt><dd>{detail.gender}</dd>
                <dt className="text-muted-foreground">专业</dt><dd>{detail.major || "—"}</dd>
                <dt className="text-muted-foreground">年级</dt><dd>{detail.grade || "—"}</dd>
                <dt className="text-muted-foreground">政治面貌</dt><dd>{detail.political_status}</dd>
                <dt className="text-muted-foreground">手机号</dt><dd className="tabular-nums">{detail.phone || "—"}</dd>
                <dt className="text-muted-foreground">籍贯</dt><dd>{detail.native_place || "—"}</dd>
                <dt className="text-muted-foreground">宿舍</dt><dd className="col-span-1">{dormLabel(detail, rooms)}</dd>
              </dl>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setFormStudent(detail)}>
                  <Pencil className="size-3.5" /> 编辑
                </Button>
                <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleting(detail)}>
                  <Trash2 className="size-3.5" /> 删除
                </Button>
              </div>
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
    </section>
  );
}
