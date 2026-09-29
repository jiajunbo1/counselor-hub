import { useCallback, useEffect, useState } from "react";
import { KeyRound, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyHint, FormField, Select } from "@/components/form";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { ROLE_LABEL, type Account, type MemberRole } from "@/lib/types";
import type { MemberUser } from "@/lib/session";

function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : "操作失败，请稍后重试。";
}

function CreateAccountDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<MemberRole>("counselor");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username.trim())) {
      toast.error("用户名需为 3-32 位字母、数字或 . _ -。");
      return;
    }
    if (!displayName.trim()) {
      toast.error("请填写姓名。");
      return;
    }
    if (password.length < 6 || password.length > 72) {
      toast.error("初始密码长度应为 6-72 位。");
      return;
    }
    setBusy(true);
    try {
      await apiPost("account.create", {
        username: username.trim(),
        display_name: displayName.trim(),
        role,
        password,
      });
      toast.success("账号已开通，请将用户名与初始密码告知对方（首次登录须改密）。");
      await onCreated();
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>开通账号</DialogTitle>
          <DialogDescription>初始密码由您设定，对方首次登录时必须修改。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="登录用户名" required>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} autoComplete="off" placeholder="如：teacher01" />
          </FormField>
          <FormField label="姓名" required>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />
          </FormField>
          <FormField label="角色" required>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as MemberRole)}
              options={[
                { value: "counselor", label: `${ROLE_LABEL.counselor}（维护业务数据）` },
                { value: "admin", label: `${ROLE_LABEL.admin}（含账号管理）` },
              ]}
            />
          </FormField>
          <FormField label="初始密码" required>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={72} autoComplete="new-password" />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "开通中…" : "开通账号"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ account, onClose, onDone }: { account: Account; onClose: () => void; onDone: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password.length < 6 || password.length > 72) {
      toast.error("新密码长度应为 6-72 位。");
      return;
    }
    setBusy(true);
    try {
      await apiPost("account.reset_password", { id: account.id, password });
      toast.success(`已重置「${account.display_name}」的密码，对方下次登录须修改。`);
      await onDone();
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重置密码：{account.display_name}</DialogTitle>
          <DialogDescription>设置新密码后，该账号现有登录会立即失效，且下次登录必须先修改密码。</DialogDescription>
        </DialogHeader>
        <FormField label="新密码" required>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={72} autoComplete="new-password" />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "提交中…" : "确认重置"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AccountsView({ currentMember }: { currentMember: MemberUser }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<Account | null>(null);
  const [statusTarget, setStatusTarget] = useState<Account | null>(null);
  const [roleTarget, setRoleTarget] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setAccounts(await apiGet<Account>("account.list"));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (action: string, payload: Record<string, unknown>, successMsg: string) => {
      setBusy(true);
      try {
        await apiPost(action, payload);
        toast.success(successMsg);
        await load();
      } catch (e) {
        toast.error(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  if (error) {
    return (
      <section className="space-y-4">
        <h1 className="text-lg font-bold">账号管理</h1>
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => void load()} disabled={accounts === null}>
          {accounts === null ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} 重试
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">账号管理</h1>
          <p className="text-sm text-muted-foreground">仅管理员可见。</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> <span className="hidden sm:inline">开通账号</span><span className="sm:hidden">开通</span>
        </Button>
      </div>

      {accounts === null ? (
        <div role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> 正在加载账号…
        </div>
      ) : accounts.length === 0 ? (
        <EmptyHint text="暂无账号。" />
      ) : (
        <ul className="space-y-2">
          {accounts.map((a) => (
            <li key={a.id}>
              <Card className="gap-0 py-3">
                <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4">
                  <span className="w-24 shrink-0 font-semibold">{a.display_name}</span>
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{a.username}</span>
                  <Badge variant={a.role === "admin" ? "default" : "secondary"}>{ROLE_LABEL[a.role]}</Badge>
                  <Badge variant={a.status === "active" ? "outline" : "destructive"} className="font-normal">
                    {a.status === "active" ? "启用中" : "已停用"}
                  </Badge>
                  {a.phone ? <span className="text-xs text-muted-foreground tabular-nums">{a.phone}</span> : null}
                  {a.must_change ? <Badge variant="outline" className="border-transparent font-normal pill-warning">未改初始密码</Badge> : null}
                  <span className="min-w-0 flex-1" />
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setResetting(a)}>
                    <KeyRound className="size-3.5" /> 重置密码
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRoleTarget(a)}>
                    改角色
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || a.id === currentMember.id}
                    title={a.id === currentMember.id ? "不能停用自己" : undefined}
                    className={a.status === "active" ? "text-destructive" : "text-[color:var(--success-fg)]"}
                    onClick={() => setStatusTarget(a)}
                  >
                    {a.status === "active" ? "停用" : "启用"}
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {creating ? <CreateAccountDialog onClose={() => setCreating(false)} onCreated={load} /> : null}
      {resetting ? <ResetPasswordDialog account={resetting} onClose={() => setResetting(null)} onDone={load} /> : null}

      <AlertDialog open={statusTarget !== null} onOpenChange={(open) => !open && setStatusTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusTarget?.status === "active"
                ? `停用「${statusTarget?.display_name}」的账号？`
                : `重新启用「${statusTarget?.display_name}」的账号？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {statusTarget?.status === "active"
                ? "停用后该账号立即退出所有设备且无法登录，数据保留，可随时重新启用。"
                : "启用后该账号可再次登录。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={statusTarget?.status === "active" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
              onClick={() => {
                if (!statusTarget) return;
                void act(
                  "account.update",
                  { id: statusTarget.id, status: statusTarget.status === "active" ? "disabled" : "active" },
                  statusTarget.status === "active" ? "账号已停用" : "账号已启用"
                );
                setStatusTarget(null);
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={roleTarget !== null} onOpenChange={(open) => !open && setRoleTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>调整「{roleTarget?.display_name}」的角色</AlertDialogTitle>
            <AlertDialogDescription>调整后即时生效。</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2">
            <Button
              variant={roleTarget?.role === "counselor" ? "secondary" : "outline"}
              disabled={busy}
              onClick={() => {
                if (!roleTarget) return;
                void act("account.update", { id: roleTarget.id, role: "counselor" }, "角色已调整为辅导员");
                setRoleTarget(null);
              }}
            >
              {ROLE_LABEL.counselor}
            </Button>
            <Button
              variant={roleTarget?.role === "admin" ? "secondary" : "outline"}
              disabled={busy}
              onClick={() => {
                if (!roleTarget) return;
                void act("account.update", { id: roleTarget.id, role: "admin" }, "角色已调整为管理员");
                setRoleTarget(null);
              }}
            >
              {ROLE_LABEL.admin}
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
