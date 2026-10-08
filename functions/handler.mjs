// 辅导员学生工作平台 - Function 业务处理器
// GET  /functions/v1/app?action=students|records|rooms|courses|grades|audit_logs|attachments|messages|leave_rules|feedback|attendance|term_evaluations|evaluation_settings|positions|honors|classmates|auth_status|auth_me|account.list
// POST /functions/v1/app  body: { action: "auth.lookup" | "auth.login" | "student.create" | "attachment.prepare" | ..., ...payload }
// 业务接口以应用内账号会话（x-app-token 请求头）鉴权；auth.bootstrap 仅在 Qoder 登录上下文下可用一次。
import { getUser } from "./auth.mjs";
import { verifyUploadedObject } from "./storage-validation.mjs";

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const fail = (code, status = 400) => json({ ok: false, code }, status);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STUDENT_COLS =
  "id,student_no,name,gender,class_name,major,grade,phone,political_status,native_place,dorm_room_id,bed_no,created_at,updated_at";
const RECORD_COLS = "id,student_id,type,title,content,status,occurred_on,review_note,source,start_date,end_date,leave_days,created_at";
const ROOM_COLS = "id,building,room_no,capacity,room_gender,note,created_at";
const COURSE_COLS = "id,name,course_code,teacher,semester,class_name,schedule,classroom,credit,created_at";
const GRADE_COLS = "id,student_id,course_id,term,score,exam_date,created_at";
const ATTEND_COLS = "id,student_id,course_id,term,occurred_on,kind,note,source,reporter_student_id,counted_override,created_at";
const TE_COLS = "id,student_id,term,usual_score,note,updated_at,created_at";
const EVAL_COLS = "id,exam_weight,usual_weight,absent_deduct,late_deduct,leave_deduct,updated_at";
const ATTEND_KINDS = ["late", "absent", "leave", "early"];
const POSITION_COLS = "id,student_id,title,note,status,appointed_on,revoked_at,attend_report,created_at,updated_at";
const POSITION_STATUSES = ["active", "revoked"];
const HONOR_COLS = "id,student_id,title,level,term,granted_on,note,status,revoked_at,granted_by,created_at,updated_at";
const HONOR_LEVELS = ["国家级", "省级", "校级", "院级", "班级"];
// 挂科口径与 lib/evaluation.ts 的 PASS_SCORE 一致：考试分低于 60 即一票否决荣誉
const PASS_SCORE = 60;
const DEFAULT_EVAL = { exam_weight: "70", usual_weight: "30", absent_deduct: "5", late_deduct: "1", leave_deduct: "0" };
const LOG_COLS = "id,actor_id,actor_name,action,target,detail,created_at";

// ---- 应用内账号体系（批次 C）----
const USER_BASE_COLS = "id,username,display_name,role,status,phone,must_change,student_id,created_at,updated_at";
const USER_FULL_COLS = USER_BASE_COLS + ",pass_salt,pass_hash,created_by,failed_attempts,locked_until";
const MESSAGE_COLS = "id,student_id,sender_id,sender_name,sender_role,body,replied,reply_note,replied_at,created_at";
const RULE_COLS = "id,max_days,advance_days,require_material,material_note,updated_at";
const DEFAULT_RULES = { max_days: "7", advance_days: "0", require_material: false, material_note: "" };
const REG_COLS = "id,open,updated_at";

// ---- 意见反馈（批次 K：面向管理员/开发者）----
const FEEDBACK_COLS = "id,user_id,user_name,role,category,content,status,reply_note,replied_at,created_at,updated_at";
const FEEDBACK_CATEGORIES = ["bug", "feature", "ui", "other"];
const FEEDBACK_STATUSES = ["pending", "adopted", "optimizing", "done", "no_plan"];

const STUDENT_DEFAULT_PASSWORD = "123456";
const ROLES = ["admin", "counselor", "student"];
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const PBKDF2_ITERATIONS = 150000;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/;

// ---- 附件上传（批次 D）----
const ATTACH_COLS = "id,record_id,uploader_id,uploader_name,original_name,content_type,size_bytes,object_path,created_at";
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 应用层 5MiB（平台上限 10MiB 之内）
const EXT_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const EXT_RE = /^[a-z0-9]{1,8}$/;

// ---- 证件照（批次 Q）：复用 prepare→直传→complete 管线，但独立成表、一生一张、替换即清旧 ----
const PHOTO_COLS = "id,student_id,uploader_id,uploader_name,original_name,content_type,size_bytes,object_path,created_at,updated_at";
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 证件照场景 2MiB 足够，前端还会本地压到 ≤1MB
const PHOTO_EXT_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const photoPath = (studentId, id, ext) => `avatars/${studentId}/${id}.${ext}`;

function photoSafeExt(fileName) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(fileName ?? "");
  const ext = m ? m[1].toLowerCase() : "";
  return PHOTO_EXT_TYPES[ext] ? ext : null;
}

// 学生本人或任意教职工可为其传照
function photoWritable(member, studentId) {
  return member.role !== "student" || (member.student_id && member.student_id === studentId);
}

// 删除学生时级联清理证件照（尽力而为，与附件同口径）
async function purgePhotoFor(supabase, studentIds) {
  const paths = [];
  for (const sid of studentIds) {
    const { data } = await supabase.from("student_photos").select("id,object_path").eq("student_id", sid);
    if (data?.length) {
      await supabase.from("student_photos").delete().eq("student_id", sid);
      paths.push(...data.map((r) => r.object_path));
    }
  }
  if (paths.length) {
    try {
      const st = await getStorage();
      if (st) await st.remove(paths.slice(0, 1000));
    } catch { /* 忽略 */ }
  }
}

// 对象路径属于服务端实现细节，任何响应都不外泄
const publicPhoto = ({ object_path, ...rest }) => rest;
const publicAttachment = ({ object_path, ...rest }) => rest;

async function handlePhotoWrite({ supabase, action, body, member }) {
  const storage = await getStorage();
  if (!storage) return fail("storage_unavailable", 503);
  // photo.urls 用 student_ids 批量，其余动作用 student_id；各自在校验分支内取 id
  const studentId = idOf(body.student_id);

  const requireStudentId = () => {
    if (!studentId) return fail("invalid_id");
    if (!photoWritable(member, studentId)) return fail("access_denied", 403);
    return null;
  };

  switch (action) {
    case "photo.prepare": {
      const denied = requireStudentId();
      if (denied) return denied;
      const { data: student, error } = await supabase.from("students").select("id").eq("id", studentId).maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!student) return fail("not_found", 404);
      const fileName = str(body.file_name, { max: 120, required: true });
      if (!fileName) return fail("invalid_file_name");
      const ext = photoSafeExt(fileName);
      if (!ext) return fail("photo_type_not_allowed");
      const size = intIn(body.size, 1, MAX_PHOTO_BYTES);
      if (size === null) return fail("photo_too_large");
      const newId = crypto.randomUUID();
      try {
        const signed = await storage.createSignedUploadUrl(photoPath(studentId, newId, ext), { upsert: false });
        if (!signed?.signedUrl) return fail("storage_unavailable", 503);
        return json({ ok: true, id: newId, upload_url: signed.signedUrl, content_type: PHOTO_EXT_TYPES[ext] });
      } catch {
        return fail("storage_unavailable", 503);
      }
    }
    case "photo.complete": {
      const denied = requireStudentId();
      if (denied) return denied;
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const fileName = str(body.file_name, { max: 120, required: true });
      const ext = fileName ? photoSafeExt(fileName) : null;
      if (!ext) return fail("photo_type_not_allowed");
      const expectedBytes = Number(body.size);
      const objectPath = photoPath(studentId, id, ext);
      try {
        const actual = await verifyUploadedObject(await storage.download(objectPath), {
          maxBytes: MAX_PHOTO_BYTES,
          expectedBytes,
          allowedContentTypes: [PHOTO_EXT_TYPES[ext]],
        });
        const now = new Date().toISOString();
        // 平台 DDL 不允许唯一索引，故不用 upsert onConflict：有则原地改、无则插入，行 id 保持稳定。
        const { data: prev, error: prevErr } = await supabase
          .from("student_photos").select("id,object_path").eq("student_id", studentId).order("updated_at", { ascending: false });
        if (prevErr) return fail("database_request_failed", 503);
        const keepId = prev?.[0]?.id ?? id;
        const fields = {
          student_id: studentId,
          uploader_id: member.id, uploader_name: member.display_name,
          original_name: fileName,
          content_type: actual.contentType, size_bytes: String(actual.size),
          object_path: objectPath, updated_at: now,
        };
        const saved = prev?.length
          ? await supabase.from("student_photos").update(fields).eq("id", keepId).select(PHOTO_COLS).maybeSingle()
          : await supabase.from("student_photos").insert({ id: keepId, created_at: now, ...fields }).select(PHOTO_COLS).maybeSingle();
        if (saved.error || !saved.data) return fail("database_request_failed", 503);
        // 新照已生效才清旧：行删+对象删尽力而为，失败不阻塞
        for (const p of prev ?? []) {
          if (p.object_path === objectPath) continue;
          try { await storage.remove([p.object_path]); } catch { /* 残留对象可由管理端清理 */ }
        }
        if ((prev?.length ?? 0) > 1) await supabase.from("student_photos").delete().neq("id", keepId).eq("student_id", studentId);
        return json({ ok: true, item: publicPhoto(saved.data) });
      } catch {
        try { await storage.remove([objectPath]); } catch { /* 尽力清理孤儿对象 */ }
        return fail("upload_validation_failed");
      }
    }
    case "photo.urls": {
      // 批量取短时效签名 URL（读行为）：学生请求作用域收缩为仅本人
      const ids = Array.isArray(body.student_ids)
        ? body.student_ids.map((v) => idOf(v)).filter(Boolean).slice(0, 300)
        : [];
      if (ids.length === 0) return fail("invalid_request");
      const scoped = member.role === "student" ? ids.filter((sid) => sid === member.student_id) : ids;
      if (scoped.length === 0) return fail("access_denied", 403);
      const { data: rows, error } = await supabase.from("student_photos").select(PHOTO_COLS).in("student_id", scoped);
      if (error) return fail("database_request_failed", 503);
      const urls = {};
      for (const row of rows ?? []) {
        try {
          const signed = await storage.createSignedUrl(row.object_path, 900);
          if (signed?.signedUrl) urls[row.student_id] = signed.signedUrl;
        } catch { /* 单个失败按无照处理 */ }
      }
      return json({ ok: true, urls });
    }
    case "photo.delete": {
      const denied = requireStudentId();
      if (denied) return denied;
      if (member.role === "student") return fail("access_denied", 403);
      const { data: row, error } = await supabase.from("student_photos").select(PHOTO_COLS).eq("student_id", studentId).maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!row) return fail("not_found", 404);
      const { error: delError } = await supabase.from("student_photos").delete().eq("id", row.id);
      if (delError) return fail("database_request_failed", 503);
      try { await storage.remove([row.object_path]); } catch { /* 行已删 */ }
      return json({ ok: true });
    }
    default:
      return fail("unknown_action", 404);
  }
}

// 部署环境由平台注入 ./_qoder/storage.mjs；本地 fixture 通过 globalThis.__appStorage 注入假实现。
let storagePromise = null;
async function getStorage() {
  if (globalThis.__appStorage) return globalThis.__appStorage;
  if (!storagePromise) {
    storagePromise = import("./_qoder/storage.mjs")
      .then((m) => m.storage)
      .catch(() => null);
  }
  return storagePromise;
}

const GENDERS = ["男", "女"];
const ROOM_GENDERS = ["男", "女", "不限"];
const RECORD_TYPES = ["leave", "talk", "award", "punish"];
const RECORD_STATUSES = ["pending", "approved", "rejected", "done"];
const POLITICAL = ["群众", "共青团员", "中共党员", "中共预备党员", "其他"];

