export interface Student {
  id: string;
  student_no: string;
  name: string;
  gender: "男" | "女";
  class_name: string;
  major: string;
  grade: string;
  phone: string;
  political_status: string;
  native_place: string;
  dorm_room_id: string | null;
  bed_no: number | null;
  created_at: string;
  updated_at: string;
}

export type RecordType = "leave" | "talk" | "award" | "punish";
export type RecordStatus = "pending" | "approved" | "rejected" | "done";

export interface RecordItem {
  id: string;
  student_id: string;
  type: RecordType;
  title: string;
  content: string;
  status: RecordStatus;
  occurred_on: string;
  review_note?: string | null;
  source?: "staff" | "student" | null;
  start_date?: string | null;
  end_date?: string | null;
  leave_days?: string | null;
  created_at: string;
}

export interface MessageItem {
  id: string;
  student_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: "student" | "counselor" | "admin";
  body: string;
  replied: number;
  reply_note: string;
  replied_at: string | null;
  created_at: string;
}

export interface LeaveRules {
  max_days: string;
  advance_days: string;
  require_material: boolean;
  material_note: string;
}

// ---- 意见反馈（批次 K：面向管理员/开发者）----
export type FeedbackCategory = "bug" | "feature" | "ui" | "other";
export type FeedbackStatus = "pending" | "adopted" | "optimizing" | "done" | "no_plan";

export interface FeedbackItem {
  id: string;
  user_id: string;
  user_name: string;
  role: MemberRole;
  category: FeedbackCategory;
  content: string;
  status: FeedbackStatus;
  reply_note: string;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
}

export const FEEDBACK_CATEGORIES: FeedbackCategory[] = ["bug", "feature", "ui", "other"];
export const FEEDBACK_CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: "Bug 反馈",
  feature: "新功能建议",
  ui: "界面美化",
  other: "其他",
};

export const FEEDBACK_STATUSES: FeedbackStatus[] = ["pending", "adopted", "optimizing", "done", "no_plan"];
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  pending: "待处理",
  adopted: "已采纳",
  optimizing: "优化中",
  done: "已优化",
  no_plan: "暂时无计划",
};

export interface RoomOccupant {
  id: string;
  name: string;
  gender: string;
  class_name: string;
  bed_no: number | null;
}

export interface Room {
  id: string;
  building: string;
  room_no: string;
  capacity: number;
  room_gender: "男" | "女" | "不限";
  note: string;
  created_at: string;
  students: RoomOccupant[];
}

export interface Course {
  id: string;
  name: string;
  course_code: string;
  teacher: string;
  semester: string;
  class_name: string;
  schedule: string;
  classroom: string;
  credit: string;
  created_at: string;
}

export interface Grade {
  id: string;
  student_id: string;
  course_id: string;
  term: string;
  score: string;
  exam_date: string;
  created_at: string;
  // 读取时由后端联查学生档案与课程自动同步，无需手动录入
  student_name: string;
  student_no: string;
  class_name: string;
  course_name: string;
  /** 仅学生端返回：本人成绩对应课程的学分，用于与辅导员端一致的加权汇总 */
  course_credit?: string;
}

// ---- 综合测评（批次 M）：考勤台账 + 综测口径 ----
export type AttendKind = "late" | "absent" | "leave" | "early";

export const ATTEND_KIND_LABEL: Record<AttendKind, string> = {
  late: "迟到",
  absent: "旷课",
  leave: "请假",
  early: "早退",
};

export type AttendSource = "staff" | "monitor";

export const ATTEND_SOURCE_LABEL: Record<AttendSource, string> = {
  staff: "老师登记",
  monitor: "班委上报",
};

export interface AttendanceItem {
  id: string;
  student_id: string;
  course_id: string | null;
  term: string;
  occurred_on: string;
  kind: AttendKind;
  note: string;
  // 登记来源：老师本人登记 / 班委上报（reporter_* 记录是谁报的，权限撤销后仍留档）
  source: AttendSource | "";
  reporter_student_id: string | null;
  reporter_name: string;
  // 人工改判：true=同节课按这条计扣，false=这条不计，null/缺省=自动（取当前标准下最重的一条）
  counted_override?: boolean | null;
  created_at: string;
  student_name: string;
  student_no: string;
  class_name: string;
  course_name: string;
}

