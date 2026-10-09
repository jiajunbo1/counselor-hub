import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/section-card";
import { CountUp } from "@/components/motion";
import type { Store } from "@/hooks/use-store";
import { ALL_CLASS, inClassScope, useClassScope } from "@/hooks/use-class-scope";
import { RECORD_TYPE_LABEL, studentName, type RecordItem } from "@/lib/types";
import type { TabId } from "@/components/AppShell";

const PASS_SCORE = 60;

function BarList({ items, unit = "" }: { items: { label: string; value: number; danger?: boolean }[]; unit?: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 truncate text-muted-foreground" title={i.label}>{i.label}</span>
          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className={"block h-full rounded-full " + (i.danger ? "bg-rose-400" : "bg-primary/70")}
              style={{ width: `${Math.max((i.value / max) * 100, 4)}%` }}
            />
          </span>
          <span className="num w-16 shrink-0 text-right">{i.value}{unit}</span>
        </li>
      ))}
    </ul>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{text}</p>;
}

function PendingLeaveRow({ record, store, onNavigate }: { record: RecordItem; store: Store; onNavigate: (t: TabId) => void }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{record.title}</p>
        <p className="num truncate text-xs text-muted-foreground">
          {studentName(store.students, record.student_id)} · {record.occurred_on}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={() => onNavigate("leaves")}>
        去审批
      </Button>
    </li>
  );
}

