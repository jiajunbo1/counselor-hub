// 本地样例数据服务：用真实的 functions/handler.mjs + 内存假数据库，供开发预览代理使用。
// 仅供本地验证，不会进入发布包（dev/ 目录在 webDirectory 与 functionDirectory 之外）。
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

// 最小真彩 PNG 编码器：样例证件照需要可被浏览器解码的真实字节
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function solidPng(width, height, top, bottom) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const [r, g, b] = y < height / 2 ? top : bottom;
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const handler = (await import(pathToFileURL(resolve("functions/handler.mjs")).href)).handleApi;
const port = Number(process.argv[2] ?? 8123);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");

const db = {
  students: [],
  records: [],
  dorm_rooms: [],
  courses: [],
  grades: [],
  audit_logs: [],
  app_users: [],
  app_sessions: [],
  app_attachments: [],
  messages: [],
  leave_rules: [],
  registration_settings: [],
  feedback: [],
  attendance: [],
  term_evaluations: [],
  evaluation_settings: [],
  student_positions: [],
  student_honors: [],
  student_photos: [],
};

// 内存假存储：模拟平台注入的 storage SDK 与同源相对签名 URL。
const storageObjects = new Map();
globalThis.__appStorage = {
  async createSignedUploadUrl(objectPath) {
    if (storageObjects.has(objectPath)) throw new Error("object exists");
    return { signedUrl: `/fake-storage/put/${objectPath}` };
  },
  async createSignedUrl(objectPath) {
    return { signedUrl: `/fake-storage/get/${objectPath}` };
  },
  async download(objectPath) {
    const o = storageObjects.get(objectPath);
    if (!o) return new Response(null, { status: 404 });
    return new Response(o.bytes, { headers: { "content-type": o.contentType } });
  },
  async remove(paths) {
    for (const p of paths) storageObjects.delete(p);
    return { ok: true };
  },
  async upload(objectPath, bytes, { contentType = "application/octet-stream" } = {}) {
    storageObjects.set(objectPath, { bytes: new Uint8Array(await new Response(bytes).arrayBuffer()), contentType });
    return { ok: true };
  },
};