export interface EvaluationSettings {
  exam_weight: string;
  usual_weight: string;
  absent_deduct: string;
  late_deduct: string;
  leave_deduct: string;
}

// 学期综合测评：每个学生每学期一个平时总评（辅导员评定，考勤自动扣分）
export interface TermEvaluation {
  id: string;
  student_id: string;
  term: string;
  usual_score: string;
  note: string;
  updated_at: string;
  created_at: string;
  student_name: string;
  student_no: string;
  class_name: string;
}

// ---- 学生职务（批次 N）：班委委任与留档 ----
export type PositionStatus = "active" | "revoked";

export interface PositionItem {
  id: string;
  student_id: string;
  title: string;
  note: string;
  status: PositionStatus;
  appointed_on: string;
  revoked_at: string | null;
  // 本班考勤上报权限：挂在委任记录上，撤销职务即随之失效，重新委任需再开通
  attend_report: boolean;
  created_at: string;
  updated_at: string;
  // 读取时由后端联查学生档案自动同步
  student_name: string;
  student_no: string;
  class_name: string;
}

// 荣誉台账（批次 V）：按成绩批量授予的结构化荣誉，仅辅导员/管理员可见
export type HonorStatus = "active" | "revoked";

export interface HonorItem {
  id: string;
  student_id: string;
  title: string;
  level: string;
  term: string;
  granted_on: string;
  note: string;
  status: HonorStatus;
  revoked_at: string | null;
  granted_by: string;
  created_at: string;
  updated_at: string;
  // 读取时由后端联查学生档案自动同步
  student_name: string;
  student_no: string;
  class_name: string;
}

// 证件照元数据（批次 Q）：图像本体在存储桶 avatars/<student_id>/ 下，URL 由 photo.urls 批量签发
export interface StudentPhoto {
  id: string;
  student_id: string;
  uploader_id: string;
  uploader_name: string;
  original_name: string;
  content_type: string;
  size_bytes: string;
  created_at: string;
  updated_at: string;
}

// 班委上报页的同班同学精简档案（后端只在持权限时返回，且不含联系方式等隐私字段）
export interface Classmate {
  id: string;
  student_no: string;
  name: string;
  class_name: string;
}

// 更新公告（批次 Z）：仅管理员可维护，读取时按受众分角色过滤
export type ChangelogAudience = "all" | "staff" | "student";
export interface ChangelogItem {
  id: string;
  title: string;
  body: string;
  audience: ChangelogAudience;
  created_at: string;
  updated_at: string;
}
export const CHANGELOG_AUDIENCES: ChangelogAudience[] = ["all", "staff", "student"];
export const CHANGELOG_AUDIENCE_LABEL: Record<ChangelogAudience, string> = {
  all: "全员",
  staff: "仅教职工",
  student: "仅学生",
};

export const POSITION_PRESETS = [
  "班长", "副班长", "学习委员", "生活委员", "心理委员", "宣传委员", "体育委员", "舍长", "课代表",
];
export const POSITION_STATUS_LABEL: Record<PositionStatus, string> = {
  active: "现任",
  revoked: "已撤销",
};

export const HONOR_PRESETS = [
  "三好学生", "优秀学生干部", "学习标兵", "一等奖学金", "二等奖学金", "三等奖学金", "单科优秀奖", "优秀团员",
];
export const HONOR_LEVELS = ["国家级", "省级", "校级", "院级", "班级"];
export const HONOR_STATUS_LABEL: Record<HonorStatus, string> = {
  active: "现行荣誉",
  revoked: "已撤销",
};

export const RECORD_TYPE_LABEL: Record<RecordType, string> = {
  leave: "请假",
  talk: "谈心谈话",
  award: "表彰奖励",
  punish: "惩戒通报",
};

export interface AuditLog {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  target: string;
  detail: string;
  created_at: string;
}

