import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";

export function StudentAvatar({
  name,
  src,
  size = 56,
  className,
  editable = false,
  onClick,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
  editable?: boolean;
  onClick?: () => void;
}) {
  const surname = name.trim().slice(0, 1) || "?";
  const style = { width: size, height: size };
  const inner = src ? (
    <img src={src} alt={`${name}证件照`} className="block size-full rounded-full object-cover" />
  ) : (
    <span
      className="flex size-full items-center justify-center rounded-full bg-primary/10 font-semibold text-primary"
      style={{ fontSize: Math.round(size * 0.38) }}
    >
      {surname}
    </span>
  );
  const base = "relative shrink-0 rounded-full ring-1 ring-border";
  if (editable) {
    return (
      <button
        type="button"
        aria-label={src ? "更换证件照" : "上传证件照"}
        onClick={onClick}
        className={cn(base, "group overflow-visible", className)}
        style={style}
      >
        {inner}
        <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border bg-muted text-muted-foreground shadow-sm group-hover:bg-accent group-hover:text-foreground">
          <Camera className="size-3" />
        </span>
      </button>
    );
  }
  return (
    <span className={cn(base, "inline-flex overflow-hidden", className)} style={style}>
      {inner}
    </span>
  );
}
