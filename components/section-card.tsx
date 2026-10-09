import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// 全站统一的区块容器：原先同一层级的卡片有 4 种内边距写法、卡头高度也不一致，
// 视觉上就是「每页都不太一样」。间距与圆角一律走 globals.css 的令牌。
export function SectionCard({
  title,
  subtitle,
  icon,
  count,
  action,
  padded = true,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  count?: number | string;
  action?: ReactNode;
  padded?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  const hasHeader = title !== undefined || action !== undefined || count !== undefined;
  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card shadow-xs", className)}>
      {hasHeader ? (
        <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b bg-muted/40 px-4 py-2.5">
          {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
          <div className="min-w-0 flex-1">
            {title ? <h2 className="truncate text-base font-semibold leading-6">{title}</h2> : null}
            {subtitle ? <p className="truncate text-xs leading-5 text-muted-foreground">{subtitle}</p> : null}
          </div>
          {count !== undefined ? (
            <Badge variant="outline" className="num shrink-0 font-normal tabular-nums">
              {count}
            </Badge>
          ) : null}
          {action ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{action}</div> : null}
        </header>
      ) : null}
      <div className={cn(padded && "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