export const ACTION_LABEL: Record<string, string> = {
  "student.create": "添加学生",
  "student.update": "修改学生",
  "student.delete": "删除学生",
  "student.assign": "安排住宿",
  "student.unassign": "退宿",
  "student.bulk_create": "批量导入学生",
  "record.create": "新增记录",
  "record.update": "更新记录",
  "record.delete": "删除记录",
  "room.create": "新增房间",
  "room.update": "修改房间",
  "room.delete": "删除房间",
  "course.create": "新增课程",
  "course.update": "修改课程",
  "course.delete": "删除课程",
  "grade.create": "录入成绩",
  "grade.update": "修改成绩",
  "grade.delete": "删除成绩",
  "grade.bulk_create": "批量导入成绩",
  "attendance.create": "登记考勤",
  "attendance.update": "修改考勤记录",
  "attendance.set_counted": "指定考勤计扣条目",
  "attendance.delete": "删除考勤记录",
  "attendance.bulk_create": "批量导入考勤",
  "term_eval.save": "录入学期总评",
  "term_eval.delete": "删除学期总评",
  "term_eval.bulk_create": "批量导入学期总评",
  "evaluation_settings.save": "设置综测口径",
  "position.create": "委任学生职务",
  "position.revoke": "撤销学生职务",
  "position.set_attend_report": "调整班委考勤上报权限",
  "honor.create": "授予学生荣誉",
  "honor.bulk_create": "批量授予荣誉",
  "honor.update": "修改荣誉",
  "honor.revoke": "撤销荣誉",
  "honor.delete": "删除荣誉记录",
  "attendance.report": "班委上报考勤",
  "auth.login": "登录系统",
  "auth.bootstrap": "初始化管理员",
  "auth.logout": "退出登录",
  "auth.change_password": "修改密码",
  "auth.bind_phone": "绑定手机",
  "auth.student_register": "学生自助注册",
  "profile.submit": "学生补全档案",
  "leave.submit": "学生提交请假",
  "leave.cancel": "学生撤回请假",
  "message.send": "学生留言",
  "message.reply": "回复留言",
  "feedback.submit": "提交意见反馈",
  "feedback.reply": "回复意见反馈",
  "leave_rules.save": "设置请假规则",
  "registration_settings.save": "设置学生注册开关",
  "account.create": "开通账号",
  "account.update": "修改账号",
  "account.reset_password": "重置密码",
  "attachment.prepare": "上传附件",
  "attachment.complete": "完成附件上传",
  "attachment.delete": "删除附件",
  "photo.prepare": "上传证件照",
  "photo.complete": "完成证件照上传",
  "photo.delete": "删除证件照",
  "changelog.save": "发布/更新公告",
  "changelog.delete": "删除公告",
};

export const RECORD_STATUS_LABEL: Record<RecordStatus, string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已驳回",
  done: "已办结",
};

export const POLITICAL_OPTIONS = ["群众", "共青团员", "中共党员", "中共预备党员", "其他"];

// ---- 应用内账号（批次 C）----
export type MemberRole = "admin" | "counselor" | "student";
export type MemberStatus = "active" | "disabled";

export interface Account {
  id: string;
  username: string;
  display_name: string;
  role: MemberRole;
  status: MemberStatus;
  phone: string;
  must_change: boolean;
  student_id?: string | null;
  created_at: string;
}

export const ROLE_LABEL: Record<MemberRole, string> = {
  admin: "管理员",
  counselor: "辅导员",
  student: "学生",
};

// ---- 记录附件（批次 D）----
export interface Attachment {
  id: string;
  record_id: string;
  uploader_id: string;
  uploader_name: string;
  original_name: string;
  content_type: string;
  size_bytes: string;
  created_at: string;
}

export const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACH_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx";
export const ATTACH_EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function attachExt(fileName: string): string | null {
  const m = /\.([a-z0-9]{1,8})$/i.exec(fileName);
  const ext = m ? m[1].toLowerCase() : "";
  return ATTACH_EXT_TYPES[ext] ? ext : null;
}

export function formatBytes(n: number | string): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(2)} MB`;
}

export function dormLabel(student: Student, rooms: Room[]): string {
  if (!student.dorm_room_id) return "未分配";
  const room = rooms.find((r) => r.id === student.dorm_room_id);
  if (!room) return "未分配";
  return `${room.building} ${room.room_no}${student.bed_no ? ` · ${student.bed_no}号床` : ""}`;
}

export function studentName(students: Student[], id: string): string {
  const s = students.find((x) => x.id === id);
  return s ? `${s.name}（${s.student_no}）` : "未知学生";
}