function str(value, { max = 200, required = false, fallback = "" } = {}) {
  if (typeof value !== "string") return required ? null : fallback;
  const v = value.trim();
  if (v.length === 0) return required ? null : fallback;
  if (new TextEncoder().encode(v).length > max) return null;
  return v;
}
function intIn(value, min, max) {
  const n = typeof value === "number" ? value : Number(str(value, { max: 12 }));
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
function oneOf(value, list, { required = false, fallback = "" } = {}) {
  if (typeof value !== "string") return required ? null : fallback;
  return list.includes(value) ? value : null;
}
function idOf(value) {
  return typeof value === "string" && UUID.test(value) ? value : null;
}
function dateStr(value) {
  if (typeof value !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;
}
function creditOf(value) {
  if (value === undefined || value === null || value === "") return "0";
  const raw = typeof value === "number" ? String(value) : str(value, { max: 8 });
  if (raw === null || !/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 0 && n <= 20 ? String(Math.round(n * 10) / 10) : null;
}
function scoreOf(value) {
  const raw = typeof value === "number" ? String(value) : str(value, { max: 8 });
  if (raw === null || !/^\d{1,3}(\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 0 && n <= 100 ? String(n) : null;
}
function weightOf(value) {
  const n = scoreOf(value);
  return n === null ? null : String(Math.round(Number(n)));
}

const isConflict = (error) =>
  error && (error.code === "23505" || /duplicate key/i.test(error.message ?? ""));

async function listAll(supabase, table, columns, orderColumn, limit, ascending = true) {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .order(orderColumn, { ascending })
    .limit(limit);
  if (error || !Array.isArray(data)) throw Object.assign(new Error("read_failed"), { db: true });
  return data;
}

// 荣誉门禁：哪些学生有挂科。term 非空只看该学期，term 为空看全部历史；
// includeHistory=true 时把历史学期的不及格也计进来。读取上限与 action=grades 同为 2000，
// 保证前端圈选看到的成绩与后端门禁判的是同一批数据。
async function failedStudentIds(supabase, { term, includeHistory }) {
  const rows = await listAll(supabase, "grades", "student_id,term,score", "created_at", 2000);
  const ids = new Set();
  for (const g of rows) {
    const score = Number(g.score);
    if (!Number.isFinite(score) || score >= PASS_SCORE) continue;
    if (!includeHistory && term && g.term !== term) continue;
    ids.add(g.student_id);
  }
  return ids;
}

// 审计日志：写入失败不影响主操作（表无 update/delete 权限，仅可追加与查询）。
function auditTarget(body) {
  for (const key of ["name", "student_no", "title", "building", "room_no", "username", "file_name", "id"]) {
    if (typeof body[key] === "string" && body[key]) return body[key].slice(0, 120);
  }
  return "";
}
async function logAction(supabase, user, action, target, detail) {
  try {
    await supabase.from("audit_logs").insert({
      id: crypto.randomUUID(),
      actor_id: String(user.user_id).slice(0, 128),
      actor_name: String(user.name ?? "").slice(0, 60),
      action: action.slice(0, 60),
      target: String(target ?? "").slice(0, 120),
      detail: String(detail ?? "").slice(0, 500),
      created_at: new Date().toISOString(),
    });
  } catch {
    // best effort
  }
}

const actorFrom = (member) => ({ user_id: member.id, name: member.display_name });

// ---- 口令与会话工具：PBKDF2-SHA256 加盐哈希，会话只存令牌摘要 ----
const encoder = new TextEncoder();
const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (bytes) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256hex = (text) =>
  crypto.subtle.digest("SHA-256", encoder.encode(text)).then(toHex);
async function derivePassword(password, salt) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return toHex(await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256
  ));
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function usernameOf(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return USERNAME_RE.test(v) ? v : null;
}
function passwordOf(value) {
  return typeof value === "string" && value.length >= 6 && value.length <= 72 && value.trim() === value && value.trim().length > 0
    ? value
    : null;
}
function publicMember(m) {
  return {
    id: m.id, username: m.username, display_name: m.display_name, role: m.role,
    status: m.status, phone: m.phone, must_change: m.must_change === 1,
    student_id: m.student_id ?? null, created_at: m.created_at,
  };
}

function tokenFromRequest(request) {
  const raw = request.headers.get("x-app-token");
  return typeof raw === "string" && TOKEN_RE.test(raw) ? raw : null;
}
async function resolveSession(supabase, request) {
  const token = tokenFromRequest(request);
  if (!token) return null;
  const tokenHash = await sha256hex(token);
  const { data: session, error } = await supabase
    .from("app_sessions").select("id,user_id,expires_at").eq("token_hash", tokenHash).maybeSingle();
  if (error) throw Object.assign(new Error("read_failed"), { db: true });
  if (!session) return null;
  if (Date.parse(session.expires_at) <= Date.now()) {
    await supabase.from("app_sessions").delete().eq("id", session.id);
    return null;
  }
  const { data: member, error: mErr } = await supabase
    .from("app_users").select(USER_FULL_COLS).eq("id", session.user_id).maybeSingle();
  if (mErr) throw Object.assign(new Error("read_failed"), { db: true });
  if (!member || member.status !== "active") return null;
  return { member, sessionId: session.id };
}
async function newSession(supabase, userId) {
  const token = randomHex(32);
  const { error } = await supabase.from("app_sessions").insert({
    id: crypto.randomUUID(),
    user_id: userId,
    token_hash: await sha256hex(token),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    created_at: new Date().toISOString(),
  });
  if (error) throw Object.assign(new Error("write_failed"), { db: true });
  return token;
}
async function fetchMember(supabase, columns, where) {
  const { data, error } = await supabase.from("app_users").select(columns).eq(where[0], where[1]).maybeSingle();
  if (error) throw Object.assign(new Error("read_failed"), { db: true });
  return data;
}
async function insertMember(supabase, { username, displayName, password, role, mustChange, createdBy, studentId = null }) {
  const salt = randomHex(16);
  const passHash = await derivePassword(password, salt);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("app_users").insert({
    id: crypto.randomUUID(), username, display_name: displayName, role, status: "active",
    pass_salt: salt, pass_hash: passHash, phone: "", must_change: mustChange,
    student_id: studentId,
    failed_attempts: 0, locked_until: null, created_by: createdBy, created_at: now, updated_at: now,
  }).select(USER_BASE_COLS).single();
  if (isConflict(error)) return { code: "username_exists", status: 409 };
  if (error || !data) return { code: "database_request_failed", status: 503 };
  return { member: data };
}
async function setPassword(supabase, id, password, { mustChange }) {
  const salt = randomHex(16);
  const passHash = await derivePassword(password, salt);
  const { data, error } = await supabase.from("app_users")
    .update({
      pass_salt: salt, pass_hash: passHash, must_change: mustChange,
      failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString(),
    })
    .eq("id", id).select(USER_BASE_COLS).maybeSingle();
  if (error) throw Object.assign(new Error("write_failed"), { db: true });
  return data;
}
async function countOtherActiveAdmins(supabase, excludeId) {
  const { data, error } = await supabase
    .from("app_users").select("id,role,status").eq("role", "admin").eq("status", "active");
  if (error) throw Object.assign(new Error("read_failed"), { db: true });
  return (data ?? []).filter((r) => r.id !== excludeId).length;
}

// 无会话即可访问的认证动作
async function handlePublicAuth({ supabase, action, body, request }) {
  switch (action) {
    case "auth.lookup": {
      // 两步式登录第一步：仅确认可进入密码步骤并区分身份类别，不返回姓名等任何资料
      const username = usernameOf(body.username);
      if (!username) return fail("invalid_request");
      const user = await fetchMember(supabase, "id,role", ["username", username]);
      if (!user) return json({ ok: true, found: false });
      return json({ ok: true, found: true, kind: user.role === "student" ? "student" : "staff" });
    }
    case "auth.login": {
      const username = usernameOf(body.username);
      const password = typeof body.password === "string" ? body.password : null;
      if (!username || !password) return fail("invalid_request");
      const user = await fetchMember(supabase, USER_FULL_COLS, ["username", username]);
      if (!user) return fail("login_failed", 401);
      if (user.status !== "active") return fail("account_disabled", 403);
      if (user.locked_until && Date.parse(user.locked_until) > Date.now()) return fail("login_locked", 429);
      const attemptHash = await derivePassword(password, user.pass_salt);
      if (!safeEqual(attemptHash, user.pass_hash)) {
        const failed = (user.failed_attempts ?? 0) + 1;
        const patch = { failed_attempts: failed, updated_at: new Date().toISOString() };
        if (failed >= MAX_FAILED) {
          patch.locked_until = new Date(Date.now() + LOCK_MS).toISOString();
          patch.failed_attempts = 0;
        }
        await supabase.from("app_users").update(patch).eq("id", user.id);
        return fail("login_failed", 401);
      }
      await supabase
        .from("app_users")
        .update({ failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      const token = await newSession(supabase, user.id);
      await logAction(supabase, actorFrom(user), "auth.login", user.username, "");
      return json({ ok: true, token, member: publicMember(user) });
    }
    case "auth.bootstrap": {
      // 仅站点私有期间：必须由 Qoder 登录上下文触发，且账号表为空
      let qoderUser = null;
      try {
        qoderUser = getUser(request);
      } catch {
        qoderUser = null;
      }
      if (!qoderUser) return fail("bootstrap_locked", 403);
      const existing = await listAll(supabase, "app_users", "id", "created_at", 1);
      if (existing.length > 0) return fail("already_bootstrapped", 409);
      const username = usernameOf(body.username);
      const password = passwordOf(body.password);
      const displayName = str(body.display_name, { max: 60 }) ?? (username ?? "");
      if (!username || !password || !displayName) return fail("invalid_credentials");
      const created = await insertMember(supabase, {
        username, displayName, password, role: "admin", mustChange: 0,
        createdBy: `qoder:${String(qoderUser.user_id).slice(0, 120)}`,
      });
      if (created.code) return fail(created.code, created.status);
      await logAction(supabase, actorFrom(created.member), "auth.bootstrap", username, "role=admin");
      return json({ ok: true, member: publicMember(created.member) });
    }
    case "auth.student_register": {
      // 学生用学号自助注册：学号已登记则绑定原档案（姓名须一致）；未登记则新建一条待完善档案，
      // 保存后即出现在辅导员端学生列表。初始密码由服务器统一分配 123456，首次登录强制修改。
      if (!(await readRegistrationOpen(supabase))) return fail("registration_closed", 403);
      const no = str(body.student_no, { max: 32, required: true });
      const name = str(body.name, { max: 60, required: true });
      if (!no || !name) return fail("invalid_request");
      const username = no.toLowerCase();
      if (!USERNAME_RE.test(username)) return fail("invalid_student_no");
      const { data: found, error } = await supabase
        .from("students").select("id,name,student_no").eq("student_no", no).maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (found && found.name !== name) return fail("name_mismatch", 403);
      const existing = await fetchMember(supabase, "id,status", ["username", username]);
      if (existing) return fail("username_exists", 409);
      let studentId = found?.id ?? null;
      let createdProfile = false;
      if (!studentId) {
        const now = new Date().toISOString();
        const { data, error: cErr } = await supabase
          .from("students")
          .insert({
            id: crypto.randomUUID(), student_no: no, name, gender: "", class_name: "", major: "",
            grade: "", phone: "", political_status: "群众", native_place: "",
            dorm_room_id: null, bed_no: null, created_at: now, updated_at: now,
          })
          .select("id").single();
        if (cErr) return fail("database_request_failed", 503);
        studentId = data.id;
        createdProfile = true;
      }
      const created = await insertMember(supabase, {
        username, displayName: name, password: STUDENT_DEFAULT_PASSWORD,
        role: "student", mustChange: 1, createdBy: "self-register", studentId,
      });
      if (created.code) {
        if (createdProfile) await supabase.from("students").delete().eq("id", studentId);
        return fail(created.code, created.status);
      }
      await logAction(
        supabase, actorFrom(created.member), "auth.student_register", no,
        `student_id=${studentId}${createdProfile ? " 新建档案" : " 绑定档案"}`
      );
      return json({ ok: true, member: publicMember(created.member), created_profile: createdProfile });
    }
    default:
      return fail("unknown_action", 404);
  }
}

// 需要管理员会话
async function handleAccountWrite({ supabase, action, body, member }) {
  switch (action) {
    case "account.create": {
      const username = usernameOf(body.username);
      const password = passwordOf(body.password);
      const role = oneOf(body.role, ROLES, { required: true });
      const displayName = str(body.display_name, { max: 60 }) ?? (username ?? "");
      if (!username || !password || !role || !displayName) return fail("invalid_credentials");
      const created = await insertMember(supabase, {
        username, displayName, password, role, mustChange: 1, createdBy: member.id,
      });
      if (created.code) return fail(created.code, created.status);
      return json({ ok: true, item: publicMember(created.member) });
    }
    case "account.update": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const patch = {};
      if (body.display_name !== undefined) {
        const v = str(body.display_name, { max: 60, required: true });
        if (!v) return fail("invalid_display_name");
        patch.display_name = v;
      }
      if (body.role !== undefined) {
        const v = oneOf(body.role, ROLES, { required: true });
        if (!v) return fail("invalid_role");
        patch.role = v;
      }
      if (body.status !== undefined) {
        const v = oneOf(body.status, ["active", "disabled"], { required: true });
        if (!v) return fail("invalid_status");
        patch.status = v;
      }
      if (Object.keys(patch).length === 0) return fail("invalid_request");
      const losesAdmin = (patch.role !== undefined && patch.role !== "admin")
        || (patch.status !== undefined && patch.status !== "active");
      if (losesAdmin) {
        const target = await fetchMember(supabase, "id,role,status", ["id", id]);
        if (!target) return fail("not_found", 404);
        if (target.role === "admin" && target.status === "active" && (await countOtherActiveAdmins(supabase, id)) === 0) {
          return fail("last_admin", 409);
        }
      }
      const { data, error } = await supabase
        .from("app_users").update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id).select(USER_BASE_COLS).maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      if (patch.status === "disabled") await supabase.from("app_sessions").delete().eq("user_id", id);
      return json({ ok: true, item: publicMember(data) });
    }
    case "account.reset_password": {
      const id = idOf(body.id);
      const password = passwordOf(body.password);
      if (!id || !password) return fail("invalid_password");
      const updated = await setPassword(supabase, id, password, { mustChange: 1 });
      if (!updated) return fail("not_found", 404);
      await supabase.from("app_sessions").delete().eq("user_id", id);
      return json({ ok: true, item: publicMember(updated) });
    }
    default:
      return fail("unknown_action", 404);
  }
}

// 仅需本人会话
async function handleSelfWrite({ supabase, action, body, session }) {
  const member = session.member;
  switch (action) {
    case "auth.logout": {
      await supabase.from("app_sessions").delete().eq("id", session.sessionId);
      return json({ ok: true });
    }
    case "auth.change_password": {
      const oldPassword = typeof body.old_password === "string" ? body.old_password : "";
      const newPassword = passwordOf(body.new_password);
      if (!newPassword) return fail("invalid_password");
      // 首登强制改密：身份已由刚完成的登录会话证明，初始密码不再重复校验；仍提供原密码则照常校验
      if (!(member.must_change === 1 && !oldPassword)) {
        if (!oldPassword) return fail("invalid_password");
        const current = await derivePassword(oldPassword, member.pass_salt);
        if (!safeEqual(current, member.pass_hash)) return fail("password_mismatch");
      }
      const updated = await setPassword(supabase, member.id, newPassword, { mustChange: 0 });
      return json({ ok: true, member: publicMember(updated ?? { ...member, must_change: 0 }) });
    }
    case "auth.bind_phone": {
      const phone = str(body.phone, { max: 32 });
      if (phone === null || (phone !== "" && !/^\d{5,20}$/.test(phone))) return fail("invalid_phone");
      const { error } = await supabase
        .from("app_users").update({ phone, updated_at: new Date().toISOString() }).eq("id", member.id);
      if (error) return fail("database_request_failed", 503);
      return json({ ok: true, member: publicMember({ ...member, phone }) });
    }
    default:
      return fail("unknown_action", 404);
  }
}

// ---- 附件（批次 D）：prepare → 浏览器直传 signedUrl → complete（服务端校验实际字节后才落库） ----
// 对象路径完全由服务端按 (record_id, 附件id, 白名单扩展名) 重建，浏览器无法指定路径。
function safeExtOf(fileName) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(fileName ?? "");
  const ext = m ? m[1].toLowerCase() : "";
  return EXT_TYPES[ext] ? ext : null;
}
const attachPath = (recordId, id, ext) => `attachments/${recordId}/${id}.${ext}`;

// 记录删除时级联清理附件（尽力而为：行删成功、对象清理失败不阻塞主流程）
async function purgeAttachmentsFor(supabase, recordIds) {
  const paths = [];
  for (const rid of recordIds) {
    const { data } = await supabase.from("app_attachments").select("id,object_path").eq("record_id", rid);
    if (data?.length) {
      await supabase.from("app_attachments").delete().eq("record_id", rid);
      paths.push(...data.map((r) => r.object_path));
    }
  }
  if (paths.length) {
    try {
      const st = await getStorage();
      if (st) await st.remove(paths.slice(0, 1000));
    } catch { /* 忽略 */ }
  }
}

// 学生仅能操作与自己学籍相关的记录（附件随请假单走同一归属判断）。
// write=true 时追加材料冻结口径：辅导员处理完毕（status 非 pending）后学生不得再增删换附件，
// 辅导员与管理员不受此限制（可通过后补材料或清理误传文件）。
async function attachmentGate(supabase, recordId, member, write = false) {
  const { data, error } = await supabase.from("records").select("id,student_id,status").eq("id", recordId).maybeSingle();
  if (error) throw Object.assign(new Error("read_failed"), { db: true });
  if (!data) return "not_found";
  if (member.role !== "student") return "ok";
  if (!member.student_id || data.student_id !== member.student_id) return "denied";
  if (write && data.status !== "pending") return "locked";
  return "ok";
}

function gateFail(gate) {
  if (gate === "ok") return null;
  if (gate === "not_found") return fail("not_found", 404);
  if (gate === "locked") return fail("record_locked", 403);
  return fail("access_denied", 403);
}

async function handleAttachmentWrite({ supabase, action, body, member }) {
  const storage = await getStorage();
  if (!storage) return fail("storage_unavailable", 503);
  const id = idOf(body.id);

  switch (action) {
    case "attachment.prepare": {
      const recordId = idOf(body.record_id);
      if (!recordId) return fail("invalid_id");
      const blockedPrepare = gateFail(await attachmentGate(supabase, recordId, member, true));
      if (blockedPrepare) return blockedPrepare;
      const fileName = str(body.file_name, { max: 120, required: true });
      if (!fileName) return fail("invalid_file_name");
      const ext = safeExtOf(fileName);
      if (!ext) return fail("file_type_not_allowed");
      const size = intIn(body.size, 1, MAX_FILE_BYTES);
      if (size === null) return fail("file_too_large");
      const newId = crypto.randomUUID();
      const objectPath = attachPath(recordId, newId, ext);
      try {
        const signed = await storage.createSignedUploadUrl(objectPath, { upsert: false });
        if (!signed?.signedUrl) return fail("storage_unavailable", 503);
        return json({ ok: true, id: newId, upload_url: signed.signedUrl, content_type: EXT_TYPES[ext] });
      } catch {
        return fail("storage_unavailable", 503);
      }
    }
    case "attachment.complete": {
      const recordId = idOf(body.record_id);
      if (!id || !recordId) return fail("invalid_id");
      const blockedComplete = gateFail(await attachmentGate(supabase, recordId, member, true));
      if (blockedComplete) return blockedComplete;
      const fileName = str(body.file_name, { max: 120, required: true });
      const ext = fileName ? safeExtOf(fileName) : null;
      if (!ext) return fail("invalid_file_name");
      const expectedBytes = Number(body.size);
      const objectPath = attachPath(recordId, id, ext);
      try {
        const actual = await verifyUploadedObject(await storage.download(objectPath), {
          maxBytes: MAX_FILE_BYTES,
          expectedBytes,
          allowedContentTypes: [EXT_TYPES[ext]],
        });
        const now = new Date().toISOString();
        const { data, error } = await supabase.from("app_attachments").insert({
          id, record_id: recordId,
          uploader_id: member.id, uploader_name: member.display_name,
          original_name: fileName,
          content_type: actual.contentType, size_bytes: String(actual.size),
          object_path: objectPath, created_at: now, updated_at: now,
        }).select(ATTACH_COLS).single();
        if (error) return fail("database_request_failed", 503);
        return json({ ok: true, item: publicAttachment(data) });
      } catch {
        try { await storage.remove([objectPath]); } catch { /* 尽力清理孤儿对象 */ }
        return fail("upload_validation_failed");
      }
    }
    case "attachment.download": {
      if (!id) return fail("invalid_id");
      const { data: row, error } = await supabase.from("app_attachments").select(ATTACH_COLS).eq("id", id).maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!row) return fail("not_found", 404);
      // 下载/预览属读取：材料冻结后学生仍可查自己的已提交材料
      const blockedDownload = gateFail(await attachmentGate(supabase, row.record_id, member));
      if (blockedDownload) return blockedDownload;
      try {
        const signed = await storage.createSignedUrl(row.object_path, 300);
        if (!signed?.signedUrl) return fail("storage_unavailable", 503);
        return json({
          ok: true, url: signed.signedUrl, name: row.original_name,
          content_type: row.content_type, size_bytes: row.size_bytes,
        });
      } catch {
        return fail("storage_unavailable", 503);
      }
    }
    case "attachment.delete": {
      if (!id) return fail("invalid_id");
      const { data: row, error } = await supabase.from("app_attachments").select(ATTACH_COLS).eq("id", id).maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!row) return fail("not_found", 404);
      // 学生只能删自己上传的；辅导员/管理员可清理本记录中传错或过期的材料
      if (member.role === "student" && row.uploader_id !== member.id) return fail("access_denied", 403);
      const blockedDelete = gateFail(await attachmentGate(supabase, row.record_id, member, true));
      if (blockedDelete) return blockedDelete;
      const { error: delError } = await supabase.from("app_attachments").delete().eq("id", id);
      if (delError) return fail("database_request_failed", 503);
      try { await storage.remove([row.object_path]); } catch { /* 行已删；残留对象可由管理端清理 */ }
      return json({ ok: true });
    }
    default:
      return fail("unknown_action", 404);
  }
}

function validateStudentFields(body, { partial = false } = {}) {
  const out = {};
  const req = (name, v) => {
    if (v === null) return `invalid_${name}`;
    if (v !== undefined || !partial) out[name] = v;
    return null;
  };
  let err;
  if (!partial || body.student_no !== undefined) {
    err = req("student_no", str(body.student_no, { max: 32, required: true }));
    if (err) return err;
  }
  if (!partial || body.name !== undefined) {
    err = req("name", str(body.name, { max: 60, required: true }));
    if (err) return err;
  }
  if (!partial || body.gender !== undefined) {
    err = req("gender", oneOf(body.gender, GENDERS, { required: true }));
    if (err) return err;
  }
  for (const [key, max] of [["class_name", 60], ["major", 60], ["grade", 16], ["phone", 32], ["native_place", 60]]) {
    if (partial && body[key] === undefined) continue;
    err = req(key, str(body[key], { max }));
    if (err) return err;
  }
  if (partial && body.political_status === undefined) {
    // unchanged
  } else {
    err = req(
      "political_status",
      oneOf(body.political_status, POLITICAL, { required: false, fallback: "群众" })
    );
    if (err) return err;
  }
  return { fields: out };
}
function unpack(result) {
  return typeof result === "string" ? { error: result } : result;
}

async function fetchStudent(supabase, id) {
  const { data, error } = await supabase
    .from("students")
    .select(STUDENT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw Object.assign(new Error("read_failed"), { db: true });
  return data;
}

const WRITE_ACTIONS = new Set([
  "student.create", "student.update", "student.delete", "student.assign", "student.unassign",
  "record.create", "record.update", "record.delete",
  "room.create", "room.update", "room.delete",
  "course.create", "course.update", "course.delete",
  "grade.create", "grade.update", "grade.delete",
  "attendance.create", "attendance.update", "attendance.delete", "attendance.bulk_create", "attendance.set_counted",
  "term_eval.save", "term_eval.delete", "term_eval.bulk_create",
  "student.bulk_create", "grade.bulk_create",
]);

async function fetchCourse(supabase, id) {
  const { data, error } = await supabase
    .from("courses")
    .select(COURSE_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw Object.assign(new Error("read_failed"), { db: true });
  return data;
}

// ---- 学生端（批次 F）：注册后凭绑定学籍补全档案、提交请假、给辅导员留言 ----
async function readLeaveRules(supabase) {
  const { data, error } = await supabase.from("leave_rules").select(RULE_COLS).limit(1);
  if (error) throw Object.assign(new Error("read_failed"), { db: true });
  const row = (data ?? [])[0];
  if (!row) return { ...DEFAULT_RULES };
  return {
    max_days: row.max_days || DEFAULT_RULES.max_days,
    advance_days: row.advance_days ?? DEFAULT_RULES.advance_days,
    require_material: row.require_material === true,
    material_note: row.material_note ?? "",
  };
}

// 学生自助注册开关：无行 = 默认开放
async function readRegistrationOpen(supabase) {
  const { data, error } = await supabase.from("registration_settings").select(REG_COLS).limit(1);
  if (error) return true;
  const row = (data ?? [])[0];
  return row ? row.open !== false : true;
}

// 综合测评口径：无行 = 默认权重（考试 70 / 平时 30，旷课扣 5、迟到扣 1、请假不扣）
async function readEvaluationSettings(supabase) {
  const { data, error } = await supabase.from("evaluation_settings").select(EVAL_COLS).limit(1);
  if (error) throw Object.assign(new Error("read_failed"), { db: true });
  const row = (data ?? [])[0];
  if (!row) return { ...DEFAULT_EVAL };
  return {
    exam_weight: row.exam_weight || DEFAULT_EVAL.exam_weight,
    usual_weight: row.usual_weight || DEFAULT_EVAL.usual_weight,
    absent_deduct: row.absent_deduct || DEFAULT_EVAL.absent_deduct,
    late_deduct: row.late_deduct || DEFAULT_EVAL.late_deduct,
    leave_deduct: row.leave_deduct || DEFAULT_EVAL.leave_deduct,
  };
}

const dayDiff = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

async function handleStudentWrite({ supabase, action, body, member }) {
  const studentId = member.student_id;
  if (!studentId) return fail("profile_missing", 409);
  switch (action) {
    case "profile.submit": {
      const packed = unpack(validateStudentFields(body, { partial: true }));
      if (packed.error) return fail(packed.error);
      delete packed.fields.student_no;
      if (Object.keys(packed.fields).length === 0) return fail("invalid_request");
      const { data, error } = await supabase
        .from("students")
        .update({ ...packed.fields, updated_at: new Date().toISOString() })
        .eq("id", studentId)
        .select(STUDENT_COLS)
        .maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "leave.submit": {
      const start = dateStr(body.start_date);
      const end = dateStr(body.end_date);
      const reason = str(body.content, { max: 1000, required: true });
      if (!start || !end || !reason) return fail("invalid_request");
      // fallback 必须为 null：str 默认返回 ""，否则 ?? 不生效，学生提交的请假会落成空标题
      const md = (d) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
      const title =
        str(body.title, { max: 120, fallback: null }) ??
        (start === end ? `请假 ${md(start)}` : `请假 ${md(start)} - ${md(end)}`);
      const days = dayDiff(start, end) + 1;
      if (days < 1 || days > 366) return fail("invalid_date_range");
      const rules = await readLeaveRules(supabase);
      const maxDays = Number(rules.max_days);
      if (days > maxDays) return fail("leave_exceeds_max_days");
      const advance = Number(rules.advance_days);
      const today = new Date().toISOString().slice(0, 10);
      if (dayDiff(today, start) < advance) return fail("leave_requires_advance");
      const { data: pendings, error: pErr } = await supabase
        .from("records")
        .select("id")
        .eq("student_id", studentId).eq("type", "leave").eq("status", "pending");
      if (pErr) return fail("database_request_failed", 503);
      if ((pendings ?? []).length >= 5) return fail("leave_too_many_pending", 409);
      const { data: leaveRows, error: overlapErr } = await supabase
        .from("records")
        .select("id,start_date,end_date,status")
        .eq("student_id", studentId).eq("type", "leave");
      if (overlapErr) return fail("database_request_failed", 503);
      const overlapped = (leaveRows ?? []).some(
        (r) => (r.status === "pending" || r.status === "approved") &&
          r.start_date && r.end_date && r.start_date <= end && r.end_date >= start
      );
      if (overlapped) return fail("leave_date_overlap", 409);
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("records")
        .insert({
          id: crypto.randomUUID(), student_id: studentId, type: "leave", title, content: reason,
          status: "pending", occurred_on: start, review_note: "",
          source: "student", start_date: start, end_date: end, leave_days: String(days),
          created_by: member.id, created_at: now,
        })
        .select(RECORD_COLS)
        .single();
      if (error) return fail("database_request_failed", 503);
      return json({ ok: true, item: data, rules });
    }
    case "leave.cancel": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const { data, error } = await supabase
        .from("records").delete().eq("id", id).eq("student_id", studentId).eq("status", "pending")
        .select("id").maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      await purgeAttachmentsFor(supabase, [id]);
      return json({ ok: true });
    }
    case "message.send": {
      const bodyText = str(body.body, { max: 1000, required: true });
      if (!bodyText) return fail("invalid_request");
      const student = await fetchStudent(supabase, studentId);
      if (!student) return fail("not_found", 404);
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("messages")
        .insert({
          id: crypto.randomUUID(), student_id: studentId,
          sender_id: member.id, sender_name: member.display_name, sender_role: "student",
          body: bodyText, replied: 0, reply_note: "", created_at: now,
        })
        .select(MESSAGE_COLS)
        .single();
      if (error) return fail("database_request_failed", 503);
      return json({ ok: true, item: data });
    }
    // 班委考勤上报：仅当本人持有「现任 + 开通考勤上报」的委任时可写，且只能报同班同学。
    // 权限挂在委任记录上，撤销职务即自动失效；已上报的数据不清除，留档可查。
    case "attendance.report": {
      const rows = Array.isArray(body.rows) ? body.rows : null;
      if (!rows || rows.length === 0 || rows.length > 100) return fail("invalid_request");
      if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) return fail("invalid_request");
      const { data: grants, error: grantErr } = await supabase
        .from("student_positions").select("id,title")
        .eq("student_id", studentId).eq("status", "active").eq("attend_report", true)
        .limit(1);
      if (grantErr) return fail("database_request_failed", 503);
      if (!(grants ?? []).length) return fail("report_not_allowed", 403);
      const reporter = await fetchStudent(supabase, studentId);
      if (!reporter) return fail("not_found", 404);
      if (!reporter.class_name) return fail("report_class_unassigned", 409);
      const students = await listAll(supabase, "students", "id,student_no,class_name", "student_no", 1000);
      const studentById = new Map(students.map((s) => [s.id, s]));
      const courses = await listAll(supabase, "courses", "id,name", "name", 500);
      const courseById = new Map(courses.map((c) => [c.id, c]));
      const skipped = [];
      let created = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const targetId = idOf(row.student_id);
        const target = targetId ? studentById.get(targetId) : null;
        if (!target) {
          skipped.push({ index: i, reason: "student_not_found" });
          continue;
        }
        if (!target.class_name || target.class_name !== reporter.class_name || target.id === studentId) {
          skipped.push({ index: i, reason: "not_classmate" });
          continue;
        }
        const kind = oneOf(row.kind, ATTEND_KINDS, { required: true });
        if (kind === null) {
          skipped.push({ index: i, reason: "invalid_kind" });
          continue;
        }
        const occurredOn = dateStr(row.occurred_on);
        if (!occurredOn) {
          skipped.push({ index: i, reason: "invalid_occurred_on" });
          continue;
        }
        let courseId = null;
        if (row.course_id !== undefined && row.course_id !== "") {
          courseId = idOf(row.course_id);
          const course = courseId ? courseById.get(courseId) : null;
          if (!course) {
            skipped.push({ index: i, reason: "course_not_found" });
            continue;
          }
        }
        const term = str(row.term, { max: 32 }) ?? "";
        const note = str(row.note, { max: 200 }) ?? "";
        const { error } = await supabase
          .from("attendance")
          .insert({
            id: crypto.randomUUID(), student_id: target.id, course_id: courseId, term,
            occurred_on: occurredOn, kind, note,
            source: "monitor", reporter_student_id: studentId, counted_override: null,
            created_at: new Date().toISOString(),
          });
        if (error) return fail("database_request_failed", 503);
        created += 1;
      }
      return json({ ok: true, created, skipped });
    }
    default:
      return fail("unknown_action", 404);
  }
}

// 需要管理员或辅导员会话
async function handleStaffWrite({ supabase, action, body, member }) {
  switch (action) {
    case "message.reply": {
      const id = idOf(body.id);
      const reply = str(body.reply_note, { max: 1000, required: true });
      if (!id || !reply) return fail("invalid_request");
      const { data, error } = await supabase
        .from("messages")
        .update({ replied: 1, reply_note: reply, replied_at: new Date().toISOString() })
        .eq("id", id)
        .select(MESSAGE_COLS)
        .maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "leave_rules.save": {
      const maxDays = intIn(body.max_days, 1, 90);
      const advanceDays = intIn(body.advance_days, 0, 60);
      const requireMaterial = typeof body.require_material === "boolean" ? body.require_material : null;
      const materialNote = str(body.material_note, { max: 200 });
      if (maxDays === null || advanceDays === null || requireMaterial === null || materialNote === null) {
        return fail("invalid_request");
      }
      const rows = await listAll(supabase, "leave_rules", "id", "updated_at", 2);
      const patch = {
        max_days: String(maxDays), advance_days: String(advanceDays),
        require_material: requireMaterial, material_note: materialNote,
        updated_at: new Date().toISOString(),
      };
      if (rows[0]) {
        const { error } = await supabase.from("leave_rules").update(patch).eq("id", rows[0].id);
        if (error) return fail("database_request_failed", 503);
      } else {
        const { error } = await supabase.from("leave_rules").insert({ id: crypto.randomUUID(), ...patch });
        if (error) return fail("database_request_failed", 503);
      }
      return json({ ok: true, rules: await readLeaveRules(supabase) });
    }
    case "registration_settings.save": {
      if (typeof body.open !== "boolean") return fail("invalid_request");
      const rows = await listAll(supabase, "registration_settings", "id", "updated_at", 2);
      const patch = { open: body.open, updated_at: new Date().toISOString() };
      if (rows[0]) {
        const { error } = await supabase.from("registration_settings").update(patch).eq("id", rows[0].id);
        if (error) return fail("database_request_failed", 503);
      } else {
        const { error } = await supabase.from("registration_settings").insert({ id: crypto.randomUUID(), ...patch });
        if (error) return fail("database_request_failed", 503);
      }
      await logAction(supabase, actorFrom(member), "registration_settings.save", "registration_settings", `open=${body.open}`);
      return json({ ok: true, open: await readRegistrationOpen(supabase) });
    }
    case "evaluation_settings.save": {
      const examWeight = weightOf(body.exam_weight);
      const usualWeight = weightOf(body.usual_weight);
      const absentDeduct = scoreOf(body.absent_deduct);
      const lateDeduct = scoreOf(body.late_deduct);
      const leaveDeduct = scoreOf(body.leave_deduct);
      if (examWeight === null || usualWeight === null || absentDeduct === null || lateDeduct === null || leaveDeduct === null) {
        return fail("invalid_request");
      }
      if (Number(examWeight) + Number(usualWeight) !== 100) return fail("invalid_weights");
      const rows = await listAll(supabase, "evaluation_settings", "id", "updated_at", 2);
      const patch = {
        exam_weight: examWeight, usual_weight: usualWeight,
        absent_deduct: absentDeduct, late_deduct: lateDeduct, leave_deduct: leaveDeduct,
        updated_at: new Date().toISOString(),
      };
      if (rows[0]) {
        const { error } = await supabase.from("evaluation_settings").update(patch).eq("id", rows[0].id);
        if (error) return fail("database_request_failed", 503);
      } else {
        const { error } = await supabase.from("evaluation_settings").insert({ id: crypto.randomUUID(), ...patch });
        if (error) return fail("database_request_failed", 503);
      }
      return json({ ok: true, settings: await readEvaluationSettings(supabase) });
    }
    case "position.create": {
      const studentId = idOf(body.student_id);
      const title = str(body.title, { max: 60, required: true });
      const note = str(body.note, { max: 600 });
      const appointedOn = dateStr(body.appointed_on);
      if (!studentId || !title || note === null || !appointedOn) return fail("invalid_request");
      const { data: studentRow, error: studentErr } = await supabase
        .from("students").select("id").eq("id", studentId).maybeSingle();
      if (studentErr) return fail("database_request_failed", 503);
      if (!studentRow) return fail("not_found", 404);
      const { data: dupRow, error: dupErr } = await supabase
        .from("student_positions").select("id")
        .eq("student_id", studentId).eq("title", title).eq("status", "active").maybeSingle();
      if (dupErr) return fail("database_request_failed", 503);
      if (dupRow) return fail("position_exists", 409);
      const attendReport = body.attend_report === true;
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("student_positions")
        .insert({
          id: crypto.randomUUID(), student_id: studentId, title, note,
          status: "active", appointed_on: appointedOn, revoked_at: null,
          attend_report: attendReport,
          created_at: now, updated_at: now,
        })
        .select(POSITION_COLS)
        .single();
      if (error) return fail("database_request_failed", 503);
      return json({ ok: true, item: data });
    }
    case "position.set_attend_report": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      if (typeof body.attend_report !== "boolean") return fail("invalid_request");
      const { data, error } = await supabase
        .from("student_positions")
        .update({ attend_report: body.attend_report, updated_at: new Date().toISOString() })
        .eq("id", id).eq("status", "active")
        .select(POSITION_COLS)
        .maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "position.revoke": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("student_positions")
        .update({ status: "revoked", revoked_at: now, updated_at: now })
        .eq("id", id).eq("status", "active")
        .select(POSITION_COLS)
        .maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    // ---- 荣誉台账（批次 V）：仅辅导员/管理员可读写，学生端不可见 ----
    case "honor.create": {
      const studentId = idOf(body.student_id);
      const title = str(body.title, { max: 120, required: true });
      const level = oneOf(body.level, HONOR_LEVELS, { required: true });
      const grantedOn = dateStr(body.granted_on);
      const term = str(body.term, { max: 32 }) ?? "";
      const note = str(body.note, { max: 600 }) ?? "";
      // 辅导员在弹窗里勾选「已知悉该生挂科，仍要授予」；没勾选就被挂科规则拦下
      const ackFailed = body.ack_failed === true;
      if (!studentId || !title || !level || !grantedOn) return fail("invalid_request");
      if (ackFailed && !note) return fail("honor_ack_note_required", 400);
      const { data: studentRow, error: studentErr } = await supabase
        .from("students").select("id").eq("id", studentId).maybeSingle();
      if (studentErr) return fail("database_request_failed", 503);
      if (!studentRow) return fail("not_found", 404);
      if (!ackFailed) {
        const failed = await failedStudentIds(supabase, { term, includeHistory: false });
        if (failed.has(studentId)) return fail("honor_student_failed", 409);
      }
      const { data: dupRow, error: dupErr } = await supabase
        .from("student_honors").select("id")
        .eq("student_id", studentId).eq("title", title).eq("term", term).eq("status", "active").maybeSingle();
      if (dupErr) return fail("database_request_failed", 503);
      if (dupRow) return fail("honor_exists", 409);
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("student_honors")
        .insert({
          id: crypto.randomUUID(), student_id: studentId, title, level, term,
          granted_on: grantedOn, note, status: "active", revoked_at: null,
          granted_by: member.display_name, created_at: now, updated_at: now,
        })
        .select(HONOR_COLS)
        .single();
      if (error) return fail("database_request_failed", 503);
      return json({ ok: true, item: data });
    }
    // 按名次圈选后的批量授予：整批共用称号/级别/学期/日期，只换学生
    case "honor.bulk_create": {
      const title = str(body.title, { max: 120, required: true });
      const level = oneOf(body.level, HONOR_LEVELS, { required: true });
      const grantedOn = dateStr(body.granted_on);
      const term = str(body.term, { max: 32 }) ?? "";
      const note = str(body.note, { max: 600 }) ?? "";
      const includeHistory = body.include_history_fail === true;
      const allowFailed = body.allow_failed === true;
      const ids = Array.isArray(body.student_ids) ? body.student_ids : null;
      if (!title || !level || !grantedOn || !ids || ids.length === 0 || ids.length > 300) return fail("invalid_request");
      // 临时放开挂科限制必须留说明，避免事后无人知道为什么挂了科还能评优
      if (allowFailed && !note) return fail("honor_ack_note_required", 400);
      const studentIds = [...new Set(ids)];
      if (studentIds.some((v) => idOf(v) === null)) return fail("invalid_request");
      const students = await listAll(supabase, "students", "id", "student_no", 1000);
      const known = new Set(students.map((s) => s.id));
      const honorRows = await listAll(supabase, "student_honors", "id,student_id,title,term,status", "created_at", 2000);
      const already = new Set(honorRows.filter((r) => r.status === "active" && r.title === title && r.term === term).map((r) => r.student_id));
      const failed = allowFailed ? new Set() : await failedStudentIds(supabase, { term, includeHistory });
      const now = new Date().toISOString();
      let created = 0;
      const skipped = [];
      for (const studentId of studentIds) {
        if (!known.has(studentId)) {
          skipped.push({ student_id: studentId, reason: "student_not_found" });
          continue;
        }
        if (failed.has(studentId)) {
          skipped.push({ student_id: studentId, reason: "student_failed" });
          continue;
        }
        if (already.has(studentId)) {
          skipped.push({ student_id: studentId, reason: "honor_exists" });
          continue;
        }
        const { error } = await supabase
          .from("student_honors")
          .insert({
            id: crypto.randomUUID(), student_id: studentId, title, level, term,
            granted_on: grantedOn, note, status: "active", revoked_at: null,
            granted_by: member.display_name, created_at: now, updated_at: now,
          });
        if (error) return fail("database_request_failed", 503);
        already.add(studentId);
        created += 1;
      }
      return json({ ok: true, created, skipped });
    }
    case "honor.update": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const title = str(body.title, { max: 120, required: true });
      const level = oneOf(body.level, HONOR_LEVELS, { required: true });
      const grantedOn = dateStr(body.granted_on);
      const term = str(body.term, { max: 32 }) ?? "";
      const note = str(body.note, { max: 600 }) ?? "";
      if (!title || !level || !grantedOn) return fail("invalid_request");
      const { data, error } = await supabase
        .from("student_honors")
        .update({ title, level, term, granted_on: grantedOn, note, updated_at: new Date().toISOString() })
        .eq("id", id).eq("status", "active")
        .select(HONOR_COLS)
        .maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "honor.revoke": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("student_honors")
        .update({ status: "revoked", revoked_at: now, updated_at: now })
        .eq("id", id).eq("status", "active")
        .select(HONOR_COLS)
        .maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "honor.delete": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const { data, error } = await supabase
        .from("student_honors").delete().eq("id", id).select("id").maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    default:
      return fail("unknown_action", 404);
  }
}

// 任意登录用户可提交反馈；仅管理员可回复并更新开发进度
async function handleFeedbackWrite({ supabase, action, body, member }) {
  switch (action) {
    case "feedback.submit": {
      const category = str(body.category, { max: 20, required: true });
      const content = str(body.content, { max: 2000, required: true });
      if (!category || !content) return fail("invalid_request");
      if (!FEEDBACK_CATEGORIES.includes(category)) return fail("invalid_request");
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("feedback")
        .insert({
          id: crypto.randomUUID(), user_id: member.id, user_name: member.display_name,
          role: member.role, category, content, status: "pending", reply_note: "",
          created_at: now, updated_at: now,
        })
        .select(FEEDBACK_COLS)
        .single();
      if (error) return fail("database_request_failed", 503);
      return json({ ok: true, item: data });
    }
    case "feedback.reply": {
      const id = idOf(body.id);
      const status = str(body.status, { max: 20, required: true });
      const note = str(body.reply_note, { max: 1000, required: true });
      if (!id || !status || !note) return fail("invalid_request");
      if (!FEEDBACK_STATUSES.includes(status)) return fail("invalid_request");
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("feedback")
        .update({ status, reply_note: note, replied_at: now, updated_at: now })
        .eq("id", id)
        .select(FEEDBACK_COLS)
        .maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    default:
      return fail("unknown_action", 404);
  }
}

async function handleWrite({ supabase, action, body }) {
  switch (action) {
    case "student.create": {
      const packed = unpack(validateStudentFields(body));
      if (packed.error) return fail(packed.error);
      const { fields } = packed;
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("students")
        .insert({ id: crypto.randomUUID(), ...fields, dorm_room_id: null, bed_no: null, created_at: now, updated_at: now })
        .select(STUDENT_COLS)
        .single();
      if (isConflict(error)) return fail("student_no_exists", 409);
      if (error || !data) return fail("database_request_failed", 503);
      return json({ ok: true, item: data });
    }
    case "student.update": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const packed = unpack(validateStudentFields(body, { partial: true }));
      if (packed.error) return fail(packed.error);
      if (Object.keys(packed.fields).length === 0) return fail("invalid_request");
      const { data, error } = await supabase
        .from("students")
        .update({ ...packed.fields, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(STUDENT_COLS)
        .maybeSingle();
      if (isConflict(error)) return fail("student_no_exists", 409);
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "student.delete": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      // 无数据库外键：先清理该生记录（含附件）与成绩，再删除学生。
      const { data: recRows } = await supabase.from("records").select("id").eq("student_id", id);
      await purgeAttachmentsFor(supabase, (recRows ?? []).map((r) => r.id));
      const { error: recErr } = await supabase.from("records").delete().eq("student_id", id);
      if (recErr) return fail("database_request_failed", 503);
      const { error: gradeErr } = await supabase.from("grades").delete().eq("student_id", id);
      if (gradeErr) return fail("database_request_failed", 503);
      const { error: attendErr } = await supabase.from("attendance").delete().eq("student_id", id);
      if (attendErr) return fail("database_request_failed", 503);
      const { error: teErr } = await supabase.from("term_evaluations").delete().eq("student_id", id);
      if (teErr) return fail("database_request_failed", 503);
      const { error: posErr } = await supabase.from("student_positions").delete().eq("student_id", id);
      if (posErr) return fail("database_request_failed", 503);
      const { error: honorErr } = await supabase.from("student_honors").delete().eq("student_id", id);
      if (honorErr) return fail("database_request_failed", 503);
      await purgePhotoFor(supabase, [id]);
      const { data, error } = await supabase.from("students").delete().eq("id", id).select("id").maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "student.assign": {
      const studentId = idOf(body.student_id);
      const roomId = idOf(body.room_id);
      const bedNo = intIn(body.bed_no, 1, 12);
      if (!studentId || !roomId || bedNo === null) return fail("invalid_request");
      const student = await fetchStudent(supabase, studentId);
      if (!student) return fail("not_found", 404);
      const { data: room, error: roomErr } = await supabase
        .from("dorm_rooms").select(ROOM_COLS).eq("id", roomId).maybeSingle();
      if (roomErr) return fail("database_request_failed", 503);
      if (!room) return fail("room_not_found", 404);
      if (bedNo > room.capacity) return fail("bed_out_of_range");
      if (room.room_gender !== "不限" && room.room_gender !== student.gender) return fail("room_gender_mismatch");
      const { data, error } = await supabase
        .from("students")
        .update({ dorm_room_id: roomId, bed_no: bedNo, updated_at: new Date().toISOString() })
        .eq("id", studentId)
        .select(STUDENT_COLS)
        .maybeSingle();
      if (isConflict(error)) return fail("bed_occupied", 409);
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "student.unassign": {
      const id = idOf(body.student_id);
      if (!id) return fail("invalid_id");
      const { data, error } = await supabase
        .from("students")
        .update({ dorm_room_id: null, bed_no: null, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select(STUDENT_COLS)
        .maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "record.create": {
      const studentId = idOf(body.student_id);
      const type = oneOf(body.type, RECORD_TYPES, { required: true });
      const title = str(body.title, { max: 120, required: true });
      const content = str(body.content, { max: 2000 });
      const occurredOn = body.occurred_on === undefined || body.occurred_on === ""
        ? new Date().toISOString().slice(0, 10)
        : dateStr(body.occurred_on);
      if (!studentId || !type || !title || !occurredOn || content === null) return fail("invalid_request");
      const status = type === "leave" ? "pending" : "done";
      const student = await fetchStudent(supabase, studentId);
      if (!student) return fail("student_not_found", 404);
      const { data, error } = await supabase
        .from("records")
        .insert({ id: crypto.randomUUID(), student_id: studentId, type, title, content, status, occurred_on: occurredOn, source: "staff", created_at: new Date().toISOString() })
        .select(RECORD_COLS)
        .single();
      if (error) return fail("database_request_failed", 503);
      return json({ ok: true, item: data });
    }
    case "record.update": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const patch = {};
      if (body.status !== undefined) {
        const status = oneOf(body.status, RECORD_STATUSES, { required: true });
        if (!status) return fail("invalid_status");
        patch.status = status;
      }
      if (body.title !== undefined) {
        const title = str(body.title, { max: 120, required: true });
        if (!title) return fail("invalid_title");
        patch.title = title;
      }
      if (body.content !== undefined) {
        const content = str(body.content, { max: 2000 });
        if (content === null) return fail("invalid_content");
        patch.content = content;
      }
      if (body.occurred_on !== undefined) {
        const d = dateStr(body.occurred_on);
        if (!d) return fail("invalid_occurred_on");
        patch.occurred_on = d;
      }
      if (body.review_note !== undefined) {
        const note = str(body.review_note, { max: 500 });
        if (note === null) return fail("invalid_review_note");
        patch.review_note = note;
      }
      if (Object.keys(patch).length === 0) return fail("invalid_request");
      if (patch.status === "approved") {
        // 学生提交的请假单：审批通过前按规则校验已上传材料
        const { data: existing } = await supabase.from("records").select("id,type,source").eq("id", id).maybeSingle();
        if (existing?.source === "student" && existing.type === "leave") {
          const rules = await readLeaveRules(supabase);
          if (rules.require_material) {
            const { data: atts } = await supabase
              .from("app_attachments").select("id").eq("record_id", id);
            if (!((atts ?? []).length > 0)) return fail("leave_requires_material", 422);
          }
        }
      }
      const { data, error } = await supabase
        .from("records").update(patch).eq("id", id).select(RECORD_COLS).maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "record.delete": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      await purgeAttachmentsFor(supabase, [id]);
      const { data, error } = await supabase.from("records").delete().eq("id", id).select("id").maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "room.create": {
      const building = str(body.building, { max: 60, required: true });
      const roomNo = str(body.room_no, { max: 16, required: true });
      const capacity = intIn(body.capacity, 1, 12) ?? 4;
      const roomGender = oneOf(body.room_gender, ROOM_GENDERS, { required: false, fallback: "不限" });
      const note = str(body.note, { max: 200 });
      if (!building || !roomNo || roomGender === null || note === null) return fail("invalid_request");
      const { data, error } = await supabase
        .from("dorm_rooms")
        .insert({ id: crypto.randomUUID(), building, room_no: roomNo, capacity, room_gender: roomGender, note, created_at: new Date().toISOString() })
        .select(ROOM_COLS)
        .single();
      if (isConflict(error)) return fail("room_exists", 409);
      if (error) return fail("database_request_failed", 503);
      return json({ ok: true, item: data });
    }
    case "room.update": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const patch = {};
      if (body.building !== undefined) {
        const v = str(body.building, { max: 60, required: true });
        if (!v) return fail("invalid_building");
        patch.building = v;
      }
      if (body.room_no !== undefined) {
        const v = str(body.room_no, { max: 16, required: true });
        if (!v) return fail("invalid_room_no");
        patch.room_no = v;
      }
      if (body.capacity !== undefined) {
        const v = intIn(body.capacity, 1, 12);
        if (v === null) return fail("invalid_capacity");
        patch.capacity = v;
      }
      if (body.room_gender !== undefined) {
        const v = oneOf(body.room_gender, ROOM_GENDERS, { required: true });
        if (!v) return fail("invalid_room_gender");
        patch.room_gender = v;
      }
      if (body.note !== undefined) {
        const v = str(body.note, { max: 200 });
        if (v === null) return fail("invalid_note");
        patch.note = v;
      }
      if (Object.keys(patch).length === 0) return fail("invalid_request");
      if (patch.capacity !== undefined) {
        const { data: occupants, error } = await supabase
          .from("students").select("id").eq("dorm_room_id", id).limit(50);
        if (error) return fail("database_request_failed", 503);
        if (Array.isArray(occupants) && occupants.length > patch.capacity) return fail("capacity_too_small");
      }
      const { data, error } = await supabase
        .from("dorm_rooms").update(patch).eq("id", id).select(ROOM_COLS).maybeSingle();
      if (isConflict(error)) return fail("room_exists", 409);
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "room.delete": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const { data: occupants, error: occErr } = await supabase
        .from("students").select("id").eq("dorm_room_id", id).limit(1);
      if (occErr) return fail("database_request_failed", 503);
      if (Array.isArray(occupants) && occupants.length > 0) return fail("room_not_empty", 409);
      const { data, error } = await supabase.from("dorm_rooms").delete().eq("id", id).select("id").maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "course.create":
    case "course.update": {
      const isCreate = action === "course.create";
      const id = isCreate ? null : idOf(body.id);
      if (!isCreate && !id) return fail("invalid_id");
      const patch = {};
      if (!isCreate || body.name !== undefined) {
        const v = str(body.name, { max: 80, required: true });
        if (!v) return fail("invalid_name");
        patch.name = v;
      }
      for (const [key, max] of [["course_code", 32], ["teacher", 40], ["semester", 32], ["class_name", 60], ["schedule", 120], ["classroom", 60]]) {
        if (isCreate || body[key] !== undefined) {
          const v = str(body[key], { max });
          if (v === null) return fail(`invalid_${key}`);
          patch[key] = v;
        }
      }
      if (isCreate || body.credit !== undefined) {
        const v = creditOf(body.credit);
        if (v === null) return fail("invalid_credit");
        patch.credit = v;
      }
      if (isCreate) {
        const { data, error } = await supabase
          .from("courses")
          .insert({ id: crypto.randomUUID(), ...patch, created_at: new Date().toISOString() })
          .select(COURSE_COLS)
          .single();
        if (error) return fail("database_request_failed", 503);
        return json({ ok: true, item: data });
      }
      if (Object.keys(patch).length === 0) return fail("invalid_request");
      const { data, error } = await supabase
        .from("courses").update(patch).eq("id", id).select(COURSE_COLS).maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "course.delete": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const { error: gradeErr } = await supabase.from("grades").delete().eq("course_id", id);
      if (gradeErr) return fail("database_request_failed", 503);
      const { error: attendErr } = await supabase.from("attendance").delete().eq("course_id", id);
      if (attendErr) return fail("database_request_failed", 503);
      const { data, error } = await supabase.from("courses").delete().eq("id", id).select("id").maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "grade.create": {
      const studentId = idOf(body.student_id);
      const courseId = idOf(body.course_id);
      const score = scoreOf(body.score);
      const term = str(body.term, { max: 32, required: true });
      const occurredOn = body.exam_date === undefined || body.exam_date === ""
        ? new Date().toISOString().slice(0, 10)
        : dateStr(body.exam_date);
      if (!studentId || !courseId || score === null || term === null || !occurredOn) return fail("invalid_request");
      const student = await fetchStudent(supabase, studentId);
      if (!student) return fail("student_not_found", 404);
      const course = await fetchCourse(supabase, courseId);
      if (!course) return fail("course_not_found", 404);
      const { data, error } = await supabase
        .from("grades")
        .insert({ id: crypto.randomUUID(), student_id: studentId, course_id: courseId, term, score, exam_date: occurredOn, created_at: new Date().toISOString() })
        .select(GRADE_COLS)
        .single();
      if (error) return fail("database_request_failed", 503);
      return json({ ok: true, item: { ...data, student_name: student.name, student_no: student.student_no, class_name: student.class_name, course_name: course.name } });
    }
    case "grade.update": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const patch = {};
      if (body.student_id !== undefined) {
        const v = idOf(body.student_id);
        if (!v) return fail("invalid_student_id");
        const student = await fetchStudent(supabase, v);
        if (!student) return fail("student_not_found", 404);
        patch.student_id = v;
      }
      if (body.course_id !== undefined) {
        const v = idOf(body.course_id);
        if (!v) return fail("invalid_course_id");
        const course = await fetchCourse(supabase, v);
        if (!course) return fail("course_not_found", 404);
        patch.course_id = v;
      }
      if (body.term !== undefined) {
        const v = str(body.term, { max: 32, required: true });
        if (v === null) return fail("invalid_term");
        patch.term = v;
      }
      if (body.score !== undefined) {
        const v = scoreOf(body.score);
        if (v === null) return fail("invalid_score");
        patch.score = v;
      }
      if (body.exam_date !== undefined) {
        const v = dateStr(body.exam_date);
        if (!v) return fail("invalid_exam_date");
        patch.exam_date = v;
      }
      if (Object.keys(patch).length === 0) return fail("invalid_request");
      const { data, error } = await supabase
        .from("grades").update(patch).eq("id", id).select(GRADE_COLS).maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "grade.delete": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const { data, error } = await supabase.from("grades").delete().eq("id", id).select("id").maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "student.bulk_create": {
      const rows = Array.isArray(body.rows) ? body.rows : null;
      if (!rows || rows.length === 0 || rows.length > 200) return fail("invalid_request");
      if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) return fail("invalid_request");
      const skipped = [];
      let created = 0;
      for (let i = 0; i < rows.length; i++) {
        const packed = unpack(validateStudentFields(rows[i]));
        if (packed.error) {
          skipped.push({ index: i, reason: packed.error });
          continue;
        }
        const now = new Date().toISOString();
        const { error } = await supabase
          .from("students")
          .insert({ id: crypto.randomUUID(), ...packed.fields, dorm_room_id: null, bed_no: null, created_at: now, updated_at: now });
        if (isConflict(error)) {
          skipped.push({ index: i, reason: "student_no_exists" });
          continue;
        }
        if (error) return fail("database_request_failed", 503);
        created += 1;
      }
      return json({ ok: true, created, skipped });
    }
    case "grade.bulk_create": {
      const rows = Array.isArray(body.rows) ? body.rows : null;
      if (!rows || rows.length === 0 || rows.length > 300) return fail("invalid_request");
      if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) return fail("invalid_request");
      const students = await listAll(supabase, "students", "id,student_no", "student_no", 1000);
      const courses = await listAll(supabase, "courses", COURSE_COLS, "name", 500);
      const studentByNo = new Map(students.map((s) => [s.student_no, s]));
      const skipped = [];
      let created = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sno = str(row.student_no, { max: 32, required: true });
        const student = sno ? studentByNo.get(sno) : null;
        if (!student) {
          skipped.push({ index: i, reason: "student_not_found" });
          continue;
        }
        const cname = str(row.course_name, { max: 80, required: true });
        const term = str(row.term, { max: 32 }) ?? "";
        const course = cname
          ? courses.find((c) => c.name === cname && (!term || !c.semester || c.semester === term))
          : null;
        if (!course) {
          skipped.push({ index: i, reason: "course_not_found" });
          continue;
        }
        const score = scoreOf(row.score);
        if (score === null) {
          skipped.push({ index: i, reason: "invalid_score" });
          continue;
        }
        const examDate = row.exam_date === undefined || row.exam_date === ""
          ? new Date().toISOString().slice(0, 10)
          : dateStr(row.exam_date);
        if (!examDate) {
          skipped.push({ index: i, reason: "invalid_exam_date" });
          continue;
        }
        const { error } = await supabase
          .from("grades")
          .insert({ id: crypto.randomUUID(), student_id: student.id, course_id: course.id, term: term || course.semester || "", score, exam_date: examDate, created_at: new Date().toISOString() });
        if (error) return fail("database_request_failed", 503);
        created += 1;
      }
      return json({ ok: true, created, skipped });
    }
    case "attendance.create": {
      const studentId = idOf(body.student_id);
      const occurredOn = dateStr(body.occurred_on);
      const kind = oneOf(body.kind, ATTEND_KINDS, { required: true });
      const term = str(body.term, { max: 32 }) ?? "";
      const note = str(body.note, { max: 200 });
      if (!studentId || !occurredOn || kind === null || note === null) return fail("invalid_request");
      let courseId = null;
      if (body.course_id !== undefined && body.course_id !== "") {
        courseId = idOf(body.course_id);
        if (!courseId) return fail("invalid_course_id");
        const course = await fetchCourse(supabase, courseId);
        if (!course) return fail("course_not_found", 404);
      }
      const student = await fetchStudent(supabase, studentId);
      if (!student) return fail("student_not_found", 404);
      const { data, error } = await supabase
        .from("attendance")
        .insert({ id: crypto.randomUUID(), student_id: studentId, course_id: courseId, term, occurred_on: occurredOn, kind, note, source: "staff", reporter_student_id: null, counted_override: null, created_at: new Date().toISOString() })
        .select(ATTEND_COLS)
        .single();
      if (error) return fail("database_request_failed", 503);
      return json({ ok: true, item: data });
    }
    case "attendance.update": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const patch = {};
      if (body.student_id !== undefined) {
        const v = idOf(body.student_id);
        if (!v) return fail("invalid_student_id");
        const student = await fetchStudent(supabase, v);
        if (!student) return fail("student_not_found", 404);
        patch.student_id = v;
      }
      if (body.course_id !== undefined) {
        if (body.course_id === "") {
          patch.course_id = null;
        } else {
          const v = idOf(body.course_id);
          if (!v) return fail("invalid_course_id");
          const course = await fetchCourse(supabase, v);
          if (!course) return fail("course_not_found", 404);
          patch.course_id = v;
        }
      }
      if (body.term !== undefined) {
        const v = str(body.term, { max: 32 });
        if (v === null) return fail("invalid_term");
        patch.term = v;
      }
      if (body.occurred_on !== undefined) {
        const v = dateStr(body.occurred_on);
        if (!v) return fail("invalid_occurred_on");
        patch.occurred_on = v;
      }
      if (body.kind !== undefined) {
        const v = oneOf(body.kind, ATTEND_KINDS, { required: true });
        if (v === null) return fail("invalid_kind");
        patch.kind = v;
      }
      if (body.note !== undefined) {
        const v = str(body.note, { max: 200 });
        if (v === null) return fail("invalid_note");
        patch.note = v;
      }
      if (Object.keys(patch).length === 0) return fail("invalid_request");
      // 日期/课程是「同一节课」的分组键，一改就换组了，人工指定标记随之失效
      if (patch.occurred_on !== undefined || patch.course_id !== undefined) patch.counted_override = null;
      const { data, error } = await supabase
        .from("attendance").update(patch).eq("id", id).select(ATTEND_COLS).maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    // 人工指定「同一节课按哪条计扣」：true=按这条扣，false=这条不计，null=恢复自动（取最重的一条）
    case "attendance.set_counted": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const counted = body.counted === undefined ? null : body.counted;
      if (counted !== null && typeof counted !== "boolean") return fail("invalid_request");
      const { data: row, error: readErr } = await supabase
        .from("attendance").select(ATTEND_COLS).eq("id", id).maybeSingle();
      if (readErr) return fail("database_request_failed", 503);
      if (!row) return fail("not_found", 404);
      let cleared = 0;
      if (counted === true) {
        // 指定新的计扣条之前，先把同一节课内其他被指定的行清回自动，避免两条同时扣分
        const { data: dayRows, error: dayErr } = await supabase
          .from("attendance").select("id,course_id,counted_override")
          .eq("student_id", row.student_id).eq("occurred_on", row.occurred_on).limit(500);
        if (dayErr) return fail("database_request_failed", 503);
        const loose = (dayRows ?? []).some((r) => !r.course_id);
        const peers = (dayRows ?? []).filter(
          (r) => r.id !== id && r.counted_override === true && (loose || r.course_id === row.course_id)
        );
        for (const peer of peers) {
          const { error: clearErr } = await supabase.from("attendance").update({ counted_override: null }).eq("id", peer.id);
          if (clearErr) return fail("database_request_failed", 503);
        }
        cleared = peers.length;
      }
      const { data, error } = await supabase
        .from("attendance").update({ counted_override: counted }).eq("id", id).select(ATTEND_COLS).maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data, cleared });
    }
    case "attendance.delete": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const { data, error } = await supabase.from("attendance").delete().eq("id", id).select("id").maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "attendance.bulk_create": {
      const rows = Array.isArray(body.rows) ? body.rows : null;
      if (!rows || rows.length === 0 || rows.length > 300) return fail("invalid_request");
      if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) return fail("invalid_request");
      const students = await listAll(supabase, "students", "id,student_no", "student_no", 1000);
      const courses = await listAll(supabase, "courses", "id,name", "name", 500);
      const studentByNo = new Map(students.map((s) => [s.student_no, s]));
      const courseByName = new Map(courses.map((c) => [c.name, c]));
      const skipped = [];
      let created = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sno = str(row.student_no, { max: 32, required: true });
        const student = sno ? studentByNo.get(sno) : null;
        if (!student) {
          skipped.push({ index: i, reason: "student_not_found" });
          continue;
        }
        const kind = oneOf(row.kind ?? row.type, ATTEND_KINDS, { required: true });
        if (kind === null) {
          skipped.push({ index: i, reason: "invalid_kind" });
          continue;
        }
        const occurredOn = dateStr(row.occurred_on ?? row.date);
        if (!occurredOn) {
          skipped.push({ index: i, reason: "invalid_occurred_on" });
          continue;
        }
        const term = str(row.term, { max: 32 }) ?? "";
        const cname = str(row.course_name, { max: 80 });
        const course = cname ? courseByName.get(cname) : null;
        if (cname && !course) {
          skipped.push({ index: i, reason: "course_not_found" });
          continue;
        }
        const note = str(row.note, { max: 200 }) ?? "";
        const { error } = await supabase
          .from("attendance")
          .insert({ id: crypto.randomUUID(), student_id: student.id, course_id: course?.id ?? null, term, occurred_on: occurredOn, kind, note, source: "staff", reporter_student_id: null, counted_override: null, created_at: new Date().toISOString() });
        if (error) return fail("database_request_failed", 503);
        created += 1;
      }
      return json({ ok: true, created, skipped });
    }
    case "term_eval.save": {
      const studentId = idOf(body.student_id);
      const term = str(body.term, { max: 32, required: true });
      const usual = scoreOf(body.usual_score);
      const note = str(body.note, { max: 200 }) ?? "";
      if (!studentId || term === null || usual === null) return fail("invalid_request");
      const student = await fetchStudent(supabase, studentId);
      if (!student) return fail("student_not_found", 404);
      const existing = (await listAll(supabase, "term_evaluations", TE_COLS, "created_at", 2000))
        .find((r) => r.student_id === studentId && r.term === term);
      const now = new Date().toISOString();
      if (existing) {
        const { data, error } = await supabase
          .from("term_evaluations").update({ usual_score: usual, note, updated_at: now }).eq("id", existing.id).select(TE_COLS).maybeSingle();
        if (error) return fail("database_request_failed", 503);
        if (!data) return fail("database_request_failed", 503);
        return json({ ok: true, created: false, item: data });
      }
      const { data, error } = await supabase
        .from("term_evaluations")
        .insert({ id: crypto.randomUUID(), student_id: studentId, term, usual_score: usual, note, created_at: now, updated_at: now })
        .select(TE_COLS).maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("database_request_failed", 503);
      return json({ ok: true, created: true, item: data });
    }
    case "term_eval.delete": {
      const id = idOf(body.id);
      if (!id) return fail("invalid_id");
      const { data, error } = await supabase.from("term_evaluations").delete().eq("id", id).select("id").maybeSingle();
      if (error) return fail("database_request_failed", 503);
      if (!data) return fail("not_found", 404);
      return json({ ok: true, item: data });
    }
    case "term_eval.bulk_create": {
      const rows = Array.isArray(body.rows) ? body.rows : null;
      if (!rows || rows.length === 0 || rows.length > 300) return fail("invalid_request");
      if (!rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) return fail("invalid_request");
      const students = await listAll(supabase, "students", "id,student_no", "student_no", 1000);
      const studentByNo = new Map(students.map((s) => [s.student_no, s]));
      const all = await listAll(supabase, "term_evaluations", TE_COLS, "created_at", 2000);
      const byKey = new Map(all.map((r) => [`${r.student_id}|${r.term}`, r]));
      const skipped = [];
      let created = 0;
      let updated = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sno = str(row.student_no, { max: 32, required: true });
        const student = sno ? studentByNo.get(sno) : null;
        if (!student) {
          skipped.push({ index: i, reason: "student_not_found" });
          continue;
        }
        const term = str(row.term, { max: 32, required: true });
        if (term === null || term === "") {
          skipped.push({ index: i, reason: "invalid_term" });
          continue;
        }
        const usual = scoreOf(row.usual_score ?? row.usual);
        if (usual === null) {
          skipped.push({ index: i, reason: "invalid_usual_score" });
          continue;
        }
        const note = str(row.note, { max: 200 }) ?? "";
        const now = new Date().toISOString();
        const existing = byKey.get(`${student.id}|${term}`);
        if (existing) {
          const { error } = await supabase
            .from("term_evaluations").update({ usual_score: usual, note, updated_at: now }).eq("id", existing.id);
          if (error) return fail("database_request_failed", 503);
          updated += 1;
          continue;
        }
        const { error } = await supabase
          .from("term_evaluations")
          .insert({ id: crypto.randomUUID(), student_id: student.id, term, usual_score: usual, note, created_at: now, updated_at: now });
        if (error) return fail("database_request_failed", 503);
        created += 1;
      }
      return json({ ok: true, created, updated, skipped });
    }
    default:
      return fail("unknown_action", 404);
  }
}

async function handleRead({ supabase, params, member }) {
  const action = params.get("action");
  if (action === "students") {
    if (member.role === "student") {
      const self = await fetchStudent(supabase, member.student_id);
      return json({ ok: true, data: self ? [self] : [] });
    }
    const items = await listAll(supabase, "students", STUDENT_COLS, "student_no", 1000);
    return json({ ok: true, data: items });
  }
  if (action === "records") {
    let items = await listAll(supabase, "records", RECORD_COLS, "occurred_on", 1000);
    if (member.role === "student") items = items.filter((r) => r.student_id === member.student_id);
    return json({ ok: true, data: items.sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0)) });
  }
  if (action === "rooms") {
    if (member.role === "student") return json({ ok: true, data: [] });
    const rooms = await listAll(supabase, "dorm_rooms", ROOM_COLS, "building", 500);
    const students = await listAll(supabase, "students", STUDENT_COLS, "student_no", 1000);
    const byRoom = new Map();
    for (const s of students) {
      if (!s.dorm_room_id) continue;
      if (!byRoom.has(s.dorm_room_id)) byRoom.set(s.dorm_room_id, []);
      byRoom.get(s.dorm_room_id).push({ id: s.id, name: s.name, gender: s.gender, class_name: s.class_name, bed_no: s.bed_no });
    }
    for (const r of rooms) {
      r.students = (byRoom.get(r.id) ?? []).sort((a, b) => (a.bed_no ?? 99) - (b.bed_no ?? 99));
    }
    return json({ ok: true, data: rooms });
  }
  if (action === "courses") {
    if (member.role === "student") return json({ ok: true, data: [] });
    const items = await listAll(supabase, "courses", COURSE_COLS, "name", 500);
    return json({ ok: true, data: items });
  }
  if (action === "grades") {
    if (member.role === "student") {
      const items = (await listAll(supabase, "grades", GRADE_COLS, "created_at", 2000))
        .filter((g) => g.student_id === member.student_id);
      const courses = await listAll(supabase, "courses", COURSE_COLS, "name", 500);
      const courseById = new Map(courses.map((c) => [c.id, c]));
      for (const g of items) g.course_name = courseById.get(g.course_id)?.name ?? "（课程已删除）";
      items.sort((a, b) => (a.exam_date < b.exam_date ? 1 : a.exam_date > b.exam_date ? -1 : 0));
      return json({ ok: true, data: items });
    }
    const items = await listAll(supabase, "grades", GRADE_COLS, "created_at", 2000);
    const students = await listAll(supabase, "students", STUDENT_COLS, "student_no", 1000);
    const courses = await listAll(supabase, "courses", COURSE_COLS, "name", 500);
    const studentById = new Map(students.map((s) => [s.id, s]));
    const courseById = new Map(courses.map((c) => [c.id, c]));
    for (const g of items) {
      const s = studentById.get(g.student_id);
      g.student_name = s?.name ?? "（学生已删除）";
      g.student_no = s?.student_no ?? "-";
      g.class_name = s?.class_name ?? "";
      g.course_name = courseById.get(g.course_id)?.name ?? "（课程已删除）";
    }
    items.sort((a, b) => (a.exam_date < b.exam_date ? 1 : a.exam_date > b.exam_date ? -1 : 0));
    return json({ ok: true, data: items });
  }
  // 班委上报专用：只返回同班同学的精简字段 + 本班课程，且必须持有效上报权限。
  if (action === "classmates") {
    if (member.role !== "student") return fail("access_denied", 403);
    const { data: grants, error: grantErr } = await supabase
      .from("student_positions").select("id")
      .eq("student_id", member.student_id).eq("status", "active").eq("attend_report", true)
      .limit(1);
    if (grantErr) return fail("database_request_failed", 503);
    if (!(grants ?? []).length) return fail("report_not_allowed", 403);
    const self = await fetchStudent(supabase, member.student_id);
    if (!self) return fail("not_found", 404);
    if (!self.class_name) return json({ ok: true, data: [], courses: [] });
    const students = await listAll(supabase, "students", "id,student_no,name,class_name", "student_no", 1000);
    const courses = await listAll(supabase, "courses", "id,name,class_name", "name", 500);
    return json({
      ok: true,
      data: students.filter((s) => s.class_name === self.class_name && s.id !== self.id),
      courses: courses.filter((c) => c.class_name === self.class_name).map((c) => ({ id: c.id, name: c.name })),
    });
  }
  if (action === "attendance") {
    let items = await listAll(supabase, "attendance", ATTEND_COLS, "created_at", 2000);
    // 学生：自己的考勤 + 自己作为班委上报的考勤
    if (member.role === "student") {
      items = items.filter((a) => a.student_id === member.student_id || a.reporter_student_id === member.student_id);
    }
    const students = await listAll(supabase, "students", STUDENT_COLS, "student_no", 1000);
    const courses = await listAll(supabase, "courses", "id,name", "name", 500);
    const studentById = new Map(students.map((s) => [s.id, s]));
    const courseById = new Map(courses.map((c) => [c.id, c]));
    for (const a of items) {
      const s = studentById.get(a.student_id);
      a.student_name = s?.name ?? "（学生已删除）";
      a.student_no = s?.student_no ?? "-";
      a.class_name = s?.class_name ?? "";
      a.course_name = a.course_id ? courseById.get(a.course_id)?.name ?? "（课程已删除）" : "";
      a.reporter_name = a.reporter_student_id ? studentById.get(a.reporter_student_id)?.name ?? "（学生已删除）" : "";
    }
    items.sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0));
    return json({ ok: true, data: items });
  }
  if (action === "term_evaluations") {
    let items = await listAll(supabase, "term_evaluations", TE_COLS, "created_at", 2000);
    if (member.role === "student") items = items.filter((r) => r.student_id === member.student_id);
    const students = await listAll(supabase, "students", STUDENT_COLS, "student_no", 1000);
    const studentById = new Map(students.map((s) => [s.id, s]));
    for (const r of items) {
      const s = studentById.get(r.student_id);
      r.student_name = s?.name ?? "（学生已删除）";
      r.student_no = s?.student_no ?? "-";
      r.class_name = s?.class_name ?? "";
    }
    items.sort((a, b) => (a.term > b.term ? -1 : a.term < b.term ? 1 : a.student_no < b.student_no ? -1 : 1));
    return json({ ok: true, data: items });
  }
  if (action === "positions") {
    let items = await listAll(supabase, "student_positions", POSITION_COLS, "created_at", 2000);
    if (member.role === "student") items = items.filter((p) => p.student_id === member.student_id);
    const students = await listAll(supabase, "students", STUDENT_COLS, "student_no", 1000);
    const studentById = new Map(students.map((s) => [s.id, s]));
    for (const r of items) {
      const s = studentById.get(r.student_id);
      r.student_name = s?.name ?? "（学生已删除）";
      r.student_no = s?.student_no ?? "-";
      r.class_name = s?.class_name ?? "";
    }
    items.sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      if (a.appointed_on !== b.appointed_on) return a.appointed_on < b.appointed_on ? 1 : -1;
      return a.student_no < b.student_no ? -1 : 1;
    });
    return json({ ok: true, data: items });
  }
  if (action === "honors") {
    // 学生端不可见：荣誉台账只对辅导员/管理员开放
    if (member.role === "student") return fail("access_denied", 403);
    const items = await listAll(supabase, "student_honors", HONOR_COLS, "created_at", 2000);
    const students = await listAll(supabase, "students", STUDENT_COLS, "student_no", 1000);
    const studentById = new Map(students.map((s) => [s.id, s]));
    for (const r of items) {
      const s = studentById.get(r.student_id);
      r.student_name = s?.name ?? "（学生已删除）";
      r.student_no = s?.student_no ?? "-";
      r.class_name = s?.class_name ?? "";
    }
    items.sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      if (a.granted_on !== b.granted_on) return a.granted_on < b.granted_on ? 1 : -1;
      return a.student_no < b.student_no ? -1 : 1;
    });
    return json({ ok: true, data: items });
  }
  if (action === "evaluation_settings") {
    return json({ ok: true, data: await readEvaluationSettings(supabase) });
  }
  if (action === "messages") {
    let items = await listAll(supabase, "messages", MESSAGE_COLS, "created_at", 1000);
    if (member.role === "student") items = items.filter((m) => m.student_id === member.student_id);
    items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    return json({ ok: true, data: items });
  }
  if (action === "leave_rules") {
    return json({ ok: true, data: await readLeaveRules(supabase) });
  }
  if (action === "registration_settings") {
    return json({ ok: true, data: { open: await readRegistrationOpen(supabase) } });
  }
  if (action === "feedback") {
    let items = await listAll(supabase, "feedback", FEEDBACK_COLS, "created_at", 1000);
    if (member.role !== "admin") items = items.filter((f) => f.user_id === member.id);
    items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    return json({ ok: true, data: items });
  }
  if (action === "audit_logs") {
    if (member.role === "student") return fail("access_denied", 403);
    const items = await listAll(supabase, "audit_logs", LOG_COLS, "created_at", 500, false);
    return json({ ok: true, data: items });
  }
  if (action === "attachments") {
    let items = await listAll(supabase, "app_attachments", ATTACH_COLS, "created_at", 1000);
    if (member.role === "student") {
      const mine = new Set(
        // 必须 select student_id：只取 id 时下面过滤恒为空，学生看不到自己的材料
        (await listAll(supabase, "records", "id,student_id", "occurred_on", 1000))
          .filter((r) => r.student_id && r.student_id === member.student_id)
          .map((r) => r.id)
      );
      items = items.filter((a) => mine.has(a.record_id));
    }
    return json({ ok: true, data: items.map(publicAttachment) });
  }
  if (action === "photos") {
    const rows = await listAll(supabase, "student_photos", PHOTO_COLS, "updated_at", 3000);
    const mine = member.role === "student" ? rows.filter((p) => p.student_id === member.student_id) : rows;
    return json({ ok: true, data: mine.map(publicPhoto) });
  }
  return fail("unknown_action", 404);
}

