import { useState, type ReactNode } from "react";
import { format, isBefore, isValid, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select as RadixSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export function FormField({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5", className)}>
      <Label className="text-xs text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}

// Radix Select 禁止空字符串作为选项值，用哨兵把 "" 映射进去再映射回来
const NONE_VALUE = "__none__";

export function Select({
  value,
  onValueChange,
  options,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const encode = (v: string) => (v === "" ? NONE_VALUE : v);
  return (
    <RadixSelect value={encode(value)} onValueChange={(v) => onValueChange(v === NONE_VALUE ? "" : v)}>
      <SelectTrigger
        // ui/select 的 *:data-[slot=select-value]:flex 会让长文本硬切无省略号，这里强制回退为可截断的块级
        className={cn(
          "w-full min-w-0 text-left [&>[data-slot=select-value]]:!inline-block [&>[data-slot=select-value]]:!truncate",
          className
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {options.map((o) => (
          <SelectItem key={o.value} value={encode(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </RadixSelect>
  );
}

function normalizeDate(raw: string): string | null {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (m) {
    const [, y, mo, d] = m;
    const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    const dt = parseISO(iso);
    if (!isValid(dt) || dt.getFullYear() !== Number(y) || dt.getMonth() !== Number(mo) - 1 || dt.getDate() !== Number(d)) return null;
    return iso;
  }
  const dt = parseISO(raw);
  return isValid(dt) ? format(dt, "yyyy-MM-dd") : null;
}

export function DateInput({
  value,
  onChange,
  min,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);

  if (isMobile) {
    return <Input type="date" className={className} value={value} min={min} onChange={(e) => onChange(e.target.value)} />;
  }

  const selected = value ? parseISO(value) : undefined;
  const commit = () => {
    if (typed === null) return;
    const t = typed.trim();
    setTyped(null);
    if (t === "") {
      onChange("");
      return;
    }
    const iso = normalizeDate(t);
    if (!iso) return;
    if (min && isBefore(parseISO(iso), parseISO(min))) return;
    onChange(iso);
  };

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn("relative", className)}>
          <Input
            className="w-full pr-9"
            inputMode="numeric"
            autoComplete="off"
            placeholder="YYYY-MM-DD"
            value={typed ?? value}
            onFocus={() => setOpen(true)}
            onChange={(e) => setTyped(e.target.value.replace(/[^\d\-/]/g, ""))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="选择日期"
            onClick={() => setOpen((o) => !o)}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <CalendarIcon className="size-4" />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent className="w-auto p-0" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <Calendar
          mode="single"
          selected={selected !== undefined && isValid(selected) ? selected : undefined}
          defaultMonth={selected !== undefined && isValid(selected) ? selected : min && isValid(parseISO(min)) ? parseISO(min) : new Date()}
          disabled={min ? (d) => isBefore(d, parseISO(min)) : undefined}
          onSelect={(d) => {
            if (!d) return;
            onChange(format(d, "yyyy-MM-dd"));
            setTyped(null);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
      <div
        className="flex size-12 items-center justify-center rounded-2xl text-primary"
        style={{ backgroundImage: "var(--grad-primary)", boxShadow: "var(--shadow-glow)" }}
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-6 text-white" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 7a2 2 0 0 1 2-2h5l2 2h4a2 2 0 0 1 2 2v1" />
          <path d="M4 9v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
          <path d="M9 14h6" />
        </svg>
      </div>
      <p className="max-w-xs text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
