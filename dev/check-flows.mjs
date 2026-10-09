// 本地主流程验证脚本：针对 dev/fixture-server.mjs 上运行的真实 handler。
const B = "http://127.0.0.1:8123/functions/v1/app";
const results = [];
async function call(desc, expect, fn) {
  try {
    const actual = await fn();
    const ok = JSON.stringify(actual) === JSON.stringify(expect);
    results.push(`${ok ? "PASS" : "FAIL"} ${desc}${ok ? "" : ` expected=${JSON.stringify(expect)} actual=${JSON.stringify(actual)}`}`);
    return ok ? actual : null;
  } catch (e) {
    results.push(`FAIL ${desc} threw=${e.message}`);
    return null;
  }
}
const get = async (action, token) => {
  const r = await fetch(`${B}?action=${action}`, token ? { headers: { "x-app-token": token } } : {});
  return { status: r.status, ...(await r.json()) };
};
const post = async (body, token) => {
  const r = await fetch(B, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-app-token": token } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, ...(await r.json()) };
};

// —— 账号体系：登录 / 会话 / RBAC ——
const noToken = await get("students");
results.push(
  noToken.code === "login_required" && noToken.status === 401
    ? "PASS business read requires session token"
    : `FAIL noToken ${JSON.stringify(noToken).slice(0, 120)}`
);
const badLogin = await post({ action: "auth.login", username: "admin", password: "wrong-password" });
results.push(badLogin.code === "login_failed" && badLogin.status === 401 ? "PASS wrong password rejected" : `FAIL badLogin ${JSON.stringify(badLogin)}`);
const reBad = await post({ action: "auth.login", username: "admin", password: "wrong-password" });
results.push(reBad.code === "login_failed" ? "PASS wrong password does not reveal lock state early (still 401)" : `FAIL reBad ${JSON.stringify(reBad)}`);
// 两步式登录第一步：auth.lookup（无令牌可用，只暴露身份类别）
const lkStaff = await post({ action: "auth.lookup", username: "admin" });
results.push(
  lkStaff.ok && lkStaff.status === 200 && lkStaff.found === true && lkStaff.kind === "staff" && lkStaff.display_name === undefined
    ? "PASS auth.lookup staff: anonymous ok, kind=staff, no profile leaked"
    : `FAIL lkStaff ${JSON.stringify(lkStaff)}`
);
const lkMissing = await post({ action: "auth.lookup", username: "nosuchuser" });
results.push(lkMissing.ok && lkMissing.found === false ? "PASS auth.lookup unknown account: found=false" : `FAIL lkMissing ${JSON.stringify(lkMissing)}`);
const lkBad = await post({ action: "auth.lookup", username: "a" });
results.push(lkBad.code === "invalid_request" ? "PASS auth.lookup invalid username rejected" : `FAIL lkBad ${JSON.stringify(lkBad)}`);
// 复位可能的失败计数依赖登录成功路径，下面用正确密码登录管理端
const adminLogin = await post({ action: "auth.login", username: "admin", password: "admin123456" });
results.push(
  adminLogin.ok && /^[0-9a-f]{64}$/.test(adminLogin.token ?? "") && adminLogin.member?.username === "admin" && adminLogin.member?.role === "admin" && adminLogin.member?.must_change === false
    ? "PASS admin login returns 64-hex token + member"
    : `FAIL adminLogin ${JSON.stringify(adminLogin).slice(0, 160)}`
);
const T = adminLogin.token;
if (!T) { console.log(results.join("\n")); process.exit(1); }

const again = await post({ action: "auth.bootstrap", username: "admin2", display_name: "二号", password: "whatever123" }, T);
results.push(again.code === "already_bootstrapped" || again.code === "bootstrap_locked" ? "PASS second bootstrap rejected" : `FAIL again ${JSON.stringify(again)}`);

const me = await get("auth_me", T);
results.push(me.ok && me.data?.username === "admin" && me.data.pass_hash === undefined && me.data.pass_salt === undefined ? "PASS auth_me returns sanitized member" : `FAIL me ${JSON.stringify(me)}`);

// 辅导员账号：首登强制改密
const createC = await post({ action: "account.create", username: "testcounselor", display_name: "测试辅导员", role: "counselor", password: "initpass1" }, T);
results.push(
  createC.ok && createC.item?.must_change === true && createC.item?.role === "counselor" && createC.item?.pass_hash === undefined
    ? "PASS admin creates account (must_change=true, secrets hidden)"
    : `FAIL createC ${JSON.stringify(createC)}`
);
const dupAcc = await post({ action: "account.create", username: "testcounselor", display_name: "重复", role: "counselor", password: "initpass1" }, T);
results.push(dupAcc.code === "username_exists" && dupAcc.status === 409 ? "PASS duplicate username rejected" : `FAIL dupAcc ${JSON.stringify(dupAcc)}`);
const badRole = await post({ action: "account.create", username: "badrole", display_name: "坏", role: "root", password: "initpass1" }, T);
results.push(badRole.code === "invalid_credentials" ? "PASS invalid role rejected" : `FAIL badRole ${JSON.stringify(badRole)}`);
const badPw = await post({ action: "account.create", username: "shortpw", display_name: "短密码", role: "counselor", password: "123" }, T);
results.push(badPw.code === "invalid_credentials" ? "PASS short password rejected" : `FAIL badPw ${JSON.stringify(badPw)}`);

const cLogin = await post({ action: "auth.login", username: "testcounselor", password: "initpass1" });
const CT = cLogin.token;
results.push(cLogin.ok && cLogin.member?.must_change === true ? "PASS counselor login (must_change=true)" : `FAIL cLogin ${JSON.stringify(cLogin).slice(0, 160)}`);
if (CT) {
  const gated = await get("students", CT);
  results.push(gated.code === "password_change_required" && gated.status === 403 ? "PASS must_change gates business reads" : `FAIL gated ${JSON.stringify(gated)}`);
  const gatedW = await post({ action: "course.create", name: "不该成功" }, CT);
  results.push(gatedW.code === "password_change_required" ? "PASS must_change gates writes" : `FAIL gatedW ${JSON.stringify(gatedW)}`);
  const meOk = await get("auth_me", CT);
  results.push(meOk.ok && meOk.data?.username === "testcounselor" ? "PASS auth_me allowed during must_change" : `FAIL meOk ${JSON.stringify(meOk)}`);

  const wrongOld = await post({ action: "auth.change_password", old_password: "nope", new_password: "newpass9" }, CT);
  results.push(wrongOld.code === "password_mismatch" ? "PASS change_password verifies old password" : `FAIL wrongOld ${JSON.stringify(wrongOld)}`);
  const chg = await post({ action: "auth.change_password", new_password: "newpass9" }, CT);
  results.push(chg.ok && chg.member?.must_change === false ? "PASS first-login change_password needs no old password" : `FAIL chg ${JSON.stringify(chg)}`);
  const noOldAfter = await post({ action: "auth.change_password", new_password: "newpass10" }, CT);
  results.push(noOldAfter.code === "invalid_password" ? "PASS old password required after must_change cleared" : `FAIL noOldAfter ${JSON.stringify(noOldAfter)}`);
  const afterChg = await get("students", CT);
  results.push(afterChg.ok && Array.isArray(afterChg.data) ? "PASS business read unlocked after change" : `FAIL afterChg ${JSON.stringify(afterChg).slice(0, 120)}`);
  const notAdmin = await get("account.list", CT);
  results.push(notAdmin.code === "access_denied" && notAdmin.status === 403 ? "PASS account.list admin-only" : `FAIL notAdmin ${JSON.stringify(notAdmin)}`);
  const privEsc = await post({ action: "account.create", username: "sneak", display_name: "越权", role: "admin", password: "initpass1" }, CT);
  results.push(privEsc.code === "access_denied" ? "PASS counselor cannot create accounts" : `FAIL privEsc ${JSON.stringify(privEsc)}`);
  const cLogs = await get("audit_logs", CT);
  results.push(cLogs.code === "access_denied" && cLogs.status === 403 ? "PASS audit_logs admin-only (counselor denied)" : `FAIL cLogs ${JSON.stringify(cLogs)}`);
  const bind = await post({ action: "auth.bind_phone", phone: "13800001234" }, CT);
  results.push(bind.ok && bind.member?.phone === "13800001234" ? "PASS bind phone" : `FAIL bind ${JSON.stringify(bind)}`);
  const badPhone = await post({ action: "auth.bind_phone", phone: "abc" }, CT);
  results.push(badPhone.code === "invalid_phone" ? "PASS invalid phone rejected" : `FAIL badPhone ${JSON.stringify(badPhone)}`);
}

// 锁定策略：连续 5 次错误密码
const lockAcc = await post({ action: "account.create", username: "lockme", display_name: "锁定测试", role: "counselor", password: "lockpass1" }, T);
for (let i = 0; i < 5; i++) await post({ action: "auth.login", username: "lockme", password: "bad" });
const locked = await post({ action: "auth.login", username: "lockme", password: "lockpass1" });
results.push(locked.code === "login_locked" && locked.status === 429 ? "PASS 5 failures locks account for 15min" : `FAIL locked ${JSON.stringify(locked)}`);
const resetPw = await post({ action: "account.reset_password", id: lockAcc.item?.id, password: "lockpass2" }, T);
results.push(resetPw.ok && resetPw.item?.must_change === true ? "PASS admin reset password (must_change again)" : `FAIL resetPw ${JSON.stringify(resetPw)}`);
const afterReset = await post({ action: "auth.login", username: "lockme", password: "lockpass2" });
results.push(afterReset.ok && afterReset.member?.must_change === true ? "PASS reset clears lock, new password works" : `FAIL afterReset ${JSON.stringify(afterReset)}`);
const oldSessionDead = afterReset.token ? await get("auth_me", afterReset.token) : null;
results.push(oldSessionDead?.ok ? "PASS re-login after reset" : `FAIL oldSessionDead ${JSON.stringify(oldSessionDead)}`);

// 重置密码应踢掉旧会话
if (CT) {
  const kick = await post({ action: "account.reset_password", id: createC.item?.id, password: "kickpass1" }, T);
  const kicked = await get("students", CT);
  results.push(kick.ok && kicked.code === "login_required" ? "PASS reset_password invalidates existing sessions" : `FAIL kick ${JSON.stringify(kick)} ${JSON.stringify(kicked)}`);
}

// 最后一个管理员保护
const selfDowngrade = await post({ action: "account.update", id: adminLogin.member?.id, role: "counselor" }, T);
results.push(selfDowngrade.code === "last_admin" && selfDowngrade.status === 409 ? "PASS cannot demote last active admin" : `FAIL selfDowngrade ${JSON.stringify(selfDowngrade)}`);
const selfDisable = await post({ action: "account.update", id: adminLogin.member?.id, status: "disabled" }, T);
results.push(selfDisable.code === "last_admin" ? "PASS cannot disable last active admin" : `FAIL selfDisable ${JSON.stringify(selfDisable)}`);

// account.list 管理员可用
const list = await get("account.list", T);
results.push(
  list.ok && list.data.some((a) => a.username === "admin" && a.role === "admin") && list.data.every((a) => a.pass_hash === undefined && a.pass_salt === undefined)
    ? "PASS account.list for admin (secrets hidden)"
    : `FAIL list ${JSON.stringify(list).slice(0, 160)}`
);

// 停用账号后会话失效
const disAcc = await post({ action: "account.create", username: "disableme", display_name: "停用测试", role: "counselor", password: "dispass1" }, T);
const disLogin = await post({ action: "auth.login", username: "disableme", password: "dispass1" });
const disUpd = await post({ action: "account.update", id: disAcc.item?.id, status: "disabled" }, T);
const disAfter = disLogin.token ? await get("students", disLogin.token) : null;
const disRe = await post({ action: "auth.login", username: "disableme", password: "dispass1" });
results.push(
  disUpd.ok && disAfter?.code === "login_required" && disRe.code === "account_disabled"
    ? "PASS disable kills sessions and blocks re-login"
    : `FAIL disable ${JSON.stringify(disUpd)} ${JSON.stringify(disAfter)} ${JSON.stringify(disRe)}`
);

// 登出使 token 失效
const tempLogin = await post({ action: "auth.login", username: "admin", password: "admin123456" });
if (tempLogin.token) {
  const out = await post({ action: "auth.logout" }, tempLogin.token);
  const dead = await get("auth_me", tempLogin.token);
  results.push(out.ok && dead.code === "login_required" ? "PASS logout invalidates token" : `FAIL logout ${JSON.stringify(out)} ${JSON.stringify(dead)}`);
}

// —— 附件流程（批次 D，使用管理员 token + 假存储直传） ——
const recList = await get("records", T);
const attachRecord = recList.data.find((r) => r.title.includes("病假"));
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const prep = await post({ action: "attachment.prepare", record_id: attachRecord.id, file_name: "校医院证明.png", size: pngBytes.length }, T);
results.push(prep.ok && /^[0-9a-f-]{36}$/.test(prep.id) && prep.upload_url?.startsWith("/fake-storage/put/attachments/") && prep.content_type === "image/png" ? "PASS attachment prepare (server-side path)" : `FAIL prep ${JSON.stringify(prep)}`);
if (prep.ok) {
  const putR = await fetch(`http://127.0.0.1:8123${prep.upload_url}`, { method: "PUT", headers: { "content-type": "image/png" }, body: pngBytes });
  const done = await post({ action: "attachment.complete", id: prep.id, record_id: attachRecord.id, file_name: "校医院证明.png", size: pngBytes.length }, T);
  results.push(putR.ok && done.ok && done.item?.size_bytes === "8" && done.item?.uploader_name === "系统管理员" && done.item?.object_path === undefined ? "PASS upload + complete (verified bytes stored, no path leak)" : `FAIL done ${putR.status} ${JSON.stringify(done)}`);
  const dl = await post({ action: "attachment.download", id: prep.id }, T);
  let bytesBack = null;
  if (dl.ok) bytesBack = new Uint8Array(await (await fetch(`http://127.0.0.1:8123${dl.url}`)).arrayBuffer());
  results.push(dl.ok && bytesBack && bytesBack.length === pngBytes.length && bytesBack[1] === 0x50 ? "PASS download via signed url returns same bytes" : `FAIL dl ${JSON.stringify(dl)}`);
  const attList = await get("attachments", T);
  results.push(attList.ok && attList.data.some((a) => a.id === prep.id && a.record_id === attachRecord.id) ? "PASS attachments listable" : `FAIL attList ${JSON.stringify(attList).slice(0, 160)}`);
  results.push(attList.ok && attList.data.every((a) => a.object_path === undefined) ? "PASS attachments list never leaks object_path" : `FAIL attLeak ${JSON.stringify(attList).slice(0, 160)}`);
  const missing = await post({ action: "attachment.complete", id: "00000000-0000-4000-8000-00000000abcd", record_id: attachRecord.id, file_name: "没上传.png", size: 8 }, T);
  results.push(missing.code === "upload_validation_failed" ? "PASS complete rejects absent object" : `FAIL missing ${JSON.stringify(missing)}`);
}
const exe = await post({ action: "attachment.prepare", record_id: attachRecord.id, file_name: "virus.exe", size: 100 }, T);
results.push(exe.code === "file_type_not_allowed" ? "PASS disallowed extension rejected" : `FAIL exe ${JSON.stringify(exe)}`);
const big = await post({ action: "attachment.prepare", record_id: attachRecord.id, file_name: "a.pdf", size: 6 * 1024 * 1024 }, T);
results.push(big.code === "file_too_large" ? "PASS >5MiB rejected at prepare" : `FAIL big ${JSON.stringify(big)}`);
const fakeRec = await post({ action: "attachment.prepare", record_id: "00000000-0000-4000-8000-000000000000", file_name: "a.pdf", size: 10 }, T);
results.push(fakeRec.code === "not_found" ? "PASS prepare requires existing record" : `FAIL fakeRec ${JSON.stringify(fakeRec)}`);
// 辅导员可清理记录上的材料（含他人上传的），管理员同样可以
const c2Login = await post({ action: "auth.login", username: "testcounselor", password: "kickpass1" });
if (c2Login.ok) {
  await post({ action: "auth.change_password", old_password: "kickpass1", new_password: "counfinal9" }, c2Login.token);
}
if (c2Login.ok) {
  const otherDel = await post({ action: "attachment.delete", id: prep.id }, c2Login.token);
  const afterDel = await post({ action: "attachment.download", id: prep.id }, T);
  const objGone = (await fetch(`http://127.0.0.1:8123/fake-storage/get/attachments/${attachRecord.id}/${prep.id}.png`)).status === 404;
  results.push(
    otherDel.ok && afterDel.code === "not_found" && objGone
      ? "PASS counselor deletes others' material (row + object gone)"
      : `FAIL del ${JSON.stringify(otherDel)} ${JSON.stringify(afterDel)} ${objGone}`
  );
  const p2 = await post({ action: "attachment.prepare", record_id: attachRecord.id, file_name: "假条.jpg", size: pngBytes.length }, c2Login.token);
  if (p2.ok) {
    await fetch(`http://127.0.0.1:8123${p2.upload_url}`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: pngBytes });
    const d2 = await post({ action: "attachment.complete", id: p2.id, record_id: attachRecord.id, file_name: "假条.jpg", size: pngBytes.length }, c2Login.token);
    const adminDel = await post({ action: "attachment.delete", id: p2.id }, T);
    results.push(
      d2.ok && d2.item?.uploader_name === "测试辅导员" && adminDel.ok
        ? "PASS counselor uploads own file; admin can delete others'"
        : `FAIL del2 ${JSON.stringify(d2)} ${JSON.stringify(adminDel)}`
    );
  }
}
// 记录删除级联清理附件
const recWithAtt = await post({ action: "record.create", student_id: recList.data[0].student_id, type: "talk", title: "附件级联测试", content: "", occurred_on: "2026-09-23" }, T);
const p3 = await post({ action: "attachment.prepare", record_id: recWithAtt.item?.id, file_name: "x.png", size: pngBytes.length }, T);
if (p3.ok) {
  await fetch(`http://127.0.0.1:8123${p3.upload_url}`, { method: "PUT", headers: { "content-type": "image/png" }, body: pngBytes });
  await post({ action: "attachment.complete", id: p3.id, record_id: recWithAtt.item.id, file_name: "x.png", size: pngBytes.length }, T);
  const delR = await post({ action: "record.delete", id: recWithAtt.item.id }, T);
  const attAfter = await get("attachments", T);
  const objGone = (await fetch(`http://127.0.0.1:8123/fake-storage/get/attachments/${recWithAtt.item.id}/${p3.id}.png`)).status === 404;
  results.push(delR.ok && attAfter.data.every((a) => a.id !== p3.id) && objGone ? "PASS record delete cascades attachments (rows + objects)" : `FAIL cascade ${JSON.stringify(delR)} ${attAfter.data?.length} ${objGone}`);
}
// 清理剩余附件
const attNow = await get("attachments", T);
for (const a of attNow.data ?? []) await post({ action: "attachment.delete", id: a.id }, T);
const attClean = await get("attachments", T);
results.push((attClean.data ?? []).length === 0 ? "PASS attachment cleanup" : `FAIL attCleanup ${JSON.stringify(attClean).slice(0, 120)}`);