export default function OverviewView({ store, onNavigate }: { store: Store; onNavigate: (tab: TabId) => void }) {
  const scope = useClassScope();
  const { students, records, rooms, courses, grades } = store;
  const scopedStudents = useMemo(() => students.filter((s) => inClassScope(scope, s.class_name)), [students, scope]);
  const classById = useMemo(() => new Map(students.map((s) => [s.id, s.class_name])), [students]);
  const recInScope = (studentId: string) => scope.cls === ALL_CLASS || classById.get(studentId) === scope.cls;
  // 宿舍是楼栋口径、无班级概念，入住率保持全局；其余统计跟随班级作用域
  const bedsTotal = rooms.reduce((sum, r) => sum + r.capacity, 0);
  const bedsUsed = students.filter((s) => s.dorm_room_id).length;
  const pendingLeaves = records.filter((r) => r.type === "leave" && r.status === "pending" && recInScope(r.student_id));
  const unassigned = scopedStudents.filter((s) => !s.dorm_room_id);
  const recent = useMemo(() => records.filter((r) => recInScope(r.student_id)).slice(0, 6), [records, classById, scope]);
  const failGrades = useMemo(() => grades.filter((g) => Number(g.score) < PASS_SCORE && inClassScope(scope, g.class_name)), [grades, scope]);
  const scopedCourseCount = courses.filter((c) => inClassScope(scope, c.class_name)).length;

  const classSizes = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of scopedStudents) map.set(s.class_name || "未分班", (map.get(s.class_name || "未分班") ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));
  }, [scopedStudents]);

  const courseAverages = useMemo(() => {
    const map = new Map<string, { sum: number; n: number }>();
    for (const g of grades) {
      if (!inClassScope(scope, g.class_name)) continue;
      const cur = map.get(g.course_name) ?? { sum: 0, n: 0 };
      cur.sum += Number(g.score);
      cur.n += 1;
      map.set(g.course_name, cur);
    }
    return [...map.entries()]
      .map(([label, { sum, n }]) => ({ label, value: Math.round((sum / n) * 10) / 10 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [grades, scope]);

  const stats: { label: string; value: number; of?: number; tab: TabId }[] = [
    { label: "学生总数", value: scopedStudents.length, tab: "students" },
    { label: "宿舍入住", value: bedsUsed, of: bedsTotal, tab: "dorms" },
    { label: "待审批请假", value: pendingLeaves.length, tab: "leaves" },
    { label: "课程数", value: scopedCourseCount, tab: "courses" },
    { label: "不及格成绩", value: failGrades.length, tab: "grades" },
  ];

  // 今日焦点：只列需要动手的事，点一下直达处理页；全部清爽时收为一行确认。
  const focus = [
    pendingLeaves.length
      ? { key: "leave", dot: "bg-amber-500", label: "条请假待审批", value: pendingLeaves.length, tab: "leaves" as TabId }
      : null,
    failGrades.length
      ? { key: "fail", dot: "bg-rose-500", label: "条不及格成绩待跟进", value: failGrades.length, tab: "grades" as TabId }
      : null,
    unassigned.length
      ? { key: "dorm", dot: "bg-sky-500", label: "人还没安排床位", value: unassigned.length, tab: "dorms" as TabId }
      : null,
    scopedStudents.length === 0
      ? { key: "student", dot: "bg-muted-foreground/40", label: "当前范围还没有学生，先去登记", value: 0, tab: "students" as TabId }
      : null,
  ].filter((f): f is NonNullable<typeof f> => f !== null);

  return (
    <section className="stack-page">
      <div>
        <h1 className="text-lg font-bold">
          工作总览{scope.cls !== ALL_CLASS ? <span className="text-muted-foreground"> · {scope.cls}</span> : null}
        </h1>
      </div>

      {focus.length === 0 ? (
        <p className="text-sm text-muted-foreground">本班今天没有待办：请假已审完、无不及格待跟进、床位都已安排。</p>
      ) : (
        <div className="stack-inline">
          {focus.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onNavigate(f.tab)}
              className="row-interactive flex items-center gap-2 rounded-[var(--r-chip)] border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className={"size-2 shrink-0 rounded-full " + f.dot} aria-hidden />
              {f.value > 0 ? <span className="num shrink-0 font-semibold">{f.value}</span> : null}
              <span className="min-w-0 truncate">{f.label}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <button
            key={s.label}
            type="button"
            className="group w-full cursor-pointer rounded-[var(--r-card)] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => onNavigate(s.tab)}
          >
            <div className="rounded-[var(--r-card)] border bg-card p-4 shadow-xs transition-colors group-hover:border-primary/60 group-hover:bg-accent/40">
              <p className="truncate text-xs text-muted-foreground transition-colors group-hover:text-foreground">{s.label}</p>
              <p className="mt-1 text-2xl font-bold text-primary">
                <CountUp value={s.value} />
                {s.of !== undefined ? <span className="num text-base font-semibold text-muted-foreground">/{s.of}</span> : null}
              </p>
            </div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="待审批请假"
          count={pendingLeaves.length}
          action={pendingLeaves.length ? <Button size="sm" variant="outline" onClick={() => onNavigate("leaves")}>去审批</Button> : undefined}
          bodyClassName="px-4 pb-4"
        >
          {pendingLeaves.length === 0 ? (
            <EmptyLine text="暂无待审批的请假申请" />
          ) : (
            <ul className="divide-y">
              {pendingLeaves.slice(0, 5).map((r) => (
                <PendingLeaveRow key={r.id} record={r} store={store} onNavigate={onNavigate} />
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="最近记录"
          count={recent.length}
          action={<Button size="sm" variant="outline" onClick={() => onNavigate("records")}>查看全部</Button>}
          bodyClassName="px-4 pb-4"
        >
          {recent.length === 0 ? (
            <EmptyLine text="还没有任何记录" />
          ) : (
            <ul className="divide-y">
              {recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{r.title}</p>
                    <p className="num truncate text-xs text-muted-foreground">
                      {studentName(store.students, r.student_id)} · {r.occurred_on}
                    </p>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {RECORD_TYPE_LABEL[r.type] ?? r.type}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="不及格预警"
        subtitle={`低于 ${PASS_SCORE} 分的课程，建议逐条与学生核实后跟进`}
        count={failGrades.length}
        action={<Button size="sm" variant="outline" onClick={() => onNavigate("grades")}>查看全部成绩</Button>}
      >
        {failGrades.length === 0 ? (
          <p className="text-sm text-muted-foreground">目前没有不及格成绩，学习状况良好。</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {failGrades.slice(0, 12).map((g) => (
              <Badge key={g.id} variant="outline" className="border-rose-200 bg-rose-50 font-normal text-rose-700">
                {g.student_name} · {g.course_name} · <span className="num">{g.score}</span>
              </Badge>
            ))}
            {failGrades.length > 12 ? <span className="num text-xs text-muted-foreground">等 {failGrades.length} 条</span> : null}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="住宿待安排"
        count={unassigned.length}
        action={<Button size="sm" variant="outline" onClick={() => onNavigate("dorms")}>去安排床位</Button>}
      >
        {unassigned.length === 0 ? (
          <p className="text-sm text-muted-foreground">所有学生均已分配宿舍。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {unassigned.map((s) => (
              <Badge key={s.id} variant="outline" className="font-normal">
                {s.name} · {s.class_name || "未填班级"}
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="班级人数">
          {classSizes.length === 0 ? <EmptyLine text="还没有学生数据" /> : <BarList items={classSizes} unit=" 人" />}
        </SectionCard>

        <SectionCard title="课程平均分">
          {courseAverages.length === 0 ? (
            <EmptyLine text="还没有成绩数据，可在「成绩」页录入或批量导入" />
          ) : (
            <BarList items={courseAverages} />
          )}
        </SectionCard>
      </div>
    </section>
  );
}