const seed = () => {
  const room = (building, room_no, capacity, room_gender, note = "") => {
    const r = { id: randomUUID(), building, room_no, capacity, room_gender, note, created_at: "2026-09-01T00:00:00Z" };
    db.dorm_rooms.push(r);
    return r;
  };
  const student = (student_no, name, gender, class_name, major, grade, phone, political_status, native_place) => {
    const s = { id: randomUUID(), student_no, name, gender, class_name, major, grade, phone, political_status, native_place, dorm_room_id: null, bed_no: null, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" };
    db.students.push(s);
    return s;
  };
  const record = (stu, type, title, content, status, occurred_on) => {
    db.records.push({ id: randomUUID(), student_id: stu.id, type, title, content, status, occurred_on, created_at: "2026-09-01T00:00:00Z" });
  };

  const r1 = room("梅园1栋", "101", 4, "男", "");
  const r2 = room("梅园1栋", "102", 4, "男", "");
  const r3 = room("梅园2栋", "205", 4, "女", "");
  const r4 = room("梅园2栋", "206", 6, "女", "含阳台");
  const r5 = room("竹园3栋", "301", 4, "男", "");

  const s1 = student("2024010101", "张伟", "男", "计算机2401", "计算机科学与技术", "2024", "13800000001", "共青团员", "河北石家庄");
  const s2 = student("2024010102", "李强", "男", "计算机2401", "计算机科学与技术", "2024", "13800000002", "群众", "山西太原");
  const s3 = student("2024010103", "王芳", "女", "计算机2401", "计算机科学与技术", "2024", "13800000003", "中共党员", "陕西西安");
  const s4 = student("2024010104", "赵敏", "女", "计算机2401", "计算机科学与技术", "2024", "13800000004", "共青团员", "河南郑州");
  const s5 = student("2024010105", "陈晨", "男", "计算机2401", "计算机科学与技术", "2024", "13800000005", "共青团员", "山东济南");
  const s6 = student("2024010106", "刘洋", "男", "计算机2401", "计算机科学与技术", "2024", "13800000006", "群众", "辽宁沈阳");
  const s7 = student("2024020201", "孙悦", "女", "软件2402", "软件工程", "2024", "13800000007", "共青团员", "江苏南京");
  const s8 = student("2024020202", "周涛", "男", "软件2402", "软件工程", "2024", "13800000008", "群众", "湖北武汉");
  const s9 = student("2024020203", "吴静", "女", "软件2402", "软件工程", "2024", "13800000009", "中共党员", "四川成都");
  const s10 = student("2024020204", "郑豪", "男", "软件2402", "软件工程", "2024", "13800000010", "共青团员", "福建厦门");
  const s11 = student("2023030301", "冯雪", "女", "数据2303", "数据科学与大数据技术", "2023", "13800000011", "共青团员", "湖南长沙");
  const s12 = student("2023030302", "蒋磊", "男", "数据2303", "数据科学与大数据技术", "2023", "13800000012", "群众", "安徽合肥");

  const assign = (s, room, bed) => { s.dorm_room_id = room.id; s.bed_no = bed; };
  assign(s1, r1, 1); assign(s2, r1, 2); assign(s6, r2, 1);
  assign(s3, r3, 1); assign(s4, r3, 2); assign(s7, r4, 1); assign(s9, r4, 2); assign(s11, r4, 3);
  assign(s5, r5, 1);

  record(s1, "leave", "请假：回家处理证件", "身份证遗失，需回户籍地补办，周五下午离校。", "approved", "2026-09-11");
  record(s1, "talk", "学期初谈心", "适应情况良好，建议参加ACM新生赛。", "done", "2026-09-05");
  record(s4, "award", "获院级辩论赛亚军", "代表班级参加新生辩论赛。", "done", "2026-09-12");
  record(s8, "leave", "请假：病假两天", "发烧就诊，附校医院证明。", "pending", "2026-09-22");
  record(s8, "punish", "晚归通报一次", "宿舍检查发现晚归，已谈话提醒。", "done", "2026-09-18");
  record(s9, "talk", "入党培养联系人谈话", "思想汇报情况交流。", "done", "2026-09-15");
  record(s12, "leave", "请假：参加学科竞赛集训", "为期一周的集训，家长已知晓。", "pending", "2026-09-23");

  const course = (name, course_code, teacher, semester, class_name, schedule, classroom, credit) => {
    const c = { id: randomUUID(), name, course_code, teacher, semester, class_name, schedule, classroom, credit, created_at: "2026-09-01T00:00:00Z" };
    db.courses.push(c);
    return c;
  };
  const math = course("高等数学（上）", "MATH1001", "钱良骏", "2026-2027-1", "计算机2401", "周一 1-2节；周三 3-4节", "教一 201", "5");
  const prog = course("程序设计基础", "CS1002", "许文博", "2026-2027-1", "计算机2401", "周二 5-6节；周四 1-2节", "机房A 302", "3");
  course("思想道德与法治", "IDE1003", "孙雅琴", "2026-2027-1", "计算机2401", "周五 3-4节", "教二 105", "2");
  course("离散数学", "MATH1202", "钱良骏", "2026-2027-1", "软件2402", "周一 5-6节", "教一 210", "3");
  const ds = course("数据结构", "CS2001", "李慕白", "2026-2027-1", "数据2303", "周三 1-2节；周五 5-6节", "教三 404", "4");

  // 上一学期（2025-2026-2）的期中考试成绩，用于演示筛选与排序
  const grade = (stu, courseRow, term, score, exam_date) => {
    db.grades.push({ id: randomUUID(), student_id: stu.id, course_id: courseRow.id, term, score, exam_date, created_at: "2026-06-20T00:00:00Z" });
  };
  grade(s1, math, "2025-2026-2", "92", "2026-06-18");
  grade(s1, prog, "2025-2026-2", "85.5", "2026-06-15");
  grade(s2, math, "2025-2026-2", "58", "2026-06-18");
  grade(s2, prog, "2025-2026-2", "76", "2026-06-15");
  grade(s3, math, "2025-2026-2", "88", "2026-06-18");
  grade(s4, math, "2025-2026-2", "95", "2026-06-18");
  grade(s4, prog, "2025-2026-2", "91", "2026-06-15");
  grade(s5, math, "2025-2026-2", "67", "2026-06-18");
  grade(s6, math, "2025-2026-2", "49", "2026-06-18");
  grade(s7, math, "2025-2026-2", "79", "2026-06-18");
  grade(s8, math, "2025-2026-2", "63", "2026-06-18");
  grade(s9, math, "2025-2026-2", "81", "2026-06-18");
  grade(s10, math, "2025-2026-2", "72.5", "2026-06-18");
  grade(s11, ds, "2025-2026-2", "90", "2026-06-20");
  grade(s12, ds, "2025-2026-2", "55", "2026-06-20");

  // 考勤台账演示：迟到/旷课/请假各若干，用于平时分折算与预警
  const attend = (stu, courseRow, term, occurred_on, kind, note = "", { source = "staff", reporter = null } = {}) => {
    db.attendance.push({
      id: randomUUID(), student_id: stu.id, course_id: courseRow?.id ?? null, term, occurred_on, kind, note,
      source, reporter_student_id: reporter, created_at: "2026-06-01T00:00:00Z",
    });
  };
  attend(s2, math, "2025-2026-2", "2026-05-11", "absent", "未选课代表登记");
  attend(s2, math, "2025-2026-2", "2026-05-25", "absent", "");
  attend(s2, prog, "2025-2026-2", "2026-05-19", "late", "睡过头");
  attend(s6, math, "2025-2026-2", "2026-04-13", "absent", "连续旷课已谈话");
  attend(s6, math, "2025-2026-2", "2026-05-18", "absent", "");
  attend(s6, math, "2025-2026-2", "2026-06-01", "absent", "");
  attend(s6, prog, "2025-2026-2", "2026-05-28", "late", "");
  attend(s8, math, "2025-2026-2", "2026-05-06", "late", "");
  attend(s8, math, "2025-2026-2", "2026-05-20", "leave", "病假一天（已批）");
  attend(s12, ds, "2025-2026-2", "2026-05-13", "early", "身体不适早退");
  // 班委上报演示：班长（s3）代报同班同学 + 与老师同节课重复登记（只按最重的一条扣分）
  attend(s5, math, "2025-2026-2", "2026-05-11", "late", "班长代记：迟到 12 分钟", { source: "monitor", reporter: s3.id });
  attend(s5, math, "2025-2026-2", "2026-05-25", "late", "班长代记", { source: "monitor", reporter: s3.id });
  attend(s6, prog, "2025-2026-2", "2026-05-19", "late", "班长代记", { source: "monitor", reporter: s3.id });
  attend(s2, math, "2025-2026-2", "2026-05-11", "late", "班长重复上报（同节课，不重复扣分）", { source: "monitor", reporter: s3.id });

  // 学期综合测评演示：辅导员期末评定的平时总评（s6/s8 故意留空=未录入）
  const termEval = (stu, term, usual_score, note = "") => {
    db.term_evaluations.push({ id: randomUUID(), student_id: stu.id, term, usual_score, note, created_at: "2026-06-25T00:00:00Z", updated_at: "2026-06-25T00:00:00Z" });
  };
  termEval(s1, "2025-2026-2", "92", "担任课代表");
  termEval(s2, "2025-2026-2", "80");
  termEval(s3, "2025-2026-2", "90");
  termEval(s4, "2025-2026-2", "95");
  termEval(s5, "2025-2026-2", "78");
  termEval(s7, "2025-2026-2", "88");
  termEval(s9, "2025-2026-2", "92");
  termEval(s10, "2025-2026-2", "82");
  termEval(s11, "2025-2026-2", "90");
  termEval(s12, "2025-2026-2", "70");

  // 职务委任演示：现任班委若干 + 一条已撤销留档
  const position = (stu, title, appointed_on, { status = "active", note = "", revoked_at = null, attend_report = false } = {}) => {
    db.student_positions.push({
      id: randomUUID(), student_id: stu.id, title, note, status, appointed_on, revoked_at, attend_report,
      created_at: `${appointed_on}T00:00:00Z`, updated_at: revoked_at ?? `${appointed_on}T00:00:00Z`,
    });
  };
  position(s3, "班长", "2026-09-08", { note: "全面负责班级事务", attend_report: true });
  position(s1, "课代表", "2026-09-08", { note: "高数/程序设计两门课" });
  position(s4, "学习委员", "2026-09-08", { attend_report: true });
  position(s6, "体育委员", "2025-09-10", { status: "revoked", revoked_at: "2026-03-01T00:00:00Z", note: "因连续旷课调整" });

  // 荣誉台账演示：按 2025-2026-2 综合名次授予 + 一条撤销留档
  const honor = (stu, title, level, term, granted_on, { status = "active", note = "", revoked_at = null, granted_by = "示例辅导员" } = {}) => {
    db.student_honors.push({
      id: randomUUID(), student_id: stu.id, title, level, term, granted_on, note,
      status, revoked_at, granted_by,
      created_at: `${granted_on}T00:00:00Z`, updated_at: revoked_at ?? `${granted_on}T00:00:00Z`,
    });
  };
  honor(s4, "学习标兵", "校级", "2025-2026-2", "2026-09-10", { note: "综合分年级第一" });
  honor(s3, "三好学生", "校级", "2025-2026-2", "2026-09-10");
  honor(s9, "三好学生", "院级", "2025-2026-2", "2026-09-10");
  honor(s6, "优秀学生干部", "班级", "2025-2026-2", "2026-03-05", { status: "revoked", revoked_at: "2026-03-20T00:00:00Z", note: "因晚归通报取消" });

  // 证件照演示：王芳一张 240x320 双色示例照（真实上传走 photo.* 链路）
  {
    const id = randomUUID();
    const bytes = new Uint8Array(solidPng(240, 320, [30, 64, 175], [245, 245, 245]));
    storageObjects.set(`avatars/${s3.id}/${id}.png`, { bytes, contentType: "image/png" });
    db.student_photos.push({
      id, student_id: s3.id, uploader_id: "seed-counselor", uploader_name: "示例辅导员",
      original_name: "王芳-证件照.png", content_type: "image/png", size_bytes: String(bytes.length),
      object_path: `avatars/${s3.id}/${id}.png`, created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z",
    });
  }

  // 综测口径演示：默认考试 70 / 平时 30，旷课扣 5、迟到扣 1、请假不扣
  db.evaluation_settings.push({
    id: randomUUID(), exam_weight: "70", usual_weight: "30",
    absent_deduct: "5", late_deduct: "1", leave_deduct: "0", updated_at: "2026-09-01T00:00:00Z",
  });

  // 请假规则演示：单次最多 7 天、需提前 1 天、必须上传材料
  db.leave_rules.push({
    id: randomUUID(), max_days: "7", advance_days: "1", require_material: true,
    material_note: "病假需校医院证明，事假需家长知情说明", updated_at: "2026-09-01T00:00:00Z",
  });
  db.messages.push({
    id: randomUUID(), student_id: s3.id, sender_id: "seed", sender_name: "王芳", sender_role: "student",
    body: "老师您好，我想咨询一下转专业的流程，什么时间方便找您？", replied: 0, reply_note: "", created_at: "2026-09-20T09:00:00Z",
  });
  db.feedback.push({
    id: randomUUID(), user_id: "seed-counselor", user_name: "示例辅导员", role: "counselor",
    category: "feature", content: "希望宿舍列表支持按楼栋筛选，方便集中查寝。",
    status: "optimizing", reply_note: "已排入开发计划，下个版本支持楼栋筛选。",
    replied_at: "2026-09-22T10:00:00Z", created_at: "2026-09-21T08:30:00Z", updated_at: "2026-09-22T10:00:00Z",
  });
};
seed();

const UNIQUE = {
  students: [
    (row, all) => all.some((r) => r.id !== row.id && r.student_no === row.student_no),
    (row, all) => row.dorm_room_id != null && row.bed_no != null &&
      all.some((r) => r.id !== row.id && r.dorm_room_id === row.dorm_room_id && r.bed_no === row.bed_no),
  ],
  dorm_rooms: [(row, all) => all.some((r) => r.id !== row.id && r.building === row.building && r.room_no === row.room_no)],
  records: [],
  courses: [],
  grades: [],
  audit_logs: [],
  app_users: [(row, all) => all.some((r) => r.id !== row.id && r.username === row.username)],
  app_sessions: [(row, all) => all.some((r) => r.id !== row.id && r.token_hash === row.token_hash)],
  app_attachments: [(row, all) => all.some((r) => r.id === row.id)],
  messages: [],
  leave_rules: [],
  registration_settings: [],
  feedback: [],
  attendance: [],
  term_evaluations: [(row, all) => all.some((r) => r.id !== row.id && r.student_id === row.student_id && r.term === row.term)],
  evaluation_settings: [],
  student_positions: [],
  student_honors: [],
  student_photos: [(row, all) => all.some((r) => r.id !== row.id && r.student_id === row.student_id)],
};
const dupError = () => ({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } });

