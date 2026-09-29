// Excel/CSV 解析、模板下载与 CSV 导出的共享工具。
// xlsx 仅在用户实际使用导入/模板功能时动态加载，避免拖慢首屏。

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  aliases?: string[];
  type?: "date";
}

export interface ParsedImport {
  rows: Record<string, string>[];
  missingColumns: string[];
  total: number;
}

async function loadXlsx() {
  const XLSX = await import("xlsx");
  return XLSX.default ?? XLSX;
}

// 将 "2026/6/18"、"2026.6.18"、Excel 日期序列号等归一化为 YYYY-MM-DD；失败返回 null。
export function normalizeDate(value: string): string | null {
  const s = value.trim();
  if (!s) return null;
  const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(s);
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    // Excel 1900 序列日期（合理范围 1990-2100）
    if (n > 30000 && n < 80000) {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      return d.toISOString().slice(0, 10);
    }
    return null;
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export async function parseSpreadsheet(
  file: File,
  columns: ImportColumn[]
): Promise<ParsedImport> {
  const XLSX = await loadXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], missingColumns: columns.map((c) => c.label), total: 0 };
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  if (matrix.length === 0) return { rows: [], missingColumns: columns.map((c) => c.label), total: 0 };

  const header = matrix[0].map(cellText);
  const keyToIndex = new Map<string, number>();
  const missingColumns: string[] = [];
  for (const col of columns) {
    const names = [col.label, ...(col.aliases ?? [])];
    const idx = header.findIndex((h) => names.includes(h));
    if (idx === -1) missingColumns.push(col.label);
    else keyToIndex.set(col.key, idx);
  }
  const rows: Record<string, string>[] = [];
  for (const line of matrix.slice(1)) {
    const values = (line as unknown[]).map(cellText);
    if (values.every((v) => v === "")) continue;
    const row: Record<string, string> = {};
    for (const [key, idx] of keyToIndex) row[key] = values[idx] ?? "";
    rows.push(row);
  }
  return { rows, missingColumns, total: rows.length };
}

// 客户端预校验：返回每行错误（无错误为 null），与后端规则保持一致的最小子集。
export function preValidateRows(
  rows: Record<string, string>[],
  columns: ImportColumn[],
  extra?: (row: Record<string, string>) => string | null
): (string | null)[] {
  return rows.map((row) => {
    for (const col of columns) {
      const value = row[col.key] ?? "";
      if (col.required && value === "") return `缺少${col.label}`;
      if (col.type === "date" && value !== "") {
        if (!normalizeDate(value)) return `${col.label}格式无法识别`;
      }
    }
    return extra ? extra(row) : null;
  });
}

export async function downloadTemplate(name: string, columns: { label: string; sample: string }[]) {
  const XLSX = await loadXlsx();
  const sheet = XLSX.utils.aoa_to_sheet([columns.map((c) => c.label), columns.map((c) => c.sample)]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "模板");
  const out = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  triggerDownload(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${name}.xlsx`);
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(filename: string, headers: string[], rows: unknown[][]) {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  // BOM 让 Excel 正确识别 UTF-8 中文
  triggerDownload(new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const STUDENT_COLUMNS: ImportColumn[] = [
  { key: "student_no", label: "学号", required: true },
  { key: "name", label: "姓名", required: true },
  { key: "gender", label: "性别", required: true, aliases: ["男女"] },
  { key: "class_name", label: "班级", aliases: ["行政班级"] },
  { key: "major", label: "专业" },
  { key: "grade", label: "年级", aliases: ["入学年份"] },
  { key: "phone", label: "电话", aliases: ["手机号", "联系电话"] },
  { key: "political_status", label: "政治面貌" },
  { key: "native_place", label: "籍贯" },
];

export const GRADE_COLUMNS: ImportColumn[] = [
  { key: "student_no", label: "学号", required: true },
  { key: "course_name", label: "课程名称", required: true, aliases: ["课程"] },
  { key: "term", label: "学期", aliases: ["学年学期"] },
  { key: "score", label: "考试成绩", required: true, aliases: ["分数", "成绩"] },
  { key: "exam_date", label: "考试日期", aliases: ["日期"], type: "date" },
];

export const TERM_EVAL_COLUMNS: ImportColumn[] = [
  { key: "student_no", label: "学号", required: true },
  { key: "term", label: "学期", required: true, aliases: ["学年学期"] },
  { key: "usual_score", label: "平时总评（0-100）", required: true, aliases: ["平时分", "总评"] },
  { key: "note", label: "备注" },
];

export const ATTENDANCE_COLUMNS: ImportColumn[] = [
  { key: "student_no", label: "学号", required: true },
  { key: "kind", label: "类型（迟到/旷课/请假/早退）", required: true, aliases: ["类型"] },
  { key: "occurred_on", label: "日期", required: true, aliases: ["考勤日期"], type: "date" },
  { key: "course_name", label: "课程名称", aliases: ["课程"] },
  { key: "term", label: "学期", aliases: ["学年学期"] },
  { key: "note", label: "备注" },
];
