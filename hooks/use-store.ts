import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, apiGet, apiGetRaw, apiPost } from "@/lib/api";
import type { Attachment, AttendanceItem, AuditLog, Course, EvaluationSettings, FeedbackItem, Grade, HonorItem, LeaveRules, MessageItem, PositionItem, RecordItem, Room, Student, StudentPhoto, TermEvaluation } from "@/lib/types";

export type StoreScope = "admin" | "staff" | "student";

export interface Store {
  students: Student[];
  records: RecordItem[];
  rooms: Room[];
  courses: Course[];
  grades: Grade[];
  logs: AuditLog[];
  attachments: Attachment[];
  messages: MessageItem[];
  feedback: FeedbackItem[];
  rules: LeaveRules;
  attendance: AttendanceItem[];
  termEvals: TermEvaluation[];
  evaluation: EvaluationSettings;
  positions: PositionItem[];
  honors: HonorItem[];
  photos: StudentPhoto[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  write: (action: string, payload?: Record<string, unknown>) => Promise<boolean>;
}

const DEFAULT_RULES: LeaveRules = { max_days: "7", advance_days: "0", require_material: false, material_note: "" };
const DEFAULT_EVALUATION: EvaluationSettings = { exam_weight: "70", usual_weight: "30", absent_deduct: "5", late_deduct: "1", leave_deduct: "0" };

export function useStore(scope: StoreScope): Store {
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [rules, setRules] = useState<LeaveRules>(DEFAULT_RULES);
  const [attendance, setAttendance] = useState<AttendanceItem[]>([]);
  const [termEvals, setTermEvals] = useState<TermEvaluation[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationSettings>(DEFAULT_EVALUATION);
  const [positions, setPositions] = useState<PositionItem[]>([]);
  const [honors, setHonors] = useState<HonorItem[]>([]);
  const [photos, setPhotos] = useState<StudentPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [st, re, ro, co, gr, lo, at, me, fb, ru, td, te, ev, po, ph, ho] = await Promise.all([
        apiGet<Student>("students"),
        apiGet<RecordItem>("records"),
        apiGet<Room>("rooms"),
        apiGet<Course>("courses"),
        apiGet<Grade>("grades"),
        // 日志仅管理员可拉取；失败不阻塞整个工作台加载
        scope === "admin" ? apiGet<AuditLog>("audit_logs").catch(() => [] as AuditLog[]) : Promise.resolve([] as AuditLog[]),
        apiGet<Attachment>("attachments"),
        // 留言按角色返回（学生只见自己的）；失败不阻塞
        apiGet<MessageItem>("messages").catch(() => [] as MessageItem[]),
        // 反馈按角色返回（管理员见全部，其余见自己的）；失败不阻塞
        apiGet<FeedbackItem>("feedback").catch(() => [] as FeedbackItem[]),
        apiGetRaw("leave_rules")
          .then((r) => ({ ...DEFAULT_RULES, ...(r.data as Partial<LeaveRules> | undefined) }))
          .catch(() => DEFAULT_RULES),
        apiGet<AttendanceItem>("attendance").catch(() => [] as AttendanceItem[]),
        apiGet<TermEvaluation>("term_evaluations").catch(() => [] as TermEvaluation[]),
        apiGetRaw("evaluation_settings")
          .then((r) => ({ ...DEFAULT_EVALUATION, ...(r.data as Partial<EvaluationSettings> | undefined) }))
          .catch(() => DEFAULT_EVALUATION),
        // 职务按角色返回（学生只见自己的）；失败不阻塞
        apiGet<PositionItem>("positions").catch(() => [] as PositionItem[]),
        // 证件照元数据（学生只见自己的）；失败不阻塞
        apiGet<StudentPhoto>("photos").catch(() => [] as StudentPhoto[]),
        // 荣誉台账学生端不可见（服务端同样硬拒），学生 scope 直接不发请求
        scope === "student" ? Promise.resolve([] as HonorItem[]) : apiGet<HonorItem>("honors").catch(() => [] as HonorItem[]),
      ]);
      setStudents(st);
      setRecords(re);
      setRooms(ro);
      setCourses(co);
      setGrades(gr);
      setLogs(lo);
      setAttachments(at);
      setMessages(me);
      setFeedback(fb);
      setRules(ru);
      setAttendance(td);
      setTermEvals(te);
      setEvaluation(ev);
      setPositions(po);
      setPhotos(ph);
      setHonors(ho);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const write = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      try {
        await apiPost(action, payload);
        await refresh();
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.code === "network_error") {
          toast.error(e.message);
        } else if (e instanceof ApiError) {
          toast.error(e.message);
        } else {
          toast.error("操作失败，请稍后重试。");
        }
        return false;
      }
    },
    [refresh]
  );

  return { students, records, rooms, courses, grades, logs, attachments, messages, feedback, rules, attendance, termEvals, evaluation, positions, honors, photos, loading, error, refresh, write };
}
