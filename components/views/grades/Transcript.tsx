import { useMemo, useState } from "react";
import { ChevronLeft, Search, Trophy, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyHint } from "@/components/form";
import type { Store } from "@/hooks/use-store";
import { ALL_CLASS, inClassScope, useClassScope } from "@/hooks/use-class-scope";
import { termNow, useTermScope } from "@/hooks/use-term-scope";
import type { Student } from "@/lib/types";
import type { Grade } from "@/lib/types";
import { summarizeTerm, type TermSummary } from "@/lib/evaluation";
import { compareRankSortable, rankRowsByClass, type RankRow, type RankSortMode } from "@/lib/rank-view";
import { RankSortControl, sortCaption, sortOptionsFor } from "./SortControl";
import { ALL, fmt1, HOT_CLASS, ScoreCell } from "./parts";
import ScoreDetailDialog, { type GotoFn, type ScoreDetail } from "./ScoreDetail";

function StatTile({ label, value, sub, onClick }: { label: string; value: string; sub?: string; onClick?: () => void }) {
  const inner = (
    <>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-xl font-bold leading-tight tabular-nums">{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={"rounded-xl border bg-card px-3 py-2.5 text-center shadow-xs " + HOT_CLASS}>
        {inner}
      </button>
    );
  }
  return <div className="rounded-xl border bg-card px-3 py-2.5 text-center shadow-xs">{inner}</div>;
}