function makeBuilder(table) {
  const state = {
    op: "select", row: null, patch: null, filters: [], orderCol: null,
    orderAsc: true, limitN: null, singleMode: null, returning: null,
  };
  const builder = {
    select(cols) { state.returning = cols; return builder; },
    insert(row) { state.op = "insert"; state.row = row; return builder; },
    upsert(row, { onConflict } = {}) { state.op = "upsert"; state.row = row; state.conflict = onConflict; return builder; },
    update(patch) { state.op = "update"; state.patch = patch; return builder; },
    delete() { state.op = "delete"; return builder; },
    eq(col, value) { state.filters.push(["eq", col, value]); return builder; },
    neq(col, value) { state.filters.push(["neq", col, value]); return builder; },
    in(col, values) { state.filters.push(["in", col, values]); return builder; },
    order(col, { ascending = true } = {}) { state.orderCol = col; state.orderAsc = ascending; return builder; },
    limit(n) { state.limitN = n; return builder; },
    single() { state.singleMode = "single"; return builder; },
    maybeSingle() { state.singleMode = "maybe"; return builder; },
    then(onOk, onErr) {
      return Promise.resolve(run()).then(onOk, onErr);
    },
  };
  const colsOf = (row) => {
    if (!state.returning) return { ...row };
    const cols = state.returning.split(",").map((c) => c.trim());
    if (cols.length === 1 && cols[0] === "*") return { ...row };
    const out = {};
    for (const c of cols) if (c in row) out[c] = row[c];
    return out;
  };
  async function run() {
    const rows = db[table];
    if (state.op === "insert") {
      const row = { id: randomUUID(), created_at: new Date().toISOString(), ...state.row };
      if (UNIQUE[table].some((check) => check(row, rows))) return dupError();
      rows.push(row);
      const result = colsOf(row);
      return { data: result, error: null };
    }
    let matches = rows.filter((r) => state.filters.every(([op, c, v]) =>
      op === "in" ? v.includes(r[c]) : op === "neq" ? r[c] !== v : r[c] === v));
    if (state.op === "upsert") {
      // 仅支持单冲突列（照片表用 student_id）
      const row = { created_at: new Date().toISOString(), ...state.row };
      const idx = rows.findIndex((r) => r[state.conflict] === row[state.conflict]);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
      else rows.push(row);
      if (UNIQUE[table].some((check) => check(row, rows))) return dupError();
      return { data: colsOf(row), error: null };
    }
    if (state.op === "update") {
      const next = matches.map((r) => ({ ...r, ...state.patch }));
      for (const candidate of next) {
        const virtual = rows.map((r) => (matches.includes(r) ? candidate : r));
        if (UNIQUE[table].some((check) => check(candidate, virtual))) return dupError();
      }
      for (const r of matches) Object.assign(r, state.patch);
    } else if (state.op === "delete") {
      for (const r of matches) rows.splice(rows.indexOf(r), 1);
    } else {
      matches = [...matches];
      if (state.orderCol) {
        matches.sort((a, b) => {
          const av = a[state.orderCol] ?? "", bv = b[state.orderCol] ?? "";
          return (av < bv ? -1 : av > bv ? 1 : 0) * (state.orderAsc ? 1 : -1);
        });
      }
    }
    if (state.limitN !== null) matches = matches.slice(0, state.limitN);
    const data = matches.map(colsOf);
    if (state.singleMode === "single") {
      if (data.length !== 1) return { data: null, error: { code: data.length === 0 ? "PGRST116" : "multiple", message: "single row expected" } };
      return { data: data[0], error: null };
    }
    if (state.singleMode === "maybe") {
      if (data.length > 1) return { data: null, error: { code: "multiple", message: "multiple rows" } };
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null };
  }
  return builder;
}

