import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyHint } from "@/components/form";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { Store } from "@/hooks/use-store";
import { RECORD_TYPE_LABEL, type RecordType } from "@/lib/types";

const PASS_SCORE = 60;

const trendConfig = {
  leave: { label: RECORD_TYPE_LABEL.leave, color: "var(--chart-1)" },
  talk: { label: RECORD_TYPE_LABEL.talk, color: "var(--chart-2)" },
  award: { label: RECORD_TYPE_LABEL.award, color: "var(--chart-3)" },
  punish: { label: RECORD_TYPE_LABEL.punish, color: "var(--chart-5)" },
} satisfies ChartConfig;

const bandConfig = {
  count: { label: "人数", color: "var(--chart-1)" },
} satisfies ChartConfig;

const GENDER_COLORS: Record<string, string> = {
  男: "var(--chart-1)",
  女: "var(--chart-3)",
  未填写: "var(--muted-foreground)",
};

const BANDS = [
  { key: "90-100", label: "优秀", min: 90, max: 101 },
  { key: "80-89", label: "良好", min: 80, max: 90 },
  { key: "70-79", label: "中等", min: 70, max: 80 },
  { key: "60-69", label: "及格", min: 60, max: 70 },
  { key: "<60", label: "不及格", min: -1, max: 60 },
];

function lastMonths(n: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

export default function StatisticsView({ store }: { store: Store }) {
  const { students, records, grades } = store;

  const trendData = useMemo(() => {
    const months = lastMonths(6);
    const byMonth = new Map(months.map((m) => [m, { leave: 0, talk: 0, award: 0, punish: 0 }]));
    for (const r of records) {
      const bucket = byMonth.get(r.occurred_on.slice(0, 7));
      if (bucket && r.type in bucket) bucket[r.type as RecordType] += 1;
    }
    return months.map((m) => {
      const c = byMonth.get(m) ?? { leave: 0, talk: 0, award: 0, punish: 0 };
      return { month: `${Number(m.slice(5))}月`, leave: c.leave, talk: c.talk, award: c.award, punish: c.punish };
    });
  }, [records]);
  const trendTotal = trendData.reduce((s, d) => s + d.leave + d.talk + d.award + d.punish, 0);

  const bandData = useMemo(
    () =>
      BANDS.map((b) => ({
        key: b.key,
        label: b.label,
        count: grades.filter((g) => Number(g.score) >= b.min && Number(g.score) < b.max).length,
      })),
    [grades]
  );
  const scoreAvg = grades.length
    ? Math.round((grades.reduce((s, g) => s + Number(g.score), 0) / grades.length) * 10) / 10
    : 0;

  const genderData = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of students) {
      const key = s.gender === "男" || s.gender === "女" ? s.gender : "未填写";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].map(([name, value]) => ({ name, value }));
  }, [students]);

  const classRows = useMemo(() => {
    const byClass = new Map<string, { students: number; scoreSum: number; scoreN: number; fails: number }>();
    const classOf = new Map(students.map((s) => [s.id, s.class_name || "未分班"]));
    for (const s of students) {
      const key = s.class_name || "未分班";
      const cur = byClass.get(key) ?? { students: 0, scoreSum: 0, scoreN: 0, fails: 0 };
      cur.students += 1;
      byClass.set(key, cur);
    }
    for (const g of grades) {
      const cur = byClass.get(classOf.get(g.student_id) ?? "未分班");
      if (!cur) continue;
      const score = Number(g.score);
      cur.scoreSum += score;
      cur.scoreN += 1;
      if (score < PASS_SCORE) cur.fails += 1;
    }
    return [...byClass.entries()]
      .sort((a, b) => b[1].students - a[1].students)
      .map(([name, v]) => ({
        name,
        students: v.students,
        avg: v.scoreN ? Math.round((v.scoreSum / v.scoreN) * 10) / 10 : null,
        fails: v.fails,
      }));
  }, [students, grades]);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">统计图表</h1>
        <p className="text-sm text-muted-foreground">记录趋势、成绩分布与班级概览（随数据实时更新）。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">近 6 个月记录趋势</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {trendTotal === 0 ? (
            <EmptyHint text="近 6 个月还没有记录。" />
          ) : (
            <ChartContainer config={trendConfig} className="mx-auto aspect-[16/9] max-h-64 w-full">
              <BarChart data={trendData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="leave" stackId="a" fill="var(--color-leave)" radius={0} />
                <Bar dataKey="talk" stackId="a" fill="var(--color-talk)" radius={0} />
                <Bar dataKey="award" stackId="a" fill="var(--color-award)" radius={0} />
                <Bar dataKey="punish" stackId="a" fill="var(--color-punish)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">成绩分数段分布（共 {grades.length} 条 · 均分 {scoreAvg || "-"}）</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {grades.length === 0 ? (
              <EmptyHint text="还没有成绩数据。" />
            ) : (
              <ChartContainer config={bandConfig} className="mx-auto aspect-[16/9] max-h-64 w-full">
                <BarChart data={bandData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="key" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">学生性别构成</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {students.length === 0 ? (
              <EmptyHint text="还没有学生数据。" />
            ) : (
              <ChartContainer
                config={{
                  男: { label: "男", color: GENDER_COLORS["男"] },
                  女: { label: "女", color: GENDER_COLORS["女"] },
                  未填写: { label: "未填写", color: GENDER_COLORS["未填写"] },
                }}
                className="mx-auto aspect-[16/9] max-h-64 w-full"
              >
                <PieChart>
                  <Pie data={genderData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2} strokeWidth={0}>
                    {genderData.map((d) => (
                      <Cell key={d.name} fill={GENDER_COLORS[d.name] ?? "var(--chart-4)"} />
                    ))}
                  </Pie>
                  <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="name" />} />
                  <ChartLegend content={<ChartLegendContent nameKey="name" />} />
                </PieChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">班级概览</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {classRows.length === 0 ? (
            <EmptyHint text="还没有学生数据。" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-normal">班级</th>
                    <th className="py-2 pr-4 font-normal">人数</th>
                    <th className="py-2 pr-4 font-normal">平均分</th>
                    <th className="py-2 font-normal">不及格人次</th>
                  </tr>
                </thead>
                <tbody>
                  {classRows.map((c) => (
                    <tr key={c.name} className="border-b last:border-0">
                      <td className="py-2 pr-4">{c.name}</td>
                      <td className="py-2 pr-4 tabular-nums">{c.students}</td>
                      <td className="py-2 pr-4 tabular-nums">{c.avg ?? "-"}</td>
                      <td className={"py-2 tabular-nums " + (c.fails > 0 ? "text-rose-600" : "")}>{c.fails}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