function TranscriptDetail({ summary, rank, total, store, onDetail }: { summary: TermSummary; rank: number | null; total: number; store: Store; onDetail: (d: ScoreDetail) => void }) {
  const s = summary.student;
  const openTerm = () => onDetail({ kind: "term", student: s, term: summary.term });
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <p className="text-sm font-bold">
          {s.name}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">{s.student_no} · {s.class_name || "未分班"} · {summary.term}</span>
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatTile label="学期综合" value={fmt1(summary.composite)} sub="点击看明细" onClick={openTerm} />
          <StatTile label="考试均分" value={fmt1(summary.examAvg)} sub="学分加权" />
          <StatTile label="GPA" value={summary.gpa === null ? "–" : String(summary.gpa)} sub="4.0 制" />
          <StatTile label="班级排名" value={rank === null ? "–" : `${rank}/${total}`} />
          <StatTile label="不及格" value={String(summary.fails)} sub="门" />
        </div>
        <div className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {summary.usual === null ? (
            <>学期平时总评：<b className="text-amber-600">未录入</b>，学期综合暂按考试均分计。请到「综合测评」分段录入。</>
          ) : (
            <>
              学期平时总评：原始 <b className="tabular-nums text-foreground">{fmt1(summary.usual)}</b>
              {summary.deduct > 0 ? <> · 考勤扣 <b className="tabular-nums text-amber-600">{fmt1(summary.deduct)}</b></> : " · 本学期考勤无扣分"}
              {" · 折算 "}
              <b className="tabular-nums text-foreground">{fmt1(summary.usualEff)}</b>
            </>
          )}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2">
          <Badge variant="outline" className="font-normal">{summary.term}</Badge>
          <span className="text-xs text-muted-foreground">{summary.rows.length} 门课</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="px-4 py-1.5 font-medium">课程（学分）</th>
              <th className="px-2 py-1.5 text-center font-medium">考试</th>
              <th className="px-2 py-1.5 text-center font-medium">绩点</th>
              <th className="px-4 py-1.5 text-right font-medium">及格</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <tr key={r.grade.id} className="border-t">
                <td className="px-4 py-2">
                  <span className="font-medium">{r.course?.name ?? "（课程已删除）"}</span>
                  <span className="ml-1 text-xs text-muted-foreground">{r.credit > 0 ? `${r.credit}学分` : ""}</span>
                </td>
                <td className="px-2 py-2 text-center"><ScoreCell value={r.exam} className="size-9 text-xs" /></td>
                <td className="px-2 py-2 text-center text-xs tabular-nums text-muted-foreground">{r.gpaPoint.toFixed(1)}</td>
                <td className="px-4 py-2 text-right">
                  {r.pass ? (
                    <Badge variant="outline" className="border-transparent bg-emerald-500/10 font-normal text-emerald-700">及格</Badge>
                  ) : (
                    <Badge variant="outline" className="border-transparent bg-rose-500/10 font-normal text-rose-600">不及格</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TranscriptView({ store, goto }: { store: Store; goto: GotoFn }) {
  const [keyword, setKeyword] = useState("");
  const scope = useClassScope();
  // 学期不再本页自管，跟随侧栏全局学期作用域（ALL=每学期分组展示）
  const term = termNow(useTermScope());
  const [sortMode, setSortMode] = useState<RankSortMode>("class_rank");
  const [groupByClass, setGroupByClass] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<ScoreDetail | null>(null);

  const coursesById = useMemo(() => new Map(store.courses.map((c) => [c.id, c])), [store.courses]);
  const evalByStudentTerm = useMemo(
    () => new Map(store.termEvals.map((e) => [`${e.student_id}|${e.term}`, e])),
    [store.termEvals]
  );

  const allTerms = useMemo(() => [...new Set(store.grades.map((g) => g.term).filter(Boolean))].sort(), [store.grades]);
  // 学期范围：选中具体学期→该学期一组成绩单；「全部学期」→每学期各一组，最新在前
  const termsInRange = useMemo(
    () => (term === ALL ? [...allTerms].reverse() : [term]),
    [term, allTerms]
  );

  const groups = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const out: { term: string; items: { student: Student; summary: TermSummary; rankRow: RankRow | null }[] }[] = [];
    for (const activeTerm of termsInRange) {
      const byStudent = new Map<string, Grade[]>();
      for (const g of store.grades) {
        if (g.term !== activeTerm) continue;
        if (!byStudent.has(g.student_id)) byStudent.set(g.student_id, []);
        byStudent.get(g.student_id)!.push(g);
      }
      const list: TermSummary[] = [];
      for (const s of store.students) {
        const gs = byStudent.get(s.id);
        if (!gs) continue;
        const sum = summarizeTerm(s, activeTerm, gs, evalByStudentTerm.get(`${s.id}|${activeTerm}`) ?? null, coursesById, store.attendance, store.evaluation);
        if (!sum) continue;
        list.push(sum);
      }
      // 名次始终用该学期全班算，搜索/班级筛选只决定显示哪些卡片
      const rankOf = rankRowsByClass(list.map((summary) => ({ student: summary.student, summary })));
      const items = list
        .filter((summary) => {
          const s = summary.student;
          if (!inClassScope(scope, s.class_name)) return false;
          if (kw && !`${s.name}${s.student_no}`.toLowerCase().includes(kw)) return false;
          return true;
        })
        .map((summary) => ({ student: summary.student, summary, rankRow: rankOf.get(summary.student.id) ?? null }))
        .sort(compareRankSortable(sortMode, groupByClass));
      if (items.length > 0) out.push({ term: activeTerm, items });
    }
    return out;
  }, [store.students, store.grades, store.attendance, store.evaluation, coursesById, evalByStudentTerm, termsInRange, keyword, scope, sortMode, groupByClass]);

  const totalCount = groups.reduce((n, g) => n + g.items.length, 0);

  const selected = selectedKey
    ? groups.flatMap((g) => g.items).find((it) => `${it.summary.student.id}|${it.summary.term}` === selectedKey) ?? null
    : null;
  const detailKey = detail ? (detail.kind === "grade" ? "g" + detail.grade.id : "t" + detail.student.id + "|" + detail.term) : "";
  const detailDialog = detail ? (
    <ScoreDetailDialog key={detailKey} store={store} detail={detail} goto={goto} onClose={() => setDetail(null)} />
  ) : null;

  if (selected) {
    return (
      <div className="space-y-3">
        <Button variant="outline" size="sm" onClick={() => setSelectedKey(null)}>
          <ChevronLeft className="size-4" /> 返回名单
        </Button>
        <TranscriptDetail
          summary={selected.summary}
          rank={selected.rankRow?.rank ?? null}
          total={selected.rankRow?.total ?? 0}
          store={store}
          onDetail={setDetail}
        />
        {detailDialog}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1 sm:max-w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索姓名 / 学号"
            maxLength={30}
            className="pl-8 pr-7"
          />
          {keyword ? (
            <button type="button" aria-label="清空搜索" onClick={() => setKeyword("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <RankSortControl
          mode={sortMode}
          onMode={setSortMode}
          options={sortOptionsFor(scope.cls === ALL_CLASS, true)}
          groupByClass={groupByClass}
          onGroupByClass={setGroupByClass}
          showGroupToggle={scope.cls === ALL_CLASS && sortMode === "composite"}
        />
        <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground" title={`${totalCount} 张成绩单`}>
          {totalCount} 张成绩单 · {term === ALL ? (allTerms.length ? `全部 ${allTerms.length} 个学期` : "暂无学期") : term} · 当前{sortCaption(sortMode, groupByClass)}
        </span>
      </div>

      {totalCount === 0 ? (
        <EmptyHint text={store.grades.length === 0 ? "还没有成绩记录。" : "没有符合条件的学生成绩。"} />
      ) : (
        groups.map((g) => (
          <section key={g.term} className="space-y-2">
            {term === ALL ? (
              <div className="flex items-center gap-2 px-1">
                <Badge variant="outline" className="font-semibold">{g.term}</Badge>
                <span className="text-xs text-muted-foreground">{g.items.length} 名学生</span>
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {g.items.map(({ summary, rankRow }) => {
                const s: Student = summary.student;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSelectedKey(`${s.id}|${summary.term}`)}
                    className="rounded-xl border bg-card px-4 py-3 text-left shadow-xs outline-none transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {s.name}
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">{s.student_no}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Trophy className="size-3.5" />
                        {rankRow ? `${rankRow.rank}/${rankRow.total}` : "未定"}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{s.class_name || "未分班"} · {summary.rows.length} 门课</p>
                    <div className="mt-2 flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">综合 <b className="tabular-nums text-foreground">{fmt1(summary.composite)}</b></span>
                      <span className="text-muted-foreground">GPA <b className="tabular-nums text-foreground">{summary.gpa ?? "–"}</b></span>
                      {summary.usual === null ? (
                        <Badge variant="outline" className="border-transparent bg-amber-500/10 font-normal text-amber-600">平时未录</Badge>
                      ) : null}
                      {summary.fails > 0 ? (
                        <Badge variant="outline" className="border-transparent bg-rose-500/10 font-normal text-rose-600">挂 {summary.fails} 门</Badge>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}
      {detailDialog}
    </div>
  );
}
