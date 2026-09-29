import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DateInput, EmptyHint, FormField, Select } from "@/components/form";
import { ALL, SegPills } from "@/components/views/grades/parts";
import type { Store } from "@/hooks/use-store";
import type { MemberUser } from "@/lib/session";
import { ApiError, apiGetRaw, apiPost } from "@/lib/api";
import { dedupeAttendance } from "@/lib/evaluation";
import { ATTEND_KIND_LABEL, type AttendKind, type Classmate } from "@/lib/types";

const TODAY = () => new Date().toISOString().slice(0, 10);
const KINDS = Object.keys(ATTEND_KIND_LABEL) as AttendKind[];
const SKIP_LABEL: Record<string, string> = {
  student_not_found: "学生不存在",
  not_classmate: "不是本班同学",
  invalid_kind: "类型不正确",
  invalid_occurred_on: "日期不正确",
  course_not_found: "课程不存在",
};

interface ClassmatesPayload {
  data: Classmate[];
  courses: { id: string; name: string }[];
}

export default function AttendReportView({ store, member }: { store: Store; member: MemberUser }) {
  const [roster, setRoster] = useState<Classmate[]>([]);
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [kind, setKind] = useState<AttendKind>("late");
  const [occurredOn, setOccurredOn] = useState(TODAY());
  const [courseId, setCourseId] = useState(ALL);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const raw = await apiGetRaw("classmates");
      const payload = raw as unknown as ClassmatesPayload;
      setRoster(Array.isArray(payload.data) ? payload.data : []);
      setCourses(Array.isArray(payload.courses) ? payload.courses : []);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "读取本班名单失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 学期选项：取自本人已知学期（成绩单 + 已有考勤），默认落在最近的学期，保证与辅导员口径一致
  const terms = useMemo(
    () => [...new Set([...store.grades.map((g) => g.term), ...store.attendance.map((a) => a.term)].filter(Boolean))].sort().reverse(),
    [store.grades, store.attendance]
  );
  const termOptions = useMemo(() => [{ value: ALL, label: "不填学期" }, ...terms.map((t) => ({ value: t, label: t }))], [terms]);
  const [termChoice, setTermChoice] = useState("");
  const activeTerm = termChoice || terms[0] || ALL;

  const courseOptions = useMemo(
    () => [{ value: ALL, label: "不选课程（当天并为一节课）" }, ...courses.map((c) => ({ value: c.id, label: c.name }))],
    [courses]
  );

  const myReports = useMemo(
    () => store.attendance.filter((a) => a.reporter_student_id === member.student_id),
    [store.attendance, member.student_id]
  );
  const marks = useMemo(() => dedupeAttendance(store.attendance, store.evaluation), [store.attendance, store.evaluation]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0) {
      toast.error("请先勾选至少一位同学。");
      return;
    }
    if (!occurredOn) {
      toast.error("请选择考勤日期。");
      return;
    }
    if (note.length > 200) {
      toast.error("备注不能超过 200 字。");
      return;
    }
    setBusy(true);
    try {
      const rows = [...selected].map((student_id) => ({
        student_id,
        kind,
        occurred_on: occurredOn,
        course_id: courseId === ALL ? "" : courseId,
        term: activeTerm === ALL ? "" : activeTerm,
        note: note.trim(),
      }));
      const res = await apiPost("attendance.report", { rows });
      const created = Number(res?.created ?? 0);
      const skipped = (res?.skipped ?? []) as { index: number; reason: string }[];
      if (created > 0) toast.success(`已上报 ${created} 条${ATTEND_KIND_LABEL[kind]}记录。`);
      if (skipped.length > 0) {
        const reasons = [...new Set(skipped.map((s) => SKIP_LABEL[s.reason] ?? s.reason))].join("、");
        toast.error(`${skipped.length} 条未提交：${reasons}`);
      }
      setSelected(new Set());
      setNote("");
      await store.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "上报失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-bold">考勤上报</h1>
        <EmptyHint text={loadError} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold">考勤上报</h1>
        <p className="text-xs text-muted-foreground">
          以班委身份登记本班同学的考勤。同一同学同一节课若被重复登记，只按扣分最多的一条计一次，不会重复扣分。
        </p>
      </div>

      <Card>
        <CardHeader className="px-4 pb-2">
          <CardTitle className="text-sm">本节登记内容</CardTitle>
          <CardDescription className="text-xs">先选好内容和下方名单勾选的同学，再一次性提交。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          <SegPills
            options={KINDS.map((k) => ({ value: k, label: ATTEND_KIND_LABEL[k] }))}
            value={kind}
            onChange={(v) => setKind(v as AttendKind)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="日期" required>
              <DateInput value={occurredOn} onChange={setOccurredOn} />
            </FormField>
            <FormField label="课程">
              <Select value={courseId} onValueChange={setCourseId} options={courseOptions} />
            </FormField>
            <FormField label="学期">
              <Select value={activeTerm} onValueChange={setTermChoice} options={termOptions} />
            </FormField>
            <FormField label="备注">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="选填，200 字以内" maxLength={200} />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4 pb-2">
          <CardTitle className="text-sm">本班同学</CardTitle>
          <CardDescription className="text-xs">已选 {selected.size} 人{loading ? " · 名单加载中…" : ""}</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          {loading && roster.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 正在读取本班名单…
            </div>
          ) : roster.length === 0 ? (
            <EmptyHint text="本班暂无其他同学，若名单有遗漏请联系辅导员完善档案。" />
          ) : (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {roster.map((s) => {
                const on = selected.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      className={
                        "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors " +
                        (on ? "border-primary bg-primary/5" : "hover:bg-accent/40")
                      }
                    >
                      <span
                        className={
                          "flex size-5 shrink-0 items-center justify-center rounded-md border " +
                          (on ? "border-transparent bg-primary text-primary-foreground" : "border-input")
                        }
                        aria-hidden
                      >
                        {on ? <Check className="size-3.5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{s.student_no}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" disabled={busy || selected.size === 0} onClick={() => void submit()}>
              <Send className="size-4" /> {busy ? "提交中…" : `上报 ${selected.size} 人${ATTEND_KIND_LABEL[kind]}`}
            </Button>
            {selected.size > 0 ? (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setSelected(new Set())}>
                清空勾选
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4 pb-2">
          <CardTitle className="text-sm">我上报的记录</CardTitle>
          <CardDescription className="text-xs">
            共 {myReports.length} 条。撤销职务后仍可在此查看历史记录，辅导员可修改或删除。扣几分以辅导员台账为准（老师登记的记录在这一侧看不到）。
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          {myReports.length === 0 ? (
            <EmptyHint text="还没有上报过考勤。" />
          ) : (
            <ul className="divide-y">
              {myReports.map((a) => {
                const mark = marks.get(a.id);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
                    <span className="w-20 shrink-0 font-medium">{a.student_name}</span>
                    <Badge variant="outline" className="shrink-0 font-normal">{ATTEND_KIND_LABEL[a.kind]}</Badge>
                    <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">{a.occurred_on}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{a.course_name || a.term || "未关联课程"}</span>
                    {mark && !mark.counted ? (
                      <span className="shrink-0 text-xs text-amber-600">
                        {mark.manual ? "辅导员已把这条改为不计扣分" : "与同节课其他记录重复·不重复扣分"}
                      </span>
                    ) : mark?.manual ? (
                      <span className="shrink-0 text-xs text-primary">辅导员已指定按这条扣分</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
