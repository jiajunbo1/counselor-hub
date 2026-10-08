import { ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/form";
import type { RankSortMode } from "@/lib/rank-view";

const RANK_OPTIONS: { value: RankSortMode; label: string }[] = [
  { value: "class_rank", label: "名次（班内）" },
  { value: "all_rank", label: "名次（不分班）" },
  { value: "composite", label: "学期综合分" },
  { value: "student_no", label: "学号" },
];

/** 只有单班数据时名次就是唯一口径，无需再给「班内 / 不分班」两个选项 */
export function sortOptionsFor(hasAllClasses: boolean, hasComposite: boolean): { value: RankSortMode; label: string }[] {
  return RANK_OPTIONS.filter((o) => {
    if (o.value === "all_rank") return hasAllClasses;
    if (o.value === "composite") return hasComposite;
    return true;
  });
}

/** 说明当前排序口径，避免把跨班名次读成年级名次 */
export function sortCaption(mode: RankSortMode, groupByClass: boolean): string {
  switch (mode) {
    case "class_rank":
      return "按班内名次升序";
    case "all_rank":
      return "按班内名次升序并列展示（不同班的名次不是同一把尺，跨班比较请看综合分）";
    case "composite":
      return groupByClass ? "按班级分段，段内按学期综合分降序" : "按学期综合分降序（跨班直接比分）";
    case "student_no":
      return "按班级 + 学号";
  }
}

export function RankSortControl({
  mode,
  onMode,
  options,
  groupByClass,
  onGroupByClass,
  showGroupToggle,
}: {
  mode: RankSortMode;
  onMode: (m: RankSortMode) => void;
  options: { value: RankSortMode; label: string }[];
  groupByClass: boolean;
  onGroupByClass: (v: boolean) => void;
  showGroupToggle: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">排序</span>
      <div className="w-32 sm:w-40">
        <Select
          value={mode}
          onValueChange={(v) => onMode(v as RankSortMode)}
          options={options}
          ariaLabel="排序方式"
        />
      </div>
      {showGroupToggle ? (
        <Button variant="outline" size="sm" onClick={() => onGroupByClass(!groupByClass)} aria-pressed={groupByClass}>
          {groupByClass ? <ToggleRight className="size-4 text-primary" /> : <ToggleLeft className="size-4" />}
          {groupByClass ? "按班级分组" : "不分班级"}
        </Button>
      ) : null}
    </div>
  );
}
