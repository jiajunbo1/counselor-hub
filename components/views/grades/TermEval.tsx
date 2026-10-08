import { useMemo, useState } from "react";
import { FileUp, Save, Settings2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ImportDialog from "@/components/ImportDialog";
import { Input } from "@/components/ui/input";
import { EmptyHint } from "@/components/form";
import type { Store } from "@/hooks/use-store";
import { ALL_CLASS, inClassScope, useClassScope } from "@/hooks/use-class-scope";
import { termNow, useTermScope } from "@/hooks/use-term-scope";
import { TERM_EVAL_COLUMNS, exportCsv } from "@/lib/import-export";
import { gradesOfTerm, round1, summarizeTerm, termAttendDeduct } from "@/lib/evaluation";
import { compareRankSortable, rankRowsByClass, type RankSortMode } from "@/lib/rank-view";
import { RankSortControl, sortCaption, sortOptionsFor } from "./SortControl";
import { ALL, SCORE_RE, SegPills, fmt1, HOT_CLASS } from "./parts";
import { RulesDialog } from "./Attendance";
import ScoreDetailDialog, { type GotoFn, type ScoreDetail } from "./ScoreDetail";

interface Draft {
  usual_score: string;
  note: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));

export default function TermEvalView({ store, goto, focusNo }: { store: Store; goto: GotoFn; focusNo?: string }) {
  const terms = useMemo(
    () => [...new Set([...store.grades.map((g) => g.term), ...store.termEvals.map((e) => e.term)].filter(Boolean))].sort(),
    [store.grades, store.termEvals]
  );
  const latestTerm = terms.length > 0 ? terms[terms.length - 1] : "";
  // 学期跟随侧栏全局作用域；测评一次只评一个学期，「全部学期」时给出提示
  const termScope = useTermScope();
  const term = termNow(termScope);
  const classScope = useClassScope();
  const [sortMode, setSortMode] = useState<RankSortMode>("class_rank");
  const [groupByClass, setGroupByClass] = useState(true);
  const [keyword, setKeyword] = useState(focusNo ?? "");
  const [scope, setScope] = useState(ALL);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [importing, setImporting] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeTerm = term === ALL ? "" : term;
  const [detail, setDetail] = useState<ScoreDetail | null>(null);
  const evalByStudent = useMemo(
    () => new Map(store.termEvals.filter((e) => e.term === activeTerm).map((e) => [e.student_id, e])),
    [store.termEvals, activeTerm]
  );

  const coursesById = useMemo(() => new Map(store.courses.map((c) => [c.id, c])), [store.courses]);

  // 名次按「全班该学期已保存的数据」算，不受搜索/录入状态筛选影响；草稿不参与，避免录入时整行跳动
  const rankOf = useMemo(() => {
    const all = store.students.map((s) => ({
      student: s,
      summary: summarizeTerm(
        s,
        activeTerm,
        gradesOfTerm(store.grades, s.id, activeTerm),
        evalByStudent.get(s.id) ?? null,
        coursesById,
        store.attendance,
        store.evaluation
      ),
    }));
    return rankRowsByClass(all);
  }, [store.students, store.grades, store.attendance, store.evaluation, coursesById, evalByStudent, activeTerm]);

  const valueOf = (studentId: string, field: keyof Draft): string =>
    drafts[studentId]?.[field] ?? evalByStudent.get(studentId)?.[field] ?? "";

  const rows = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return store.students
      .filter((s) => inClassScope(classScope, s.class_name))
      .filter((s) => !kw || `${s.name}${s.student_no}`.toLowerCase().includes(kw))
      .map((s) => {
        const { counts, deduct } = termAttendDeduct(s.id, activeTerm, store.attendance, store.evaluation);
        const saved = evalByStudent.get(s.id) ?? null;
        const draft = drafts[s.id];
        const raw = draft ? draft.usual_score : saved?.usual_score ?? "";
        const usualNum = raw !== "" && SCORE_RE.test(raw) ? Number(raw) : null;
        const usualEff = usualNum === null ? null : clamp01(usualNum - deduct);
        return { student: s, saved, counts, deduct, raw, usualEff, dirty: !!draft && (draft.usual_score !== (saved?.usual_score ?? "") || draft.note !== (saved?.note ?? "")), rankRow: rankOf.get(s.id) ?? null };
      })
      .filter((r) => (scope === "done" ? r.saved !== null : scope === "todo" ? r.saved === null : true))
      .sort(compareRankSortable(sortMode, groupByClass));
  }, [store.students, store.attendance, store.evaluation, classScope, keyword, scope, activeTerm, evalByStudent, drafts, rankOf, sortMode, groupByClass]);

  const dirtyCount = rows.filter((r) => r.dirty).length;
  const doneCount = useMemo(() => store.students.filter((s) => evalByStudent.has(s.id)).length, [store.students, evalByStudent]);

  const saveOne = async (studentId: string): Promise<boolean> => {
    const draft = drafts[studentId];
    if (!draft) return true;
    if (!SCORE_RE.test(draft.usual_score) || Number(draft.usual_score) > 100) {
      toast.error("平时总评需为 0-100。");
      return false;
    }
    return await store.write("term_eval.save", { student_id: studentId, term: activeTerm, usual_score: draft.usual_score, note: draft.note.trim() });
  };

  const saveAll = async () => {
    setBusy(true);
    let okCount = 0;
    let failed = 0;
    for (const r of rows) {
      if (!r.dirty) continue;
      const ok = await saveOne(r.student.id);
      if (ok) okCount += 1;
      else {
        failed += 1;
        break;
      }
    }
    setBusy(false);
    if (failed === 0 && okCount > 0) toast.success(`已保存 ${okCount} 名学生的学期平时总评。`);
    setDrafts({});
  };

  const exportTerm = () => {
    if (rows.length === 0) return toast.error("当前范围内没有学生。");
    exportCsv(
      `学期综合测评-${activeTerm}-${classScope.cls === ALL_CLASS ? "全部班级" : classScope.cls}.csv`,
      ["名次", "学号", "姓名", "班级", "平时总评（原始）", "考勤扣分", "折算平时", "旷课", "迟到", "早退", "请假", "备注"],
      rows.map((r) => [
        r.rankRow ? `${r.rankRow.rank}/${r.rankRow.total}` : "未定",
        r.student.student_no, r.student.name, r.student.class_name,
        r.raw === "" ? "未录入" : r.raw,
        String(r.deduct),
        r.usualEff === null ? "" : String(r.usualEff),
        String(r.counts.absent), String(r.counts.late), String(r.counts.early), String(r.counts.leave),
        drafts[r.student.id]?.note ?? r.saved?.note ?? "",
      ])
    );
    toast.success("测评表已开始下载。");
  };

  if (term === ALL) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground shadow-xs">
        综合测评一次只录入一个学期，请在左侧「当前学期」选定具体学期。
        {latestTerm ? (
          <Button variant="outline" size="sm" onClick={() => termScope.setTerm(latestTerm)}>
            跳到最新学期（{latestTerm}）
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1 sm:max-w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索姓名 / 学号" maxLength={30} className="pl-8 pr-7" />
          {keyword ? (
            <button type="button" aria-label="清空搜索" onClick={() => setKeyword("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowRules(true)}>
            <Settings2 className="size-4" /> <span className="hidden sm:inline">规则设置</span>
          </Button>
          <Button variant="outline" size="sm" onClick={exportTerm}>
            导出
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
            <FileUp className="size-4" /> <span className="hidden sm:inline">导入</span>
          </Button>
          <Button size="sm" onClick={() => void saveAll()} disabled={busy || dirtyCount === 0}>
            <Save className="size-4" /> {busy ? "保存中…" : dirtyCount ? `保存全部（${dirtyCount}）` : "保存全部"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-80">
          <SegPills
            options={[
              { value: ALL, label: "全部", count: store.students.length },
              { value: "done", label: "已录入", count: doneCount },
              { value: "todo", label: "未录入", count: store.students.length - doneCount },
            ]}
            value={scope}
            onChange={setScope}
          />
        </div>
        <RankSortControl
          mode={sortMode}
          onMode={setSortMode}
          options={sortOptionsFor(classScope.cls === ALL_CLASS, true)}
          groupByClass={groupByClass}
          onGroupByClass={setGroupByClass}
          showGroupToggle={classScope.cls === ALL_CLASS && sortMode === "composite"}
        />
        <span className="text-xs text-muted-foreground">
          {activeTerm || "暂无学期"} · 录入的是扣分前的原始分，考勤扣分自动折算；点「折算后」看明细 · 当前{sortCaption(sortMode, groupByClass)}，名次以已保存数据计，不受录入草稿影响
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyHint text={store.students.length === 0 ? "还没有学生档案。" : "没有符合条件的学生。"} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/40 text-left text-[11px] text-muted-foreground">
                <th className="sticky left-0 z-10 bg-card px-3 py-2 font-medium">姓名 / 学号</th>
                <th className="px-2 py-2 text-left font-medium">班级</th>
                <th className="px-2 py-2 text-center font-medium">考勤（旷/迟/早/假）</th>
                <th className="px-2 py-2 text-center font-medium">扣分</th>
                <th className="px-2 py-2 text-center font-medium">平时总评</th>
                <th className="px-2 py-2 text-center font-medium">折算后</th>
                <th className="hidden px-2 py-2 text-left font-medium lg:table-cell">备注</th>
                <th className="px-2 py-2 text-center font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.student.id} className="border-t">
                  <td className="sticky left-0 z-10 bg-card px-3 py-1.5 whitespace-nowrap">
                    <span className="mr-1.5 text-xs font-semibold tabular-nums text-muted-foreground">{r.rankRow ? `#${r.rankRow.rank}/${r.rankRow.total}` : "未定"}</span>
                    <span className="font-medium">{r.student.name}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{r.student.student_no}</span>
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap">{r.student.class_name || "未分班"}</td>
                  <td className="px-2 py-1.5 text-center text-xs tabular-nums text-muted-foreground">
                    {r.counts.absent || r.counts.late || r.counts.early || r.counts.leave
                      ? `${r.counts.absent}/${r.counts.late}/${r.counts.early}/${r.counts.leave}`
                      : "满勤"}
                  </td>
                  <td className="px-2 py-1.5 text-center text-xs tabular-nums">
                    {r.deduct > 0 ? <span className="font-semibold text-amber-600">-{fmt1(r.deduct)}</span> : <span className="text-muted-foreground">0</span>}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <Input
                      value={valueOf(r.student.id, "usual_score")}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.student.id]: { usual_score: e.target.value.replace(/[^\d.]/g, ""), note: d[r.student.id]?.note ?? r.saved?.note ?? "" } }))}
                      placeholder="0-100"
                      inputMode="decimal"
                      maxLength={5}
                      className="mx-auto w-20 text-center"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center text-sm font-semibold tabular-nums">
                    {r.usualEff === null ? (
                      <span className="text-xs font-normal text-amber-600">未录入</span>
                    ) : (
                      <button type="button" className={"rounded px-1 underline decoration-dotted decoration-from-font underline-offset-4 " + HOT_CLASS} onClick={() => setDetail({ kind: "term", student: r.student, term: activeTerm })}>
                        {round1(r.usualEff)}
                      </button>
                    )}
                  </td>
                  <td className="hidden px-2 py-1.5 lg:table-cell">
                    <Input
                      value={valueOf(r.student.id, "note")}
                      onChange={(e) => setDrafts((d) => ({ ...d, [r.student.id]: { usual_score: d[r.student.id]?.usual_score ?? r.saved?.usual_score ?? "", note: e.target.value } }))}
                      placeholder="选填"
                      maxLength={200}
                      className="w-full min-w-24"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {r.dirty ? (
                      <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => void saveOne(r.student.id).then((ok) => ok && setDrafts((d) => { const n = { ...d }; delete n[r.student.id]; return n; }))}>
                        保存
                      </Button>
                    ) : r.saved ? (
                      <Badge variant="outline" className="border-transparent bg-emerald-500/10 font-normal text-emerald-700">已录</Badge>
                    ) : (
                      <Badge variant="outline" className="border-transparent bg-muted font-normal text-muted-foreground">未录</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {importing ? (
        <ImportDialog
          title="导入学期平时总评"
          description="首行为表头（可下载模板对照）。按学号匹配学生，已有总评会被覆盖；分数需为 0-100。"
          columns={TERM_EVAL_COLUMNS}
          action="term_eval.bulk_create"
          chunkSize={150}
          template={{ name: "学期总评导入模板", samples: ["2024010101", "2025-2026-2", "92", "担任课代表"] }}
          buildRow={(row) => ({
            student_no: row.student_no ?? "",
            term: row.term ?? "",
            usual_score: row.usual_score ?? "",
            note: row.note ?? "",
          })}
          extraValidate={(row) => {
            if (row.usual_score && (!SCORE_RE.test(row.usual_score) || Number(row.usual_score) > 100)) return "分数需为 0-100";
            if (!row.term) return "学期必填";
            return null;
          }}
          onClose={() => setImporting(false)}
          onDone={(created, skipped) => {
            void store.refresh();
            toast.success(`导入完成：写入 ${created} 条${skipped ? `，跳过 ${skipped} 条` : ""}`);
          }}
        />
      ) : null}

      {showRules ? <RulesDialog store={store} onClose={() => setShowRules(false)} /> : null}

      {detail ? (
        <ScoreDetailDialog
          key={detail.kind === "grade" ? "g" + detail.grade.id : "t" + detail.student.id + "|" + detail.term}
          store={store}
          detail={detail}
          goto={goto}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </div>
  );
}