// —— 业务主流程（使用管理员 token） ——
const rooms = await call("rooms readable", true, async () => {
  const j = await get("rooms", T);
  return j.ok && Array.isArray(j.data);
});
if (!rooms) { console.log(results.join("\n")); process.exit(1); }
const data = await get("rooms", T);
const room102 = data.data.find((r) => r.room_no === "102");
const room101 = data.data.find((r) => r.room_no === "101");
const room205 = data.data.find((r) => r.room_no === "205");

const stu = await post({ action: "student.create", student_no: "T0001", name: "测试同学", gender: "男", class_name: "计算机2401", major: "", grade: "2024", phone: "", political_status: "群众", native_place: "" }, T);
results.push(stu.ok && stu.item?.student_no === "T0001" ? "PASS create student" : `FAIL create student ${JSON.stringify(stu)}`);
const sid = stu.item?.id;

const dup = await post({ action: "student.create", student_no: "T0001", name: "重复", gender: "男" }, T);
results.push(dup.code === "student_no_exists" && dup.status === 409 ? "PASS duplicate student_no rejected" : `FAIL duplicate ${JSON.stringify(dup)}`);

const asg = await post({ action: "student.assign", student_id: sid, room_id: room102.id, bed_no: 2 }, T);
results.push(asg.ok && asg.item?.bed_no === 2 ? "PASS assign empty bed" : `FAIL assign ${JSON.stringify(asg)}`);

const clash = await post({ action: "student.assign", student_id: sid, room_id: room101.id, bed_no: 1 }, T);
results.push(clash.code === "bed_occupied" ? "PASS occupied bed rejected" : `FAIL clash ${JSON.stringify(clash)}`);

const mismatch = await post({ action: "student.assign", student_id: sid, room_id: room205.id, bed_no: 4 }, T);
results.push(mismatch.code === "room_gender_mismatch" ? "PASS gender mismatch rejected" : `FAIL mismatch ${JSON.stringify(mismatch)}`);

const rec = await post({ action: "record.create", student_id: sid, type: "leave", title: "测试请假", content: "", occurred_on: "2026-09-23" }, T);
results.push(rec.ok && rec.item?.status === "pending" ? "PASS create leave (pending)" : `FAIL record ${JSON.stringify(rec)}`);
const appr = await post({ action: "record.update", id: rec.item?.id, status: "approved" }, T);
results.push(appr.ok && appr.item?.status === "approved" ? "PASS approve leave" : `FAIL approve ${JSON.stringify(appr)}`);
const apprNote = await post({ action: "record.update", id: rec.item?.id, status: "approved", review_note: "同意，注意安全" }, T);
results.push(apprNote.ok && apprNote.item?.review_note === "同意，注意安全" ? "PASS approve leave with review note" : `FAIL apprNote ${JSON.stringify(apprNote)}`);
const longNote = await post({ action: "record.update", id: rec.item?.id, review_note: "x".repeat(501) }, T);
results.push(longNote.code === "invalid_review_note" ? "PASS review note >500 rejected" : `FAIL longNote ${JSON.stringify(longNote)}`);
const clearNote = await post({ action: "record.update", id: rec.item?.id, review_note: "" }, T);
results.push(clearNote.ok && clearNote.item?.review_note === "" ? "PASS review note can be cleared" : `FAIL clearNote ${JSON.stringify(clearNote)}`);

const roomDel = await post({ action: "room.delete", id: room101.id }, T);
results.push(roomDel.code === "room_not_empty" ? "PASS delete occupied room rejected" : `FAIL roomDel ${JSON.stringify(roomDel)}`);
const capSmall = await post({ action: "room.update", id: room101.id, capacity: 1 }, T);
results.push(capSmall.code === "capacity_too_small" ? "PASS shrink capacity below occupancy rejected" : `FAIL cap ${JSON.stringify(capSmall)}`);

const un = await post({ action: "student.unassign", student_id: sid }, T);
results.push(un.ok && un.item?.dorm_room_id === null ? "PASS unassign" : `FAIL unassign ${JSON.stringify(un)}`);
const delRec = await post({ action: "record.delete", id: rec.item?.id }, T);
results.push(delRec.ok ? "PASS delete record" : `FAIL delRec ${JSON.stringify(delRec)}`);
const del = await post({ action: "student.delete", id: sid }, T);
results.push(del.ok ? "PASS delete student" : `FAIL del ${JSON.stringify(del)}`);

const course = await post({ action: "course.create", name: "测试课程", credit: "2.5", semester: "2026-2027-1", class_name: "计算机2401" }, T);
results.push(course.ok && course.item?.credit === "2.5" ? "PASS create course" : `FAIL course ${JSON.stringify(course)}`);
const badCourse = await post({ action: "course.create", name: "坏学分", credit: "99" }, T);
results.push(badCourse.code === "invalid_credit" ? "PASS bad credit rejected" : `FAIL badCourse ${JSON.stringify(badCourse)}`);
await post({ action: "course.delete", id: course.item?.id }, T);

// —— 成绩流程 ——
const stu2 = await post({ action: "student.create", student_no: "T0002", name: "成绩测试生", gender: "女", class_name: "软件2402" }, T);
const sid2 = stu2.item?.id;
const gcourse = await post({ action: "course.create", name: "成绩测试课", credit: "3", semester: "2025-2026-2", class_name: "软件2402" }, T);
const gcid = gcourse.item?.id;

const g1 = await post({ action: "grade.create", student_id: sid2, course_id: gcid, term: "2025-2026-2", score: "87.5", exam_date: "2026-06-01" }, T);
results.push(
  g1.ok && g1.item?.score === "87.5" && g1.item?.student_name === "成绩测试生" && g1.item?.student_no === "T0002" && g1.item?.class_name === "软件2402" && g1.item?.course_name === "成绩测试课"
    ? "PASS create grade (student info auto-synced)"
    : `FAIL grade ${JSON.stringify(g1)}`
);
const badScore = await post({ action: "grade.create", student_id: sid2, course_id: gcid, term: "t", score: "101" }, T);
results.push(badScore.code === "invalid_request" ? "PASS score>100 rejected" : `FAIL badScore ${JSON.stringify(badScore)}`);
const badStudent = await post({ action: "grade.create", student_id: "00000000-0000-4000-8000-000000000000", course_id: gcid, term: "t", score: "60" }, T);
results.push(badStudent.code === "student_not_found" ? "PASS unknown student rejected" : `FAIL badStudent ${JSON.stringify(badStudent)}`);
const gupd = await post({ action: "grade.update", id: g1.item?.id, score: "59" }, T);
results.push(gupd.ok && gupd.item?.score === "59" ? "PASS update grade" : `FAIL gupd ${JSON.stringify(gupd)}`);

const gl = await get("grades", T);
results.push(
  gl.ok && gl.data.some((x) => x.id === g1.item?.id && x.course_name === "成绩测试课" && x.student_no === "T0002")
    ? "PASS grades readable with joined student/course"
    : `FAIL grades list ${JSON.stringify(gl).slice(0, 200)}`
);

// 课程删除应级联清理成绩
const gdelCourse = await post({ action: "course.delete", id: gcid }, T);
const gl2 = await get("grades", T);
results.push(
  gdelCourse.ok && gl2.data.every((x) => x.id !== g1.item?.id)
    ? "PASS delete course cascades grades"
    : `FAIL course cascade ${JSON.stringify(gl2.data.filter((x) => x.id === g1.item?.id))}`
);

// 学生删除应级联清理成绩
const g2 = await post({ action: "grade.create", student_id: sid2, course_id: gl.data.find((x) => x.course_id !== gcid)?.course_id ?? gcid, term: "t", score: "70" }, T).catch(() => null);
const stuDel = await post({ action: "student.delete", id: sid2 }, T);
const gl3 = await get("grades", T);
results.push(
  stuDel.ok && gl3.data.every((x) => x.student_id !== sid2)
    ? "PASS delete student cascades grades"
    : `FAIL student cascade ${JSON.stringify(stuDel)}`
);
if (g2?.ok) await post({ action: "grade.delete", id: g2.item?.id }, T);

// —— 批量导入与审计日志 ——
const bulk1 = await post({ action: "student.bulk_create", rows: [
  { student_no: "T9001", name: "批量甲", gender: "男", class_name: "计算机2401" },
  { student_no: "T9002", name: "批量乙", gender: "女", class_name: "软件2402" },
  { student_no: "", name: "缺学号", gender: "男" },
] }, T);
results.push(
  bulk1.ok && bulk1.created === 2 && bulk1.skipped.length === 1 && bulk1.skipped[0]?.reason === "invalid_student_no"
    ? "PASS student bulk import (2 created, invalid skipped)"
    : `FAIL bulk1 ${JSON.stringify(bulk1)}`
);
const bulkDup = await post({ action: "student.bulk_create", rows: [{ student_no: "T9001", name: "重复批量", gender: "男" }] }, T);
results.push(
  bulkDup.ok && bulkDup.created === 0 && bulkDup.skipped[0]?.reason === "student_no_exists"
    ? "PASS bulk skips existing student_no"
    : `FAIL bulkDup ${JSON.stringify(bulkDup)}`
);

const gbulk = await post({ action: "grade.bulk_create", rows: [
  { student_no: "T9001", course_name: "高等数学（上）", score: "99", exam_date: "2026-07-01" },
  { student_no: "NO_SUCH_NO", course_name: "高等数学（上）", score: "60" },
  { student_no: "T9001", course_name: "不存在课", score: "60" },
  { student_no: "T9001", course_name: "高等数学（上）", score: "120" },
] }, T);
results.push(
  gbulk.ok && gbulk.created === 1 && gbulk.skipped.length === 3 &&
    gbulk.skipped[0]?.reason === "student_not_found" && gbulk.skipped[1]?.reason === "course_not_found" && gbulk.skipped[2]?.reason === "invalid_score"
    ? "PASS grade bulk import matches + rejects"
    : `FAIL gbulk ${JSON.stringify(gbulk)}`
);
const gl4 = await get("grades", T);
const imported = gl4.data.find((x) => x.student_no === "T9001" && x.score === "99");
results.push(
  imported?.course_name === "高等数学（上）" && imported?.term === "2026-2027-1"
    ? "PASS bulk grade joined info (term falls back to course semester)"
    : `FAIL bulk join ${JSON.stringify(imported)}`
);

const logsJ = await get("audit_logs", T);
const logs = logsJ.data;
results.push(
  Array.isArray(logs) && logs.length > 0 && logs.every((l, i, a) => i === 0 || a[i - 1].created_at >= l.created_at)
    ? `PASS audit logs recorded (${logs.length} entries, desc order)`
    : `FAIL logs ${JSON.stringify(logs).slice(0, 160)}`
);
const hasBulkLog = logs.some((l) => l.action === "student.bulk_create" && l.actor_name === "系统管理员" && /rows=/.test(l.detail));
results.push(hasBulkLog ? "PASS audit log actor from app account + detail" : `FAIL audit detail ${JSON.stringify(logs.slice(0, 3))}`);
const pwLeak = logs.filter((l) => /password|pass_hash|lockpass|initpass|admin123456|counselor123|newpass|kickpass|dispass|whatever/i.test(`${l.detail}`));
results.push(pwLeak.length === 0 ? "PASS no secrets in audit detail" : `FAIL pwLeak ${JSON.stringify(pwLeak.slice(0, 2))}`);
const loginLogged = logs.some((l) => l.action === "auth.login" && l.target === "lockme");
results.push(loginLogged ? "PASS login attempts audited" : `FAIL login audit missing ${JSON.stringify(logs.slice(0, 5).map((l) => l.action))}`);

// 清理批量测试数据（学生删除应级联清掉其成绩）
const t9001 = (await get("students", T)).data.find((s) => s.student_no === "T9001");
if (imported) await post({ action: "grade.delete", id: imported.id }, T);
if (t9001) await post({ action: "student.delete", id: t9001.id }, T);
const t9002 = (await get("students", T)).data.find((s) => s.student_no === "T9002");
if (t9002) await post({ action: "student.delete", id: t9002.id }, T);
const gl5 = await get("grades", T);
results.push(gl5.data.every((x) => x.student_no !== "T9001" && x.student_no !== "T9002" && x.score !== "99") ? "PASS bulk cleanup" : "FAIL bulk cleanup leftover");

// 清理测试账号
for (const uname of ["testcounselor", "lockme", "disableme"]) {
  const acc = (await get("account.list", T)).data.find((a) => a.username === uname);
  if (acc) await post({ action: "account.update", id: acc.id, status: "disabled" }, T);
}

const statsAfter = await get("students", T);
results.push(statsAfter.data.every((s) => s.student_no !== "T0001") ? "PASS cleanup (test student gone)" : "FAIL cleanup leftover");

