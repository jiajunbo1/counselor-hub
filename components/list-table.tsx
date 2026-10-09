import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

// 列表表格的统一外壳：卡片边框在外层、滚动口在内层。
// 分两层是必须的：渐隐遮罩（scroll-fade-e）会把它所在元素的最后一条边一起淡掉，
// 边框若和滚动口同层，右侧框线就会跟着变透明。
export function TableShell({
  children,
  className,
  maxHeight,
}: {
  children: ReactNode;
  className?: string;
  /** 覆盖默认 68dvh 的滚动高度，例如 "40dvh" */
  maxHeight?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-card shadow-xs", className)}>
      <div
        className="list-scroll scroll-fade-e"
        style={maxHeight ? ({ "--list-max-h": maxHeight } as CSSProperties) : undefined}
      >
        {children}
      </div>
    </div>
  );
}

export function THead({ children, className }: { children: ReactNode; className?: string }) {
  return <thead className={cn("border-b bg-muted/40", className)}>{children}</thead>;
}

export function Th({
  children,
  align = "left",
  className,
}: {
  children?: ReactNode;
  align?: "left" | "center" | "right";
  className?: string;
}) {
  return (
    <th
      className={cn(
        "h-9 px-3 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground",
        align === "center" && "text-center",
        align === "right" && "text-right",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  numeric,
  muted,
  className,
}: {
  children?: ReactNode;
  align?: "left" | "center" | "right";
  /** 数字列：等宽 + 右对齐，避免 1/8 宽度差造成列抖动 */
  numeric?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2 align-middle text-sm whitespace-nowrap",
        numeric && "num text-right",
        align === "center" && !numeric && "text-center",
        align === "right" && "text-right",
        muted && "text-muted-foreground",
        className
      )}
    >
      {children}
    </td>
  );
}

export function TRow({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr
      className={cn("border-t transition-colors", onClick && "row-interactive cursor-pointer", className)}
      onClick={onClick}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {children}
    </tr>
  );
}
