import { getToken } from "@/lib/session";

// 同源 Function 请求封装：浏览器只访问 /functions/v1/app。
export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number = 0) {
    super(message);
    this.name = "ApiError";
  }
}

// 已知错误码 -> 面向用户的中文提示；未知错误码使用兜底文案，绝不展示原始服务端信息。
const MESSAGES: Readonly<Record<string, string>> = {
  network_error: "网络请求未完成。请先刷新确认操作是否已生效，再决定是否重试。",
  access_denied: "没有访问权限，请使用被授权的账号登录后再试。",
  login_required: "请先登录后再使用本系统。",
  invalid_response: "服务返回了无法识别的响应，请检查登录状态后重试。",
  request_failed: "请求失败，请稍后重试。",
  invalid_request: "请填写必填项，并检查内容格式。",
  invalid_review_note: "审批意见需为 500 字以内的文字。",
  unknown_action: "不支持的操作。",
  not_found: "记录不存在，可能已被删除，请刷新后重试。",
  student_no_exists: "该学号已存在，请更换学号。",
  position_exists: "该学生已担任此职务，无需重复委任。",
  report_not_allowed: "当前没有可上报本班考勤的职务权限，请联系辅导员开通。",
  report_class_unassigned: "你的档案还没有班级，暂时无法上报本班考勤，请先完善个人信息。",
  not_classmate: "只能上报本班同学的考勤。",
  student_not_found: "未找到该学生。",
  room_not_found: "未找到该宿舍房间。",
  room_exists: "该楼栋下已存在同号房间。",
  room_not_empty: "房间内还有学生住宿，无法删除。",
  bed_occupied: "该床位已被其他学生占用。",
  bed_out_of_range: "床位号超出房间床位数。",
  room_gender_mismatch: "该房间仅限同性别学生入住，与学生性别不符。",
  capacity_too_small: "房间容量小于当前入住人数。",
  invalid_content_type: "请求格式不正确。",
  body_too_large: "提交内容过长。",
  invalid_json: "提交内容格式不正确。",
  database_request_failed: "数据服务暂时不可用，请稍后重试。",
  login_failed: "用户名或密码不正确。",
  login_locked: "登录失败次数过多，账号已临时锁定，请 15 分钟后再试。",
  account_disabled: "该账号已被停用，请联系管理员。",
  password_change_required: "首次登录需要先修改初始密码。",
  password_mismatch: "原密码不正确，请重新输入。",
  invalid_password: "密码不符合要求：长度 6-72 位，不能包含首尾空格。",
  invalid_credentials: "账号信息不符合要求：用户名为 3-32 位字母/数字/._-，密码 6-72 位。",
  username_exists: "该登录用户名已存在，请更换。",
  last_admin: "系统必须保留至少一名启用状态的管理员。",
  bootstrap_locked: "初始化功能仅站点所有者可用。",
  already_bootstrapped: "管理员账号已初始化，请直接登录。",
  file_type_not_allowed: "附件仅支持：图片（jpg/png/gif/webp）、PDF、Word、Excel。",
  file_too_large: "单个附件不能超过 5MB。",
  invalid_file_name: "文件名不符合要求。",
  upload_validation_failed: "上传校验未通过，文件未保存，请重新上传。",
  storage_unavailable: "文件存储服务暂不可用，请稍后重试。",
  name_mismatch: "该学号已登记，但姓名与档案不一致，请核对后重试。",
  invalid_student_no: "该学号格式无法用于注册，请联系管理员。",
  registration_closed: "学生注册通道当前未开放，请联系辅导员确认开放时间。",
  profile_missing: "尚未绑定学籍信息，请联系管理员处理。",
  leave_exceeds_max_days: "请假天数超过辅导员设定的单次上限。",
  leave_requires_advance: "未按规则提前提交请假申请。",
  leave_requires_material: "按请假规则该申请需要上传材料，请先让学生上传后再通过。",
  leave_date_overlap: "该时间段已存在请假申请，无法重复提交。",
  leave_too_many_pending: "待审批的请假申请过多，请等待处理后再提交。",
  invalid_date_range: "请假日期范围不正确，请检查起止日期。",
};

async function requestJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const token = getToken();
  if (token) headers.set("x-app-token", token);
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(MESSAGES.network_error!, "network_error");
  }
  if ((response.status === 401 || response.status === 403) && !response.headers.get("content-type")?.includes("application/json")) {
    // 平台网关层面的拦截（非本系统 JSON 应答）
    throw new ApiError(
      response.status === 401 ? MESSAGES.login_required! : MESSAGES.access_denied!,
      response.status === 401 ? "login_required" : "access_denied",
      response.status
    );
  }
  if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError(MESSAGES.invalid_response!, "invalid_response", response.status);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(MESSAGES.invalid_response!, "invalid_response", response.status);
  }
  const body = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const errorCode = typeof body?.error === "string" ? body.error : null;
  const code =
    errorCode ??
    ((!response.ok || body?.ok === false) && typeof body?.code === "string" ? body.code : null) ??
    (response.ok ? null : "request_failed");
  if (!response.ok || body?.ok === false || code) {
    const resolved = code ?? "request_failed";
    if (resolved === "login_required") {
      // 会话失效：通知外壳退回登录页
      window.dispatchEvent(new Event("app:unauthorized"));
    }
    const detail = MESSAGES[resolved];
    const message = resolved.startsWith("invalid_")
      ? `请检查填写内容${detail ? "：" + detail : "。"}`
      : detail ?? MESSAGES.request_failed!;
    throw new ApiError(message, resolved, response.status);
  }
  return data;
}

export async function apiGet<T>(action: string, signal?: AbortSignal): Promise<T[]> {
  const data = await requestJson(`/functions/v1/app?action=${encodeURIComponent(action)}`, { signal });
  if (!data || typeof data !== "object" || !Array.isArray((data as { data?: unknown }).data)) {
    throw new ApiError(MESSAGES.invalid_response!, "invalid_response");
  }
  return (data as { data: T[] }).data;
}

// 返回对象型应答（如 auth_status）：不走数组校验。
export async function apiGetRaw(action: string): Promise<Record<string, unknown>> {
  const data = await requestJson(`/functions/v1/app?action=${encodeURIComponent(action)}`);
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

export async function apiPost(
  action: string,
  payload: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const data = await requestJson("/functions/v1/app", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}