const supabase = { from: (table) => (table in db ? makeBuilder(table) : { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, then: () => Promise.resolve({ data: null, error: { code: "42P01", message: "no such table" } }) }) };

// 启动时走真实 handler：初始化首个管理员 + 建一个辅导员演示账号
const contextHeader = () => {
  const value = { user_id: "local-dev-user", name: "本地演示用户", picture: "", site_id: "local", host_id: "local", session_expires_at: Math.floor(Date.now() / 1000) + 86400 };
  return Buffer.from(JSON.stringify(value)).toString("base64url");
};
async function callHandler(body, token) {
  const request = new Request(`http://127.0.0.1:${port}/functions/v1/app`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-qoder-user-context": contextHeader(), ...(token ? { "x-app-token": token } : {}) },
    body: JSON.stringify(body),
  });
  const response = await handler({ request, supabase });
  return await response.json();
}
const boot = await callHandler({ action: "auth.bootstrap", username: "admin", display_name: "系统管理员", password: "admin123456" });
if (!boot.ok) console.warn("fixture bootstrap failed:", JSON.stringify(boot));
if (boot.ok) {
  const login = await callHandler({ action: "auth.login", username: "admin", password: "admin123456" });
  if (login.ok) {
    const c = await callHandler({ action: "account.create", username: "counselor", display_name: "示例辅导员", role: "counselor", password: "counselor123" }, login.token);
    if (!c.ok) console.warn("fixture counselor account failed:", JSON.stringify(c));
  }
}
db.audit_logs.length = 0; // 清掉初始化产生的审计，保持样例干净

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith("/fake-storage/put/")) {
      const key = decodeURIComponent(url.pathname.slice("/fake-storage/put/".length));
      const body = [];
      for await (const chunk of incoming) body.push(chunk);
      if (storageObjects.has(key)) { outgoing.writeHead(409); outgoing.end(); return; }
      storageObjects.set(key, { bytes: new Uint8Array(Buffer.concat(body)), contentType: incoming.headers["content-type"] ?? "application/octet-stream" });
      outgoing.writeHead(200, { "content-type": "application/json" });
      outgoing.end('{"ok":true}');
      return;
    }
    if (url.pathname.startsWith("/fake-storage/get/")) {
      const key = decodeURIComponent(url.pathname.slice("/fake-storage/get/".length));
      const o = storageObjects.get(key);
      if (!o) { outgoing.writeHead(404); outgoing.end(); return; }
      outgoing.writeHead(200, { "content-type": o.contentType });
      outgoing.end(Buffer.from(o.bytes));
      return;
    }
    if (url.pathname !== "/functions/v1/app") { outgoing.writeHead(404); outgoing.end(); return; }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const request = new Request(url, {
      method: incoming.method,
      headers: {
        "x-qoder-user-context": contextHeader(),
        ...(incoming.headers["content-type"] ? { "content-type": incoming.headers["content-type"] } : {}),
        ...(incoming.headers["x-app-token"] ? { "x-app-token": incoming.headers["x-app-token"] } : {}),
      },
      body: incoming.method === "POST" && chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const response = await handler({ request, supabase });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, { "content-type": "application/json" });
    outgoing.end('{"error":"local_preview_failed"}');
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`本地样例数据服务（handler 真实逻辑 + 内存假数据）: http://127.0.0.1:${server.address().port}/functions/v1/app?action=students`)
);
