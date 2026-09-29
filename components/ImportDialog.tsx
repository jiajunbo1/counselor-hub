import { useRef, useState } from "react";
import { Download, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, apiPost } from "@/lib/api";
import {
  downloadTemplate,
  parseSpreadsheet,
  preValidateRows,
  type ImportColumn,
} from "@/lib/import-export";

export interface ImportDialogProps {
  title: string;
  description: string;
  columns: ImportColumn[];
  action: string;
  chunkSize: number;
  template: { name: string; samples: string[] };
  buildRow: (row: Record<string, string>) => Record<string, unknown>;
  extraValidate?: (row: Record<string, string>) => string | null;
  onClose: () => void;
  onDone: (created: number, skipped: number) => void;
}

export default function ImportDialog(props: ImportDialogProps) {
  const { title, description, columns, action, chunkSize, template, buildRow, extraValidate, onClose, onDone } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [errors, setErrors] = useState<(string | null)[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const validRows = rows.filter((_, i) => !errors[i]);

  const handleFile = async (file: File) => {
    setParsing(true);
    setFileName(file.name);
    try {
      const parsed = await parseSpreadsheet(file, columns);
      setMissing(parsed.missingColumns);
      setRows(parsed.rows);
      setErrors(preValidateRows(parsed.rows, columns, extraValidate));
      if (parsed.rows.length === 0) toast.error("未读取到数据行，请检查首行是否为表头。");
    } catch {
      toast.error("文件解析失败，请使用 Excel(.xlsx/.xls) 或 CSV 文件。");
      setFileName("");
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    if (validRows.length === 0) return;
    setSubmitting(true);
    let created = 0;
    let skipped = rows.length - validRows.length;
    try {
      for (let i = 0; i < validRows.length; i += chunkSize) {
        const chunk = validRows.slice(i, i + chunkSize).map(buildRow);
        const res = await apiPost(action, { rows: chunk });
        created += typeof res.created === "number" ? res.created : 0;
        if (Array.isArray(res.skipped)) skipped += res.skipped.length;
        setProgress({ done: Math.min(i + chunkSize, validRows.length), total: validRows.length });
      }
      onDone(created, skipped);
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "导入失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFile(file);
            }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={parsing || submitting}>
            {parsing ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            选择 Excel / CSV 文件
          </Button>
          <Button
            variant="ghost"
            className="text-muted-foreground"
            disabled={submitting}
            onClick={() =>
              void downloadTemplate(
                template.name,
                columns.map((c, i) => ({ label: c.label, sample: template.samples[i] ?? "" }))
              )
            }
          >
            <Download className="size-4" /> 下载模板
          </Button>
          {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
        </div>

        {missing.length > 0 ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
            缺少必需列：{missing.join("、")}。请使用模板或在首行补充对应表头。
          </p>
        ) : null}

        {rows.length > 0 ? (
          <>
            <p className="text-xs text-muted-foreground">
              共 {rows.length} 行，可导入 {validRows.length} 行
              {rows.length - validRows.length > 0 ? `，${rows.length - validRows.length} 行将被跳过` : ""}。预览前 20 行：
            </p>
            <div className="max-h-64 overflow-auto rounded-lg border">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted/70">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">#</th>
                    {columns.map((c) => (
                      <th key={c.key} className="whitespace-nowrap px-2 py-1.5 font-medium">{c.label}</th>
                    ))}
                    <th className="px-2 py-1.5 font-medium">校验</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((row, i) => (
                    <tr key={i} className={errors[i] ? "bg-rose-50/60 text-rose-700" : "border-t"}>
                      <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                      {columns.map((c) => (
                        <td key={c.key} className="whitespace-nowrap px-2 py-1.5">{row[c.key] || "—"}</td>
                      ))}
                      <td className="px-2 py-1.5">{errors[i] ?? "OK"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {progress ? (
          <p className="text-xs text-muted-foreground">
            正在导入 {progress.done}/{progress.total}…请勿关闭页面。
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>取消</Button>
          <Button onClick={() => void submit()} disabled={parsing || submitting || validRows.length === 0}>
            {submitting ? "导入中…" : `导入 ${validRows.length} 条`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
