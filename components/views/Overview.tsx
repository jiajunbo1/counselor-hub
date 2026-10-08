import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
          <span className="w-16 shrink-0 text-right tabular-nums">{i.value}{unit}</span>
        </li>
      ))}
    </ul>
  );
}

function PendingLeaveRow({ record, store, onNavigate }: { record: RecordItem; store: Store; onNavigate: (t: TabId) => void }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">{record.title}</p>
        <p className="truncate text-xs text-muted-foreground">
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

  const stats = [
    { label: "学生总数", value: scopedStudents.length, tab: "students" as TabId },
    { label: "宿舍入住", value: `${bedsUsed}/${bedsTotal}`, tab: "dorms" as TabId },
    { label: "待审批请假", value: pendingLeaves.length, tab: "leaves" as TabId },
    { label: "课程数", value: scopedCourseCount, tab: "courses" as TabId },
    { label: "不及格成绩", value: failGrades.length, tab: "grades" as TabId },
  ];

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">
          工作总览{scope.cls !== ALL_CLASS ? <span className="text-muted-foreground"> · {scope.cls}</span> : null}
        </h1>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <button
            key={s.label}
            type="button"
            className="group w-full cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => onNavigate(s.tab)}
          >
            <Card className="gap-0 py-4 transition-all group-hover:border-primary/60 group-hover:bg-accent/40 group-hover:shadow-md group-active:scale-[0.99]">
              <CardHeader className="px-4 pb-1">
                <CardTitle className="text-xs font-normal text-muted-foreground transition-colors group-hover:text-foreground">
                  {s.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <span className="text-2xl font-bold tabular-nums text-primary">{s.value}</span>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">待审批请假（{pendingLeaves.length}）</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {pendingLeaves.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">暂无待审批的请假申请</p>
            ) : (
              <ul className="divide-y">
                {pendingLeaves.slice(0, 5).map((r) => (
                  <PendingLeaveRow key={r.id} record={r} store={store} onNavigate={onNavigate} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">最近记录</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">还没有任何记录</p>
            ) : (
              <ul className="divide-y">
                {recent.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{r.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
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
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">班级人数</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {classSizes.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">还没有学生数据</p>
            ) : (
              <BarList items={classSizes} unit=" 人" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">课程平均分</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {courseAverages.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">还没有成绩数据，可在「成绩」页录入或批量导入</p>
            ) : (
              <BarList items={courseAverages} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">不及格预警（{failGrades.length}）</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {failGrades.length === 0 ? (
            <p className="text-sm text-muted-foreground">目前没有不及格成绩，学习状况良好。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {failGrades.slice(0, 12).map((g) => (
                <Badge key={g.id} variant="outline" className="border-rose-200 bg-rose-50 font-normal text-rose-700">
                  {g.student_name} · {g.course_name} · {g.score}
                </Badge>
              ))}
              {failGrades.length > 12 ? <span className="self-center text-xs text-muted-foreground">等 {failGrades.length} 条</span> : null}
              <Button size="sm" variant="outline" onClick={() => onNavigate("grades")}>
                查看全部成绩
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">住宿待安排（{unassigned.length}）</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {unassigned.length === 0 ? (
            <p className="text-sm text-muted-foreground">所有学生均已分配宿舍。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {unassigned.map((s) => (
                <Badge key={s.id} variant="outline" className="font-normal">
                  {s.name} · {s.class_name || "未填班级"}
                </Badge>
              ))}
              <Button size="sm" variant="outline" onClick={() => onNavigate("dorms")}>
                去安排床位
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
