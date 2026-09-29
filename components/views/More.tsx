import { Download, FileSpreadsheet, History, KeyRound, LogOut, Phone, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import ImportDialog from "@/components/ImportDialog";
import { useEffect, useMemo, useState } from "react";
import { apiGetRaw, apiPost, ApiError } from "@/lib/api";
import type { Store } from "@/hooks/use-store";
import type { TabId } from "@/components/AppShell";
import type { AdminSection } from "@/components/views/Admin";
import { exportCsv, GRADE_COLUMNS, normalizeDate, STUDENT_COLUMNS } from "@/lib/import-export";
import { dedupeAttendance } from "@/lib/evaluation";
import { ACTION_LABEL, ATTEND_KIND_LABEL, POLITICAL_OPTIONS, RECORD_STATUS_LABEL, RECORD_TYPE_LABEL, ROLE_LABEL, studentName } from "@/lib/types";
import { BindPhoneDialog, ChangePasswordDialog } from "@/components/account-dialogs";
import type { MemberUser } from "@/lib/session";

const PASS_SCORE = 60;

export default function MoreView({
  store,
  onNavigate,
  member,
  onLogout,
  onUpdateMember,
  onOpenAdmin,
}: {
  store: Store;
  onNavigate: (tab: TabId) => void;
  member: MemberUser;
  onLogout: () => void;
  onUpdateMember: (member: MemberUser) => void;
  onOpenAdmin: (section: AdminSection) => void;
}) {
  const [templateKind, setTemplateKind] = useState<"student" | "grade" | null>(null);
  const [changingPw, setChangingPw] = useState(false);
  const [bindingPhone, setBindingPhone] = useState(false);
  const [regOpen, setRegOpen] = useState<boolean | null>(null);
  const [regSaving, setRegSaving] = useState(false);
  const stamp = () => new Date().toISOString().slice(0, 10);
  const failCount = store.grades.filter((g) => Number(g.score) < PASS_SCORE).length;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await apiGetRaw("registration_settings");
        const open = (s.data as { open?: boolean } | undefined)?.open;
        if (!cancelled) setRegOpen(open !== false);
      } catch {
        if (!cancelled) setRegOpen(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveRegOpen = async (open: boolean) => {
    if (regSaving) return;
    const prev = regOpen;
    setRegSaving(true);
    setRegOpen(open);
    try {
      await apiPost("registration_settings.save", { open });
      toast.success(open ? "学生注册已开放，学生现可在登录页注册。" : "学生注册已关闭，登录页注册入口即时隐藏。");
    } catch (e) {
      setRegOpen(prev);
      toast.error(e instanceof ApiError ? e.message : "保存失败，请稍后重试。");
    } finally {
      setRegSaving(false);
    }
  };

  // 考勤台账导出要如实标出每条是否参与扣分（同节课重复/人工改判）
  const attendMarks = useMemo(() => dedupeAttendance(store.attendance, store.evaluation), [store.attendance, store.evaluation]);

  const doExport = (which: "students" | "grades" | "term_eval" | "attendance" | "positions" | "records" | "rooms" | "courses" | "logs") => {
    if (which === "students") {
      exportCsv(
        `学生档案-${stamp()}.csv`,
        ["学号", "姓名", "性别", "班级", "专业", "年级", "电话", "政治面貌", "籍贯", "宿舍"],
        store.students.map((s) => [s.student_no, s.name, s.gender, s.class_name, s.major, s.grade, s.phone, s.political_status, s.native_place,
          s.dorm_room_id ? `${store.rooms.find((r) => r.id === s.dorm_room_id)?.building ?? ""} ${store.rooms.find((r) => r.id === s.dorm_room_id)?.room_no ?? ""} ${s.bed_no ?? ""}号床`.trim() : "未分配"])
      );
    } else if (which === "grades") {
      exportCsv(
        `成绩-${stamp()}.csv`,
        ["学号", "姓名", "班级", "课程", "学期", "考试成绩", "考试日期"],
        store.grades.map((g) => [g.student_no, g.student_name, g.class_name, g.course_name, g.term, g.score, g.exam_date])
      );
    } else if (which === "term_eval") {
      exportCsv(
        `学期综合测评-${stamp()}.csv`,
        ["学号", "姓名", "班级", "学期", "平时总评", "备注"],
        store.termEvals.map((e) => [e.student_no, e.student_name, e.class_name, e.term, e.usual_score, e.note])
      );
    } else if (which === "attendance") {
      exportCsv(
        `考勤台账-${stamp()}.csv`,
        ["学号", "姓名", "班级", "类型", "日期", "课程", "学期", "来源", "上报人", "计扣", "备注"],
        store.attendance.map((a) => {
          const mark = attendMarks.get(a.id);
          const flag = mark?.counted ? (mark.manual ? "计扣·人工指定" : "计扣") : mark?.manual ? "不计·人工改判" : "留档不计";
          return [a.student_no, a.student_name, a.class_name, ATTEND_KIND_LABEL[a.kind] ?? a.kind, a.occurred_on, a.course_name, a.term, a.source === "monitor" ? "班委上报" : "老师登记", a.reporter_name, flag, a.note];
        })
      );
    } else if (which === "positions") {
      exportCsv(
        `学生职务-${stamp()}.csv`,
        ["学号", "姓名", "班级", "职务", "状态", "委任日期", "撤销日期", "考勤上报权限", "备注"],
        store.positions.map((p) => [p.student_no, p.student_name, p.class_name, p.title, p.status === "active" ? "现任" : "已撤销", p.appointed_on, p.revoked_at ? p.revoked_at.slice(0, 10) : "", p.attend_report ? "已开通" : "未开通", p.note])
      );
    } else if (which === "records") {
      exportCsv(
        `日常记录-${stamp()}.csv`,
        ["学生", "类型", "标题", "状态", "日期", "内容"],
        store.records.map((r) => [studentName(store.students, r.student_id), RECORD_TYPE_LABEL[r.type] ?? r.type, r.title, RECORD_STATUS_LABEL[r.status] ?? r.status, r.occurred_on, r.content])
      );
    } else if (which === "rooms") {
      exportCsv(
        `宿舍-${stamp()}.csv`,
        ["楼栋", "房间号", "容量", "限住", "备注", "入住人数", "入住学生"],
        store.rooms.map((r) => [r.building, r.room_no, r.capacity, r.room_gender, r.note, r.students.length, r.students.map((s) => `${s.name}(${s.bed_no}号床)`).join(" ")])
      );
    } else if (which === "courses") {
      exportCsv(
        `课程-${stamp()}.csv`,
        ["课程名称", "课程编码", "教师", "学期", "班级", "上课时间", "上课地点", "学分"],
        store.courses.map((c) => [c.name, c.course_code, c.teacher, c.semester, c.class_name, c.schedule, c.classroom, c.credit])
      );
    } else {
      exportCsv(
        `操作日志-${stamp()}.csv`,
        ["时间", "操作人", "操作", "对象", "详情"],
        store.logs.map((l) => [l.created_at, l.actor_name || l.actor_id, ACTION_LABEL[l.action] ?? l.action, l.target, l.detail])
      );
    }
    toast.success("CSV 文件已开始下载。");
  };

  const exportAll = () => {
    const kinds: readonly ("students" | "grades" | "term_eval" | "attendance" | "positions" | "records" | "rooms" | "courses" | "logs")[] =
      member.role === "admin" ? ["students", "grades", "term_eval", "attendance", "positions", "records", "rooms", "courses", "logs"] : ["students", "grades", "term_eval", "attendance", "positions", "records", "rooms", "courses"];
    kinds.forEach((w, i) => {
      setTimeout(() => doExport(w), i * 300);
    });
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">更多</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="gap-0 py-4">
          <CardHeader className="px-4 pb-2">
            <CardTitle className="text-sm">我的账号</CardTitle>
            <CardDescription className="text-xs">
              {member.display_name}（{ROLE_LABEL[member.role]} · {member.username}）{member.phone ? ` · ${member.phone}` : " · 未绑定手机"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 px-4">
            <Button size="sm" variant="outline" onClick={() => setChangingPw(true)}>
              <KeyRound className="size-4" /> 修改密码
            </Button>
            <Button size="sm" variant="outline" onClick={() => setBindingPhone(true)}>
              <Phone className="size-4" /> {member.phone ? "更换手机" : "绑定手机"}
            </Button>
            <Button size="sm" variant="ghost" onClick={onLogout}>
              <LogOut className="size-4" /> 退出登录
            </Button>
          </CardContent>
        </Card>
        {member.role === "admin" ? (
          <Card className="gap-0 py-4">
            <CardHeader className="px-4 pb-2">
              <CardTitle className="text-sm">管理后台</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 px-4">
              <Button size="sm" variant="outline" onClick={() => onOpenAdmin("accounts")}>
                <ShieldCheck className="size-4" /> 账号管理
              </Button>
              <Button size="sm" variant="outline" onClick={() => onOpenAdmin("logs")}>
                <History className="size-4" /> 操作日志
              </Button>
            </CardContent>
          </Card>
        ) : null}
        <Card className="gap-0 py-4">
          <CardHeader className="px-4 pb-2">
            <CardTitle className="text-sm">待办提醒</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 px-4">
            <Button size="sm" variant="outline" onClick={() => onNavigate("overview")}>
              待审批 {store.records.filter((r) => r.type === "leave" && r.status === "pending").length} · 不及格 {failCount}
            </Button>
          </CardContent>
        </Card>
        <Card className="gap-0 py-4">
          <CardHeader className="px-4 pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <UserPlus className="size-4" /> 学生自助注册
            </CardTitle>
            <CardDescription className="text-xs">
              开放时学生可在登录页用「学号+姓名」注册，初始密码由系统统一分配（首登强制修改）；集中注册完成后建议关闭
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3 px-4">
            <Switch
              checked={regOpen === true}
              disabled={regSaving || regOpen === null}
              onCheckedChange={(v) => void saveRegOpen(v)}
            />
            <span className="text-sm text-muted-foreground">
              {regOpen === null ? "读取设置…" : regOpen ? "已开放" : "已关闭"}
            </span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">批量导入</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 px-4 pb-4">
          <Button variant="outline" onClick={() => setTemplateKind("student")}>
            <FileSpreadsheet className="size-4" /> 导入学生
          </Button>
          <Button variant="outline" onClick={() => setTemplateKind("grade")}>
            <FileSpreadsheet className="size-4" /> 导入成绩
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">数据备份（导出 CSV）</CardTitle>
          <CardDescription>建议每周至少完整导出一次，文件通过浏览器下载到本机保存。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 px-4 pb-4">
          <Button onClick={exportAll}>
            <Download className="size-4" /> 一键导出全部
          </Button>
          <Button variant="outline" onClick={() => doExport("students")}>学生</Button>
          <Button variant="outline" onClick={() => doExport("grades")}>成绩</Button>
          <Button variant="outline" onClick={() => doExport("term_eval")}>学期总评</Button>
          <Button variant="outline" onClick={() => doExport("attendance")}>考勤</Button>
          <Button variant="outline" onClick={() => doExport("positions")}>职务</Button>
          <Button variant="outline" onClick={() => doExport("records")}>记录</Button>
          <Button variant="outline" onClick={() => doExport("rooms")}>宿舍</Button>
          <Button variant="outline" onClick={() => doExport("courses")}>课程</Button>
          {member.role === "admin" ? (
            <Button variant="outline" onClick={() => doExport("logs")}>日志</Button>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">使用说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-4 pb-4 text-sm text-muted-foreground">
          <p>1. 本系统在电脑与手机上使用同一网址，数据实时同步；手机浏览器可「添加到主屏幕」当作 App 使用。</p>
          <p>2. 所有删除操作不可恢复，重要学期节点请先「一键导出全部」备份。</p>
        </CardContent>
      </Card>

      {templateKind ? (
        <ImportDialog
          title={templateKind === "student" ? "导入学生名单" : "导入成绩"}
          description={
            templateKind === "student"
              ? "首行为表头（可下载模板对照）。学号需唯一，已存在的行会被跳过。性别限「男/女」；政治面貌可填：" + POLITICAL_OPTIONS.join(" / ") + "。"
              : "按学号匹配学生、按课程名称匹配课程，姓名/班级自动同步。"
          }
          columns={templateKind === "student" ? STUDENT_COLUMNS : GRADE_COLUMNS}
          action={templateKind === "student" ? "student.bulk_create" : "grade.bulk_create"}
          chunkSize={templateKind === "student" ? 100 : 150}
          template={
            templateKind === "student"
              ? { name: "学生导入模板", samples: ["2024010101", "张三", "男", "计算机2401", "计算机科学与技术", "2024", "13800000000", "共青团员", "河北石家庄"] }
              : { name: "成绩导入模板", samples: ["2024010101", "高等数学（上）", "2025-2026-2", "87.5", "2026-06-18"] }
          }
          buildRow={(row) =>
            templateKind === "student"
              ? {
                  student_no: row.student_no ?? "", name: row.name ?? "", gender: row.gender ?? "",
                  class_name: row.class_name ?? "", major: row.major ?? "", grade: row.grade ?? "",
                  phone: row.phone ?? "", political_status: row.political_status ?? "", native_place: row.native_place ?? "",
                }
              : {
                  student_no: row.student_no ?? "", course_name: row.course_name ?? "", term: row.term ?? "",
                  score: row.score ?? "", exam_date: normalizeDate(row.exam_date ?? "") ?? row.exam_date ?? "",
                }
          }
          extraValidate={(row) => {
            if (templateKind === "student") {
              if (row.gender && row.gender !== "男" && row.gender !== "女") return "性别需为 男/女";
              if (row.political_status && !POLITICAL_OPTIONS.includes(row.political_status)) return "政治面貌不在可选范围";
              return null;
            }
            if (row.score && !/^\d{1,3}(\.\d{1,2})?$/.test(row.score)) return "分数需为 0-100";
            return null;
          }}
          onClose={() => setTemplateKind(null)}
          onDone={(created, skipped) => {
            void store.refresh();
            toast.success(`导入完成：成功 ${created} 条${skipped ? `，跳过 ${skipped} 条` : ""}`);
          }}
        />
      ) : null}

      {changingPw ? (
        <ChangePasswordDialog
          onDone={(m) => { onUpdateMember(m); setChangingPw(false); }}
          onClose={() => setChangingPw(false)}
        />
      ) : null}
      {bindingPhone ? (
        <BindPhoneDialog
          member={member}
          onDone={(m) => { onUpdateMember(m); setBindingPhone(false); }}
          onClose={() => setBindingPhone(false)}
        />
      ) : null}
    </section>
  );
}
