import { useEffect, useState } from "react";
import { ArrowLeft, GraduationCap, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/form";
import { AppearanceMenu } from "@/components/Appearance";
import { apiGetRaw } from "@/lib/api";
import type { LookupResult } from "@/hooks/use-auth";

interface LoginViewProps {
  onLookup: (username: string) => Promise<LookupResult | null>;
  onLogin: (username: string, password: string) => Promise<boolean>;
  onBootstrap: (username: string, displayName: string, password: string) => Promise<boolean>;
  onStudentRegister: (studentNo: string, name: string) => Promise<boolean>;
}

export default function LoginView({ onLookup, onLogin, onBootstrap, onStudentRegister }: LoginViewProps) {
  const [mode, setMode] = useState<"login" | "bootstrap" | "register">("login");
  const [step, setStep] = useState<"id" | "password">("id");
  const [kind, setKind] = useState<"staff" | "student">("staff");
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(true);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await apiGetRaw("auth_status");
        if (cancelled) return;
        setRegisterOpen(s.student_register_open !== false);
        if (s.need_bootstrap === true && s.qoder_logged_in === true) setMode("bootstrap");
      } catch {
        // 状态不可得时保持普通登录页
      } finally {
        if (!cancelled) setStatusLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!registerOpen && mode === "register") {
      setMode("login");
      setStep("id");
      setError("");
    }
  }, [registerOpen, mode]);

  const isBootstrap = mode === "bootstrap";
  const isRegister = mode === "register";
  const isPasswordStep = mode === "login" && step === "password";

  const goRegister = () => {
    setError("");
    setMode("register");
  };

  const backToIdStep = () => {
    setStep("id");
    setPassword("");
    setError("");
  };

  const submit = async () => {
    setError("");
    if (isRegister) {
      if (!username.trim() || !displayName.trim()) {
        setError("请填写学号和姓名。");
        return;
      }
      setBusy(true);
      const ok = await onStudentRegister(username.trim(), displayName.trim());
      setBusy(false);
      if (ok) {
        setMode("login");
        setStep("id");
        setPassword("");
        setError("");
      }
      return;
    }
    if (!username.trim() || (step === "password" && !password)) {
      setError(step === "password" ? "请输入密码。" : "请输入用户名或学号。");
      return;
    }
    if (isBootstrap) {
      if (!displayName.trim()) {
        setError("请填写显示姓名。");
        return;
      }
      if (password.length < 6) {
        setError("密码至少 6 位。");
        return;
      }
      if (password !== confirm) {
        setError("两次输入的密码不一致。");
        return;
      }
    }
    setBusy(true);
    if (isBootstrap) {
      const ok = await onBootstrap(username.trim(), displayName.trim(), password);
      setBusy(false);
      return ok;
    }
    if (step === "id") {
      const result = await onLookup(username.trim());
      setBusy(false);
      if (!result) return;
      if (result.found === false) {
        setError(`未找到账号「${username.trim()}」。同学可点击下方「学生注册」开通；教职工请联系管理员创建。`);
        return;
      }
      setKind(result.kind);
      setStep("password");
      return;
    }
    const ok = await onLogin(username.trim(), password);
    setBusy(false);
    if (!ok) setError("");
  };

  const accountLabel = isRegister || kind === "student" ? "学号" : "用户名";

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full opacity-60 blur-3xl" style={{ backgroundImage: "radial-gradient(circle at 30% 30%, var(--brand-1), transparent 70%)" }} />
      <div aria-hidden className="pointer-events-none absolute -bottom-28 -right-20 size-80 rounded-full opacity-50 blur-3xl" style={{ backgroundImage: "radial-gradient(circle at 60% 40%, var(--brand-3), transparent 70%)" }} />
      <div className="absolute right-3 top-3">
        <AppearanceMenu />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span
            className="mb-3 flex size-14 items-center justify-center rounded-xl text-white"
            style={{ backgroundImage: "var(--grad-primary)", boxShadow: "var(--shadow-glow)" }}
          >
            <GraduationCap className="size-7" />
          </span>
          <div className="text-gradient text-2xl font-extrabold tracking-tight">辅导员学生工作平台</div>
        </div>
        <Card className="gap-0 rounded-xl py-5">
          <CardHeader className="px-5 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {isBootstrap ? <ShieldCheck className="size-4" /> : isRegister ? <UserPlus className="size-4" /> : <LogIn className="size-4" />}
              {isBootstrap
                ? "初始化管理员账号"
                : isRegister
                  ? "学生注册"
                  : isPasswordStep
                    ? kind === "student"
                      ? "学生登录"
                      : "教职工登录"
                    : "登录"}
            </CardTitle>
            {isBootstrap || isRegister || isPasswordStep ? (
              <CardDescription>
                {isBootstrap
                  ? "系统尚未创建账号。当前检测到站点所有者登录，可创建首个管理员（此后本页面不再出现）。"
                  : isRegister
                    ? "使用辅导员已登记的学号注册；姓名需与档案一致。注册成功后系统分配初始密码 123456，首次登录须修改。"
                    : "忘记密码请联系管理员重置。"}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3 px-5">
            {isPasswordStep ? (
              <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <span className="truncate">
                  <span className="text-muted-foreground">{accountLabel}：</span>
                  <span className="font-medium">{username}</span>
                </span>
                <button type="button" className="flex shrink-0 items-center gap-1 text-xs text-primary" onClick={backToIdStep}>
                  <ArrowLeft className="size-3" />
                  更换账号
                </button>
              </div>
            ) : (
              <FormField label={isRegister ? "学号" : isBootstrap ? "管理员用户名" : "用户名或学号"} required>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  maxLength={32}
                  placeholder={isRegister ? "与档案一致的学号" : mode === "login" ? "教职工用户名 / 学号" : "字母、数字、._-，3-32 位"}
                  onKeyDown={(e) => e.key === "Enter" && !busy && void submit()}
                />
              </FormField>
            )}
            {isBootstrap || isRegister ? (
              <FormField label={isRegister ? "姓名（与档案一致）" : "姓名（显示名）"} required>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />
              </FormField>
            ) : null}
            {isPasswordStep || isBootstrap ? (
              <FormField label="密码" required>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isBootstrap ? "new-password" : "current-password"}
                  maxLength={72}
                  autoFocus={!isRegister}
                  onKeyDown={(e) => e.key === "Enter" && !busy && void submit()}
                />
              </FormField>
            ) : null}
            {isBootstrap ? (
              <FormField label="确认密码" required>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  maxLength={72}
                />
              </FormField>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" disabled={busy || !statusLoaded} onClick={() => void submit()}>
              {busy
                ? "处理中…"
                : isBootstrap
                  ? "创建并进入系统"
                  : isRegister
                    ? "注册并返回登录"
                    : step === "id"
                      ? "下一步"
                      : "登录"}
            </Button>
            {isBootstrap ? null : (
              <div className="flex items-center justify-between text-xs">
                {isRegister ? (
                  <button type="button" className="text-primary" onClick={() => { setError(""); setMode("login"); setStep("id"); }}>
                    返回登录
                  </button>
                ) : registerOpen ? (
                  <button type="button" className="text-primary" onClick={goRegister}>
                    学生注册（用学号）
                  </button>
                ) : (
                  <span className="text-muted-foreground">学生注册通道当前未开放，集中注册开放时再来注册</span>
                )}
                {isRegister ? <span className="text-muted-foreground">已注册过？直接学号登录</span> : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