// —— 学生端（批次 F：自助注册 → 强制改密 → 建档同步 → 请假规则 → 留言） ——
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// 1) 未登记学号注册（无需输密码，服务器分配初始密码）：新建待完善档案，同步到辅导员/管理员端
const reg = await post({ action: "auth.student_register", student_no: "S202699", name: "自助注册生" });
results.push(
  reg.ok && reg.created_profile === true && reg.member?.role === "student" && reg.member?.must_change === true && reg.member?.student_id
    ? "PASS student self-register without password (server-assigned, must_change, bound student_id)"
    : `FAIL reg ${JSON.stringify(reg).slice(0, 180)}`
);
const dupReg = await post({ action: "auth.student_register", student_no: "S202699", name: "自助注册生" });
results.push(dupReg.code === "username_exists" && dupReg.status === 409 ? "PASS duplicate registration rejected" : `FAIL dupReg ${JSON.stringify(dupReg)}`);
// 已登记学号但姓名不符 → 拦截
const nameMism = await post({ action: "auth.student_register", student_no: "2024020201", name: "名字不对" });
results.push(nameMism.code === "name_mismatch" && nameMism.status === 403 ? "PASS existing roster number rejects wrong name" : `FAIL nameMism ${JSON.stringify(nameMism)}`);
// 注册开关：默认开放 → 关闭后拒注册 → 重新开放
const regFlagRead = await get("registration_settings", T);
results.push(regFlagRead.ok && regFlagRead.data?.open === true ? "PASS registration defaults to open (no row = open)" : `FAIL regFlagRead ${JSON.stringify(regFlagRead)}`);
const closeFlag = await post({ action: "registration_settings.save", open: false }, T);
results.push(closeFlag.ok && closeFlag.open === false ? "PASS staff closes registration switch" : `FAIL closeFlag ${JSON.stringify(closeFlag)}`);
const regClosed = await post({ action: "auth.student_register", student_no: "S202698", name: "关闭期注册" });
results.push(regClosed.code === "registration_closed" && regClosed.status === 403 ? "PASS registration rejected while closed" : `FAIL regClosed ${JSON.stringify(regClosed)}`);
const authStatusClosed = await get("auth_status");
results.push(authStatusClosed.ok && authStatusClosed.student_register_open === false ? "PASS auth_status hides register entry when closed" : `FAIL authStatusClosed ${JSON.stringify(authStatusClosed)}`);
const openFlag = await post({ action: "registration_settings.save", open: true }, T);
results.push(openFlag.ok && openFlag.open === true ? "PASS staff reopens registration switch" : `FAIL openFlag ${JSON.stringify(openFlag)}`);
const regReopened = await post({ action: "auth.student_register", student_no: "S202699", name: "自助注册生" });
results.push(regReopened.code === "username_exists" ? "PASS registration flows again after reopen" : `FAIL regReopened ${JSON.stringify(regReopened)}`);
// 管理员端可见新档案（同步）
const rosterAfterReg = await get("students", T);
const syncStudent = rosterAfterReg.data.find((s) => s.student_no === "S202699");
results.push(
  syncStudent?.name === "自助注册生" && (syncStudent.gender === "" || syncStudent.gender == null)
    ? "PASS registered profile appears in admin roster (gender empty = 待完善)"
    : `FAIL roster sync ${JSON.stringify(syncStudent)}`
);

// 2) 首登强制改密
const sLogin = await post({ action: "auth.login", username: "s202699", password: "123456" });
const ST = sLogin.token;
results.push(sLogin.ok && sLogin.member?.must_change === true ? "PASS student login (must_change=true)" : `FAIL sLogin ${JSON.stringify(sLogin).slice(0, 160)}`);
const lkStu = await post({ action: "auth.lookup", username: "s202699" });
results.push(lkStu.ok && lkStu.found === true && lkStu.kind === "student" ? "PASS auth.lookup student: kind=student" : `FAIL lkStu ${JSON.stringify(lkStu)}`);
const stuFlagRead = await get("registration_settings", ST);
results.push(stuFlagRead.code === "password_change_required" ? "PASS student gated from registration settings until password change" : `FAIL stuFlagRead ${JSON.stringify(stuFlagRead)}`);
let fbStuId = null; // 批次 K：学生反馈 id 需在 if(ST) 块外复用
if (ST) {
  const gatedRead = await get("leave_rules", ST);
  results.push(gatedRead.code === "password_change_required" ? "PASS student gated until password changed" : `FAIL gatedRead ${JSON.stringify(gatedRead)}`);
  const meAllowed = await get("auth_me", ST);
  results.push(meAllowed.ok && meAllowed.data?.role === "student" ? "PASS auth_me allowed during must_change (student)" : `FAIL meAllowed ${JSON.stringify(meAllowed)}`);
  const chg = await post({ action: "auth.change_password", old_password: "123456", new_password: "studentpass9" }, ST);
  results.push(chg.ok && chg.member?.must_change === false ? "PASS student forced password change clears gate" : `FAIL chg ${JSON.stringify(chg)}`);
  const stuFlagDeny = await get("registration_settings", ST);
  results.push(stuFlagDeny.code === "access_denied" ? "PASS student cannot read registration settings" : `FAIL stuFlagDeny ${JSON.stringify(stuFlagDeny)}`);

  // 3) 学生读隔离：仅本人 / 无宿舍课程 / 无审计
  const myStudents = await get("students", ST);
  results.push(
    myStudents.ok && myStudents.data.length === 1 && myStudents.data[0].student_no === "S202699"
      ? "PASS student reads only own profile"
      : `FAIL myStudents ${JSON.stringify(myStudents).slice(0, 160)}`
  );
  const myRooms = await get("rooms", ST);
  const myCourses = await get("courses", ST);
  results.push(myRooms.ok && myRooms.data.length === 0 && myCourses.data.length === 0 ? "PASS student sees no rooms/courses" : `FAIL myRooms ${JSON.stringify(myRooms)} ${JSON.stringify(myCourses)}`);
  const myLogs = await get("audit_logs", ST);
  results.push(myLogs.code === "access_denied" && myLogs.status === 403 ? "PASS student denied audit_logs" : `FAIL myLogs ${JSON.stringify(myLogs)}`);
  const myRecords = await get("records", ST);
  results.push(myRecords.ok && myRecords.data.every((r) => r.student_id === reg.member.student_id) ? "PASS student reads only own records" : `FAIL myRecords ${JSON.stringify(myRecords).slice(0, 160)}`);
  // 学生不得触碰辅导员端写接口
  const stuDeny = await post({ action: "student.create", student_no: "X", name: "越权" }, ST);
  results.push(stuDeny.code === "access_denied" ? "PASS student blocked from staff writes (student.create)" : `FAIL stuDeny ${JSON.stringify(stuDeny)}`);
  const stuRuleDeny = await post({ action: "leave_rules.save", max_days: 1, advance_days: 0, require_material: false, material_note: "" }, ST);
  results.push(stuRuleDeny.code === "access_denied" ? "PASS student blocked from leave_rules.save" : `FAIL stuRuleDeny ${JSON.stringify(stuRuleDeny)}`);

  // 4) 完善个人信息 → 同步到管理员端
  const prof = await post({ action: "profile.submit", gender: "女", class_name: "软件2402", major: "软件工程", grade: "2024", phone: "13900000099", native_place: "浙江杭州" }, ST);
  results.push(prof.ok && prof.item?.class_name === "软件2402" ? "PASS profile.submit updates own record" : `FAIL prof ${JSON.stringify(prof).slice(0, 160)}`);
  const rosterSync = (await get("students", T)).data.find((s) => s.student_no === "S202699");
  results.push(rosterSync?.class_name === "软件2402" && rosterSync?.gender === "女" ? "PASS profile syncs to admin roster" : `FAIL roster sync ${JSON.stringify(rosterSync)}`);

  // 5) 辅导员端设定请假规则（此处以管理员会话代设 STAFF_WRITE）
  const ruleSave = await post({ action: "leave_rules.save", max_days: 3, advance_days: 2, require_material: true, material_note: "需附证明" }, T);
  results.push(
    ruleSave.ok && ruleSave.rules?.max_days === "3" && ruleSave.rules?.advance_days === "2" && ruleSave.rules?.require_material === true
      ? "PASS staff sets leave rules"
      : `FAIL ruleSave ${JSON.stringify(ruleSave)}`
  );
  const ruleRead = await get("leave_rules", ST);
  results.push(ruleRead.ok && ruleRead.data?.max_days === "3" ? "PASS student sees configured rules" : `FAIL ruleRead ${JSON.stringify(ruleRead)}`);

  // 6) 请假规则校验
  const tooFar = await post({ action: "leave.submit", start_date: day(1), end_date: day(2), content: "提前量不足" }, ST);
  results.push(tooFar.code === "leave_requires_advance" ? "PASS leave enforces advance_days" : `FAIL tooFar ${JSON.stringify(tooFar)}`);
  const tooLong = await post({ action: "leave.submit", start_date: day(5), end_date: day(11), content: "超过最大天数" }, ST );
  results.push(tooLong.code === "leave_exceeds_max_days" ? "PASS leave enforces max_days" : `FAIL tooLong ${JSON.stringify(tooLong)}`);
  const okLeave = await post({ action: "leave.submit", start_date: day(5), end_date: day(6), content: "回家处理事务" }, ST);
  results.push(
    okLeave.ok && okLeave.item?.source === "student" && okLeave.item?.status === "pending" && okLeave.item?.leave_days === "2"
      ? "PASS student submits compliant leave (source=student, 2 days, pending)"
      : `FAIL okLeave ${JSON.stringify(okLeave).slice(0, 180)}`
  );
  const mdOf = (iso) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
  results.push(
    okLeave.item?.title === `请假 ${mdOf(day(5))} - ${mdOf(day(6))}`
      ? "PASS student leave without title gets Chinese auto title (no blank title)"
      : `FAIL autoTitle ${JSON.stringify(okLeave.item?.title)}`
  );
  const overlap = await post({ action: "leave.submit", start_date: day(6), end_date: day(6), content: "与上单重叠" }, ST);
  results.push(overlap.code === "leave_date_overlap" ? "PASS overlapping leave rejected" : `FAIL overlap ${JSON.stringify(overlap)}`);
  const listMine = await get("records", ST);
  results.push(listMine.data.some((r) => r.id === okLeave.item?.id) ? "PASS own leave visible to student" : `FAIL listMine ${JSON.stringify(listMine).slice(0, 160)}`);

  // 7) 需材料的请假：无附件不得通过，上传后方可审批
  const approveNoMat = await post({ action: "record.update", id: okLeave.item?.id, status: "approved" }, T);
  results.push(approveNoMat.code === "leave_requires_material" && approveNoMat.status === 422 ? "PASS approve blocked without material" : `FAIL approveNoMat ${JSON.stringify(approveNoMat)}`);
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6]);
  const prep = await post({ action: "attachment.prepare", record_id: okLeave.item?.id, file_name: "证明.png", size: pngBytes.length }, ST);
  results.push(prep.ok ? "PASS student prepares attachment on own leave" : `FAIL prep ${JSON.stringify(prep)}`);
  // 竞态用第二件：待审批时 prepare+直传，辅导员处理后学生再 complete 必须被拒
  const prepB = await post({ action: "attachment.prepare", record_id: okLeave.item?.id, file_name: "后补.png", size: pngBytes.length }, ST);
  if (prepB.ok) {
    await fetch(`http://127.0.0.1:8123${prepB.upload_url}`, { method: "PUT", headers: { "content-type": "image/png" }, body: pngBytes });
  }
  if (prep.ok) {
    await fetch(`http://127.0.0.1:8123${prep.upload_url}`, { method: "PUT", headers: { "content-type": "image/png" }, body: pngBytes });
    const done = await post({ action: "attachment.complete", id: prep.id, record_id: okLeave.item?.id, file_name: "证明.png", size: pngBytes.length }, ST);
    const approveOk = await post({ action: "record.update", id: okLeave.item?.id, status: "approved" }, T);
    results.push(done.ok && approveOk.ok && approveOk.item?.status === "approved" ? "PASS material uploaded → leave approvable" : `FAIL approveOk ${JSON.stringify(done)} ${JSON.stringify(approveOk)}`);

    if (prepB.ok) {
      const lateComplete = await post({ action: "attachment.complete", id: prepB.id, record_id: okLeave.item?.id, file_name: "后补.png", size: pngBytes.length }, ST);
      const afterLate = await get("attachments", ST);
      results.push(
        lateComplete.code === "record_locked" && lateComplete.status === 403 && afterLate.data.every((a) => a.id !== prepB.id)
          ? "PASS complete blocked after processing (prepared-while-pending race closed)"
          : `FAIL lateComplete ${JSON.stringify(lateComplete)}`
      );
    }
    // 材料冻结：学生不可增/删，但仍可查看自己交过的材料；辅导员仍可补
    const lockedPrep = await post({ action: "attachment.prepare", record_id: okLeave.item?.id, file_name: "补交.png", size: pngBytes.length }, ST);
    const lockedDel = await post({ action: "attachment.delete", id: prep.id }, ST);
    results.push(
      lockedPrep.code === "record_locked" && lockedDel.code === "record_locked"
        ? "PASS student material frozen once processed (prepare + delete both rejected)"
        : `FAIL freeze ${JSON.stringify(lockedPrep)} ${JSON.stringify(lockedDel)}`
    );
    const frozenDl = await post({ action: "attachment.download", id: prep.id }, ST);
    results.push(frozenDl.ok && typeof frozenDl.url === "string" ? "PASS frozen material still viewable by its student" : `FAIL frozenDl ${JSON.stringify(frozenDl)}`);
    const stuAtts = await get("attachments", ST);
    results.push(
      stuAtts.ok && stuAtts.data.some((a) => a.id === prep.id) && stuAtts.data.every((a) => a.object_path === undefined)
        ? "PASS student attachment list is self-scoped (visible after processing)"
        : `FAIL stuAtts ${JSON.stringify(stuAtts).slice(0, 160)}`
    );
    // 辅导员处理后可补充材料（前文 testcounselor 已停用，这里新建一个辅导员会话）
    await post({ action: "account.create", username: "matelock", display_name: "材料冻结测试", role: "counselor", password: "matelock123" }, T);
    const mlLogin = await post({ action: "auth.login", username: "matelock", password: "matelock123" });
    await post({ action: "auth.change_password", old_password: "matelock123", new_password: "matelock456" }, mlLogin.token);
    const staffPrep = await post({ action: "attachment.prepare", record_id: okLeave.item?.id, file_name: "辅导员补充说明.png", size: pngBytes.length }, mlLogin.token);
    results.push(staffPrep.ok ? "PASS counselor can still add material after processing" : `FAIL staffPrep ${JSON.stringify(staffPrep)}`);
  }
  // 已批准的请假不可撤回
  const cancelApproved = await post({ action: "leave.cancel", id: okLeave.item?.id }, ST);
  results.push(cancelApproved.code === "not_found" ? "PASS approved leave cannot be cancelled by student" : `FAIL cancelApproved ${JSON.stringify(cancelApproved)}`);

  // 8) 留言往返：学生发送 → 辅导员/管理员回复 → 学生可见回复
  const msg = await post({ action: "message.send", body: "老师好，想咨询转专业的事。" }, ST);
  results.push(msg.ok && msg.item?.replied === 0 && msg.item?.sender_role === "student" ? "PASS student sends message" : `FAIL msg ${JSON.stringify(msg)}`);
  if (msg.ok) {
    const staffMsgs = await get("messages", T);
    results.push(staffMsgs.ok && staffMsgs.data.some((m) => m.id === msg.item.id) ? "PASS staff sees student message" : `FAIL staffMsgs ${JSON.stringify(staffMsgs).slice(0, 160)}`);
    const reply = await post({ action: "message.reply", id: msg.item.id, reply_note: "周五下午办公室详聊。" }, T);
    results.push(reply.ok && reply.item?.replied === 1 && reply.item?.reply_note?.includes("周五") ? "PASS staff replies to message" : `FAIL reply ${JSON.stringify(reply)}`);
    const stuMsgs = await get("messages", ST);
    const seen = stuMsgs.data.find((m) => m.id === msg.item.id);
    results.push(seen?.replied === 1 ? "PASS student sees reply" : `FAIL stuMsgs ${JSON.stringify(stuMsgs).slice(0, 160)}`);
    // 学生只能看到自己的留言
    results.push(stuMsgs.data.every((m) => m.student_id === reg.member.student_id) ? "PASS student message feed is self-scoped" : `FAIL scope ${JSON.stringify(stuMsgs).slice(0, 160)}`);
  }

  // 9) 撤回待审批请假
  const openLeave = await post({ action: "leave.submit", start_date: day(20), end_date: day(20), content: "临时取消" }, ST);
  // 9b) 待审批期间可更换材料：先传新件成功、再删旧件
  const attA = await post({ action: "attachment.prepare", record_id: openLeave.item?.id, file_name: "初版证明.png", size: pngBytes.length }, ST);
  if (attA.ok) {
    await fetch(`http://127.0.0.1:8123${attA.upload_url}`, { method: "PUT", headers: { "content-type": "image/png" }, body: pngBytes });
    const aDone = await post({ action: "attachment.complete", id: attA.id, record_id: openLeave.item.id, file_name: "初版证明.png", size: pngBytes.length }, ST);
    const attB = await post({ action: "attachment.prepare", record_id: openLeave.item.id, file_name: "新版证明.png", size: pngBytes.length }, ST);
    let bDone = { ok: false };
    if (attB.ok) {
      await fetch(`http://127.0.0.1:8123${attB.upload_url}`, { method: "PUT", headers: { "content-type": "image/png" }, body: pngBytes });
      bDone = await post({ action: "attachment.complete", id: attB.id, record_id: openLeave.item.id, file_name: "新版证明.png", size: pngBytes.length }, ST);
    }
    const delOld = await post({ action: "attachment.delete", id: attA.id }, ST);
    const afterReplace = await get("attachments", ST);
    results.push(
      aDone.ok && attB.ok && bDone.ok && delOld.ok && afterReplace.data.some((a) => a.id === attB.id) && afterReplace.data.every((a) => a.id !== attA.id)
        ? "PASS student replaces material while pending (new stored, old removed)"
        : `FAIL replace ${JSON.stringify(aDone)} ${JSON.stringify(attB)} ${JSON.stringify(bDone)} ${JSON.stringify(delOld)}`
    );
  }
  const cancelled = await post({ action: "leave.cancel", id: openLeave.item?.id }, ST);
  const gone = (await get("records", ST)).data.some((r) => r.id === openLeave.item?.id);
  results.push(openLeave.ok && cancelled.ok && !gone ? "PASS student cancels pending leave" : `FAIL cancel ${JSON.stringify(openLeave)} ${JSON.stringify(cancelled)}`);

  // 10) 意见反馈（批次 K）：提交 / 作用域 / 管理员回复
  const fbBadCat = await post({ action: "feedback.submit", category: "xyz", content: "分类非法" }, ST);
  results.push(fbBadCat.code === "invalid_request" ? "PASS feedback rejects invalid category" : `FAIL fbBadCat ${JSON.stringify(fbBadCat)}`);
  const fbEmpty = await post({ action: "feedback.submit", category: "bug", content: "  " }, ST);
  results.push(fbEmpty.code === "invalid_request" ? "PASS feedback rejects empty content" : `FAIL fbEmpty ${JSON.stringify(fbEmpty)}`);
  const fbStu = await post({ action: "feedback.submit", category: "ui", content: "手机端底部导航有点挤。" }, ST);
  fbStuId = fbStu.item?.id ?? null;
  results.push(
    fbStu.ok && fbStu.item?.status === "pending" && fbStu.item?.role === "student" && fbStu.item?.user_id === reg.member?.id
      ? "PASS student submits feedback (pending, self-tagged)"
      : `FAIL fbStu ${JSON.stringify(fbStu)}`
  );
  const fbStuList = await get("feedback", ST);
  results.push(
    fbStuList.ok && fbStuList.data.some((f) => f.id === fbStuId) && fbStuList.data.every((f) => f.user_id === reg.member?.id)
      ? "PASS student feedback list is self-scoped"
      : `FAIL fbStuList ${JSON.stringify(fbStuList).slice(0, 160)}`
  );
  const fbReplyByStu = await post({ action: "feedback.reply", id: fbStuId, status: "done", reply_note: "越权" }, ST);
  results.push(fbReplyByStu.code === "access_denied" && fbReplyByStu.status === 403 ? "PASS student cannot reply feedback" : `FAIL fbReplyByStu ${JSON.stringify(fbReplyByStu)}`);
}
// 辅导员也可提交，且仅见自己的（fixture 种子反馈不外泄给非管理员）
// 注：CT 已被前文停用/重置类用例作废，这里新建一个干净的辅导员会话
await post({ action: "account.create", username: "fbtester", display_name: "反馈测试员", role: "counselor", password: "fbtest123" }, T);
const fbLogin = await post({ action: "auth.login", username: "fbtester", password: "fbtest123" });
await post({ action: "auth.change_password", old_password: "fbtest123", new_password: "fbtest456" }, fbLogin.token);
const CT2 = fbLogin.token;
const fbC = await post({ action: "feedback.submit", category: "feature", content: "希望记录页支持按班级筛选。" }, CT2);
results.push(fbC.ok && fbC.item?.role === "counselor" ? "PASS counselor submits feedback" : `FAIL fbC ${JSON.stringify(fbC)}`);
const fbCList = await get("feedback", CT2);
results.push(
  fbCList.ok && fbCList.data.every((f) => f.user_id === fbC.item?.user_id)
    ? "PASS counselor feedback list is self-scoped (seed row hidden)"
    : `FAIL fbCList ${JSON.stringify(fbCList).slice(0, 160)}`
);
const fbReplyByC = await post({ action: "feedback.reply", id: fbC.item?.id, status: "done", reply_note: "越权" }, CT2);
results.push(fbReplyByC.code === "access_denied" ? "PASS counselor cannot reply feedback (admin-only)" : `FAIL fbReplyByC ${JSON.stringify(fbReplyByC)}`);
const fbAll = await get("feedback", T);
results.push(
  fbAll.ok && fbAll.data.some((f) => f.user_id === "seed-counselor") && fbAll.data.some((f) => f.id === fbC.item?.id) && fbAll.data.some((f) => f.id === fbStuId)
    ? "PASS admin sees all feedback incl. seed + counselor + student"
    : `FAIL fbAll ${JSON.stringify(fbAll).slice(0, 200)}`
);
const fbBadStatus = await post({ action: "feedback.reply", id: fbC.item?.id, status: "someday", reply_note: "状态非法" }, T);
results.push(fbBadStatus.code === "invalid_request" ? "PASS feedback reply rejects invalid status" : `FAIL fbBadStatus ${JSON.stringify(fbBadStatus)}`);
const fbNoTarget = await post({ action: "feedback.reply", id: "00000000-0000-4000-8000-000000000000", status: "adopted", reply_note: "不存在" }, T);
results.push(fbNoTarget.code === "not_found" && fbNoTarget.status === 404 ? "PASS feedback reply to missing id → not_found" : `FAIL fbNoTarget ${JSON.stringify(fbNoTarget)}`);
const fbReply = await post({ action: "feedback.reply", id: fbC.item?.id, status: "optimizing", reply_note: "已排期，下个版本见。" }, T);
results.push(
  fbReply.ok && fbReply.item?.status === "optimizing" && fbReply.item?.reply_note?.includes("排期") && fbReply.item?.replied_at
    ? "PASS admin replies with progress status"
    : `FAIL fbReply ${JSON.stringify(fbReply)}`
);
const fbRepeat = await post({ action: "feedback.reply", id: fbC.item?.id, status: "done", reply_note: "已上线。" }, T);
results.push(fbRepeat.ok && fbRepeat.item?.status === "done" ? "PASS admin can update reply/status repeatedly" : `FAIL fbRepeat ${JSON.stringify(fbRepeat)}`);
const fbReplyStu = await post({ action: "feedback.reply", id: fbStuId, status: "adopted", reply_note: "有道理，采纳。" }, T);
const fbStuAfterReply = await get("feedback", ST);
const fbSeen = fbStuAfterReply?.data.find((f) => f.id === fbStuId);
results.push(
  fbReplyStu.ok && fbSeen?.status === "adopted" && fbSeen?.reply_note === "有道理，采纳。" && fbStuAfterReply.data.every((f) => f.user_id === fbSeen.user_id)
    ? "PASS student sees admin reply on own feedback, still self-scoped"
    : `FAIL fbStuAfterReply ${JSON.stringify(fbStuAfterReply).slice(0, 200)}`
);
const fbNoAuth = await get("feedback");
results.push(fbNoAuth.code === "login_required" && fbNoAuth.status === 401 ? "PASS feedback list requires session" : `FAIL fbNoAuth ${JSON.stringify(fbNoAuth)}`);

