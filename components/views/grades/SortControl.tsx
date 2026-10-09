import { Select } from "@/components/form";
import type { RankSortMode } from "@/lib/rank-view";

/** 四个按班分节屏（考勤台账/报表矩阵/综合测评/成绩单）共用：分节后「不分班」与分组开关失去意义 */
export const SECTION_SORT_OPTIONS: { value: RankSortMode; label: string }[] = [
  { value: "class_rank", label: "名次（班内）" },
  { value: "composite", label: "学期综合分" },
  { value: "student_no", label: "学号" },
];

/** 说明当前排序口径（分节表格里名次恒为班内口径） */
export function sortCaption(mode: RankSortMode): string {
  switch (mode) {
    case "class_rank":
      return "按班内名次升序";
    case "all_rank":
      return "按班内名次升序并列展示（不同班的名次不是同一把尺，跨班比较请看综合分）";
    case "composite":
      return "按班级分段，段内按学期综合分降序";
    case "student_no":
      return "按班级 + 学号";
  }
}

export function RankSortControl({
  mode,
  onMode,
  options,
}: {
  mode: RankSortMode;
  onMode: (m: RankSortMode) => void;
  options: { value: RankSortMode; label: string }[];
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
    </div>
  );
}
