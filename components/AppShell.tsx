import { Fragment, lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  BedDouble,
  BookOpen,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  Crown,
  Ellipsis,
  GraduationCap,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Medal,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { AppearanceMenu, AppearancePanel } from "@/components/Appearance";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTheme } from "@/lib/theme";
import { useStore, type Store } from "@/hooks/use-store";
import { useAuth, type Auth } from "@/hooks/use-auth";
import { ALL_CLASS, ClassScopeProvider, useClassScope } from "@/hooks/use-class-scope";
import { Select } from "@/components/form";
import OverviewView from "@/components/views/Overview";
import StudentsView from "@/components/views/Students";
import DormsView from "@/components/views/Dorms";
import CoursesView from "@/components/views/Courses";
import GradesView from "@/components/views/Grades";
import PositionsView from "@/components/views/Positions";
import HonorsView from "@/components/views/Honors";
import RecordsView, { LeavesView } from "@/components/views/Records";
import MessagesView from "@/components/views/Messages";
import FeedbackView from "@/components/views/Feedback";
import StudentView, { StudentProfileView } from "@/components/views/Student";
import AdminView, { type AdminSection } from "@/components/views/Admin";
import MoreView from "@/components/views/More";
import LoginView from "@/components/views/Login";
import { ChangePasswordDialog } from "@/components/account-dialogs";
import { ROLE_LABEL } from "@/lib/types";

const TABS = [
  { id: "overview", label: "总览", icon: LayoutDashboard, group: "全局事务" },
  { id: "messages", label: "留言", icon: MessageSquareText, group: "全局事务" },
  { id: "feedback", label: "反馈", icon: Lightbulb, group: "全局事务", hideForAdmin: true },
  { id: "dorms", label: "宿舍", icon: BedDouble, group: "全局事务" },
  { id: "students", label: "学生", icon: Users, group: "班级工作区" },
  { id: "courses", label: "课程", icon: BookOpen, group: "班级工作区" },
  { id: "grades", label: "成绩", icon: GraduationCap, group: "班级工作区" },
  { id: "honors", label: "荣誉", icon: Medal, group: "班级工作区" },
  { id: "positions", label: "职务", icon: Crown, group: "班级工作区" },
  { id: "leaves", label: "请假", icon: CalendarDays, group: "班级工作区" },
  { id: "records", label: "记录", icon: ClipboardList, group: "班级工作区" },
  { id: "statistics", label: "统计", icon: ChartColumn, group: "系统" },
  { id: "admin", label: "后台", icon: ShieldCheck, group: "系统", adminOnly: true },
  { id: "more", label: "更多", icon: Ellipsis, group: "系统" },
] as const;

const STUDENT_TABS = [
  { id: "s_leave", label: "请假", icon: CalendarDays },
  { id: "s_attend", label: "考勤上报", icon: ClipboardCheck, requiresGrant: true },
  { id: "s_messages", label: "留言", icon: MessageSquareText },
  { id: "s_feedback", label: "反馈", icon: Lightbulb },
  { id: "s_profile", label: "我的", icon: UserRound },
] as const;

export type TabId = (typeof TABS)[number]["id"] | (typeof STUDENT_TABS)[number]["id"];

const StatisticsView = lazy(() => import("@/components/views/Statistics"));
const AttendReportView = lazy(() => import("@/components/views/AttendReport"));

export default function App() {
  const auth = useAuth();
  if (!auth.session) {
    return (
      <>
        <LoginView
          onLookup={auth.lookup}
          onLogin={auth.login}
          onBootstrap={auth.bootstrap}
          onStudentRegister={auth.studentRegister}
        />
        <Toaster position="top-center" richColors closeButton />
      </>
    );
  }
  return (
    <ClassScopeProvider>
      <Workspace auth={auth} />
    </ClassScopeProvider>
  );
}