// 11) 综合测评（批次 M2）：成绩只记考试分 + 学期平时总评 + 考勤台账 + 综测口径
const rosterForGrades = await get("students", T);
const zhangwei = rosterForGrades.data.find((s) => s.student_no === "2024010101");
const mathCourse = (await get("courses", T)).data.find((c) => c.name === "高等数学（上）");
results.push(zhangwei && mathCourse ? "PASS seed student + course available for grade M2 cases" : "FAIL missing seed for M2 cases");
const scoreBad = await post({ action: "grade.create", student_id: zhangwei?.id, course_id: mathCourse?.id, term: "2026-2027-1", score: "150", exam_date: "2027-01-10" }, T);
results.push(scoreBad.code === "invalid_request" ? "PASS grade.create rejects out-of-range score" : `FAIL scoreBad ${JSON.stringify(scoreBad)}`);
const gradeM = await post({ action: "grade.create", student_id: zhangwei?.id, course_id: mathCourse?.id, term: "2026-2027-1", score: "81", usual_score: "88", exam_date: "2027-01-10" }, T);
results.push(gradeM.ok && gradeM.item?.score === "81" && gradeM.item?.usual_score === undefined ? "PASS grade.create ignores removed usual_score field" : `FAIL gradeM ${JSON.stringify(gradeM)}`);
const gradeMBulk = await post({
  action: "grade.bulk_create",
  rows: [
    { student_no: "2024010102", course_name: "高等数学（上）", term: "2026-2027-1", score: "77", exam_date: "2027-01-10" },
    { student_no: "2024010102", course_name: "高等数学（上）", term: "2026-2027-1", score: "999", exam_date: "2027-01-10" },
  ],
}, T);
const bulkGrades = (await get("grades", T)).data.filter((g) => g.student_no === "2024010102" && g.term === "2026-2027-1");
results.push(
  gradeMBulk.ok && gradeMBulk.created === 1 && gradeMBulk.skipped?.[0]?.reason === "invalid_score" && bulkGrades[0]?.usual_score === undefined
    ? "PASS grade.bulk_create imports exam scores only and skips invalid"
    : `FAIL gradeMBulk ${JSON.stringify(gradeMBulk)} ${JSON.stringify(bulkGrades[0])}`
);
const stuGradeWrite = await post({ action: "grade.create", student_id: zhangwei?.id, course_id: mathCourse?.id, term: "2026-2027-1", score: "60" }, ST);
results.push(stuGradeWrite.code === "access_denied" && stuGradeWrite.status === 403 ? "PASS student cannot write grades" : `FAIL stuGradeWrite ${JSON.stringify(stuGradeWrite)}`);

const teNoTerm = await post({ action: "term_eval.save", student_id: zhangwei?.id, usual_score: "88" }, T);
results.push(teNoTerm.code === "invalid_request" ? "PASS term_eval.save requires term" : `FAIL teNoTerm ${JSON.stringify(teNoTerm)}`);
const teBadScore = await post({ action: "term_eval.save", student_id: zhangwei?.id, term: "2026-2027-1", usual_score: "150" }, T);
results.push(teBadScore.code === "invalid_request" ? "PASS term_eval.save rejects out-of-range usual_score" : `FAIL teBadScore ${JSON.stringify(teBadScore)}`);
const teMissingStu = await post({ action: "term_eval.save", student_id: "00000000-0000-4000-8000-000000000000", term: "2026-2027-1", usual_score: "88" }, T);
results.push(teMissingStu.code === "student_not_found" && teMissingStu.status === 404 ? "PASS term_eval.save unknown student → not_found" : `FAIL teMissingStu ${JSON.stringify(teMissingStu)}`);
const teCreate = await post({ action: "term_eval.save", student_id: zhangwei?.id, term: "2026-2027-1", usual_score: "88", note: "班干加分" }, T);
results.push(teCreate.ok && teCreate.created === true && teCreate.item?.usual_score === "88" && teCreate.item?.note === "班干加分" ? "PASS term_eval.save creates row" : `FAIL teCreate ${JSON.stringify(teCreate)}`);
const teUpsert = await post({ action: "term_eval.save", student_id: zhangwei?.id, term: "2026-2027-1", usual_score: "90", note: "更新总评" }, T);
results.push(teUpsert.ok && teUpsert.created === false && teUpsert.item?.id === teCreate.item?.id && teUpsert.item?.usual_score === "90" ? "PASS term_eval.save upserts same student+term" : `FAIL teUpsert ${JSON.stringify(teUpsert)}`);
const teStuWrite = await post({ action: "term_eval.save", student_id: syncStudent?.id, term: "2026-2027-1", usual_score: "60" }, ST);
results.push(teStuWrite.code === "access_denied" && teStuWrite.status === 403 ? "PASS student cannot write term_eval" : `FAIL teStuWrite ${JSON.stringify(teStuWrite)}`);
const teMine = await post({ action: "term_eval.save", student_id: syncStudent?.id, term: "2025-2026-2", usual_score: "77" }, T);
const teStuList = await get("term_evaluations", ST);
results.push(
  teStuList.ok && teStuList.data.some((r) => r.id === teMine.item?.id) && teStuList.data.every((r) => r.student_id === syncStudent?.id) && !teStuList.data.some((r) => r.id === teUpsert.item?.id)
    ? "PASS student term_eval list is self-scoped"
    : `FAIL teStuList ${JSON.stringify(teStuList).slice(0, 200)}`
);
const teStaffList = await get("term_evaluations", T);
const teZhang = teStaffList.data.find((r) => r.student_no === "2024010101" && r.term === "2026-2027-1");
results.push(
  teStaffList.ok && teZhang?.student_name && teStaffList.data.filter((r) => r.term === "2025-2026-2").length >= 10
    ? "PASS staff sees all term_evals with joined names + seeded rows"
    : `FAIL teStaffList ${JSON.stringify(teStaffList).slice(0, 200)}`
);
const teBulk = await post({
  action: "term_eval.bulk_create",
  rows: [
    { student_no: "2024010102", term: "2026-2027-1", usual_score: "69.5", note: "导入" },
    { student_no: "2024010101", term: "2026-2027-1", usual_score: "92" },
    { student_no: "2024010103", term: "", usual_score: "80" },
    { student_no: "2024010104", term: "2026-2027-1", usual_score: "999" },
    { student_no: "nobody", term: "2026-2027-1", usual_score: "80" },
  ],
}, T);
const teAfterBulk = (await get("term_evaluations", T)).data;
const teBulkNew = teAfterBulk.find((r) => r.student_no === "2024010102" && r.term === "2026-2027-1");
const teBulkUpd = teAfterBulk.find((r) => r.id === teUpsert.item?.id);
results.push(
  teBulk.ok && teBulk.created === 1 && teBulk.updated === 1 &&
    teBulk.skipped?.some((s) => s.reason === "invalid_term") && teBulk.skipped?.some((s) => s.reason === "invalid_usual_score") && teBulk.skipped?.some((s) => s.reason === "student_not_found") &&
    teBulkNew?.usual_score === "69.5" && teBulkUpd?.usual_score === "92"
    ? "PASS term_eval.bulk_create upserts + skips invalid term/score/student"
    : `FAIL teBulk ${JSON.stringify(teBulk)} ${JSON.stringify(teBulkNew)} ${JSON.stringify(teBulkUpd)}`
);
const teDel = await post({ action: "term_eval.delete", id: teBulkNew?.id }, T);
const teAfterDel = await get("term_evaluations", T);
results.push(teDel.ok && !teAfterDel.data.some((r) => r.id === teBulkNew?.id) ? "PASS term_eval.delete removes row" : `FAIL teDel ${JSON.stringify(teDel)}`);
const teNoAuth = await get("term_evaluations");
results.push(teNoAuth.code === "login_required" && teNoAuth.status === 401 ? "PASS term_evaluations read requires session" : `FAIL teNoAuth ${JSON.stringify(teNoAuth)}`);

