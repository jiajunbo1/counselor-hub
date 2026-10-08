import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { EmptyHint, FormField } from "@/components/form";
import { ALL_CLASS, inClassScope, useClassScope } from "@/hooks/use-class-scope";
import type { Store } from "@/hooks/use-store";
import type { Course } from "@/lib/types";

interface CourseDraft {
  name: string;
  course_code: string;
  teacher: string;
  semester: string;
  class_name: string;
  schedule: string;
  classroom: string;
  credit: string;
}

function courseDraft(course: Course | null): CourseDraft {
  return course
    ? {
        name: course.name,
        course_code: course.course_code,
        teacher: course.teacher,
        semester: course.semester,
        class_name: course.class_name,
        schedule: course.schedule,
        classroom: course.classroom,
        credit: String(course.credit),
      }
    : { name: "", course_code: "", teacher: "", semester: "2026-2027-1", class_name: "", schedule: "", classroom: "", credit: "2" };
}

function CourseFormDialog({ course, onClose, store }: { course: Course | null; onClose: () => void; store: Store }) {
  const isEdit = course !== null;
  const [draft, setDraft] = useState<CourseDraft>(courseDraft(course));
  const [busy, setBusy] = useState(false);
  const set = (key: keyof CourseDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    if (!draft.name.trim()) {
      toast.error("课程名称为必填项。");
      return;
    }
    setBusy(true);
    const payload = { ...draft, credit: draft.credit };
    const ok = isEdit
      ? await store.write("course.update", { id: course.id, ...payload })
      : await store.write("course.create", payload);
    setBusy(false);
    if (ok) {
      toast.success(isEdit ? "课程已更新" : "课程已添加");
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑课程：${course.name}` : "添加课程"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label="课程名称" required>
            <Input value={draft.name} onChange={(e) => set("name")(e.target.value)} maxLength={80} />
          </FormField>
          <FormField label="课程编码">
            <Input value={draft.course_code} onChange={(e) => set("course_code")(e.target.value)} maxLength={32} />
          </FormField>
          <FormField label="任课教师">
            <Input value={draft.teacher} onChange={(e) => set("teacher")(e.target.value)} maxLength={40} />
          </FormField>
          <FormField label="学期">
            <Input value={draft.semester} onChange={(e) => set("semester")(e.target.value)} placeholder="如：2026-2027-1" maxLength={32} />
          </FormField>
          <FormField label="上课班级">
            <Input value={draft.class_name} onChange={(e) => set("class_name")(e.target.value)} placeholder="如：计算机2401" maxLength={60} />
          </FormField>
          <FormField label="学分">
            <Input value={draft.credit} onChange={(e) => set("credit")(e.target.value)} inputMode="decimal" maxLength={8} />
          </FormField>
          <FormField label="上课时间">
            <Input value={draft.schedule} onChange={(e) => set("schedule")(e.target.value)} placeholder="如：周一 1-2节" maxLength={120} />
          </FormField>
          <FormField label="上课地点">
            <Input value={draft.classroom} onChange={(e) => set("classroom")(e.target.value)} placeholder="如：教一 201" maxLength={60} />
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

export default function CoursesView({ store }: { store: Store }) {
  const { courses } = store;
  const scope = useClassScope();
  const [formCourse, setFormCourse] = useState<Course | null | "new" | null>(null);
  const [deleting, setDeleting] = useState<Course | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = courses.filter((c) => inClassScope(scope, c.class_name));

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    const ok = await store.write("course.delete", { id: deleting.id });
    setBusy(false);
    if (ok) toast.success(`已删除课程：${deleting.name}`);
    setDeleting(null);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">课程管理</h1>
          <p className="text-sm text-muted-foreground">
            {scope.cls === ALL_CLASS ? `共 ${courses.length} 门课程。` : `${scope.cls} 共 ${filtered.length} 门课程。`}
          </p>
        </div>
        <Button onClick={() => setFormCourse("new")}>
          <Plus className="size-4" /> <span className="hidden sm:inline">添加课程</span><span className="sm:hidden">添加</span>
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyHint text={courses.length === 0 ? "还没有课程。" : "该班级暂无课程记录。"} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((c) => (
            <div key={c.id} className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {c.course_code ? `${c.course_code} · ` : ""}{c.teacher || "未填教师"} · {c.credit} 学分
                  </p>
                </div>
                <div className="flex shrink-0">
                  <Button variant="ghost" size="icon" aria-label="编辑课程" onClick={() => setFormCourse(c)}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="删除课程" onClick={() => setDeleting(c)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-sm">
                {c.class_name ? <p><span className="text-muted-foreground">班级：</span>{c.class_name}</p> : null}
                {c.schedule ? <p><span className="text-muted-foreground">时间：</span>{c.schedule}</p> : null}
                {c.classroom ? <p><span className="text-muted-foreground">地点：</span>{c.classroom}</p> : null}
              </div>
              {c.semester ? <Badge variant="outline" className="mt-2 font-normal">{c.semester}</Badge> : null}
            </div>
          ))}
        </div>
      )}

      {formCourse !== null ? (
        <CourseFormDialog
          key={formCourse === "new" ? "new" : formCourse.id}
          course={formCourse === "new" ? null : formCourse}
          onClose={() => setFormCourse(null)}
          store={store}
        />
      ) : null}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除课程「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>此操作不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