function Workspace({ auth }: { auth: Auth }) {
  const session = auth.session;
  const member = session?.member;
  const isAdmin = member?.role === "admin";
  const isStudent = member?.role === "student";
  const store = useStore(isStudent ? "student" : isAdmin ? "admin" : "staff");
  const scope = useClassScope();
  const classOptions = useMemo(() => {
    const uniq = [...new Set(store.students.map((s) => s.class_name).filter((c): c is string => !!c))].sort();
    return [{ value: ALL_CLASS, label: "全部班级" }, ...uniq.map((c) => ({ value: c, label: c }))];
  }, [store.students]);
  useEffect(() => {
    // 记住的班级可能已被改名/无人（比如学生全部转出），回落「全部班级」避免整站空列表
    // 首屏还没加载到学生时不能判残，否则会误清掉 localStorage 里记住的班级
    if (store.loading || store.students.length === 0) return;
    if (scope.cls !== ALL_CLASS && !classOptions.some((o) => o.value === scope.cls)) scope.setCls(ALL_CLASS);
  }, [classOptions, scope, store.loading, store.students.length]);
  const [tab, setTab] = useState<TabId>(isStudent ? "s_leave" : "overview");
  const [adminSection, setAdminSection] = useState<AdminSection>("accounts");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);
  const studentClassById = useMemo(() => new Map(store.students.map((s) => [s.id, s.class_name])), [store.students]);
  const pendingCount = store.records.filter(
    (r) => r.type === "leave" && r.status === "pending" && (scope.cls === ALL_CLASS || studentClassById.get(r.student_id) === scope.cls)
  ).length;
  const openMsgCount = isStudent
    ? store.messages.filter((m) => m.replied === 1 && m.sender_role === "student").length
    : store.messages.filter((m) => m.replied !== 1).length;
  const canReportAttendNow = store.positions.some((p) => p.status === "active" && p.attend_report === true);
  useEffect(() => {
    // 权限被辅导员收回时，若正停留在上报页则退回请假页
    if (!canReportAttendNow) setTab((t) => (t === "s_attend" ? "s_leave" : t));
  }, [canReportAttendNow]);
  if (!member) return null;
  const tabSet = isStudent ? STUDENT_TABS : TABS;
  // 班委考勤上报入口：仅当本人持有「现任 + 开通考勤上报」的委任时出现，撤销职务即随之消失
  const canReportAttend = store.positions.some((p) => p.status === "active" && p.attend_report === true);
  const visibleTabs = tabSet.filter(
    (t) => !("adminOnly" in t && t.adminOnly && !isAdmin) && !("hideForAdmin" in t && t.hideForAdmin && isAdmin) &&
      !("requiresGrant" in t && t.requiresGrant && !canReportAttend)
  );
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const mobileCoreIds: string[] = isAdmin ? ["overview", "leaves", "students", "admin"] : ["overview", "leaves", "students"];
  const mobileCoreTabs = isStudent ? visibleTabs : visibleTabs.filter((t) => mobileCoreIds.includes(t.id));
  const mobileRestTabs = isStudent ? [] : visibleTabs.filter((t) => !mobileCoreIds.includes(t.id));

  if (member.must_change) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-sidebar px-4">
        <ChangePasswordDialog
          force
          onDone={(m) => {
            auth.updateMember(m);
            void store.refresh();
          }}
        />
        <Toaster position="top-center" richColors closeButton />
      </div>
    );
  }

  const renderView = () => {
    switch (tab) {
      case "s_leave":
        return isStudent ? (
          <StudentView
            store={store}
            member={member}
            onOpenMessages={() => setTab("s_messages")}
            onOpenProfile={() => setTab("s_profile")}
            onOpenMore={() => setTab("s_profile")}
          />
        ) : null;
      case "s_messages":
        return isStudent ? <MessagesView store={store} member={member} /> : null;
      case "s_attend":
        return isStudent ? (
          <Suspense fallback={<div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"><Spinner className="size-4" /> 正在加载…</div>}>
            <AttendReportView store={store} member={member} />
          </Suspense>
        ) : null;
      case "s_feedback":
      case "feedback":
        return <FeedbackView store={store} member={member} />;
      case "s_profile":
        return isStudent ? <StudentProfileView store={store} member={member} /> : null;
      case "overview":
        return <OverviewView store={store} onNavigate={setTab} />;
      case "students":
        return <StudentsView store={store} />;
      case "dorms":
        return <DormsView store={store} />;
      case "courses":
        return <CoursesView store={store} />;
      case "grades":
        return <GradesView store={store} />;
      case "positions":
        return <PositionsView store={store} />;
      case "honors":
        return <HonorsView store={store} />;
      case "records":
        return <RecordsView store={store} member={member} />;
      case "leaves":
        return <LeavesView store={store} member={member} />;
      case "messages":
        return <MessagesView store={store} member={member} />;
      case "statistics":
        return (
          <Suspense fallback={<div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground"><Spinner className="size-4" /> 正在加载图表…</div>}>
            <StatisticsView store={store} />
          </Suspense>
        );
      case "admin":
        return <AdminView store={store} currentMember={member} section={adminSection} onSection={setAdminSection} />;
      case "more":
        return <MoreView store={store} onNavigate={setTab} member={member} onLogout={() => void auth.logout()} onUpdateMember={(m) => auth.updateMember(m)} onOpenAdmin={(s) => { setAdminSection(s); setTab("admin"); }} />;
    }
  };

  const badge = (id: TabId) =>
    (id === "leaves" && pendingCount > 0) || (id === "messages" && !isStudent && openMsgCount > 0) ? (
      <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold leading-4 text-white tabular-nums">
        {id === "leaves" ? pendingCount : openMsgCount}
      </span>
    ) : id === "s_messages" && openMsgCount > 0 ? (
      <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold leading-4 text-white tabular-nums">
        {openMsgCount}
      </span>
    ) : null;

  const initial = member.display_name?.trim()?.slice(0, 1) || "?";

  return (
    <div className="min-h-dvh md:flex">
      <aside className="glass-surface sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r md:flex">
        <div className="flex items-center gap-2.5 px-5 py-6">
          <span
            className="flex size-9 items-center justify-center rounded-xl text-white"
            style={{ backgroundImage: "var(--grad-primary)", boxShadow: "var(--shadow-glow)" }}
          >
            <GraduationCap className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="text-gradient text-base font-extrabold tracking-tight">辅导员工作台</div>
            <div className="truncate text-[11px] text-muted-foreground">学生工作信息管理</div>
          </div>
        </div>
        {!isStudent ? (
          <div className="px-3 pb-1">
            <div className="px-1 pb-1 text-[11px] font-semibold tracking-widest text-muted-foreground/70">当前班级</div>
            <Select value={scope.cls} onValueChange={scope.setCls} options={classOptions} ariaLabel="班级作用域" />
          </div>
        ) : null}
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-2" aria-label="主导航">
          {visibleTabs.map((t, i) => {
            const active = tab === t.id;
            const prev = i > 0 ? visibleTabs[i - 1] : null;
            const heading =
              "group" in t && (!prev || !("group" in prev) || prev.group !== t.group) ? t.group : null;
            const Icon = t.icon;
            return (
              <Fragment key={t.id}>
                {heading ? (
                  <div
                    className={
                      "flex min-w-0 items-center gap-1.5 px-3 pb-0.5 pt-4 text-[11px] font-semibold tracking-widest " +
                      (heading === "班级工作区" && scope.cls !== ALL_CLASS ? "text-primary" : "text-muted-foreground/70")
                    }
                  >
                    <span className="shrink-0">{heading}</span>
                    {heading === "班级工作区" && scope.cls !== ALL_CLASS ? (
                      <span className="truncate font-normal tracking-normal opacity-80">· {scope.cls}</span>
                    ) : null}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={active ? "page" : undefined}
                  className={
                    "group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50 " +
                    (active ? "text-white" : "text-muted-foreground hover:bg-accent hover:text-foreground")
                  }
                  style={active ? { backgroundImage: "var(--grad-primary)", boxShadow: "var(--shadow-glow)" } : undefined}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{t.label}</span>
                  <span className="ml-auto shrink-0">{badge(t.id)}</span>
                </button>
              </Fragment>
            );
          })}
        </nav>
        <div className="border-t p-3">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundImage: "var(--grad-primary)" }}
                >
                  {initial}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{member.display_name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {ROLE_LABEL[member.role]} · {member.username}
                  </span>
                </span>
                <Sparkles className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72">
              <AppearancePanel />
              <div className="mt-4 flex gap-2 border-t pt-3">
                {!isStudent ? (
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setTab("more")}>
                    <UserRound className="size-4" /> 个人设置
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" className={isStudent ? "flex-1" : ""} onClick={() => void auth.logout()}>
                  <LogOut className="size-4" /> 退出
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-surface sticky top-0 z-20 flex items-center justify-between gap-3 border-b px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <span
              className="flex size-7 items-center justify-center rounded-lg text-white"
              style={{ backgroundImage: "var(--grad-primary)" }}
            >
              <GraduationCap className="size-4" />
            </span>
            <span className="text-sm font-bold">辅导员工作台</span>
          </div>
          {!isStudent ? (
            <div className="min-w-0 max-w-[10rem] flex-1">
              <Select value={scope.cls} onValueChange={scope.setCls} options={classOptions} ariaLabel="班级作用域" />
            </div>
          ) : null}
          <div className="flex items-center gap-0.5">
            <AppearanceMenu />
            <Button variant="ghost" size="icon" onClick={() => void store.refresh()} aria-label="刷新数据">
              <RefreshCw className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => void auth.logout()} aria-label="退出登录">
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-10 md:pt-8">
          {store.loading ? (
            <div role="status" className="space-y-4">
              <Skeleton className="h-8 w-40" />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-2xl" />
                ))}
              </div>
              <Skeleton className="h-48 rounded-2xl" />
            </div>
          ) : store.error ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <p className="text-sm text-destructive">{store.error}</p>
              <Button variant="outline" onClick={() => void store.refresh()}>
                <RefreshCw className="size-4" /> 重试
              </Button>
            </div>
          ) : (
            <div key={tab} className="view-anim">
              {renderView()}
            </div>
          )}
        </main>
        {mobileRestTabs.length > 0 ? (
          <Sheet open={moreNavOpen} onOpenChange={setMoreNavOpen}>
            <SheetContent side="bottom" className="rounded-t-2xl pb-6">
              <SheetHeader>
                <SheetTitle className="text-base">全部功能</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-2 px-4 pb-2">
                {mobileRestTabs.map((t) => {
                  const active = tab === t.id;
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setTab(t.id);
                        setMoreNavOpen(false);
                      }}
                      className={
                        "relative flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition-colors " +
                        (active
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-transparent bg-muted/60 text-muted-foreground")
                      }
                    >
                      <Icon className="size-5" />
                      {t.label}
                      {badge(t.id) ? (
                        <span className="absolute right-2.5 top-1.5 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold leading-4 text-white tabular-nums">
                          {t.id === "messages" ? openMsgCount : 0}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        ) : null}
        <nav
          className="glass-surface fixed inset-x-0 bottom-0 z-20 grid border-t pb-[env(safe-area-inset-bottom)] md:hidden"
          style={{ gridTemplateColumns: `repeat(${mobileCoreTabs.length + (mobileRestTabs.length > 0 ? 1 : 0)}, minmax(0, 1fr))` }}
          aria-label="主导航"
        >
          {mobileCoreTabs.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={active ? "page" : undefined}
                className="relative flex flex-col items-center gap-1 py-2 text-[10px]"
              >
                <span
                  className={
                    "relative flex h-8 w-12 items-center justify-center rounded-full transition-all " +
                    (active ? "text-white" : "text-muted-foreground")
                  }
                  style={active ? { backgroundImage: "var(--grad-primary)", boxShadow: "var(--shadow-glow)" } : undefined}
                >
                  <Icon className="size-5" />
                  {badge(id) ? (
                    <span className="absolute right-1 top-0 rounded-full bg-destructive px-1 text-[9px] font-semibold leading-3.5 text-white">
                      {id === "leaves" ? pendingCount : openMsgCount}
                    </span>
                  ) : null}
                </span>
                <span className={active ? "font-semibold text-foreground" : ""}>{label}</span>
              </button>
            );
          })}
          {mobileRestTabs.length > 0 ? (
            <button
              type="button"
              onClick={() => setMoreNavOpen(true)}
              aria-current={mobileRestTabs.some((t) => t.id === tab) ? "page" : undefined}
              className="relative flex flex-col items-center gap-1 py-2 text-[10px]"
            >
              <span
                className={
                  "relative flex h-8 w-12 items-center justify-center rounded-full transition-all " +
                  (mobileRestTabs.some((t) => t.id === tab) ? "text-white" : "text-muted-foreground")
                }
                style={mobileRestTabs.some((t) => t.id === tab) ? { backgroundImage: "var(--grad-primary)", boxShadow: "var(--shadow-glow)" } : undefined}
              >
                <Ellipsis className="size-5" />
                {mobileRestTabs.some((t) => t.id === "messages") && openMsgCount > 0 ? (
                  <span className="absolute right-1 top-0 rounded-full bg-destructive px-1 text-[9px] font-semibold leading-3.5 text-white">
                    {openMsgCount}
                  </span>
                ) : null}
              </span>
              <span className={mobileRestTabs.some((t) => t.id === tab) ? "font-semibold text-foreground" : ""}>更多</span>
            </button>
          ) : null}
        </nav>
      </div>
      <Toaster position="top-center" richColors closeButton />
    </div>
  );
}

export type { Store };