const attBadKind = await post({ action: "attendance.create", student_id: zhangwei?.id, kind: "sleeping", occurred_on: "2026-05-11", term: "2025-2026-2" }, T);
results.push(attBadKind.code === "invalid_request" ? "PASS attendance rejects invalid kind" : `FAIL attBadKind ${JSON.stringify(attBadKind)}`);
const attBadDate = await post({ action: "attendance.create", student_id: zhangwei?.id, kind: "late", occurred_on: "2026/5/11", term: "" }, T);
results.push(attBadDate.code === "invalid_request" ? "PASS attendance rejects bad date" : `FAIL attBadDate ${JSON.stringify(attBadDate)}`);
const attCreate = await post({ action: "attendance.create", student_id: zhangwei?.id, course_id: mathCourse?.id, kind: "absent", occurred_on: "2026-05-11", term: "2025-2026-2", note: "测试旷课" }, T);
results.push(attCreate.ok && attCreate.item?.kind === "absent" && attCreate.item?.term === "2025-2026-2" ? "PASS staff creates attendance row" : `FAIL attCreate ${JSON.stringify(attCreate)}`);
const attStuWrite = await post({ action: "attendance.create", student_id: zhangwei?.id, kind: "late", occurred_on: "2026-05-12" }, ST);
results.push(attStuWrite.code === "access_denied" ? "PASS student cannot write attendance" : `FAIL attStuWrite ${JSON.stringify(attStuWrite)}`);
const attMine = await post({ action: "attendance.create", student_id: syncStudent?.id, kind: "late", occurred_on: "2026-05-13", term: "2025-2026-2" }, T);
const attStuList = await get("attendance", ST);
results.push(
  attStuList.ok && attStuList.data.some((a) => a.id === attMine.item?.id) && attStuList.data.every((a) => a.student_id === syncStudent?.id) && !attStuList.data.some((a) => a.id === attCreate.item?.id)
    ? "PASS student attendance list is self-scoped (staff-created other rows hidden)"
    : `FAIL attStuList ${JSON.stringify(attStuList).slice(0, 200)}`
);
const attStuSeeSeed = (await get("attendance", T)).data.filter((a) => a.student_no === "2024010101");
results.push(attStuSeeSeed.length >= 1 ? "PASS staff sees attendance incl. created row" : `FAIL attStaffList ${JSON.stringify(attStuSeeSeed)}`);
const attUpd = await post({ action: "attendance.update", id: attCreate.item?.id, kind: "leave", note: "改判为请假" }, T);
results.push(attUpd.ok && attUpd.item?.kind === "leave" && attUpd.item?.note === "改判为请假" ? "PASS attendance.update changes kind" : `FAIL attUpd ${JSON.stringify(attUpd)}`);
const attDel = await post({ action: "attendance.delete", id: attCreate.item?.id }, T);
const attAfterDel = await get("attendance", T);
results.push(attDel.ok && !attAfterDel.data.some((a) => a.id === attCreate.item?.id) ? "PASS attendance.delete removes row" : `FAIL attDel ${JSON.stringify(attDel)}`);
const attNoAuth = await get("attendance");
results.push(attNoAuth.code === "login_required" && attNoAuth.status === 401 ? "PASS attendance read requires session" : `FAIL attNoAuth ${JSON.stringify(attNoAuth)}`);
const attBulk = await post({
  action: "attendance.bulk_create",
  rows: [
    { student_no: "2024010103", kind: "late", occurred_on: "2026-05-14", term: "2025-2026-2", note: "导入迟到" },
    { student_no: "2024010103", kind: "nap", occurred_on: "2026-05-15" },
    { student_no: "nobody", kind: "absent", occurred_on: "2026-05-16" },
  ],
}, T);
results.push(
  attBulk.ok && attBulk.created === 1 && attBulk.skipped?.[0]?.reason === "invalid_kind" && attBulk.skipped?.[1]?.reason === "student_not_found"
    ? "PASS attendance.bulk_create imports valid + skips invalid kind/student"
    : `FAIL attBulk ${JSON.stringify(attBulk)}`
);

// ---- 学生职务（批次 N）----
const posCreate = await post({ action: "position.create", student_id: zhangwei?.id, title: "副班长", appointed_on: "2026-09-20", note: "协助班长" }, T);
results.push(posCreate.ok && posCreate.item?.status === "active" && posCreate.item?.title === "副班长" && posCreate.item?.appointed_on === "2026-09-20" ? "PASS position.create stores active row" : `FAIL posCreate ${JSON.stringify(posCreate)}`);
const posDup = await post({ action: "position.create", student_id: zhangwei?.id, title: "副班长", appointed_on: "2026-09-21" }, T);
results.push(posDup.code === "position_exists" && posDup.status === 409 ? "PASS duplicate active position rejected" : `FAIL posDup ${JSON.stringify(posDup)}`);
const posBadDate = await post({ action: "position.create", student_id: zhangwei?.id, title: "舍长", appointed_on: "2026/9/20" }, T);
results.push(posBadDate.code === "invalid_request" ? "PASS position.create rejects bad date" : `FAIL posBadDate ${JSON.stringify(posBadDate)}`);
const posUnknownStu = await post({ action: "position.create", student_id: "00000000-0000-4000-8000-000000000000", title: "班长", appointed_on: "2026-09-20" }, T);
results.push(posUnknownStu.code === "not_found" && posUnknownStu.status === 404 ? "PASS position.create unknown student → 404" : `FAIL posUnknownStu ${JSON.stringify(posUnknownStu)}`);
const posLongTitle = await post({ action: "position.create", student_id: zhangwei?.id, title: "长".repeat(21), appointed_on: "2026-09-20" }, T);
results.push(posLongTitle.code === "invalid_request" ? "PASS position.create rejects title over 20 chars" : `FAIL posLongTitle ${JSON.stringify(posLongTitle)}`);
const posStuWrite = await post({ action: "position.create", student_id: zhangwei?.id, title: "班长", appointed_on: "2026-09-20" }, ST);
results.push(posStuWrite.code === "access_denied" && posStuWrite.status === 403 ? "PASS student cannot create position" : `FAIL posStuWrite ${JSON.stringify(posStuWrite)}`);
const posSelf = await post({ action: "position.create", student_id: syncStudent?.id, title: "宿舍长", appointed_on: "2026-09-19" }, T);
results.push(posSelf.ok ? "PASS counselor positions another student (self-scope subject)" : `FAIL posSelf ${JSON.stringify(posSelf)}`);
const posStuList = await get("positions", ST);
results.push(
  posStuList.ok && posStuList.data.length > 0 && posStuList.data.every((p) => p.student_id === syncStudent?.id) && posStuList.data[0]?.student_name
    ? "PASS student position list is self-scoped with joined names"
    : `FAIL posStuList ${JSON.stringify(posStuList)}`
);
const posStaffList = await get("positions", T);
const firstRevokedIdx = posStaffList.data?.findIndex?.((p) => p.status !== "active") ?? -1;
results.push(
  posStaffList.ok && posStaffList.data.length >= 5 && posStaffList.data.some((p) => p.title === "副班长" && p.class_name === "计算机2401") &&
    (firstRevokedIdx === -1 || posStaffList.data.slice(firstRevokedIdx).every((p) => p.status !== "active"))
    ? "PASS staff sees all positions, active sorted first"
    : `FAIL posStaffList ${JSON.stringify(posStaffList)}`
);
const posNoAuth = await get("positions");
results.push(posNoAuth.code === "login_required" && posNoAuth.status === 401 ? "PASS positions read requires session" : `FAIL posNoAuth ${JSON.stringify(posNoAuth)}`);
const posRevoke = await post({ action: "position.revoke", id: posSelf.item?.id }, T);
results.push(posRevoke.ok && posRevoke.item?.status === "revoked" && posRevoke.item?.revoked_at && posRevoke.item?.appointed_on === "2026-09-19" ? "PASS position.revoke archives row (keeps appointed_on)" : `FAIL posRevoke ${JSON.stringify(posRevoke)}`);
const posRevokeTwice = await post({ action: "position.revoke", id: posSelf.item?.id }, T);
results.push(posRevokeTwice.code === "not_found" && posRevokeTwice.status === 404 ? "PASS revoke twice → 404 (only active revocable)" : `FAIL posRevokeTwice ${JSON.stringify(posRevokeTwice)}`);
const posRecreate = await post({ action: "position.create", student_id: syncStudent?.id, title: "宿舍长", appointed_on: "2026-09-22" }, T);
results.push(posRecreate.ok && posRecreate.item?.status === "active" ? "PASS re-appoint allowed after revoke" : `FAIL posRecreate ${JSON.stringify(posRecreate)}`);

// ---- 班委考勤上报权限（批次 O）----
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const rosterO = await get("students", T);
const reporterClass = rosterO.data.find((s) => s.id === syncStudent?.id)?.class_name || "软件2024";
const mateCreate = await post({ action: "student.create", student_no: "T0003", name: "上报对象甲", gender: "男", class_name: reporterClass }, T);
const mateId = mateCreate.item?.id;
const outsiderCreate = await post({ action: "student.create", student_no: "T0004", name: "外班乙", gender: "女", class_name: "非本班2409" }, T);
const outsiderId = outsiderCreate.item?.id;
results.push(mateCreate.ok && outsiderCreate.ok ? "PASS 批次O fixture students created" : `FAIL fixture students ${JSON.stringify(mateCreate)} ${JSON.stringify(outsiderCreate)}`);

// 现任但未开通考勤上报 → 入口数据与上报均被拒
const cmNoGrant = await get("classmates", ST);
results.push(cmNoGrant.code === "report_not_allowed" && cmNoGrant.status === 403 ? "PASS student without an attend_report grant cannot fetch classmates" : `FAIL cmNoGrant ${JSON.stringify(cmNoGrant)}`);
const repNoGrant = await post({ action: "attendance.report", rows: [{ student_id: mateId, kind: "late", occurred_on: "2026-06-05" }] }, ST);
results.push(repNoGrant.code === "report_not_allowed" && repNoGrant.status === 403 ? "PASS attendance.report rejected without grant" : `FAIL repNoGrant ${JSON.stringify(repNoGrant)}`);

const grantOn = await post({ action: "position.create", student_id: syncStudent?.id, title: "考勤员", appointed_on: "2026-09-23", note: "开通本班考勤上报", attend_report: true }, T);
results.push(grantOn.ok && grantOn.item?.attend_report === true ? "PASS appointment with toggle opens reporting" : `FAIL grantOn ${JSON.stringify(grantOn)}`);
const grantPlain = await post({ action: "position.create", student_id: zhangwei?.id, title: "心理委员", appointed_on: "2026-09-23" }, T);
results.push(grantPlain.ok && grantPlain.item?.attend_report === false ? "PASS appointment without toggle stays closed" : `FAIL grantPlain ${JSON.stringify(grantPlain)}`);

const cmList = await get("classmates", ST);
results.push(
  cmList.ok && cmList.data.length >= 1 && cmList.data.some((s) => s.id === mateId) &&
    cmList.data.every((s) => s.class_name === reporterClass && s.id !== syncStudent?.id && s.student_no && s.name && !("phone" in s)) &&
    !cmList.data.some((s) => s.id === outsiderId) && Array.isArray(cmList.courses)
    ? "PASS classmates list is class-scoped, minimal fields, own-class courses"
    : `FAIL cmList ${JSON.stringify(cmList).slice(0, 240)}`
);
const cmStaff = await get("classmates", T);
results.push(cmStaff.code === "access_denied" && cmStaff.status === 403 ? "PASS staff cannot use classmates route" : `FAIL cmStaff ${JSON.stringify(cmStaff)}`);
const cmNoAuth = await get("classmates");
results.push(cmNoAuth.code === "login_required" && cmNoAuth.status === 401 ? "PASS classmates read requires session" : `FAIL cmNoAuth ${JSON.stringify(cmNoAuth)}`);

const repRows = await post({ action: "attendance.report", rows: [
  { student_id: mateId, kind: "late", occurred_on: "2026-06-05", term: "2025-2026-2", note: "班委登记迟到" },
  { student_id: UNKNOWN_ID, kind: "late", occurred_on: "2026-06-05" },
  { student_id: outsiderId, kind: "absent", occurred_on: "2026-06-06" },
  { student_id: mateId, kind: "sleeping", occurred_on: "2026-06-07" },
  { student_id: mateId, kind: "absent", occurred_on: "2026/6/8" },
  { student_id: mateId, kind: "early", occurred_on: "2026-06-09", course_id: UNKNOWN_ID },
  { student_id: syncStudent?.id, kind: "late", occurred_on: "2026-06-10" },
] }, ST);
const repSkipped = JSON.stringify((repRows.skipped ?? []).map((s) => s.reason));
results.push(
  repRows.ok && repRows.created === 1 && repSkipped === JSON.stringify(["student_not_found", "not_classmate", "invalid_kind", "invalid_occurred_on", "course_not_found", "not_classmate"])
    ? "PASS attendance.report imports valid row + skips bad student/kind/date/course and non-classmates"
    : `FAIL repRows ${JSON.stringify(repRows)}`
);
const attListO = await get("attendance", T);
const reported = attListO.data.find((a) => a.student_id === mateId);
results.push(
  reported?.source === "monitor" && reported?.reporter_student_id === syncStudent?.id && reported?.reporter_name && reported?.kind === "late"
    ? "PASS monitor-reported attendance stores source + reporter"
    : `FAIL reported ${JSON.stringify(reported)}`
);
const attStuO = await get("attendance", ST);
results.push(
  attStuO.ok && attStuO.data.some((a) => a.id === reported?.id) && attStuO.data.every((a) => a.student_id === syncStudent?.id || a.reporter_student_id === syncStudent?.id)
    ? "PASS student sees own rows plus rows reported by self, nothing else"
    : `FAIL attStuO ${JSON.stringify(attStuO).slice(0, 200)}`
);
const attDupSlot = await post({ action: "attendance.create", student_id: mateId, kind: "absent", occurred_on: "2026-06-05", term: "2025-2026-2", note: "老师同日登记" }, T);
results.push(attDupSlot.item?.source === "staff" && attDupSlot.item?.reporter_student_id === null ? "PASS staff-created row marked source=staff" : `FAIL attDupSlot ${JSON.stringify(attDupSlot)}`);
const bothKept = (await get("attendance", T)).data.filter((a) => a.student_id === mateId && a.occurred_on === "2026-06-05");
results.push(bothKept.length === 2 ? "PASS same-slot rows are both archived (dedup happens at scoring, records are never dropped)" : `FAIL bothKept ${JSON.stringify(bothKept)}`);

const repEmpty = await post({ action: "attendance.report", rows: [] }, ST);
results.push(repEmpty.code === "invalid_request" ? "PASS report rejects empty rows" : `FAIL repEmpty ${JSON.stringify(repEmpty)}`);
const repTooMany = await post({ action: "attendance.report", rows: Array.from({ length: 101 }, (_, i) => ({ student_id: mateId, kind: "late", occurred_on: `2026-06-${String((i % 28) + 1).padStart(2, "0")}` })) }, ST);
results.push(repTooMany.code === "invalid_request" ? "PASS report rejects more than 100 rows" : `FAIL repTooMany ${JSON.stringify(repTooMany)}`);
const repStaff = await post({ action: "attendance.report", rows: [{ student_id: mateId, kind: "late", occurred_on: "2026-06-11" }] }, T);
results.push(repStaff.code === "access_denied" && repStaff.status === 403 ? "PASS staff does not use the monitor reporting route" : `FAIL repStaff ${JSON.stringify(repStaff)}`);
const repNoAuth = await post({ action: "attendance.report", rows: [{ student_id: mateId, kind: "late", occurred_on: "2026-06-11" }] });
results.push(repNoAuth.code === "login_required" && repNoAuth.status === 401 ? "PASS report requires session" : `FAIL repNoAuth ${JSON.stringify(repNoAuth)}`);

// 撤销职务：权限即时收回，已上报数据保留
const grantRevoke = await post({ action: "position.revoke", id: grantOn.item?.id }, T);
results.push(grantRevoke.ok && grantRevoke.item?.attend_report === true && grantRevoke.item?.status === "revoked" ? "PASS revoked grant keeps its archived state" : `FAIL grantRevoke ${JSON.stringify(grantRevoke)}`);
const repAfterRevoke = await post({ action: "attendance.report", rows: [{ student_id: mateId, kind: "late", occurred_on: "2026-06-12" }] }, ST);
results.push(repAfterRevoke.code === "report_not_allowed" && repAfterRevoke.status === 403 ? "PASS revoke withdraws reporting rights immediately" : `FAIL repAfterRevoke ${JSON.stringify(repAfterRevoke)}`);
const cmAfterRevoke = await get("classmates", ST);
results.push(cmAfterRevoke.code === "report_not_allowed" ? "PASS revoke hides the class roster route too" : `FAIL cmAfterRevoke ${JSON.stringify(cmAfterRevoke)}`);
const keptAfterRevoke = (await get("attendance", T)).data.some((a) => a.id === reported?.id);
results.push(keptAfterRevoke ? "PASS revoke does NOT clear already-reported attendance" : "FAIL revoke wiped reported rows");
const reGrant = await post({ action: "position.create", student_id: syncStudent?.id, title: "考勤员", appointed_on: "2026-09-24" }, T);
results.push(reGrant.ok && reGrant.item?.attend_report === false ? "PASS re-appointment defaults reporting off" : `FAIL reGrant ${JSON.stringify(reGrant)}`);
const repAfterReGrant = await post({ action: "attendance.report", rows: [{ student_id: mateId, kind: "late", occurred_on: "2026-06-13" }] }, ST);
results.push(repAfterReGrant.code === "report_not_allowed" ? "PASS re-appointment alone does not restore rights" : `FAIL repAfterReGrant ${JSON.stringify(repAfterReGrant)}`);

