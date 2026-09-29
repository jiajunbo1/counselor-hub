import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyHint, Select } from "@/components/form";
import type { Store } from "@/hooks/use-store";
import { ACTION_LABEL, type AuditLog } from "@/lib/types";

const ALL = "__all";

const GROUP_LABEL: Record<string, string> = {
  student: "学生",
  record: "记录",
  attachment: "附件",
  room: "宿舍",
  course: "课程",
  grade: "成绩",
  auth: "登录/个人",
  account: "账号管理",
};

function groupOf(action: string): string {
  return action.split(".")[0] ?? "";
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LogsView({ store }: { store: Store }) {
  const { logs } = store;
  const [group, setGroup] = useState(ALL);
  const [actor, setActor] = useState(ALL);

  const groupOptions = useMemo(() => {
    const set = new Set(logs.map((l) => groupOf(l.action)));
    return [{ value: ALL, label: "全部类型" }, ...[...set].sort().map((g) => ({ value: g, label: GROUP_LABEL[g] ?? g }))];
  }, [logs]);

  const actorOptions = useMemo(() => {
    const set = new Set(logs.map((l) => l.actor_name || l.actor_id));
    return [{ value: ALL, label: "全部操作人" }, ...[...set].sort().map((a) => ({ value: a, label: a }))];
  }, [logs]);

  const filtered = useMemo(
    () =>
      logs.filter(
        (l) => (group === ALL || groupOf(l.action) === group) && (actor === ALL || (l.actor_name || l.actor_id) === actor)
      ),
    [logs, group, actor]
  );

  const byActor = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of filtered) {
      const key = l.actor_name || l.actor_id || "未知";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">操作日志</h1>
        <p className="text-sm text-muted-foreground">仅可追加，无法编辑或删除。最近 {logs.length} 条。</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:w-56">
          <Select value={group} onValueChange={setGroup} options={groupOptions} />
        </div>
        <div className="sm:w-56">
          <Select value={actor} onValueChange={setActor} options={actorOptions} />
        </div>
      </div>

      {byActor.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">操作分布（当前筛选 {filtered.length} 条）</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 px-4 pb-4">
            {byActor.map(([name, count]) => (
              <Badge key={name} variant="secondary" className="font-normal">
                {name} · {count}
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyHint text={logs.length === 0 ? "暂无操作日志。" : "没有符合筛选条件的日志。"} />
      ) : (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {filtered.map((l: AuditLog) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">{timeLabel(l.created_at)}</span>
              <span className="w-20 shrink-0 truncate">{l.actor_name || "未知"}</span>
              <Badge variant="outline" className="shrink-0 font-normal">
                {ACTION_LABEL[l.action] ?? l.action}
              </Badge>
              {l.target ? <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{l.target}</span> : <span className="flex-1" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
