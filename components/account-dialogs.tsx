import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { ApiError, apiPost } from "@/lib/api";
import { FormField } from "@/components/form";
import type { MemberUser } from "@/lib/session";

export function ChangePasswordDialog({
  force = false,
  onDone,
  onClose,
}: {
  force?: boolean;
  onDone: (member: MemberUser) => void;
  onClose?: () => void;
}) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if ((!force && !oldPw) || !newPw) {
      setError(force ? "请填写新密码。" : "请填写原密码与新密码。");
      return;
    }
    if (newPw.length < 6 || newPw.length > 72) {
      setError("新密码长度应为 6-72 位。");
      return;
    }
    if (newPw !== confirm) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setBusy(true);
    try {
      const body = await apiPost("auth.change_password", force ? { new_password: newPw } : { old_password: oldPw, new_password: newPw });
      const member = body.member as MemberUser | undefined;
      toast.success("密码已修改。");
      if (member) onDone({ ...member, must_change: false });
      else onClose?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "修改失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !force && onClose?.()}>
      <DialogContent showCloseButton={!force}>
        <DialogHeader>
          <DialogTitle>{force ? "首次登录：请修改初始密码" : "修改密码"}</DialogTitle>
          <DialogDescription>
            {force
              ? "首次登录，请设置新密码。"
              : "修改后当前登录仍然有效，其他设备需重新登录。"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {force ? null : (
            <FormField label="原密码" required>
              <Input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} maxLength={72} autoComplete="current-password" />
            </FormField>
          )}
          <FormField label="新密码" required>
            <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} maxLength={72} autoComplete="new-password" autoFocus={force} />
          </FormField>
          <FormField label="确认新密码" required>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={72} autoComplete="new-password" />
          </FormField>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          {force ? null : (
            <Button variant="outline" onClick={() => onClose?.()} disabled={busy}>取消</Button>
          )}
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "提交中…" : "确认修改"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BindPhoneDialog({
  member,
  onDone,
  onClose,
}: {
  member: MemberUser;
  onDone: (member: MemberUser) => void;
  onClose: () => void;
}) {
  const [phone, setPhone] = useState(member.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    const trimmed = phone.trim();
    if (trimmed && !/^\d{5,20}$/.test(trimmed)) {
      setError("手机号请填写 5-20 位数字。");
      return;
    }
    setBusy(true);
    try {
      const body = await apiPost("auth.bind_phone", { phone: trimmed });
      const updated = body.member as MemberUser | undefined;
      toast.success("手机号已更新。");
      if (updated) onDone(updated);
      else onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "保存失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>绑定手机号</DialogTitle>
          <DialogDescription>用于紧急联络登记，仅保存在本系统内。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="手机号">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} inputMode="tel" placeholder="如：13800001234" />
          </FormField>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "保存中…" : "保存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