// 独立开关：不撤销职务也能开/收回
const toggleOn = await post({ action: "position.set_attend_report", id: reGrant.item?.id, attend_report: true }, T);
results.push(toggleOn.ok && toggleOn.item?.attend_report === true && toggleOn.item?.status === "active" ? "PASS independent switch opens reporting" : `FAIL toggleOn ${JSON.stringify(toggleOn)}`);
const repAfterToggle = await post({ action: "attendance.report", rows: [{ student_id: mateId, kind: "leave", occurred_on: "2026-06-14", note: "班委登记请假" }] }, ST);
results.push(repAfterToggle.ok && repAfterToggle.created === 1 ? "PASS independent switch makes the student able to report" : `FAIL repAfterToggle ${JSON.stringify(repAfterToggle)}`);
const toggleOff = await post({ action: "position.set_attend_report", id: reGrant.item?.id, attend_report: false }, T);
const posListAfterToggle = await get("positions", T);
results.push(
  toggleOff.ok && toggleOff.item?.attend_report === false && posListAfterToggle.data.some((p) => p.id === reGrant.item?.id && p.status === "active")
    ? "PASS independent switch revokes rights while the appointment stays active"
    : `FAIL toggleOff ${JSON.stringify(toggleOff)}`
);
const repAfterToggleOff = await post({ action: "attendance.report", rows: [{ student_id: mateId, kind: "late", occurred_on: "2026-06-15" }] }, ST);
results.push(repAfterToggleOff.code === "report_not_allowed" ? "PASS reporting blocked right after switch-off" : `FAIL repAfterToggleOff ${JSON.stringify(repAfterToggleOff)}`);
const toggleBadId = await post({ action: "position.set_attend_report", id: "not-a-uuid", attend_report: true }, T);
results.push(toggleBadId.code === "invalid_id" ? "PASS set_attend_report rejects malformed id" : `FAIL toggleBadId ${JSON.stringify(toggleBadId)}`);
const toggleMissing = await post({ action: "position.set_attend_report", id: UNKNOWN_ID, attend_report: true }, T);
results.push(toggleMissing.code === "not_found" && toggleMissing.status === 404 ? "PASS set_attend_report unknown position → 404" : `FAIL toggleMissing ${JSON.stringify(toggleMissing)}`);
const toggleRevoked = await post({ action: "position.set_attend_report", id: grantOn.item?.id, attend_report: true }, T);
results.push(toggleRevoked.code === "not_found" ? "PASS set_attend_report only touches active appointments" : `FAIL toggleRevoked ${JSON.stringify(toggleRevoked)}`);
const toggleNoBool = await post({ action: "position.set_attend_report", id: reGrant.item?.id, attend_report: "yes" }, T);
results.push(toggleNoBool.code === "invalid_request" ? "PASS set_attend_report requires boolean value" : `FAIL toggleNoBool ${JSON.stringify(toggleNoBool)}`);
const toggleStu = await post({ action: "position.set_attend_report", id: reGrant.item?.id, attend_report: true }, ST);
results.push(toggleStu.code === "access_denied" && toggleStu.status === 403 ? "PASS student cannot change reporting rights" : `FAIL toggleStu ${JSON.stringify(toggleStu)}`);
const posStuGrant = await get("positions", ST);
results.push(posStuGrant.data.every((p) => "attend_report" in p) ? "PASS student position list exposes attend_report flag" : `FAIL posStuGrant ${JSON.stringify(posStuGrant).slice(0, 160)}`);

const evGet = await get("evaluation_settings", T);
results.push(evGet.ok && evGet.data?.exam_weight === "70" && evGet.data?.usual_weight === "30" ? "PASS evaluation settings visible (seeded default 70/30)" : `FAIL evGet ${JSON.stringify(evGet)}`);
const evStuGet = await get("evaluation_settings", ST);
results.push(evStuGet.ok && typeof evStuGet.data?.exam_weight === "string" ? "PASS student can read evaluation settings" : `FAIL evStuGet ${JSON.stringify(evStuGet)}`);
const evBadSum = await post({ action: "evaluation_settings.save", exam_weight: "70", usual_weight: "20", absent_deduct: "5", late_deduct: "1", leave_deduct: "0" }, CT2);
results.push(evBadSum.code === "invalid_weights" ? "PASS evaluation save rejects weights not summing to 100" : `FAIL evBadSum ${JSON.stringify(evBadSum)}`);
const evStuSave = await post({ action: "evaluation_settings.save", exam_weight: "50", usual_weight: "50", absent_deduct: "5", late_deduct: "1", leave_deduct: "0" }, ST);
results.push(evStuSave.code === "access_denied" && evStuSave.status === 403 ? "PASS student cannot save evaluation settings" : `FAIL evStuSave ${JSON.stringify(evStuSave)}`);
const evSave = await post({ action: "evaluation_settings.save", exam_weight: "60", usual_weight: "40", absent_deduct: "4", late_deduct: "1.5", leave_deduct: "0.5" }, CT2);
results.push(evSave.ok && evSave.settings?.exam_weight === "60" && evSave.settings?.usual_weight === "40" ? "PASS counselor updates evaluation settings" : `FAIL evSave ${JSON.stringify(evSave)}`);
const evAfter = await get("evaluation_settings", T);
results.push(evAfter.data?.late_deduct === "1.5" && evAfter.data?.absent_deduct === "4" ? "PASS updated settings persist for all readers" : `FAIL evAfter ${JSON.stringify(evAfter)}`);

// ---- 批次P：同一节课人工指定按哪条计扣 ----
const pCourse = (await get("courses", T)).data[0]?.id ?? null;
const pA = await post({ action: "attendance.create", student_id: syncStudent?.id, course_id: pCourse, kind: "absent", occurred_on: "2026-06-20", term: "2025-2026-2", note: "先按旷课登记" }, T);
const pB = await post({ action: "attendance.create", student_id: syncStudent?.id, course_id: pCourse, kind: "late", occurred_on: "2026-06-20", term: "2025-2026-2", note: "学生后来到课" }, T);
results.push(pA.ok && pB.ok && pA.item?.counted_override === null ? "PASS attendance rows start with no manual override" : `FAIL pCreate ${JSON.stringify(pA)} ${JSON.stringify(pB)}`);
const pSetB = await post({ action: "attendance.set_counted", id: pB.item?.id, counted: true }, T);
results.push(pSetB.ok && pSetB.item?.counted_override === true && pSetB.cleared === 0 ? "PASS set_counted marks the chosen row" : `FAIL pSetB ${JSON.stringify(pSetB)}`);
const pSetA = await post({ action: "attendance.set_counted", id: pA.item?.id, counted: true }, T);
results.push(pSetA.ok && pSetA.cleared === 1 ? "PASS re-designating clears the previous manual row in the same slot" : `FAIL pSetA ${JSON.stringify(pSetA)}`);
const pPair = (await get("attendance", T)).data.filter((a) => a.id === pA.item?.id || a.id === pB.item?.id);
results.push(
  pPair.find((a) => a.id === pA.item?.id)?.counted_override === true && pPair.find((a) => a.id === pB.item?.id)?.counted_override === null
    ? "PASS only one row per slot stays manually designated"
    : `FAIL pPair ${JSON.stringify(pPair)}`
);
const pSetFalse = await post({ action: "attendance.set_counted", id: pA.item?.id, counted: false }, T);
results.push(pSetFalse.ok && pSetFalse.item?.counted_override === false && pSetFalse.cleared === 0 ? "PASS set_counted can exclude a row" : `FAIL pSetFalse ${JSON.stringify(pSetFalse)}`);
const pSetNull = await post({ action: "attendance.set_counted", id: pA.item?.id, counted: null }, T);
results.push(pSetNull.ok && pSetNull.item?.counted_override === null ? "PASS set_counted null restores automatic rule" : `FAIL pSetNull ${JSON.stringify(pSetNull)}`);
const pKeepOnKindEdit = await post({ action: "attendance.update", id: pB.item?.id, kind: "early" }, T);
results.push(pKeepOnKindEdit.ok && pKeepOnKindEdit.item?.counted_override === null ? "PASS kind edit keeps the row readable for the ledger" : `FAIL pKeepOnKindEdit ${JSON.stringify(pKeepOnKindEdit)}`);
const pMarkB = await post({ action: "attendance.set_counted", id: pB.item?.id, counted: true }, T);
const pMoveDate = await post({ action: "attendance.update", id: pB.item?.id, occurred_on: "2026-06-21" }, T);
results.push(pMarkB.ok && pMoveDate.ok && pMoveDate.item?.counted_override === null ? "PASS moving a row to another day/course drops its manual mark" : `FAIL pMoveDate ${JSON.stringify(pMoveDate)}`);
const pBadId = await post({ action: "attendance.set_counted", id: "not-a-uuid", counted: true }, T);
results.push(pBadId.code === "invalid_id" ? "PASS set_counted rejects malformed id" : `FAIL pBadId ${JSON.stringify(pBadId)}`);
const pUnknown = await post({ action: "attendance.set_counted", id: UNKNOWN_ID, counted: true }, T);
results.push(pUnknown.code === "not_found" && pUnknown.status === 404 ? "PASS set_counted unknown row → 404" : `FAIL pUnknown ${JSON.stringify(pUnknown)}`);
const pBadVal = await post({ action: "attendance.set_counted", id: pA.item?.id, counted: "yes" }, T);
results.push(pBadVal.code === "invalid_request" ? "PASS set_counted requires boolean or null" : `FAIL pBadVal ${JSON.stringify(pBadVal)}`);
const pStu = await post({ action: "attendance.set_counted", id: pA.item?.id, counted: true }, ST);
results.push(pStu.code === "access_denied" && pStu.status === 403 ? "PASS student cannot designate scoring rows" : `FAIL pStu ${JSON.stringify(pStu)}`);
const pNoAuth = await post({ action: "attendance.set_counted", id: pA.item?.id, counted: true });
results.push(pNoAuth.code === "login_required" && pNoAuth.status === 401 ? "PASS set_counted requires a session" : `FAIL pNoAuth ${JSON.stringify(pNoAuth)}`);
const pLog = (await get("audit_logs", T)).data.find((l) => l.action === "attendance.set_counted");
results.push(pLog ? "PASS manual designation is audited" : "FAIL set_counted audit entry missing");
for (const row of [pA.item?.id, pB.item?.id]) await post({ action: "attendance.delete", id: row }, T);
const pAfterClean = await get("attendance", T);
results.push(pAfterClean.data.every((a) => a.id !== pA.item?.id && a.id !== pB.item?.id) ? "PASS designation test rows cleaned" : "FAIL p cleanup leftover");

// 清理学生端测试数据（账号 + 档案）
const sAcc = (await get("account.list", T)).data.find((a) => a.username === "s202699");
if (sAcc) await post({ action: "account.update", id: sAcc.id, status: "disabled" }, T);
if (syncStudent) await post({ action: "student.delete", id: syncStudent.id }, T);
const rosterClean = await get("students", T);
results.push(rosterClean.data.every((s) => s.student_no !== "S202699") ? "PASS student test data cleaned up" : "FAIL student cleanup leftover");
const teAfterStuDel = await get("term_evaluations", T);
results.push(teAfterStuDel.ok && teAfterStuDel.data.every((r) => r.student_id !== syncStudent?.id) ? "PASS student.delete cascades term_eval rows" : "FAIL term_eval cascade leftover");
const posAfterStuDel = await get("positions", T);
results.push(posAfterStuDel.ok && posAfterStuDel.data.every((p) => p.student_id !== syncStudent?.id) ? "PASS student.delete cascades position rows (incl. revoked archive)" : "FAIL position cascade leftover");
const attAfterReporterDel = (await get("attendance", T)).data.find((a) => a.id === reported?.id);
results.push(
  attAfterReporterDel && attAfterReporterDel.reporter_name === "（学生已删除）" && attAfterReporterDel.source === "monitor"
    ? "PASS reported row outlives the reporter with a placeholder name (archive stays readable)"
    : `FAIL reporter archive display ${JSON.stringify(attAfterReporterDel)}`
);
if (mateId) await post({ action: "student.delete", id: mateId }, T);
if (outsiderId) await post({ action: "student.delete", id: outsiderId }, T);
const attAfterMateDel = await get("attendance", T);
results.push(
  attAfterMateDel.data.every((a) => a.student_id !== mateId && a.student_id !== outsiderId)
    ? "PASS student.delete cascades monitor-reported rows too"
    : "FAIL monitor row leftover after target deletion");

// ---- 批次Q：证件照上传 / 作用域 / 替换清旧 / 级联 ----
const qStu = await post({ action: "student.create", student_no: "Q900000001", name: "证件照测试", gender: "女", class_name: "测试Q班" }, T);
const qid = qStu.item?.id;
let qP2 = null;
const seedPhotos = await get("photos", T);
results.push(
  seedPhotos.ok && seedPhotos.data.some((p) => p.original_name?.includes("王芳")) && seedPhotos.data.every((p) => p.object_path === undefined)
    ? "PASS photos list: seed photo visible, object_path never leaked"
    : `FAIL qList ${JSON.stringify(seedPhotos).slice(0, 200)}`
);
const qExe = await post({ action: "photo.prepare", student_id: qid, file_name: "photo.exe", size: 100 }, T);
results.push(qExe.code === "photo_type_not_allowed" ? "PASS photo rejects non-image extension" : `FAIL qExe ${JSON.stringify(qExe)}`);
const qGif = await post({ action: "photo.prepare", student_id: qid, file_name: "anim.gif", size: 100 }, T);
results.push(qGif.code === "photo_type_not_allowed" ? "PASS photo stricter than attachment (gif rejected)" : `FAIL qGif ${JSON.stringify(qGif)}`);
const qBig = await post({ action: "photo.prepare", student_id: qid, file_name: "big.jpg", size: 2 * 1024 * 1024 + 1 }, T);
results.push(qBig.code === "photo_too_large" ? "PASS photo >2MiB rejected at prepare" : `FAIL qBig ${JSON.stringify(qBig)}`);
const qGhost = await post({ action: "photo.prepare", student_id: "00000000-0000-4000-8000-000000000000", file_name: "a.jpg", size: 10 }, T);
results.push(qGhost.code === "not_found" ? "PASS photo prepare requires existing student" : `FAIL qGhost ${JSON.stringify(qGhost)}`);
const qNoAuth = await post({ action: "photo.prepare", student_id: qid, file_name: "a.jpg", size: 10 });
results.push(qNoAuth.code === "login_required" && qNoAuth.status === 401 ? "PASS photo endpoints require session" : `FAIL qNoAuth ${JSON.stringify(qNoAuth)}`);
const qP1 = await post({ action: "photo.prepare", student_id: qid, file_name: "一寸.jpg", size: pngBytes.length }, CT2);
if (qP1.ok) {
  await fetch(`http://127.0.0.1:8123${qP1.upload_url}`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: pngBytes });
  const qC1 = await post({ action: "photo.complete", id: qP1.id, student_id: qid, file_name: "一寸.jpg", size: pngBytes.length }, CT2);
  results.push(qC1.ok && qC1.item?.content_type === "image/jpeg" && qC1.item?.object_path === undefined
    ? "PASS counselor uploads photo, metadata returned without path" : `FAIL qC1 ${JSON.stringify(qC1)}`);
  qP2 = await post({ action: "photo.prepare", student_id: qid, file_name: "二号.png", size: pngBytes.length }, T);
  await fetch(`http://127.0.0.1:8123${qP2.upload_url}`, { method: "PUT", headers: { "content-type": "image/png" }, body: pngBytes });
  const qC2 = await post({ action: "photo.complete", id: qP2.id, student_id: qid, file_name: "二号.png", size: pngBytes.length }, T);
  const qAfter = await get("photos", T);
  const qMine = qAfter.data.filter((p) => p.student_id === qid);
  const oldObjGone = (await fetch(`http://127.0.0.1:8123/fake-storage/get/avatars/${qid}/${qP1.id}.jpg`)).status === 404;
  const newObj = await fetch(`http://127.0.0.1:8123/fake-storage/get/avatars/${qid}/${qP2.id}.png`);
  results.push(qC2.ok && qMine.length === 1 && qMine[0].id === qP1.id && qMine[0].original_name === "二号.png" && oldObjGone && newObj.ok
    ? "PASS replace keeps one stable row, purges old object, keeps new" : `FAIL qReplace ${qMine.length} ${qMine[0]?.id === qP1.id} ${oldObjGone} ${newObj.status}`);
}
const qTamper = await post({ action: "photo.complete", id: qP1.id, student_id: qid, file_name: "改.png", size: pngBytes.length }, T);
results.push(qTamper.code === "upload_validation_failed" ? "PASS complete rejects extension/path mismatch" : `FAIL qTamper ${JSON.stringify(qTamper)}`);
// 学生自助传照用独立账号（此前的 S202699 已在中途被级联测试删除）
const qReg = await post({ action: "auth.student_register", student_no: "Q900000002", name: "自传照生" });
const qLogin = await post({ action: "auth.login", username: "q900000002", password: "123456" });
await post({ action: "auth.change_password", old_password: "123456", new_password: "qqphoto9" }, qLogin.token);
const QT = qLogin.token;
const qSid = qReg.member?.student_id;
const qUrls = await post({ action: "photo.urls", student_ids: [qid, qSid].filter(Boolean) }, T);
results.push(qUrls.ok && typeof qUrls.urls === "object" ? "PASS staff batch-signs avatar urls" : `FAIL qUrls ${JSON.stringify(qUrls)}`);
const stuPhoto = await post({ action: "photo.prepare", student_id: qSid, file_name: "自传.jpg", size: pngBytes.length }, QT);
results.push(stuPhoto.ok ? "PASS student can prepare own photo" : `FAIL stuPhoto ${JSON.stringify(stuPhoto)}`);
if (stuPhoto.ok) {
  await fetch(`http://127.0.0.1:8123${stuPhoto.upload_url}`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: pngBytes });
  const stuDone = await post({ action: "photo.complete", id: stuPhoto.id, student_id: qSid, file_name: "自传.jpg", size: pngBytes.length }, QT);
  results.push(stuDone.ok ? "PASS student completes own photo upload" : `FAIL stuDone ${JSON.stringify(stuDone)}`);
}
const stuOther = await post({ action: "photo.prepare", student_id: qid, file_name: "偷传.jpg", size: pngBytes.length }, QT);
results.push(stuOther.code === "access_denied" && stuOther.status === 403 ? "PASS student cannot upload for others" : `FAIL stuOther ${JSON.stringify(stuOther)}`);
const qqDelByStu = await post({ action: "photo.delete", student_id: qSid }, QT);
results.push(qqDelByStu.code === "access_denied" ? "PASS student cannot delete own photo (only replace)" : `FAIL qqDelByStu ${JSON.stringify(qqDelByStu)}`);
const stuList = await get("photos", QT);
results.push(stuList.ok && stuList.data.length === 1 && stuList.data.every((p) => p.student_id === qSid) && !stuList.data.some((p) => p.original_name?.includes("王芳"))
  ? "PASS student photos scope: own row only, seed row hidden" : `FAIL stuList ${JSON.stringify(stuList).slice(0, 160)}`);
