import type { EvaluationSettings } from "@/lib/types";

export const ALL = "__all";
export const PASS_SCORE = 60;
export const SCORE_RE = /^\d{1,3}(\.\d{1,2})?$/;

export function scoreTone(score: number | null): string {
  if (score === null || Number.isNaN(score)) return "text-muted-foreground";
  if (score < PASS_SCORE) return "pill-danger";
  if (score < 75) return "pill-warning";
  if (score < 90) return "pill-info";
  return "pill-success";
}

/** 可点击数值的通用样式（点分数看详情） */
export const HOT_CLASS =
  "cursor-pointer rounded-md outline-none transition-colors hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-ring/50";

/** 分数方块（成绩单/矩阵通用）；null 显示占位；传 onClick 变可点 */
export function ScoreCell({ value, className = "", onClick }: { value: number | null; className?: string; onClick?: () => void }) {
  if (value === null || Number.isNaN(value)) {
    return <span className={"inline-flex items-center justify-center rounded-lg border border-dashed text-muted-foreground " + className}>–</span>;
  }
  const base = "inline-flex items-center justify-center rounded-lg border font-bold tabular-nums " + scoreTone(value) + " " + className;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={`考试 ${value} 分，点击查看明细`} className={base + " cursor-pointer transition-transform outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring/50"}>
        {Math.round(value * 10) / 10}
      </button>
    );
  }
  return <span className={base}>{Math.round(value * 10) / 10}</span>;
}

export interface SegOption {
  value: string;
  label: string;
  count?: number;
  dot?: boolean;
}

/** 一体化胶囊分段切换（与日常记录页同款） */
export function SegPills({ options, value, onChange }: { options: SegOption[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl border bg-muted/40 p-1">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={
              "relative flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50 " +
              (active ? "text-white" : "text-muted-foreground hover:text-foreground")
            }
            style={active ? { backgroundImage: "var(--grad-primary)", boxShadow: "var(--shadow-glow)" } : undefined}
          >
            <span className="truncate">{o.label}</span>
            {o.count !== undefined ? (
              <span className={"shrink-0 text-[11px] tabular-nums " + (active ? "text-white/85" : "text-muted-foreground/70")}>{o.count}</span>
            ) : null}
            {o.dot ? <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-red-500" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** 学期综合公式的口径说明（成绩单/矩阵/测评页脚注共用） */
export function evalFormulaNote(settings: EvaluationSettings): string {
  return `学期综合 = 学分加权考试均分×${settings.exam_weight}% + 折算平时×${settings.usual_weight}%；考勤扣分（旷课每次${settings.absent_deduct}、迟到/早退每次${settings.late_deduct}、请假每次${settings.leave_deduct}）作用于学期平时总评。`;
}

export const fmt1 = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? "–" : String(Math.round(n * 10) / 10);

export function termOptionsOf(values: string[]): { value: string; label: string }[] {
  const uniq = [...new Set(values.filter(Boolean))].sort();
  return [{ value: ALL, label: "全部学期" }, ...uniq.map((t) => ({ value: t, label: t }))];
}
