import { useEffect, useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CHANGELOG_AUDIENCE_LABEL, type ChangelogItem } from "@/lib/types";

// 更新公告（批次 Z）：铃铛历史面板 + 未读自动弹窗一次。
// 已读水位=本用户见过的最新 created_at，按用户分键存 localStorage（同一浏览器多账号互不串）。
const SEEN_EVENT = "changelog-seen";
const seenKey = (memberId: string) => `changelog_seen_v1:${memberId}`;
const readSeen = (memberId: string) => {
  try {
    return localStorage.getItem(seenKey(memberId)) ?? "";
  } catch {
    return "";
  }
};

// 同一批公告全站只自动弹一次：侧栏与移动端顶栏各挂了一个实例，用模块级水位去重。
// 水位按用户分键：同一标签页内登出换号（不刷新）时，新用户仍应看到自己的首次弹窗
let autoPoppedFor = "";

function ChangelogRow({ item, showAudience }: { item: ChangelogItem; showAudience?: boolean }) {
  return (
    <div className="border-b border-border/60 py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.title}</span>
        {showAudience && item.audience !== "all" ? (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {CHANGELOG_AUDIENCE_LABEL[item.audience]}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{item.body}</p>
      <div className="mt-1.5 text-[11px] tabular-nums text-muted-foreground/70">{item.created_at.slice(0, 10)}</div>
    </div>
  );
}

export function ChangelogBell({ memberId, entries }: { memberId: string; entries: ChangelogItem[] }) {
  const [seen, setSeen] = useState(() => readSeen(memberId));
  const [panelOpen, setPanelOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    // 另一实例（如弹窗）标记已读后同步水位，避免本实例红点残留
    const onSeen = () => setSeen(readSeen(memberId));
    window.addEventListener(SEEN_EVENT, onSeen);
    return () => window.removeEventListener(SEEN_EVENT, onSeen);
  }, [memberId]);

  // 服务端已按 created_at 倒序返回，entries[0] 即最新
  const unseen = useMemo(() => entries.filter((e) => e.created_at > seen), [entries, seen]);
  const latest = entries[0]?.created_at ?? "";

  useEffect(() => {
    if (entries.length === 0 || unseen.length === 0) return;
    const mark = `${memberId}|${latest}`;
    if (autoPoppedFor === mark) return;
    autoPoppedFor = mark;
    setDialogOpen(true);
  }, [entries.length, unseen.length, latest, memberId]);

  const markSeen = () => {
    if (!latest || latest <= seen) return;
    try {
      localStorage.setItem(seenKey(memberId), latest);
    } catch {
      // 隐私模式存不下就只影响本页面，红点照常消失
    }
    setSeen(latest);
    window.dispatchEvent(new Event(SEEN_EVENT));
  };

  return (
    <>
      <Popover open={panelOpen} onOpenChange={(o) => { setPanelOpen(o); if (!o) markSeen(); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={unseen.length > 0 ? `更新公告（${unseen.length} 条未读）` : "更新公告"}
            className="relative flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Bell className="size-4" />
            {unseen.length > 0 ? (
              <span className="absolute right-1.5 top-1.5 flex size-2.5 items-center justify-center rounded-full bg-rose-500 ring-2 ring-background" />
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 px-3 py-1">
          <div className="border-b py-2.5 text-sm font-semibold">更新公告</div>
          {entries.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">暂无公告。</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {entries.map((e) => (
                <ChangelogRow key={e.id} item={e} showAudience />
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) markSeen(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>最近更新</DialogTitle>
            <DialogDescription>本次更新了以下内容，看过后不再提醒。</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {unseen.map((e) => (
              <ChangelogRow key={e.id} item={e} />
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => { markSeen(); setDialogOpen(false); }}>我知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