const stuUrls = await post({ action: "photo.urls", student_ids: [qid] }, QT);
results.push(stuUrls.code === "access_denied" ? "PASS student cannot sign urls for others" : `FAIL stuUrls ${JSON.stringify(stuUrls)}`);
const qStuUrls = await post({ action: "photo.urls", student_ids: [qSid] }, QT);
results.push(qStuUrls.ok && typeof qStuUrls.urls?.[qSid] === "string" ? "PASS student can sign own url batch" : `FAIL qStuUrls ${JSON.stringify(qStuUrls)}`);
const qBadBody = await post({ action: "photo.urls", student_ids: [] }, T);
results.push(qBadBody.code === "invalid_request" ? "PASS photo.urls rejects empty batch" : `FAIL qBadBody ${JSON.stringify(qBadBody)}`);
const qDelLog = await post({ action: "photo.delete", student_id: qid }, T);
const qDelObjGone = (await fetch(`http://127.0.0.1:8123/fake-storage/get/avatars/${qid}/${qP2.id}.png`)).status === 404;
const qAfterDel = await get("photos", T);
results.push(qDelLog.ok && qDelObjGone && qAfterDel.data.every((p) => p.student_id !== qid)
  ? "PASS staff deletes photo (row + object)" : `FAIL qDel ${JSON.stringify(qDelLog)} ${qDelObjGone}`);
const qLog = (await get("audit_logs", T)).data.find((l) => l.action === "photo.prepare");
results.push(qLog ? "PASS photo writes are audited" : "FAIL photo audit missing");
// 级联：先给测试生传照再删学生，行与对象都应消失
const qP3 = await post({ action: "photo.prepare", student_id: qid, file_name: "告别照.jpg", size: pngBytes.length }, T);
await fetch(`http://127.0.0.1:8123${qP3.upload_url}`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: pngBytes });
await post({ action: "photo.complete", id: qP3.id, student_id: qid, file_name: "告别照.jpg", size: pngBytes.length }, T);
await post({ action: "student.delete", id: qid }, T);
const qFinal = await get("photos", T);
const qCascadeObjGone = (await fetch(`http://127.0.0.1:8123/fake-storage/get/avatars/${qid}/${qP3.id}.jpg`)).status === 404;
results.push(qFinal.ok && qFinal.data.every((p) => p.student_id !== qid) && qCascadeObjGone
  ? "PASS student.delete cascades photo row + object" : `FAIL qCascade ${JSON.stringify(qFinal).slice(0, 120)} ${qCascadeObjGone}`);
// 收尾：删掉自助注册的测试生，样例库应只剩种子照片（避免污染本地预览）
if (qSid) await post({ action: "student.delete", id: qSid }, T);
const qClean = await get("photos", T);
results.push(qClean.ok && qClean.data.length === 1 && qClean.data[0].original_name?.includes("王芳")
  ? "PASS batch Q leaves only the seed photo" : `FAIL qCleanup ${JSON.stringify(qClean.data?.map((p) => p.original_name))}`);

// ===== 批次 V：荣誉台账（按成绩授予 / 撤销留档 / 学生端不可见）=====
const VTERM = "2025-2026-2";
const GHOST = "00000000-0000-4000-8000-000000000000";
const vReg = await post({ action: "auth.student_register", student_no: "V900000001", name: "荣誉测试生" });
const vLogin = await post({ action: "auth.login", username: "v900000001", password: "123456" });
await post({ action: "auth.change_password", old_password: "123456", new_password: "vhonor789" }, vLogin.token);
const VT = vLogin.token;
const vid = vReg.member?.student_id;
const vMate = await post({ action: "student.create", student_no: "V900000002", name: "荣誉陪跑生", gender: "女", class_name: "计算机2401" }, T);
const vid2 = vMate.item?.id;
results.push(vReg.ok && vLogin.ok && vMate.ok ? "PASS 批次V fixture accounts ready" : `FAIL vFixture ${JSON.stringify(vReg).slice(0, 120)} ${JSON.stringify(vMate).slice(0, 120)}`);

// 学生端整块不可见：读被硬拒、写被硬拒、匿名先要登录
const vStuRead = await get("honors", VT);
results.push(vStuRead.code === "access_denied" && vStuRead.status === 403 ? "PASS student cannot read honors (staff-only module)" : `FAIL vStuRead ${JSON.stringify(vStuRead)}`);
const vAnonRead = await get("honors");
results.push(vAnonRead.code === "login_required" && vAnonRead.status === 401 ? "PASS honors read requires session" : `FAIL vAnonRead ${JSON.stringify(vAnonRead)}`);
const vAnonWrite = await post({ action: "honor.create", student_id: vid ?? GHOST, title: "三好学生", level: "校级", granted_on: "2026-10-08" });
results.push(vAnonWrite.code === "login_required" && vAnonWrite.status === 401 ? "PASS honor writes require session (live smoke discriminator)" : `FAIL vAnonWrite ${JSON.stringify(vAnonWrite)}`);
const vStuWrite = await post({ action: "honor.create", student_id: vid, title: "三好学生", level: "校级", granted_on: "2026-10-08" }, VT);
results.push(vStuWrite.code === "access_denied" ? "PASS student cannot grant honors" : `FAIL vStuWrite ${JSON.stringify(vStuWrite)}`);
const vUnknown = await post({ action: "honor.not_a_thing", id: GHOST }, T);
results.push(vUnknown.code === "unknown_action" ? "PASS unknown honor action still 404" : `FAIL vUnknown ${JSON.stringify(vUnknown)}`);

// 台账读取：联名学生字段 + 辅导员见全表（不是自见作用域）
const vSeedList = await get("honors", T);
const vSeed = (vSeedList.data ?? []).find((h) => h.title === "学习标兵");
results.push(
  vSeedList.ok && vSeed?.student_name === "赵敏" && vSeed?.class_name === "计算机2401" && vSeed?.status === "active"
    ? "PASS admin sees honor ledger with joined student fields"
    : `FAIL vSeed ${JSON.stringify(vSeedList).slice(0, 200)}`
);
const vSeedC = await get("honors", CT2);
results.push(vSeedC.ok && vSeedC.data.length === vSeedList.data.length ? "PASS counselor sees the whole ledger" : `FAIL vSeedC ${vSeedC.data?.length}/${vSeedList.data?.length}`);

// 单条授予 + 去重口径（同名同学期即重复，不看级别；换学期可再授）
const vCreate = await post({ action: "honor.create", student_id: vid, title: "三好学生", level: "校级", term: VTERM, granted_on: "2026-10-08", note: "综合分班内第一" }, T);
results.push(
  vCreate.ok && vCreate.item?.status === "active" && vCreate.item?.granted_by && vCreate.item?.revoked_at === null
    ? "PASS honor.create stores active row with granter name"
    : `FAIL vCreate ${JSON.stringify(vCreate)}`
);
const vDup = await post({ action: "honor.create", student_id: vid, title: "三好学生", level: "班级", term: VTERM, granted_on: "2026-10-09" }, T);
results.push(vDup.code === "honor_exists" && vDup.status === 409 ? "PASS same title+term dedupes regardless of level (active rows only)" : `FAIL vDup ${JSON.stringify(vDup)}`);
const vOtherTerm = await post({ action: "honor.create", student_id: vid, title: "三好学生", level: "校级", term: "2026-2027-1", granted_on: "2026-10-09" }, T);
results.push(vOtherTerm.ok ? "PASS same title in another term is allowed" : `FAIL vOtherTerm ${JSON.stringify(vOtherTerm)}`);
const vNoTerm = await post({ action: "honor.create", student_id: vid, title: "文明个人", level: "班级", granted_on: "2026-10-08" }, T);
results.push(vNoTerm.ok && vNoTerm.item?.term === "" ? "PASS honor.term is optional" : `FAIL vNoTerm ${JSON.stringify(vNoTerm)}`);

// 参数校验
const vBadLevel = await post({ action: "honor.create", student_id: vid, title: "某某奖", level: "世界级", term: VTERM, granted_on: "2026-10-08" }, T);
results.push(vBadLevel.code === "invalid_request" ? "PASS honor rejects level outside the five" : `FAIL vBadLevel ${JSON.stringify(vBadLevel)}`);
const vBadDate = await post({ action: "honor.create", student_id: vid, title: "某某奖", level: "校级", term: VTERM, granted_on: "2026/10/08" }, T);
results.push(vBadDate.code === "invalid_request" ? "PASS honor rejects non-ISO granted_on" : `FAIL vBadDate ${JSON.stringify(vBadDate)}`);
const vNoTitle = await post({ action: "honor.create", student_id: vid, level: "校级", granted_on: "2026-10-08" }, T);
results.push(vNoTitle.code === "invalid_request" ? "PASS honor.create requires title" : `FAIL vNoTitle ${JSON.stringify(vNoTitle)}`);
const vGhost = await post({ action: "honor.create", student_id: GHOST, title: "某某奖", level: "校级", term: VTERM, granted_on: "2026-10-08" }, T);
results.push(vGhost.code === "not_found" && vGhost.status === 404 ? "PASS honor.create for missing student → not_found" : `FAIL vGhost ${JSON.stringify(vGhost)}`);

// 批量授予：整批共用称号/级别/学期，逐人跳过
await post({ action: "honor.create", student_id: vid2, title: "优秀团员", level: "院级", term: VTERM, granted_on: "2026-10-08" }, T);
const vBulk = await post({ action: "honor.bulk_create", title: "优秀团员", level: "院级", term: VTERM, granted_on: "2026-10-08", student_ids: [vid2, GHOST, vid] }, T);
results.push(
  vBulk.ok && vBulk.created === 1 && vBulk.skipped?.length === 2
    && vBulk.skipped.some((s) => s.reason === "honor_exists" && s.student_id === vid2)
    && vBulk.skipped.some((s) => s.reason === "student_not_found" && s.student_id === GHOST)
    ? "PASS bulk grant counts created and skips existing/missing"
    : `FAIL vBulk ${JSON.stringify(vBulk)}`
);
const vBulkEmpty = await post({ action: "honor.bulk_create", title: "某某奖", level: "校级", granted_on: "2026-10-08", student_ids: [] }, T);
results.push(vBulkEmpty.code === "invalid_request" ? "PASS bulk rejects empty list" : `FAIL vBulkEmpty ${JSON.stringify(vBulkEmpty)}`);
const vBulkBig = await post({ action: "honor.bulk_create", title: "某某奖", level: "校级", granted_on: "2026-10-08", student_ids: Array.from({ length: 301 }, () => crypto.randomUUID()) }, T);
results.push(vBulkBig.code === "invalid_request" ? "PASS bulk caps at 300 students" : `FAIL vBulkBig ${JSON.stringify(vBulkBig).slice(0, 120)}`);
const vBulkBadId = await post({ action: "honor.bulk_create", title: "某某奖", level: "校级", granted_on: "2026-10-08", student_ids: ["not-a-uuid"] }, T);
results.push(vBulkBadId.code === "invalid_request" ? "PASS bulk rejects malformed student id" : `FAIL vBulkBadId ${JSON.stringify(vBulkBadId)}`);

// 订正 → 撤销留档 → 历史不可改 → 可重新授予 → 留档可删
const vRow = (await get("honors", T)).data.find((h) => h.student_id === vid2 && h.title === "优秀团员");
const vUpdate = await post({ action: "honor.update", id: vRow?.id, title: "优秀团员", level: "校级", term: VTERM, granted_on: "2026-10-08", note: "级别更正" }, T);
results.push(vUpdate.ok && vUpdate.item?.level === "校级" && vUpdate.item?.note === "级别更正" ? "PASS honor.update edits an active row" : `FAIL vUpdate ${JSON.stringify(vUpdate)}`);
const vRevoke = await post({ action: "honor.revoke", id: vUpdate.item?.id }, T);
results.push(vRevoke.ok && vRevoke.item?.status === "revoked" && vRevoke.item?.revoked_at ? "PASS honor.revoke moves the row to history" : `FAIL vRevoke ${JSON.stringify(vRevoke)}`);
const vRevokeAgain = await post({ action: "honor.revoke", id: vRevoke.item?.id }, T);
results.push(vRevokeAgain.code === "not_found" ? "PASS revoking twice → not_found" : `FAIL vRevokeAgain ${JSON.stringify(vRevokeAgain)}`);
const vUpdateHistory = await post({ action: "honor.update", id: vRevoke.item?.id, title: "优秀团员", level: "班级", granted_on: "2026-10-08" }, T);
results.push(vUpdateHistory.code === "not_found" ? "PASS history rows are immutable" : `FAIL vUpdateHistory ${JSON.stringify(vUpdateHistory)}`);
const vRegrant = await post({ action: "honor.create", student_id: vid2, title: "优秀团员", level: "院级", term: VTERM, granted_on: "2026-10-10" }, T);
results.push(vRegrant.ok && vRegrant.item?.status === "active" ? "PASS revoked honor does not block re-granting" : `FAIL vRegrant ${JSON.stringify(vRegrant)}`);
const vDelHistory = await post({ action: "honor.delete", id: vRevoke.item?.id }, T);
results.push(vDelHistory.ok ? "PASS history row can be deleted" : `FAIL vDelHistory ${JSON.stringify(vDelHistory)}`);
const vDelAgain = await post({ action: "honor.delete", id: vRevoke.item?.id }, T);
results.push(vDelAgain.code === "not_found" ? "PASS deleting a missing honor → not_found" : `FAIL vDelAgain ${JSON.stringify(vDelAgain)}`);

// 级联 + 审计
const vDelStu = await post({ action: "student.delete", id: vid2 }, T);
const vAfterCascade = await get("honors", T);
results.push(vDelStu.ok && vAfterCascade.data.every((h) => h.student_id !== vid2) ? "PASS student.delete cascades honors" : `FAIL vCascade ${JSON.stringify(vAfterCascade).slice(0, 160)}`);
const vLog = (await get("audit_logs", T)).data.find((l) => l.action === "honor.bulk_create");
results.push(vLog?.detail?.includes("students=3") && !vLog.detail.includes(GHOST) ? "PASS bulk grant audited by count, ids not dumped" : `FAIL vLog ${JSON.stringify(vLog)}`);