const BUSINESS_READS = new Set(["students", "records", "rooms", "courses", "grades", "audit_logs", "attachments", "messages", "leave_rules", "registration_settings", "feedback", "attendance", "term_evaluations", "evaluation_settings", "positions", "honors", "classmates", "photos"]);
const PUBLIC_WRITE_ACTIONS = new Set(["auth.lookup", "auth.login", "auth.bootstrap", "auth.student_register"]);
const SELF_WRITE_ACTIONS = new Set(["auth.logout", "auth.change_password", "auth.bind_phone"]);
const STUDENT_WRITE_ACTIONS = new Set(["profile.submit", "leave.submit", "leave.cancel", "message.send", "attendance.report"]);
const STAFF_WRITE_ACTIONS = new Set(["message.reply", "leave_rules.save", "registration_settings.save", "evaluation_settings.save", "position.create", "position.revoke", "position.set_attend_report", "honor.create", "honor.bulk_create", "honor.update", "honor.revoke", "honor.delete"]);
const ADMIN_WRITE_ACTIONS = new Set(["account.create", "account.update", "account.reset_password"]);
const FEEDBACK_SUBMIT_ACTIONS = new Set(["feedback.submit"]);
const FEEDBACK_ADMIN_ACTIONS = new Set(["feedback.reply"]);
const ATTACHMENT_ACTIONS = new Set(["attachment.prepare", "attachment.complete", "attachment.download", "attachment.delete"]);
const PHOTO_ACTIONS = new Set(["photo.prepare", "photo.complete", "photo.delete", "photo.urls"]);
const BUSINESS_ACTIONS = new Set([
  ...WRITE_ACTIONS, ...SELF_WRITE_ACTIONS, ...ADMIN_WRITE_ACTIONS,
  ...ATTACHMENT_ACTIONS, ...PHOTO_ACTIONS, ...STUDENT_WRITE_ACTIONS, ...STAFF_WRITE_ACTIONS,
  ...FEEDBACK_SUBMIT_ACTIONS, ...FEEDBACK_ADMIN_ACTIONS,
]);