// 收尾：删掉测试授予与测试生，台账只留四条种子荣誉（避免污染本地预览）
const vMine = (await get("honors", T)).data.filter((h) => h.student_id === vid);
for (const h of vMine) await post({ action: "honor.delete", id: h.id }, T);
await post({ action: "student.delete", id: vid }, T);
const vClean = await get("honors", T);
results.push(
  vMine.length === 4 && vClean.ok && vClean.data.length === 4 && vClean.data.every((h) => h.status === "active" || h.student_name === "刘洋")
    ? "PASS 批次V leaves only the four seed honors"
    : `FAIL vCleanup ${vMine.length} ${JSON.stringify(vClean.data?.map((h) => h.title))}`
);

// ===== 批次 W：挂科一票否决（活门禁 / 压线口径 / 留痕放行 / 历史学期开关）=====
const wCourse = (await get("courses", T)).data.find((c) => c.name === "数据结构") ?? (await get("courses", T)).data[0];
const wA = await post({ action: "student.create", student_no: "W900000001", name: "挂科门禁生", gender: "男", class_name: "计算机2401" }, T);
const wB = await post({ action: "student.create", student_no: "W900000002", name: "历史挂科生", gender: "女", class_name: "计算机2401" }, T);
const wAid = wA.item?.id;
const wBid = wB.item?.id;
const wSeedFail = (await get("students", T)).data.find((s) => s.student_no === "2023030302"); // 蒋磊：55 数据结构 2025-2026-2
results.push(wCourse && wAid && wBid && wSeedFail ? "PASS 批次W fixture accounts ready" : `FAIL wFixture ${JSON.stringify(wA).slice(0, 120)}`);

// 无成绩的学生不受影响（门禁只在确有不及格记录时生效）
const wNoGrade = await post({ action: "honor.create", student_id: wAid, title: "无成绩可授", level: "校级", term: VTERM, granted_on: "2026-10-08" }, T);
results.push(wNoGrade.ok ? "PASS student without grades is never blocked by the fail gate" : `FAIL wNoGrade ${JSON.stringify(wNoGrade)}`);

// 挂科即拦：种子库里 55 分的学生，本学期授予被 409 挡下
const wSeedBlock = await post({ action: "honor.create", student_id: wSeedFail?.id, title: "学习先进", level: "校级", term: VTERM, granted_on: "2026-10-08" }, T);
results.push(wSeedBlock.code === "honor_student_failed" && wSeedBlock.status === 409 ? "PASS failing student blocked at honor.create (409)" : `FAIL wSeedBlock ${JSON.stringify(wSeedBlock)}`);

const wGrade = await post({ action: "grade.create", student_id: wAid, course_id: wCourse.id, term: VTERM, score: "42", exam_date: "2026-06-01" }, T);
const wBlock = await post({ action: "honor.create", student_id: wAid, title: "挂科后不可授", level: "校级", term: VTERM, granted_on: "2026-10-08" }, T);
results.push(wGrade.ok && wBlock.code === "honor_student_failed" ? "PASS newly recorded fail blocks the next grant" : `FAIL wBlock ${JSON.stringify(wGrade).slice(0, 100)} ${JSON.stringify(wBlock)}`);

// 留痕放行：勾选确认必须带备注，带备注才放行，备注随记录归档
const wAckNoNote = await post({ action: "honor.create", student_id: wAid, title: "挂科后不可授", level: "校级", term: VTERM, granted_on: "2026-10-08", ack_failed: true }, T);
results.push(wAckNoNote.code === "honor_ack_note_required" && wAckNoNote.status === 400 ? "PASS override without a note is rejected" : `FAIL wAckNoNote ${JSON.stringify(wAckNoNote)}`);
const wAck = await post({ action: "honor.create", student_id: wAid, title: "挂科后不可授", level: "校级", term: VTERM, granted_on: "2026-10-08", ack_failed: true, note: "竞赛获奖破例" }, T);
results.push(wAck.ok && wAck.item?.note === "竞赛获奖破例" ? "PASS override with a note grants and keeps the reason" : `FAIL wAck ${JSON.stringify(wAck)}`);
const wBulkAckNoNote = await post({ action: "honor.bulk_create", title: "破例批量", level: "校级", term: VTERM, granted_on: "2026-10-08", student_ids: [wAid], allow_failed: true }, T);
results.push(wBulkAckNoNote.code === "honor_ack_note_required" ? "PASS bulk override also requires a note" : `FAIL wBulkAck ${JSON.stringify(wBulkAckNoNote)}`);

// 压线口径：60 分不算挂科，改回 59 又立刻被拦（说明门禁读的是当前分数）
const wEdge = await post({ action: "grade.update", id: wGrade.item?.id, score: "60" }, T);
const wEdgeGrant = await post({ action: "honor.create", student_id: wAid, title: "压线可授", level: "校级", term: VTERM, granted_on: "2026-10-08" }, T);
results.push(wEdge.ok && wEdgeGrant.ok ? "PASS 60 is a pass, not a fail" : `FAIL wEdge ${JSON.stringify(wEdge).slice(0, 100)} ${JSON.stringify(wEdgeGrant)}`);
await post({ action: "grade.update", id: wGrade.item?.id, score: "59" }, T);
const wEdgeBack = await post({ action: "honor.create", student_id: wAid, title: "改挂即拦", level: "校级", term: VTERM, granted_on: "2026-10-08" }, T);
results.push(wEdgeBack.code === "honor_student_failed" ? "PASS reverting to 59 blocks again (gate reads live scores)" : `FAIL wEdgeBack ${JSON.stringify(wEdgeBack)}`);

// 圈选批量：挂科学生跳过并给出原因，其余照常授予
const wBulk = await post({ action: "honor.bulk_create", title: "批量授予", level: "校级", term: VTERM, granted_on: "2026-10-08", student_ids: [wAid, wBid] }, T);
results.push(
  wBulk.ok && wBulk.created === 1 && wBulk.skipped?.length === 1
    && wBulk.skipped[0].reason === "student_failed" && wBulk.skipped[0].student_id === wAid
    ? "PASS bulk skips failing students with reason student_failed"
    : `FAIL wBulk ${JSON.stringify(wBulk)}`
);
const wBulkAllow = await post({ action: "honor.bulk_create", title: "批量破例", level: "校级", term: VTERM, granted_on: "2026-10-08", student_ids: [wAid, wBid], allow_failed: true, note: "院级评比名额已批" }, T);
results.push(wBulkAllow.ok && wBulkAllow.created === 2 && wBulkAllow.skipped?.length === 0 ? "PASS bulk override grants everyone" : `FAIL wBulkAllow ${JSON.stringify(wBulkAllow)}`);

// 历史学期开关：默认只看本学期，勾选后历史挂科也排除
const wOldFail = await post({ action: "grade.create", student_id: wBid, course_id: wCourse.id, term: "2026-2027-1", score: "38", exam_date: "2027-01-05" }, T);
const wTermGrant = await post({ action: "honor.create", student_id: wBid, title: "本学期仍可信", level: "班级", term: "2025-2026-1", granted_on: "2026-10-08" }, T);
const wBulkNoFlag = await post({ action: "honor.bulk_create", title: "历史不计", level: "校级", term: "2025-2026-1", granted_on: "2026-10-08", student_ids: [wBid] }, T);
results.push(wOldFail.ok && wTermGrant.ok && wBulkNoFlag.created === 1 ? "PASS other-term fail is ignored by default" : `FAIL wHistory ${JSON.stringify(wTermGrant)} ${JSON.stringify(wBulkNoFlag)}`);
const wBulkHistory = await post({ action: "honor.bulk_create", title: "历史也计", level: "校级", term: "2025-2026-1", granted_on: "2026-10-08", student_ids: [wBid], include_history_fail: true }, T);
results.push(
  wBulkHistory.ok && wBulkHistory.created === 0
    && wBulkHistory.skipped?.[0]?.reason === "student_failed"
    ? "PASS include_history_fail widens the exclusion to past terms"
    : `FAIL wBulkHistory ${JSON.stringify(wBulkHistory)}`
);
// 台账不填学期 = 按全部历史判，历史挂科同样拦下
const wNoTerm = await post({ action: "honor.create", student_id: wBid, title: "未填学期", level: "校级", granted_on: "2026-10-08" }, T);
results.push(wNoTerm.code === "honor_student_failed" ? "PASS grant without a term checks the whole record" : `FAIL wNoTerm ${JSON.stringify(wNoTerm)}`);

// 收尾：删测试生（成绩与荣誉随级联消失），台账回到四条种子荣誉
for (const id of [wAid, wBid]) await post({ action: "student.delete", id }, T);
const wClean = await get("honors", T);
results.push(
  wClean.ok && wClean.data.length === 4 && wClean.data.every((h) => !String(h.title).startsWith("挂科") && !String(h.title).startsWith("批量"))
    ? "PASS 批次W cleanup restores the seed ledger"
    : `FAIL wCleanup ${JSON.stringify(wClean.data?.map((h) => h.title))}`
);

// ===== 批次 Z：更新公告（分角色可见 / 仅管理员可写 / 编辑与删除 / 审计）=====
const zCounselor = await post({ action: "account.create", username: "znotice-counselor", display_name: "公告测试辅导员", role: "counselor", password: "zn123456" }, T);
const zLogin0 = await post({ action: "auth.login", username: "znotice-counselor", password: "zn123456" });
// account.create 的新账号是首登强制改密态，未改密前一切业务读写都被 403 挡住
await post({ action: "auth.change_password", old_password: "zn123456", new_password: "zn654321" }, zLogin0.token);
const zCT = zLogin0.token;
const zReg = await post({ action: "auth.student_register", student_no: "Z900000001", name: "公告测试生" });
const zLogin = await post({ action: "auth.login", username: "z900000001", password: "123456" });
await post({ action: "auth.change_password", old_password: "123456", new_password: "zn889900" }, zLogin.token);
const zST = zLogin.token;
const zSid = zReg.member?.student_id;
results.push(zCT && zST && zSid ? "PASS 批次Z fixture accounts ready" : `FAIL zFixture ${JSON.stringify(zCounselor).slice(0, 120)}`);

const zNoToken = await get("changelog");
results.push(zNoToken.code === "login_required" && zNoToken.status === 401 ? "PASS changelog read requires session" : `FAIL zNoToken ${JSON.stringify(zNoToken)}`);
const zAdmin = await get("changelog", T);
results.push(
  zAdmin.ok && zAdmin.data.length === 2 && zAdmin.data[0].created_at > zAdmin.data[1].created_at
    ? "PASS admin sees both seed notices, newest first"
    : `FAIL zAdmin ${JSON.stringify(zAdmin).slice(0, 200)}`
);
const zStuSeed = await get("changelog", zST);
results.push(
  zStuSeed.ok && zStuSeed.data.length === 2 && zStuSeed.data.every((c) => c.audience !== "staff")
    ? "PASS student sees all+student notices (seed has no staff row yet)"
    : `FAIL zStuSeed ${JSON.stringify(zStuSeed).slice(0, 160)}`
);

// 写入门禁：辅导员与学生都被拒，匿名要登录
const zStuWrite = await post({ action: "changelog.save", title: "学生发公告", content: "不该成功", audience: "all" }, zST);
results.push(zStuWrite.code === "access_denied" && zStuWrite.status === 403 ? "PASS student cannot publish notices" : `FAIL zStuWrite ${JSON.stringify(zStuWrite)}`);
const zCTWrite = await post({ action: "changelog.save", title: "辅导员发公告", content: "不该成功", audience: "all" }, zCT);
results.push(zCTWrite.code === "access_denied" ? "PASS counselor cannot publish notices" : `FAIL zCTWrite ${JSON.stringify(zCTWrite)}`);
const zAnonWrite = await post({ action: "changelog.save", title: "匿名", content: "x", audience: "all" });
results.push(zAnonWrite.code === "login_required" ? "PASS anonymous publish rejected" : `FAIL zAnonWrite ${JSON.stringify(zAnonWrite)}`);

// 校验：缺标题/非法受众/非法 id/未知行更新
const zNoTitle = await post({ action: "changelog.save", title: "", content: "正文", audience: "all" }, T);
results.push(zNoTitle.code === "invalid_request" ? "PASS empty title rejected" : `FAIL zNoTitle ${JSON.stringify(zNoTitle)}`);
const zBadAud = await post({ action: "changelog.save", title: "t", content: "c", audience: "everyone" }, T);
results.push(zBadAud.code === "invalid_request" ? "PASS invalid audience rejected" : `FAIL zBadAud ${JSON.stringify(zBadAud)}`);
const zBadId = await post({ action: "changelog.save", id: "not-a-uuid", title: "t", content: "c", audience: "all" }, T);
results.push(zBadId.code === "invalid_id" ? "PASS malformed id rejected" : `FAIL zBadId ${JSON.stringify(zBadId)}`);
const zGhostUpdate = await post({ action: "changelog.save", id: "00000000-0000-4000-8000-000000000000", title: "t", content: "c", audience: "all" }, T);
results.push(zGhostUpdate.code === "not_found" && zGhostUpdate.status === 404 ? "PASS update of unknown notice is 404" : `FAIL zGhostUpdate ${JSON.stringify(zGhostUpdate)}`);
const zGhostDelete = await post({ action: "changelog.delete", id: "00000000-0000-4000-8000-000000000000" }, T);
results.push(zGhostDelete.code === "not_found" ? "PASS delete of unknown notice is 404" : `FAIL zGhostDelete ${JSON.stringify(zGhostDelete)}`);

// 发布三条：全员 / 仅教职工 / 仅学生，分角色可见性各验一次
const zAll = await post({ action: "changelog.save", title: "全员新公告", content: "所有角色都应看到这条。", audience: "all" }, T);
const zStaff = await post({ action: "changelog.save", title: "教职工专用", content: "辅导员端口径说明。", audience: "staff" }, T);
const zStudent = await post({ action: "changelog.save", title: "学生专用", content: "同学端提醒。", audience: "student" }, T);
results.push(zAll.ok && zStaff.ok && zStudent.ok ? "PASS admin publishes three notices" : `FAIL zSave ${JSON.stringify(zAll).slice(0, 120)}`);
const zStu = (await get("changelog", zST)).data.map((c) => c.title);
const zCounselorList = (await get("changelog", zCT)).data.map((c) => c.title);
const zAdminList = (await get("changelog", T)).data.map((c) => c.title);
results.push(
  zStu.includes("全员新公告") && zStu.includes("学生专用") && !zStu.includes("教职工专用")
    ? "PASS student visibility: all+student only" : `FAIL zStuVis ${JSON.stringify(zStu)}`
);
results.push(
  zCounselorList.includes("全员新公告") && zCounselorList.includes("教职工专用") && !zCounselorList.includes("学生专用")
    ? "PASS counselor visibility: all+staff only" : `FAIL zCVis ${JSON.stringify(zCounselorList)}`
);
results.push(zAdminList.length === 5 ? "PASS admin sees every audience" : `FAIL zAdminVis ${JSON.stringify(zAdminList)}`);

// 编辑：带 id 更新原行，不新增
const zEdit = await post({ action: "changelog.save", id: zAll.item?.id, title: "全员新公告（已改）", content: "改过的正文。", audience: "student" }, T);
const zAfterEdit = await get("changelog", T);
results.push(
  zEdit.ok && zEdit.item?.id === zAll.item?.id && zEdit.item?.title === "全员新公告（已改）" && zEdit.item?.body === "改过的正文。" && zAfterEdit.data.length === 5
    ? "PASS save with id updates in place (no duplicate row)" : `FAIL zEdit ${JSON.stringify(zEdit).slice(0, 160)} n=${zAfterEdit.data?.length}`
);

// 审计：发布公告动作入库
const zLog = (await get("audit_logs", T)).data.find((l) => l.action === "changelog.save");
results.push(zLog ? "PASS changelog.save is audited" : "FAIL changelog audit missing");

// 收尾：删掉三条测试公告（其中一条已被改成学生可见），回到两条种子
for (const id of [zAll.item?.id, zStaff.item?.id, zStudent.item?.id]) await post({ action: "changelog.delete", id }, T);
if (zSid) await post({ action: "student.delete", id: zSid }, T);
const zAcct = (await get("account.list", T)).data.find((u) => u.username === "znotice-counselor");
if (zAcct) await post({ action: "account.update", id: zAcct.id, status: "disabled" }, T);
const zClean = await get("changelog", T);
results.push(
  zClean.ok && zClean.data.length === 2 && zClean.data.every((c) => !String(c.title).startsWith("全员新公告") && c.title !== "教职工专用" && c.title !== "学生专用")
    ? "PASS 批次Z cleanup restores the two seed notices" : `FAIL zCleanup ${JSON.stringify(zClean.data?.map((c) => c.title))}`
);

console.log(results.join("\n"));
console.log(results.every((r) => r.startsWith("PASS")) ? `\nALL ${results.length} CASES PASS` : "\nSOME FAILED");