// 管理员动作的审计详情：绝不记录口令字段
function accountDetail(action, body) {
  if (action === "account.create") {
    return JSON.stringify({ username: body.username, role: body.role, display_name: body.display_name });
  }
  if (action === "account.update") {
    return JSON.stringify({ id: body.id, role: body.role, status: body.status, display_name: body.display_name });
  }
  return JSON.stringify({ id: body.id });
}

export async function handleApi({ request, supabase }) {
  const params = new URL(request.url).searchParams;
  try {
    if (request.method === "GET") {
      const action = params.get("action");
      if (action === "auth_status") {
        const users = await listAll(supabase, "app_users", "id", "created_at", 1);
        let qoderLoggedIn = false;
        try {
          qoderLoggedIn = getUser(request) !== null;
        } catch {
          qoderLoggedIn = false;
        }
        return json({
          ok: true,
          need_bootstrap: users.length === 0,
          qoder_logged_in: qoderLoggedIn,
          student_register_open: await readRegistrationOpen(supabase),
        });
      }
      const session = await resolveSession(supabase, request);
      if (!session) return fail("login_required", 401);
      const member = session.member;
      if (member.must_change === 1 && action !== "auth_me") return fail("password_change_required", 403);
      if (action === "auth_me") return json({ ok: true, data: publicMember(member) });
      if (action === "account.list") {
        if (member.role !== "admin") return fail("access_denied", 403);
        const items = await listAll(supabase, "app_users", USER_BASE_COLS, "created_at", 200);
        return json({ ok: true, data: items.map(publicMember) });
      }
      if (action === "audit_logs" && member.role !== "admin") return fail("access_denied", 403);
      if (member.role === "student" && ["account.list", "registration_settings"].includes(action)) return fail("access_denied", 403);
      if (!BUSINESS_READS.has(action)) return fail("unknown_action", 404);
      return await handleRead({ supabase, params, member });
    }
    if (request.method !== "POST") return fail("method_not_allowed", 405);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return fail("invalid_content_type");
    const raw = await request.text();
    if (raw.length > 64 * 1024) return fail("body_too_large");
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail("invalid_json");
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") {
      return fail("invalid_request");
    }
    const action = body.action;
    if (PUBLIC_WRITE_ACTIONS.has(action)) {
      return await handlePublicAuth({ supabase, action, body, request });
    }
    if (!BUSINESS_ACTIONS.has(action)) return fail("unknown_action", 404);
    const session = await resolveSession(supabase, request);
    if (!session) return fail("login_required", 401);
    const member = session.member;
    if (member.must_change === 1 && action !== "auth.change_password" && action !== "auth.logout") {
      return fail("password_change_required", 403);
    }
    if (ADMIN_WRITE_ACTIONS.has(action) && member.role !== "admin") return fail("access_denied", 403);
    if (STAFF_WRITE_ACTIONS.has(action) && member.role === "student") return fail("access_denied", 403);
    if (member.role === "student" && WRITE_ACTIONS.has(action)) return fail("access_denied", 403);
    let res;
    if (SELF_WRITE_ACTIONS.has(action)) {
      res = await handleSelfWrite({ supabase, action, body, session });
    } else if (ADMIN_WRITE_ACTIONS.has(action)) {
      res = await handleAccountWrite({ supabase, action, body, member });
    } else if (STAFF_WRITE_ACTIONS.has(action)) {
      res = await handleStaffWrite({ supabase, action, body, member });
    } else if (FEEDBACK_ADMIN_ACTIONS.has(action)) {
      if (member.role !== "admin") return fail("access_denied", 403);
      res = await handleFeedbackWrite({ supabase, action, body, member });
    } else if (FEEDBACK_SUBMIT_ACTIONS.has(action)) {
      res = await handleFeedbackWrite({ supabase, action, body, member });
    } else if (STUDENT_WRITE_ACTIONS.has(action)) {
      if (member.role !== "student") return fail("access_denied", 403);
      res = await handleStudentWrite({ supabase, action, body, member });
    } else if (ATTACHMENT_ACTIONS.has(action)) {
      res = await handleAttachmentWrite({ supabase, action, body, member });
    } else if (PHOTO_ACTIONS.has(action)) {
      res = await handlePhotoWrite({ supabase, action, body, member });
    } else {
      res = await handleWrite({ supabase, action, body });
    }
    // 下载/取 URL 属于读取行为，不写审计，避免噪声
    if (res.status === 200 && action !== "attachment.download" && action !== "photo.urls") {
      const detail = ADMIN_WRITE_ACTIONS.has(action)
        ? accountDetail(action, body)
        : (() => {
            const { action: _omit, rows, student_ids, password, old_password, new_password, ...rest } = body;
            if (Array.isArray(rows)) return `rows=${rows.length} ${JSON.stringify(rest)}`;
            // 批量授予只留人数，避免整串 UUID 灌进审计详情
            if (Array.isArray(student_ids)) return `students=${student_ids.length} ${JSON.stringify(rest)}`;
            return JSON.stringify(rest);
          })();
      await logAction(supabase, actorFrom(member), action, auditTarget(body), detail);
    }
    return res;
  } catch (error) {
    if (error && error.db) return fail("database_request_failed", 503);
    throw error;
  }
}
