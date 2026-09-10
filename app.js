const APP_VERSION = "2.7.0";
const APP_BUILD = "20260908-calendar-controls";
const STORAGE_KEY = "fangcun-data-v1";
const THEME_KEY = "fangcun-theme";
const SYNC_META_KEY = "fangcun-sync-v1";
const PRE_CLOUD_BACKUP_KEY = "fangcun-pre-cloud-backup";
const CALENDAR_SUBSCRIPTION_URL_KEY = "fangcun-calendar-subscription-url";
const TEST_REMINDER_KEY = "fangcun-test-reminder";
const COURSE_PALETTE = ["#4F6BED", "#0FA77A", "#F59E0B", "#EF5B5B", "#8B5CF6", "#0891B2", "#F97316", "#EC4899"];
const LEGACY_COURSE_COLORS = { "#52778e": "#4F6BED", "#4d7661": "#0FA77A", "#b67a34": "#F59E0B", "#ad646e": "#EF5B5B", "#756493": "#8B5CF6", "#3f8587": "#0891B2", "#9a6b4f": "#F97316", "#61728f": "#EC4899" };

function vividCourseColor(color, index = 0) {
  const normalized = String(color || "").toLowerCase();
  return LEGACY_COURSE_COLORS[normalized] || color || COURSE_PALETTE[index % COURSE_PALETTE.length];
}

const COURSE_COLOR_FAMILIES = [
  { id: "science", hue: 210, pattern: /物理|化学|生物|科学|实验|phy|chem|bio|sci/i },
  { id: "quantitative", hue: 266, pattern: /数学|微积分|代数|统计|计算机|程序|算法|数据|人工智能|机器学习|math|cst|cs\d|stat|ai/i },
  { id: "humanities", hue: 18, pattern: /思想|政治|哲学|法治|历史|社会|文化|形势与政策|pol|hum|soc/i },
  { id: "language", hue: 166, pattern: /英语|写作|语言|文学|翻译|eng/i },
  { id: "sports", hue: 128, pattern: /体育|运动|健身|体能|游泳|球|pe\d/i },
  { id: "business", hue: 42, pattern: /经济|管理|金融|会计|商业|econ|fin|bus/i },
  { id: "arts", hue: 328, pattern: /艺术|设计|音乐|美术|戏剧|舞蹈|art/i },
];

function canonicalCourseIdentity(course = {}) {
  const normalize = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[\s·•,，。:：()（）\-_]/g, "");
  return normalize(course.name) || normalize(String(course.code || "").replace(/[_-]\d+$/, "")) || "course-" + (course.id || "unknown");
}

function courseColorFamily(course = {}) {
  const source = (course.name || "") + " " + (course.code || "");
  return COURSE_COLOR_FAMILIES.find((family) => family.pattern.test(source)) || { id: "general", hue: 196 };
}

function stableTextHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hslToHex(hue, saturation, lightness) {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = l - chroma / 2;
  const channels = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return "#" + channels.map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function intelligentCourseColor(course, usedColors = new Set()) {
  const identity = canonicalCourseIdentity(course);
  const family = courseColorFamily(course);
  const hash = stableTextHash(identity);
  for (let attempt = 0; attempt < 41; attempt += 1) {
    const offset = ((hash + attempt * 11) % 31) - 15;
    const hue = (family.hue + offset + 360) % 360;
    const color = hslToHex(hue, 68 + (hash % 7), 43 + ((hash >>> 5) % 5));
    if (!usedColors.has(color.toLowerCase())) return color;
  }
  return COURSE_PALETTE[hash % COURSE_PALETTE.length];
}

function applyCourseColorSystem(courses = []) {
  const groups = new Map();
  courses.forEach((course) => {
    const identity = canonicalCourseIdentity(course);
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(course);
  });
  const usedColors = new Set();
  groups.forEach((group) => {
    const manuallyColored = group.find((course) => course.colorAuto === false && course.color);
    const color = manuallyColored ? vividCourseColor(manuallyColored.color) : intelligentCourseColor(group[0], usedColors);
    group.forEach((course) => {
      course.color = color;
      course.colorAuto = !manuallyColored;
      course.colorFamily = courseColorFamily(course).id;
    });
    usedColors.add(color.toLowerCase());
  });
  return courses;
}
const LAST_USER_KEY = "fangcun-last-user";
let currentUser = null;
let authMode = "login";
let mobileQuadrant = "q1";
let matrixScrollFrame = 0;
let installPrompt = null;
let waitingServiceWorker = null;
let focusRotation = 0;
let pendingScheduleImport = null;

function accountKey(base) {
  return currentUser?.id ? `${base}:user-${currentUser.id}` : base;
}

const quadrantInfo = {
  q1: { name: "重要且紧急", color: "var(--q1)", action: "立即做" },
  q2: { name: "重要不紧急", color: "var(--q2)", action: "计划做" },
  q3: { name: "紧急不重要", color: "var(--q3)", action: "尽快处理" },
  q4: { name: "不紧急不重要", color: "var(--q4)", action: "稍后再说" },
};

const viewInfo = {
  matrix: "优先级",
  inbox: "待确认",
  today: "今天",
  schedule: "日历",
  projects: "长期项目",
  admin: "管理后台",
};

const projectColors = {
  sage: "#4d7661",
  blue: "#52778e",
  amber: "#b67a34",
  rose: "#ad646e",
};

const taskTypeLabels = { task: "任务", event: "日程", assignment: "作业", exam: "考试", review: "复习" };
const repeatLabels = { daily: "每天", weekdays: "工作日", weekly: "每周", monthly: "每月" };

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function mediaMatches(query, fallback = false) {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : fallback;
}

function mobileAppLayout() {
  return mediaMatches("(max-width: 720px), (max-width: 960px) and (orientation: landscape) and (pointer: coarse)", window.innerWidth <= 720);
}

function openPrimaryCreate() {
  if (!mobileAppLayout()) return openTaskModal();
  $("#mobileCreateModal").showModal();
  setTimeout(() => $("#mobileCaptureInput").focus(), 80);
}

function submitMobileCreate(event) {
  event.preventDefault();
  const source = $("#mobileCaptureInput").value.trim();
  if (!source) return $("#mobileCaptureInput").focus();
  $("#quickInput").value = source;
  $("#mobileCreateModal").close();
  submitQuickTask({ preventDefault() {} });
}

function openDetailedMobileCreate(kind) {
  $("#mobileCreateModal").close();
  if (kind === "course") openCourseModal();
  else if (kind === "project") openProjectModal();
  else openTaskModal();
}

async function installMobileApp() {
  if (!installPrompt) return showToast("请使用浏览器菜单中的“添加到主屏幕”");
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("#installAppBtn").classList.add("hidden");
}

function localISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function offsetDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localISO(date);
}

function mondayOf(date = new Date()) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function dateFromISO(value) {
  if (!value) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function defaultSemester() {
  const start = mondayOf();
  return { name: `${start.getFullYear()} 学期`, startDate: localISO(start), totalWeeks: 20, showWeekend: true };
}

function defaultTimeSlots() {
  return [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "09:50", endTime: "10:35" },
    { number: 4, startTime: "10:40", endTime: "11:25" },
    { number: 5, startTime: "11:30", endTime: "12:15" },
    { number: 6, startTime: "13:30", endTime: "14:15" },
    { number: 7, startTime: "14:20", endTime: "15:05" },
    { number: 8, startTime: "15:10", endTime: "15:55" },
    { number: 9, startTime: "16:10", endTime: "16:55" },
    { number: 10, startTime: "17:00", endTime: "17:45" },
    { number: 11, startTime: "18:30", endTime: "19:15" },
    { number: 12, startTime: "19:20", endTime: "20:05" },
    { number: 13, startTime: "20:10", endTime: "20:55" },
  ];
}

function isV22DefaultTimeSlots(timeSlots) {
  const previous = [
    ["08:00", "08:45"], ["08:50", "09:35"], ["10:05", "10:50"], ["10:55", "11:40"], ["11:45", "12:30"],
    ["14:00", "14:45"], ["14:50", "15:35"], ["15:40", "16:25"], ["16:30", "17:15"], ["17:20", "18:05"],
    ["19:00", "19:45"], ["19:50", "20:35"], ["20:40", "21:25"],
  ];
  return Array.isArray(timeSlots) && timeSlots.length === previous.length
    && previous.every(([start, end], index) => timeSlots[index]?.startTime === start && timeSlots[index]?.endTime === end);
}

function isLegacyTimeSlots(timeSlots) {
  const legacy = [
    ["08:00", "09:35"], ["10:05", "11:40"], ["14:00", "15:35"],
    ["16:05", "17:40"], ["19:00", "20:35"], ["20:45", "22:20"],
  ];
  return Array.isArray(timeSlots) && timeSlots.length === legacy.length
    && legacy.every(([start, end], index) => timeSlots[index]?.startTime === start && timeSlots[index]?.endTime === end);
}

function migrateLegacySchedule(saved) {
  if (!isLegacyTimeSlots(saved.timeSlots)) return false;
  const startMap = { 1: 1, 2: 3, 3: 6, 4: 8, 5: 11, 6: 13 };
  const endMap = { 1: 2, 2: 4, 3: 7, 4: 10, 5: 12, 6: 13 };
  (saved.courses || []).forEach((course) => {
    course.startSection = startMap[Number(course.startSection)] || course.startSection;
    course.endSection = endMap[Number(course.endSection)] || course.endSection;
  });
  saved.timeSlots = defaultTimeSlots();
  saved.schemaVersion = 3;
  return true;
}

function seedData() {
  const healthId = uid();
  const readingId = uid();
  const semester = defaultSemester();
  const courseId = uid();
  return {
    projects: [
      { id: healthId, name: "恢复规律运动", goal: "建立每周三次、能够长期坚持的运动习惯", due: offsetDate(60), color: "sage", createdAt: Date.now() },
      { id: readingId, name: "年度阅读计划", goal: "完成主题阅读，并为每本书留下一页笔记", due: offsetDate(120), color: "blue", createdAt: Date.now() },
    ],
    tasks: [
      { id: uid(), title: "回复今天到期的重要邮件", notes: "", due: localISO(), projectId: "", important: true, urgent: true, quadrant: "q1", today: true, completed: false, createdAt: Date.now() - 5000 },
      { id: uid(), title: "安排本周三次运动时间", notes: "先从每次 30 分钟开始。", due: offsetDate(2), projectId: healthId, important: true, urgent: false, quadrant: "q2", today: false, completed: false, createdAt: Date.now() - 4000 },
      { id: uid(), title: "阅读下一章并整理笔记", notes: "", due: offsetDate(5), projectId: readingId, courseId: "", type: "task", important: true, urgent: false, quadrant: "q2", today: true, completed: false, createdAt: Date.now() - 3000 },
      { id: uid(), title: "确认快递配送时间", notes: "", due: localISO(), projectId: "", important: false, urgent: true, quadrant: "q3", today: false, completed: false, createdAt: Date.now() - 2000 },
      { id: uid(), title: "整理稍后想看的视频", notes: "", due: "", projectId: "", important: false, urgent: false, quadrant: "q4", today: false, completed: false, createdAt: Date.now() - 1000 },
      { id: uid(), title: "记录周末突然想到的旅行计划", notes: "先收集，不急着决定。", due: "", projectId: "", important: null, urgent: null, quadrant: null, today: false, completed: false, createdAt: Date.now() },
    ],
    semester,
    timeSlots: defaultTimeSlots(),
    courses: [
      { id: courseId, name: "示例课程 · 研究方法", teacher: "张老师", location: "教学楼 A201", day: 2, startSection: 2, endSection: 2, color: COURSE_PALETTE[0], weeks: Array.from({ length: 16 }, (_, index) => index + 1), reminderMinutes: 10, notes: "点击课程可以编辑，或为它创建作业。", createdAt: Date.now() },
    ],
    courseExceptions: [],
    calendarRules: [],
    settings: { notificationsEnabled: false },
  };
}

function normalizeData(saved) {
  if (!saved || !Array.isArray(saved.tasks) || !Array.isArray(saved.projects)) return null;
  saved.semester ||= defaultSemester();
  migrateLegacySchedule(saved);
  if (isV22DefaultTimeSlots(saved.timeSlots)) {
    saved.timeSlots = defaultTimeSlots();
    saved.schemaVersion = 4;
  }
  saved.timeSlots = Array.isArray(saved.timeSlots) && saved.timeSlots.length ? saved.timeSlots : defaultTimeSlots();
  saved.courses = Array.isArray(saved.courses) ? saved.courses : [];
  saved.courseExceptions = Array.isArray(saved.courseExceptions) ? saved.courseExceptions : [];
  saved.calendarRules = Array.isArray(saved.calendarRules) ? saved.calendarRules : [];
  saved.settings ||= { notificationsEnabled: false };
  saved.tasks.forEach((task) => {
    task.courseId ||= "";
    task.projectId ||= "";
    task.type ||= "task";
    task.repeat ||= "none";
    task.dueTime ||= "";
    task.startDate ||= "";
    task.startTime ||= "";
    task.endDate ||= "";
    task.endTime ||= "";
    task.location ||= "";
    if (task.reminderMinutes === undefined) task.reminderMinutes = -1;
    task.alarmMode = Boolean(task.alarmMode);
    task.estimateMinutes = Number(task.estimateMinutes) > 0 ? Number(task.estimateMinutes) : 0;
    task.focusPinned = Boolean(task.focusPinned);
    task.focusDismissedDate ||= "";
    task.source ||= "manual";
    task.confirmationIssues = Array.isArray(task.confirmationIssues) ? task.confirmationIssues : [];
  });
  saved.projects.forEach((project) => {
    project.nextActionTaskId ||= "";
    project.startDate ||= localISO(new Date(project.createdAt || Date.now()));
    project.milestones = Array.isArray(project.milestones) ? project.milestones : [];
  });
  saved.courses.forEach((course) => { course.code ||= ""; course.campus ||= ""; course.link ||= ""; course.credits ||= ""; course.alarmMode = Boolean(course.alarmMode); });
  applyCourseColorSystem(saved.courses);
  return saved;
}

function loadData() {
  try {
    let raw = localStorage.getItem(accountKey(STORAGE_KEY));
    if (!raw && currentUser?.id === 1) raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw);
    const migratedSchedule = isLegacyTimeSlots(parsed?.timeSlots) || isV22DefaultTimeSlots(parsed?.timeSlots);
    const saved = normalizeData(parsed);
    if (saved) {
      localStorage.setItem(accountKey(STORAGE_KEY), JSON.stringify(saved));
      if (migratedSchedule) updateSyncMeta({ dirty: true });
      return saved;
    }
  } catch (error) {
    console.warn("无法读取本地数据", error);
  }
  const initial = normalizeData(seedData());
  localStorage.setItem(accountKey(STORAGE_KEY), JSON.stringify(initial));
  return initial;
}

let data = loadData();
let activeView = "today";
let taskDecision = { important: null, urgent: null };
let quickDecision = { important: false, urgent: false, touched: false };
let displayedWeek = 1;
let displayedDay = localISO();
let displayedMonth = new Date().getMonth();
let displayedYear = new Date().getFullYear();
let scheduleMode = "week";
let semesterDraftSlots = [];
let smartDrafts = [];
let toastTimer;
let syncTimer;
let syncState = {
  available: false,
  configured: false,
  authenticated: false,
  syncing: false,
  conflict: false,
  applyingRemote: false,
  revision: 0,
  updatedAt: null,
  registrationOpen: false,
  user: null,
  serverVersion: "",
};

function saveData() {
  applyCourseColorSystem(data.courses);
  if (!syncState.applyingRemote) data.settings.lastLocalChangeAt = new Date().toISOString();
  localStorage.setItem(accountKey(STORAGE_KEY), JSON.stringify(data));
  if (!syncState.applyingRemote) {
    updateSyncMeta({ dirty: true });
    scheduleCloudSync();
  }
  renderAll();
  syncNativeReminders();
  scheduleNativeCalendarSync();
}

function syncMeta() {
  try {
    return { revision: 0, dirty: false, connectedBefore: false, ...JSON.parse(localStorage.getItem(accountKey(SYNC_META_KEY)) || "{}") };
  } catch {
    return { revision: 0, dirty: false, connectedBefore: false };
  }
}

function updateSyncMeta(changes) {
  const next = { ...syncMeta(), ...changes };
  localStorage.setItem(accountKey(SYNC_META_KEY), JSON.stringify(next));
  return next;
}

function isLikelyUntouchedSeed() {
  return data.courses.length === 1
    && data.courses[0].name.startsWith("示例课程")
    && data.projects.length === 2
    && data.tasks.length === 6;
}

function setCloudIndicator(mode, label) {
  const dot = $("#cloudDot");
  const text = $("#cloudLabel");
  if (!dot || !text) return;
  dot.className = `sync-dot${mode ? ` ${mode}` : ""}`;
  text.textContent = label;
}

function formatSyncTime(value) {
  if (!value) return "尚未同步";
  try {
    return `最近同步 ${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value))}`;
  } catch {
    return "最近已同步";
  }
}

function renderCloudPanel() {
  const cloudPassword = $("#cloudPassword");
  cloudPassword.minLength = syncState.configured ? 1 : 8;
  cloudPassword.placeholder = syncState.configured ? "输入你的密码" : "至少 8 个字符";
  if (!$("#cloudSummary")) return;
  const fields = $("#cloudAuthFields");
  const signedIn = $("#cloudSignedIn");
  const submit = $("#cloudAuthSubmit");
  if (!syncState.available) {
    $("#cloudSummary").textContent = "当前是本地模式。通过方寸服务器打开页面后，可以启用多端同步。";
    fields.classList.add("hidden");
    signedIn.classList.add("hidden");
    submit.classList.add("hidden");
    $("#cloudRegisterBtn").classList.add("hidden");
    return;
  }
  if (!syncState.authenticated) {
    $("#cloudSummary").textContent = syncState.configured ? "请先登录自己的账号，再同步这台设备。" : "首次使用：创建管理员账号并保存本机数据。";
    $("#cloudPasswordLabel").textContent = syncState.configured ? "密码" : "设置密码";
    $("#cloudAuthHint").textContent = syncState.configured ? "每个账号的数据完全独立。" : "密码至少 8 个字符；首个账号自动成为管理员。";
    submit.textContent = syncState.configured ? "登录并同步" : "初始化管理员";
    fields.classList.remove("hidden");
    signedIn.classList.add("hidden");
    submit.classList.remove("hidden");
    $("#cloudRegisterBtn").classList.remove("hidden");
    return;
  }
  fields.classList.add("hidden");
  signedIn.classList.remove("hidden");
  submit.classList.add("hidden");
  $("#cloudRegisterBtn").classList.add("hidden");
  $("#cloudSummary").textContent = syncState.conflict ? "本机和云端都发生过修改，请选择保留哪一份。操作前本机数据会自动留一份恢复副本。" : `${syncState.user?.displayName || syncState.user?.username || "当前账号"} 已登录，数据只会同步到这个账号。`;
  $("#cloudDetail").textContent = syncState.conflict
    ? "检测到版本冲突，自动同步已暂停。"
    : `${formatSyncTime(syncState.updatedAt)} · 数据版本 ${syncState.revision} · 方寸 ${syncState.serverVersion || APP_VERSION}`;
  $("#appVersionInfo").textContent = `方寸 v${APP_VERSION} · ${APP_BUILD}${syncState.serverVersion && syncState.serverVersion !== APP_VERSION ? ` · 服务端 v${syncState.serverVersion}` : ""}`;
  $("#deleteAccountSection").classList.toggle("hidden", syncState.user?.role !== "user");
  $("#restoreLocalBtn").disabled = !localStorage.getItem(accountKey(PRE_CLOUD_BACKUP_KEY));
  const busy = syncState.syncing || syncState.reconciling || syncState.pulling || syncState.integrationSyncing;
  if (syncState.conflict) $(".sync-recovery").open = true;
  $("#pullCloudBtn").disabled = Boolean(busy);
  $("#pushCloudBtn").disabled = Boolean(busy);
}

async function apiRequest(pathname, options = {}) {
  const { timeoutMs = 20000, ...requestOptions } = options;
  options = requestOptions;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(pathname, {
      credentials: "same-origin",
      headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers,
      ...options,
      signal: options.signal || controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `请求失败 (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("连接超时，本机内容已保留，请检查网络后重试");
    throw error;
  } finally { clearTimeout(timeout); }
}

function scheduleCloudSync() {
  if (!syncState.authenticated || syncState.conflict || syncState.applyingRemote || syncState.pulling || syncState.integrationSyncing || syncMeta().needsChoice) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    if (syncState.reconciling) { scheduleCloudSync(); return; }
    syncToCloud();
  }, 900);
}

async function syncToCloud(force = false) {
  if (!syncState.authenticated || syncState.syncing || syncState.pulling || syncState.integrationSyncing || ((syncState.conflict || syncMeta().needsChoice) && !force)) return false;
  const syncingAccount = currentUser?.id;
  syncState.syncing = true;
  setCloudIndicator("syncing", "同步中…");
  renderCloudPanel();
  try {
    const meta = syncMeta();
    const uploadedDocument = JSON.stringify(data);
    const result = await apiRequest(`/api/data${force ? "?force=1" : ""}`, {
      method: "PUT",
      body: JSON.stringify({ data: JSON.parse(uploadedDocument), baseRevision: meta.revision }),
    });
    if (!syncState.authenticated || currentUser?.id !== syncingAccount) return false;
    syncState.revision = result.revision;
    syncState.updatedAt = result.updatedAt;
    syncState.conflict = false;
    const changedDuringUpload = JSON.stringify(data) !== uploadedDocument;
    updateSyncMeta({ revision: result.revision, dirty: changedDuringUpload, needsChoice: false, connectedBefore: true, updatedAt: result.updatedAt });
    if (changedDuringUpload) scheduleCloudSync();
    setCloudIndicator(changedDuringUpload ? "syncing" : "online", changedDuringUpload ? "有新修改，继续同步…" : "已同步");
    renderCloudPanel();
    return true;
  } catch (error) {
    if (currentUser?.id !== syncingAccount) return false;
    syncState.lastError = error.message;
    if (error.status === 409) {
      syncState.conflict = true;
      syncState.revision = error.payload?.revision || syncState.revision;
      setCloudIndicator("error", "需要处理冲突");
      showToast("云端有较新的修改，请在“云端同步”中选择保留版本");
    } else if (error.status === 401) {
      syncState.authenticated = false;
      setCloudIndicator("", "需要登录");
      showAuthGate();
    } else {
      setCloudIndicator("error", "离线，等待同步");
    }
    renderCloudPanel();
    return false;
  } finally {
    syncState.syncing = false;
    renderCloudPanel();
  }
}

async function fetchCloudState() {
  return apiRequest("/api/data");
}

function applyCloudData(remote) {
  const migratedSchedule = isLegacyTimeSlots(remote.data?.timeSlots);
  const normalized = normalizeData(remote.data);
  if (!normalized) throw new Error("云端数据结构不正确");
  localStorage.setItem(accountKey(PRE_CLOUD_BACKUP_KEY), JSON.stringify({ data, savedAt: new Date().toISOString() }));
  syncState.applyingRemote = true;
  data = normalized;
  localStorage.setItem(accountKey(STORAGE_KEY), JSON.stringify(data));
  syncState.applyingRemote = false;
  syncState.revision = remote.revision;
  syncState.updatedAt = remote.updatedAt;
  syncState.conflict = false;
  updateSyncMeta({ revision: remote.revision, dirty: migratedSchedule, needsChoice: false, connectedBefore: true, updatedAt: remote.updatedAt });
  renderAll();
  syncNativeReminders();
  scheduleNativeCalendarSync();
  setCloudIndicator("online", "已同步");
  renderCloudPanel();
  if (migratedSchedule) scheduleCloudSync();
}

async function reconcileCloud() {
  if (syncMeta().needsChoice) {
    syncState.conflict = true;
    setCloudIndicator("error", "恢复备份后请选择版本");
    renderCloudPanel();
    return false;
  }
  if (syncState.reconciling || syncState.syncing || syncState.pulling || syncState.integrationSyncing || syncState.conflict) return false;
  const reconcilingAccount = currentUser?.id;
  syncState.reconciling = true;
  clearTimeout(syncTimer);
  try {
    const documentBeforeFetch = JSON.stringify(data);
    const remote = await fetchCloudState();
    if (!syncState.authenticated || currentUser?.id !== reconcilingAccount) return false;
    const meta = syncMeta();
    syncState.revision = remote.revision;
    syncState.updatedAt = remote.updatedAt;
    if (JSON.stringify(data) !== documentBeforeFetch && remote.revision !== meta.revision) {
      syncState.conflict = true;
      setCloudIndicator("error", "两端均有修改");
      renderCloudPanel();
      return;
    }
    if (!remote.data) {
      updateSyncMeta({ revision: 0, connectedBefore: true });
      await syncToCloud();
      return;
    }
    if (meta.connectedBefore && meta.revision === remote.revision) {
      if (meta.dirty) await syncToCloud();
      else {
        setCloudIndicator("online", "已同步");
        renderCloudPanel();
      }
      return;
    }
    if (meta.connectedBefore && !meta.dirty) {
      applyCloudData(remote);
      return;
    }
    if (!meta.connectedBefore && isLikelyUntouchedSeed()) {
      applyCloudData(remote);
      showToast("已载入你的云端数据");
      return;
    }
    syncState.conflict = true;
    setCloudIndicator("error", "选择同步版本");
    renderCloudPanel();
  } catch (error) {
    setCloudIndicator("error", "离线，使用本机");
    renderCloudPanel();
    syncState.lastError = error.message;
  } finally { syncState.reconciling = false; renderCloudPanel(); }
}

async function syncNow() {
  if (syncState.syncing || syncState.reconciling || syncState.pulling || syncState.integrationSyncing) return showToast("正在同步，请稍候");
  if (!syncState.authenticated) return showToast("请先登录后同步");
  const button = $("#syncNowBtn");
  button.disabled = true;
  button.textContent = "正在同步…";
  syncState.lastError = "";
  try {
    await reconcileCloud();
    showToast(syncState.lastError || (syncState.conflict ? "两端都有修改，请展开“版本冲突与恢复”选择保留的数据" : syncMeta().dirty ? "本机仍有待上传内容，将继续重试" : "已同步到最新数据"));
  } finally { button.disabled = false; button.textContent = "立即同步"; }
}

function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#mobileMenu").setAttribute("aria-expanded", "false");
}

function selectDataHubTab(tab) {
  if (!["account", "calendar", "files"].includes(tab)) tab = "account";
  $$("[data-sync-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.syncPanel !== tab));
  $$("[data-sync-tab]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.syncTab === tab));
    button.classList.toggle("active", button.dataset.syncTab === tab);
  });
  $("#cloudModal").scrollTop = 0;
  if (tab === "account") renderCloudPanel();
  if (tab === "calendar") {
    loadCalendarSubscription(); loadOutlookStatus(); loadGoogleStatus(); updateSystemCalendarStatus();
  }
  if (tab === "files") $("#undoScheduleImportBtn").classList.toggle("hidden", !data.settings.lastScheduleImportUndo);
}

function openDataHub(tab = "account") {
  closeSidebar();
  selectDataHubTab(tab);
  if (!$("#cloudModal").open) $("#cloudModal").showModal();
}

function switchAccount(user) {
  const previousId = currentUser?.id;
  currentUser = user;
  syncState.user = user;
  if (!user) return;
  if (user.id === 1) {
    if (!localStorage.getItem(accountKey(STORAGE_KEY)) && localStorage.getItem(STORAGE_KEY)) localStorage.setItem(accountKey(STORAGE_KEY), localStorage.getItem(STORAGE_KEY));
    if (!localStorage.getItem(accountKey(SYNC_META_KEY)) && localStorage.getItem(SYNC_META_KEY)) localStorage.setItem(accountKey(SYNC_META_KEY), localStorage.getItem(SYNC_META_KEY));
  }
  localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
  if (previousId !== user.id) {
    if (user.role !== "admin") {
      data = loadData();
      displayedWeek = currentSemesterWeek();
      renderAll();
      syncNativeReminders();
    }
  }
  applyRoleUI();
}

function applyRoleUI() {
  const admin = syncState.user?.role === "admin";
  document.body.classList.toggle("admin-mode", admin);
  $("#adminNavItem").classList.toggle("hidden", !admin);
  $("#mobileAdminNav").classList.toggle("hidden", !admin);
  if (admin) {
    switchView("admin");
    setCloudIndicator("online", "管理员");
    loadAdminPanel();
  } else if (activeView === "admin") switchView("today");
}

function setAuthMode(mode) {
  authMode = mode;
  $$("[data-auth-mode]").forEach((button) => button.classList.toggle("active", button.dataset.authMode === mode));
  const registering = mode === "register";
  const setup = mode === "setup";
  const registrationClosed = registering && !syncState.registrationOpen;
  $("#authDisplayNameField").classList.toggle("hidden", !registering && !setup);
  $("#authGateTitle").textContent = setup ? "建立管理员账号" : registering ? "注册方寸" : "登录方寸";
  $("#authGateSubmit").textContent = setup ? "建立并进入" : registrationClosed ? "管理员暂未开放注册" : registering ? "注册并进入" : "登录";
  $("#authGateSubmit").disabled = registrationClosed;
  const passwordInput = $("#authPassword");
  passwordInput.autocomplete = registering || setup ? "new-password" : "current-password";
  passwordInput.minLength = registering || setup ? 8 : 1;
  passwordInput.placeholder = registering || setup ? "至少 8 个字符" : "输入你的密码";
  $("#authGateHint").textContent = setup ? "首个账号会成为管理员；公开注册默认关闭。" : registrationClosed ? "服务器当前关闭了新账号注册，请联系管理员开放。" : registering ? "注册后会获得一套独立的任务、项目和课表。已有账号会明确提示用户名已存在。" : "请输入你的用户名和密码；如果不确定账号是否存在，可以切换到“注册”验证。";
}

function showAuthGate() {
  const registerTab = $("[data-auth-mode='register']");
  registerTab.classList.remove("hidden");
  registerTab.dataset.closed = String(!syncState.registrationOpen);
  $("#authTabs").classList.toggle("hidden", !syncState.configured);
  setAuthMode(syncState.configured ? "login" : "setup");
  $("#authGate").classList.remove("hidden");
  setTimeout(() => $("#authUsername").focus(), 30);
}

function hideAuthGate() { $("#authGate").classList.add("hidden"); }

async function submitAuthGate(event) {
  event.preventDefault();
  const username = $("#authUsername").value.trim();
  const password = $("#authPassword").value;
  const displayName = $("#authDisplayName").value.trim();
  if (username.length < 3) return showToast("用户名至少需要 3 个字符");
  if ((authMode === "register" || authMode === "setup") && password.length < 8) return showToast("密码至少需要 8 个字符");
  if (!password) return showToast("请输入密码");
  const button = $("#authGateSubmit");
  button.disabled = true;
  try {
    const endpoint = authMode === "register" ? "/api/auth/register" : authMode === "setup" ? "/api/auth/setup" : "/api/auth/login";
    const result = await apiRequest(endpoint, { method: "POST", body: JSON.stringify({ username, password, displayName }) });
    syncState.configured = true;
    syncState.authenticated = true;
    switchAccount(result.user);
    $("#authPassword").value = "";
    hideAuthGate();
    if (result.user.role === "admin") setCloudIndicator("online", "管理员");
    else { setCloudIndicator("syncing", "连接中…"); await reconcileCloud(); }
    showToast(authMode === "register" ? "注册成功，已进入你的独立空间" : "登录成功");
  } catch (error) {
    if (authMode === "login" && error.status === 401) $("#authGateHint").textContent = "登录失败：账号不存在、密码不正确或已被停用。可以切换到“注册”检查用户名是否已经存在，或请管理员重置密码。";
    showToast(error.message);
  }
  finally { button.disabled = false; }
}

async function initializeCloud() {
  if (typeof fetch !== "function" || typeof location === "undefined" || !location.protocol.startsWith("http")) {
    setCloudIndicator("", "仅本机");
    renderCloudPanel();
    hideAuthGate();
    return;
  }
  try {
    const session = await apiRequest("/api/auth/session");
    syncState.available = true;
    syncState.configured = session.configured;
    syncState.authenticated = session.authenticated;
    syncState.registrationOpen = Boolean(session.registrationOpen);
    syncState.serverVersion = session.version || "";
    $("#authServerStatus").className = "auth-server-status online";
    $("#authServerStatus span").textContent = `服务器在线 · 方寸 ${session.version || APP_VERSION} · ${session.registrationOpen ? "可注册新账号" : "注册暂时关闭"}`;
    if (session.authenticated) {
      switchAccount(session.user);
      hideAuthGate();
      if (session.user.role === "admin") setCloudIndicator("online", "管理员");
      else { setCloudIndicator("syncing", "连接中…"); await reconcileCloud(); }
    } else setCloudIndicator("", session.configured ? "登录以同步" : "设置云同步");
  } catch {
    setCloudIndicator("error", "仅本机");
    $("#authServerStatus").className = "auth-server-status error";
    $("#authServerStatus span").textContent = "无法连接服务器，请检查网络后重试";
    showAuthGate();
  }
  renderCloudPanel();
  if (syncState.available && !syncState.authenticated) showAuthGate();
}

async function submitCloudAuth(event) {
  event.preventDefault();
  const password = $("#cloudPassword").value;
  const username = $("#cloudUsername").value.trim();
  if (username.length < 3) return showToast("请输入用户名");
  if (!syncState.configured && password.length < 8) return showToast("密码至少需要 8 个字符");
  if (!password) return showToast("请输入密码");
  const submit = $("#cloudAuthSubmit");
  submit.disabled = true;
  try {
    const result = await apiRequest(syncState.configured ? "/api/auth/login" : "/api/auth/setup", { method: "POST", body: JSON.stringify({ username, password }) });
    syncState.configured = true;
    syncState.authenticated = true;
    switchAccount(result.user);
    $("#cloudPassword").value = "";
    setCloudIndicator(result.user.role === "admin" ? "online" : "syncing", result.user.role === "admin" ? "管理员" : "连接中…");
    renderCloudPanel();
    if (result.user.role !== "admin") await reconcileCloud();
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
  }
}

async function pullCloudData() {
  if (syncState.syncing || syncState.reconciling || syncState.pulling || syncState.integrationSyncing) return showToast("正在同步，请完成后再选择版本");
  if (!confirm("用云端数据替换本机数据吗？当前本机数据会自动保留一份恢复副本。")) return;
  clearTimeout(syncTimer);
  syncState.pulling = true;
  const pullingAccount = currentUser?.id;
  renderCloudPanel();
  try {
    const localBeforePull = JSON.stringify(data);
    const remote = await fetchCloudState();
    if (!syncState.authenticated || currentUser?.id !== pullingAccount) return;
    if (!remote.data) return showToast("云端还没有数据");
    if (JSON.stringify(data) !== localBeforePull) return showToast("下载期间本机有新修改，未覆盖，请重新确认版本");
    applyCloudData(remote);
    showToast("已下载云端数据");
  } catch (error) {
    showToast(error.message);
  } finally { syncState.pulling = false; renderCloudPanel(); }
}

async function pushCloudData() {
  if (syncState.syncing || syncState.reconciling || syncState.pulling || syncState.integrationSyncing) return showToast("正在同步，请完成后再选择版本");
  if (!confirm("确定用这台设备的数据覆盖云端吗？服务器会保留最近版本快照。")) return;
  const ok = await syncToCloud(true);
  if (ok) showToast("本机数据已写入云端");
  else showToast(syncState.lastError || "未能上传，本机数据已保留");
}

function restorePreCloudData() {
  if (syncState.syncing || syncState.reconciling || syncState.pulling || syncState.integrationSyncing) return showToast("正在同步，请完成后再恢复副本");
  try {
    const backup = JSON.parse(localStorage.getItem(accountKey(PRE_CLOUD_BACKUP_KEY)) || "null");
    const restored = normalizeData(backup?.data);
    if (!restored) return showToast("没有可恢复的本机副本");
    if (!confirm("恢复被云端数据替换前的本机版本吗？恢复后需要再决定是否覆盖云端。")) return;
    syncState.conflict = true;
    updateSyncMeta({ needsChoice: true });
    data = restored;
    saveData();
    setCloudIndicator("error", "选择同步版本");
    renderCloudPanel();
    showToast("已恢复本机副本，请决定是否覆盖云端");
  } catch {
    showToast("本机恢复副本已损坏");
  }
}

async function logoutCloud() {
  clearTimeout(syncTimer);
  try { await apiRequest("/api/auth/logout", { method: "POST" }); } catch {}
  syncState.authenticated = false;
  syncState.conflict = false;
  syncState.user = null;
  currentUser = null;
  document.body.classList.remove("admin-mode");
  $("#adminNavItem").classList.add("hidden");
  $("#mobileAdminNav").classList.add("hidden");
  localStorage.removeItem(LAST_USER_KEY);
  setCloudIndicator("", "登录以同步");
  renderCloudPanel();
  if ($("#cloudModal").open) $("#cloudModal").close();
  showAuthGate();
}

async function changeCloudPassword() {
  const currentPassword = $("#currentCloudPassword").value;
  const newPassword = $("#newCloudPassword").value;
  if (!currentPassword) return showToast("请输入当前密码");
  if (newPassword.length < 8) return showToast("新密码至少需要 8 个字符");
  const button = $("#changeCloudPasswordBtn");
  button.disabled = true;
  try {
    await apiRequest("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
    $("#currentCloudPassword").value = "";
    $("#newCloudPassword").value = "";
    $(".password-change").removeAttribute("open");
    showToast("访问密码已修改，其他设备需要重新登录");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function loadAdminPanel() {
  if (syncState.user?.role !== "admin") return;
  try {
    const result = await apiRequest("/api/admin/users");
    syncState.registrationOpen = Boolean(result.registrationOpen);
    $("#registrationToggle").checked = syncState.registrationOpen;
    $("#adminUserCount").textContent = result.stats.ordinary;
    $("#adminStats").innerHTML = [
      [result.stats.total, "全部账号", "#4F6BED"], [result.stats.active, "正常使用", "#0FA77A"],
      [result.stats.ordinary, "普通用户", "#8B5CF6"], [result.stats.withData, "已有云端数据", "#F59E0B"],
    ].map(([value, label, color]) => `<article class="admin-stat" style="--stat-color:${color}"><strong>${value}</strong><span>${label}</span></article>`).join("");
    const migration = result.migration;
    const migrationCard = $("#migrateOwnerDataBtn").closest(".migration-card");
    migrationCard.classList.toggle("complete", migration.completed);
    migrationCard.classList.toggle("warning", migration.targetHasData && !migration.completed);
    $("#migrateOwnerDataBtn").disabled = migration.completed || !migration.sourceHasData;
    $("#migrateOwnerDataBtn").textContent = migration.completed ? "迁移已完成" : !migration.targetExists ? "等待 member 注册" : "迁移到 member";
    $("#ownerMigrationStatus").textContent = migration.completed ? `已于 ${formatAdminTime(migration.completedAt)} 完成；owner 的原数据已存入快照，member 需重新登录。` : !migration.sourceExists ? "未找到 owner 账号。" : !migration.sourceHasData ? "owner 当前没有可迁移的数据。" : !migration.targetExists ? "请先用普通用户身份注册用户名 member，随后回到这里迁移。" : migration.targetHasData ? "member 已有数据，迁移时会先备份再要求你确认覆盖。" : "目标账号 member 已就绪，可以安全迁移。";
    $("#adminUsers").innerHTML = result.users.map((user) => `<article class="admin-user"><div class="admin-user-main"><div class="admin-user-title"><strong>${escapeHTML(user.displayName)} · ${escapeHTML(user.username)}</strong><span class="admin-role">${user.role === "admin" ? "管理员" : "普通用户"}</span><span class="admin-status ${user.status}">${user.status === "active" ? "正常" : "已停用"}</span></div><span class="admin-user-metrics">${user.counts.tasks} 项任务 · ${user.counts.projects} 个项目 · ${user.counts.courses} 门课程 · ${user.updatedAt ? `同步 ${formatAdminTime(user.updatedAt)}` : "尚未同步"}</span></div><div class="admin-user-actions"><button type="button" data-view-user-id="${user.id}">查看</button>${user.role === "admin" ? "" : `<button type="button" data-reset-user-id="${user.id}" data-reset-username="${escapeHTML(user.username)}">重置密码</button><button type="button" data-user-status-id="${user.id}" data-next-status="${user.status === "active" ? "disabled" : "active"}">${user.status === "active" ? "停用" : "启用"}</button><button type="button" class="delete" data-delete-user-id="${user.id}" data-delete-username="${escapeHTML(user.username)}">删除</button>`}</div></article>`).join("");
  } catch (error) { showToast(error.message); }
}

function formatAdminTime(value) {
  if (!value) return "从未";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "未知" : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

async function viewAdminUser(userId) {
  try {
    const { user } = await apiRequest(`/api/admin/users/${userId}`);
    const content = user.content || { tasks: [], projects: [], courses: [] };
    const list = (items, empty, label) => items.length ? items.slice(0, 8).map((item) => `<div class="admin-content-item"><strong>${escapeHTML(item.title || item.name || "未命名")}</strong><span>${escapeHTML(item.due || item.targetDate || item.code || label)}</span></div>`).join("") : `<p>${empty}</p>`;
    $("#adminUserDetail").innerHTML = `<div class="admin-detail-header"><span class="eyebrow">用户详情</span><h3>${escapeHTML(user.displayName)} · ${escapeHTML(user.username)}</h3><p>${user.role === "admin" ? "管理员账号" : "普通用户"} · ${user.status === "active" ? "正常使用" : "已停用"}</p><div class="admin-detail-meta"><span>${user.counts.pendingTasks} 项待完成</span><span>版本 ${user.revision}</span><span>${user.snapshots} 份快照</span><span>${Math.ceil(user.dataBytes / 1024)} KB</span></div></div><section class="admin-detail-section"><h4>最近任务</h4><div class="admin-content-list">${list(content.tasks, "暂无任务", "任务")}</div></section><section class="admin-detail-section"><h4>长期项目</h4><div class="admin-content-list">${list(content.projects, "暂无项目", "项目")}</div></section><section class="admin-detail-section"><h4>课程</h4><div class="admin-content-list">${list(content.courses, "暂无课程", "课程")}</div></section><p style="margin-top:14px">最近登录：${formatAdminTime(user.lastLoginAt)}<br>最近同步：${formatAdminTime(user.updatedAt)}</p>`;
  } catch (error) { showToast(error.message); }
}

async function deleteAdminUser(button) {
  const username = button.dataset.deleteUsername;
  if (!confirm(`确定永久删除普通用户“${username}”吗？\n\n该账号的任务、项目、课表、会话和服务器快照都会删除，此操作无法撤销。`)) return;
  button.disabled = true;
  try {
    await apiRequest(`/api/admin/users/${button.dataset.deleteUserId}`, { method: "DELETE" });
    $("#adminUserDetail").innerHTML = `<div class="admin-empty"><strong>账号已删除</strong><p>选择其他普通用户查看详情。</p></div>`;
    await loadAdminPanel();
    showToast(`已删除账号 ${username}`);
  } catch (error) { showToast(error.message); button.disabled = false; }
}

async function resetAdminUserPassword(button) {
  if (!confirm(`为普通用户“${button.dataset.resetUsername}”生成一个新的临时密码吗？该用户当前所有设备会被退出。`)) return;
  button.disabled = true;
  try {
    const result = await apiRequest(`/api/admin/users/${button.dataset.resetUserId}/reset-password`, { method: "POST" });
    const message = `${result.username} 的临时密码：\n\n${result.temporaryPassword}\n\n请立即保存并交给用户，关闭后服务器不会再次显示。`;
    try { await navigator.clipboard.writeText(result.temporaryPassword); alert(`${message}\n\n临时密码已复制到剪贴板。`); }
    catch { alert(message); }
    showToast("密码已重置，临时密码仅显示这一次");
    await loadAdminPanel();
  } catch (error) { showToast(error.message); button.disabled = false; }
}

async function migrateOwnerToMember() {
  const button = $("#migrateOwnerDataBtn");
  button.disabled = true;
  const execute = async (force) => apiRequest("/api/admin/migrate-owner-data", { method: "POST", body: JSON.stringify({ force }) });
  try {
    await execute(false);
    showToast("owner 原数据已迁移到 member");
    await loadAdminPanel();
  } catch (error) {
    if (error.payload?.requiresConfirmation && confirm("member 已经有自己的数据。继续会先在服务器保留双方快照，再用 owner 原数据覆盖 member，并让 member 重新登录。确定继续吗？")) {
      try { await execute(true); showToast("迁移完成，member 需要重新登录"); await loadAdminPanel(); }
      catch (forceError) { showToast(forceError.message); button.disabled = false; }
    } else { showToast(error.message); button.disabled = false; }
  }
}

async function toggleRegistration() {
  const checkbox = $("#registrationToggle");
  checkbox.disabled = true;
  try {
    const result = await apiRequest("/api/admin/registration", { method: "PUT", body: JSON.stringify({ open: checkbox.checked }) });
    syncState.registrationOpen = result.registrationOpen;
    showToast(result.registrationOpen ? "已开放注册" : "已关闭注册");
  } catch (error) { checkbox.checked = !checkbox.checked; showToast(error.message); }
  finally { checkbox.disabled = false; }
}

async function changeUserStatus(button) {
  button.disabled = true;
  try {
    await apiRequest(`/api/admin/users/${button.dataset.userStatusId}/status`, { method: "PATCH", body: JSON.stringify({ status: button.dataset.nextStatus }) });
    await loadAdminPanel();
  } catch (error) { showToast(error.message); button.disabled = false; }
}

function classify(important, urgent) {
  if (important === null || urgent === null) return null;
  if (important && urgent) return "q1";
  if (important) return "q2";
  if (urgent) return "q3";
  return "q4";
}

function decisionForQuadrant(quadrant) {
  return {
    q1: { important: true, urgent: true },
    q2: { important: true, urgent: false },
    q3: { important: false, urgent: true },
    q4: { important: false, urgent: false },
  }[quadrant] || { important: null, urgent: null };
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function projectById(id) {
  return data.projects.find((project) => project.id === id);
}

function courseById(id) {
  return data.courses.find((course) => course.id === id);
}

function currentSemesterWeek(date = new Date()) {
  const start = dateFromISO(data.semester.startDate);
  const diff = mondayOf(date) - mondayOf(start);
  return Math.floor(diff / 604800000) + 1;
}

function weekStartDate(week) {
  return addDays(dateFromISO(data.semester.startDate), (week - 1) * 7);
}

function exceptionForWeek(course, week) {
  const originalDate = addDays(weekStartDate(week), course.day - 1);
  return data.courseExceptions.find((item) => item.courseId === course.id && item.date === localISO(originalDate));
}

function calendarRuleForDate(date) {
  const key = typeof date === "string" ? date : localISO(date);
  return data.calendarRules.find((rule) => rule.date === key) || null;
}

function courseOccurrence(course, date) {
  const dateKey = localISO(date);
  const movedHere = data.courseExceptions.find((item) => item.courseId === course.id && item.type === "reschedule" && item.targetDate === dateKey);
  if (movedHere) {
    const originalWeek = currentSemesterWeek(dateFromISO(movedHere.date));
    return course.weeks.includes(originalWeek) ? { ...course, day: date.getDay() || 7, startSection: movedHere.startSection, endSection: movedHere.endSection, occurrenceChanged: true } : null;
  }
  const week = currentSemesterWeek(date);
  const calendarRule = calendarRuleForDate(date);
  if (calendarRule?.type === "holiday") return null;
  const weekday = calendarRule?.type === "teaching" ? Number(calendarRule.useDay) : (date.getDay() || 7);
  if (!course.weeks.includes(week)) return null;
  const exception = exceptionForWeek(course, week);
  if (exception?.type === "cancel") return null;
  if (exception?.type === "reschedule") return (exception.targetDate ? exception.targetDate === dateKey : exception.day === weekday) ? { ...course, day: exception.day, startSection: exception.startSection, endSection: exception.endSection, occurrenceChanged: true } : null;
  return course.day === weekday ? course : null;
}

function courseOccursOn(course, date) {
  return Boolean(courseOccurrence(course, date));
}

function parseWeeks(value, maxWeeks = data.semester.totalWeeks) {
  const source = String(value || "");
  const parity = /单周|单数周|\(单\)|（单）/.test(source) ? 1 : /双周|双数周|\(双\)|（双）/.test(source) ? 0 : null;
  const weeks = new Set();
  source.replace(/(?:单周|双周|单数周|双数周|[（(][单双][)）])/g, "").split(/[，,]/).map((item) => item.trim()).filter(Boolean).forEach((part) => {
    const range = part.match(/^(\d+)\s*[-~～至到]\s*(\d+)\s*周?$/);
    if (range) {
      const from = Math.min(maxWeeks, Math.max(1, Number(range[1])));
      const to = Math.min(maxWeeks, Math.max(1, Number(range[2])));
      for (let week = Math.min(from, to); week <= Math.max(from, to); week += 1) if (parity === null || week % 2 === parity) weeks.add(week);
    } else if (/^\d+\s*周?$/.test(part)) {
      const week = Number(part.replace("周", ""));
      if (week >= 1 && week <= maxWeeks && (parity === null || week % 2 === parity)) weeks.add(week);
    }
  });
  if (!weeks.size && parity !== null) for (let week = 1; week <= maxWeeks; week += 1) if (week % 2 === parity) weeks.add(week);
  return [...weeks].sort((a, b) => a - b);
}

function formatWeeks(weeks) {
  if (!weeks?.length) return "";
  const ranges = [];
  let start = weeks[0];
  let previous = weeks[0];
  for (let index = 1; index <= weeks.length; index += 1) {
    const value = weeks[index];
    if (value === previous + 1) { previous = value; continue; }
    ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = value;
    previous = value;
  }
  return ranges.join(",");
}

function isOverdue(task) {
  return task.due && task.due < localISO() && !task.completed;
}

function formatDate(value) {
  if (!value) return "";
  const today = localISO();
  if (value === today) return "今天";
  if (value === offsetDate(1)) return "明天";
  const [year, month, day] = value.split("-");
  return `${Number(month)}月${Number(day)}日${year !== String(new Date().getFullYear()) ? ` · ${year}` : ""}`;
}

function deadlineState(task, now = new Date()) {
  if (!task?.due || task.completed) return { kind: "none", label: "", minutes: null };
  const time = task.dueTime || "23:59";
  const target = new Date(`${task.due}T${time}:00`);
  if (Number.isNaN(target.getTime())) return { kind: "none", label: "", minutes: null };
  const minutes = Math.round((target.getTime() - now.getTime()) / 60000);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = dateFromISO(task.due);
  const days = Math.round((targetDay - dayStart) / 86400000);
  if (minutes < 0) {
    const overdue = Math.abs(minutes);
    const label = overdue < 60 ? `⚠ 已逾期 ${overdue} 分钟` : overdue < 1440 ? `⚠ 已逾期 ${Math.ceil(overdue / 60)} 小时` : `⚠ 已逾期 ${Math.ceil(overdue / 1440)} 天`;
    return { kind: "overdue", label, minutes };
  }
  if (days === 0 && task.dueTime) {
    const label = minutes < 60 ? `剩余 ${Math.max(minutes, 0)} 分钟` : `剩余 ${Math.ceil(minutes / 60)} 小时`;
    return { kind: minutes <= 180 ? "urgent" : "today", label, minutes };
  }
  if (days === 0) return { kind: "today", label: "今天", minutes };
  if (days === 1) return { kind: "soon", label: "明天", minutes };
  if (days > 1) return { kind: days <= 3 ? "soon" : "future", label: `${days} 天后`, minutes };
  return { kind: "overdue", label: `⚠ 已逾期 ${Math.abs(days)} 天`, minutes };
}

function deadlineLabel(task, now = new Date()) {
  const state = deadlineState(task, now);
  if (!state.label) return "";
  return `${state.label}${task.dueTime && !state.label.includes(task.dueTime) ? ` · ${task.dueTime}` : ""}`;
}

function coursePlace(course) {
  return [course.campus, course.location].filter(Boolean).join(" · ");
}

function renderTaskCard(task) {
  const project = projectById(task.projectId);
  const course = courseById(task.courseId);
  const deadline = deadlineState(task);
  const dueClass = deadline.kind;
  const dueText = deadlineLabel(task);
  const scheduleText = task.startDate ? `${formatDate(task.startDate)}${task.startTime ? ` ${task.startTime}` : ""}${task.endTime ? `–${task.endTime}` : ""}` : "";
  return `<article class="task-card" draggable="true" data-task-id="${task.id}">
    <button class="complete-btn" data-complete-id="${task.id}" aria-label="完成事项"></button>
    <h4>${escapeHTML(task.title)}</h4>
    <div class="task-meta">
      ${dueText ? `<span class="meta-tag deadline-status ${dueClass}">◷ ${escapeHTML(dueText)}</span>` : ""}
      ${scheduleText ? `<span class="meta-tag">▣ ${escapeHTML(scheduleText)}</span>` : ""}
      ${project ? `<span class="meta-tag identity-tag" style="--identity-color:${projectColors[project.color] || projectColors.sage}">◇ ${escapeHTML(project.name)}</span>` : ""}
      ${course ? `<span class="meta-tag identity-tag" style="--identity-color:${course.color}">▦ ${escapeHTML(course.name)}</span>` : ""}
      ${task.type && task.type !== "task" ? `<span class="meta-tag">${taskTypeLabels[task.type] || "任务"}</span>` : ""}
      ${task.repeat && task.repeat !== "none" ? `<span class="meta-tag">↻ ${repeatLabels[task.repeat]}</span>` : ""}
      ${task.today ? '<span class="meta-tag">今日</span>' : ""}
      ${task.estimateMinutes ? `<span class="meta-tag">约 ${task.estimateMinutes} 分钟</span>` : ""}
    </div>
  </article>`;
}

function renderQuadrants() {
  Object.keys(quadrantInfo).forEach((quadrant) => {
    const tasks = data.tasks.filter((task) => task.quadrant === quadrant && !task.completed);
    $(`#${quadrant}List`).innerHTML = tasks.length
      ? tasks.map(renderTaskCard).join("")
      : '<div class="empty-state">这里暂时很清爽</div>';
  });
}

function renderListRow(task, mode) {
  const project = projectById(task.projectId);
  const course = courseById(task.courseId);
  const info = task.quadrant ? quadrantInfo[task.quadrant] : null;
  const detailParts = [];
  if (task.startDate) detailParts.push(`${formatDate(task.startDate)}${task.startTime ? ` ${task.startTime}` : ""}${task.endTime ? `–${task.endTime}` : ""}`);
  if (task.completed) detailParts.push("已完成");
  if (task.due) detailParts.push(deadlineLabel(task));
  if (project) detailParts.push(project.name);
  if (course) detailParts.push(course.name);
  if (task.type && task.type !== "task") detailParts.push(taskTypeLabels[task.type] || "任务");
  if (task.repeat && task.repeat !== "none") detailParts.push(`循环 · ${repeatLabels[task.repeat]}`);
  if (task.estimateMinutes) detailParts.push(`约 ${task.estimateMinutes} 分钟`);
  if (task.confirmationIssues?.length) detailParts.push(`待确认：${task.confirmationIssues.map((issue) => issue.message || issue).join("、")}`);
  if (info) detailParts.push(info.name);
  if (!detailParts.length) detailParts.push("尚未设置日期和分类");
  return `<div class="list-row" data-task-id="${task.id}">
    <button class="complete-btn ${task.completed ? "completed" : ""}" data-complete-id="${task.id}" data-complete-to="${!task.completed}" aria-pressed="${task.completed}" aria-label="${task.completed ? "恢复" : "完成"}事项"></button>
    <div class="list-main"><strong style="${task.completed ? "text-decoration:line-through;opacity:.55" : ""}">${escapeHTML(task.title)}</strong><span>${escapeHTML(detailParts.join(" · "))}</span></div>
    <div class="row-actions">${mode === "inbox" ? `<button class="classify-button" data-inbox-reparse="${task.id}">重新识别</button>` : info ? `<span class="meta-tag" style="color:${info.color}">${info.action}</span>` : ""}</div>
  </div>`;
}

function renderInbox() {
  const tasks = data.tasks.filter((task) => !task.quadrant && !task.completed);
  $("#inboxList").innerHTML = tasks.length ? tasks.map((task) => renderListRow(task, "inbox")).join("") : '<div class="empty-state" style="margin:18px">收集箱已清空，思绪也轻了一点。</div>';
  $("#inboxPanelCount").textContent = `${tasks.length} 项`;
}

function reparseInboxTask(taskId) {
  const task = data.tasks.find((item) => item.id === taskId && !item.completed && !item.quadrant);
  if (!task || !globalThis.FangcunSmartParser) return showToast("无法重新识别这项内容");
  const drafts = globalThis.FangcunSmartParser.parseNaturalBatch(task.title, { now: new Date(), totalWeeks: data.semester.totalWeeks, projects: data.projects, courses: data.courses });
  const draft = drafts.length === 1 && drafts[0].kind === "task" ? drafts[0] : null;
  if (!draft) return showToast("这句话包含多项内容，请进入手动确认");
  Object.assign(task, {
    title: draft.title || task.title, due: draft.due || "", dueTime: draft.dueTime || "",
    startDate: draft.startDate || "", startTime: draft.startTime || "", endDate: draft.endDate || "", endTime: draft.endTime || "",
    reminderMinutes: Number.isFinite(draft.reminderMinutes) ? draft.reminderMinutes : -1,
    important: draft.important, urgent: draft.urgent, quadrant: classify(draft.important, draft.urgent),
    courseId: draft.courseId || "", projectId: draft.projectId || "", estimateMinutes: draft.estimateMinutes || 0,
    confirmationIssues: draft.issues || [], source: "natural-language"
  });
  saveData();
  showToast(task.quadrant && !task.confirmationIssues.length ? "已重新识别并移出待确认" : `已补全可识别字段，仍有 ${task.confirmationIssues.length} 项待确认`);
}

function taskFocusScore(task, now = new Date()) {
  if (task.completed || task.focusDismissedDate === localISO(now)) return -Infinity;
  const deadline = deadlineState(task, now);
  let score = task.focusPinned ? 5000 : 0;
  if (deadline.kind === "overdue") score += 1200;
  else if (deadline.kind === "urgent") score += 950;
  else if (deadline.kind === "today") score += 760;
  else if (deadline.kind === "soon") score += 420;
  if (task.important) score += 220;
  if (task.urgent) score += 160;
  if (task.today) score += 130;
  if (task.startDate === localISO(now)) score += 90;
  if (task.projectId) {
    const project = projectById(task.projectId);
    const metrics = project ? projectMetrics(project) : null;
    if (metrics?.status === "behind" || metrics?.status === "risk") score += 180;
    score += 45;
  }
  if (task.courseId) score += 35;
  if (task.estimateMinutes && task.estimateMinutes <= 60) score += 25;
  return score;
}

function focusReason(task) {
  const deadline = deadlineState(task);
  if (deadline.kind === "overdue" || deadline.kind === "urgent" || deadline.kind === "today") return deadlineLabel(task);
  if (task.projectId) {
    const project = projectById(task.projectId);
    const metrics = project ? projectMetrics(project) : null;
    if (metrics?.status === "behind" || metrics?.status === "risk") return `项目需要推进 · ${project.name}`;
    return `项目下一行动 · ${project?.name || "长期项目"}`;
  }
  if (task.important && task.urgent) return "重要且紧急";
  if (task.important) return "重要 · 适合现在推进";
  if (task.urgent) return "紧急 · 尽快收口";
  return task.today ? "已加入今天" : "当前可执行";
}

function focusTasks(limit = 3) {
  const candidates = data.tasks.filter((task) => !task.completed && task.quadrant && task.focusDismissedDate !== localISO());
  const pinned = candidates.filter((task) => task.focusPinned).sort((a, b) => taskFocusScore(b) - taskFocusScore(a));
  const ranked = candidates.filter((task) => !task.focusPinned).sort((a, b) => taskFocusScore(b) - taskFocusScore(a));
  if (ranked.length > limit && focusRotation) {
    const offset = focusRotation % ranked.length;
    ranked.push(...ranked.splice(0, offset));
  }
  return [...pinned, ...ranked].slice(0, limit);
}

function todayTimelineItems(now = new Date()) {
  const today = localISO(now);
  const courses = data.courses.map((course) => courseOccurrence(course, now)).filter(Boolean).map((course) => {
    const start = slotByNumber(course.startSection)?.startTime || "00:00";
    const end = slotByNumber(course.endSection)?.endTime || start;
    return { kind: "course", id: course.id, title: course.name, subtitle: coursePlace(course) || "地点待确认", start, end, color: course.color };
  });
  const events = data.tasks.filter((task) => !task.completed && task.startDate === today && task.startTime).map((task) => ({ kind: "task", id: task.id, title: task.title, subtitle: task.courseId ? courseById(task.courseId)?.name || "课程事项" : "已安排事项", start: task.startTime, end: task.endTime || task.startTime, color: "var(--accent)" }));
  return [...courses, ...events].sort((a, b) => a.start.localeCompare(b.start));
}

function renderToday() {
  const now = new Date();
  const today = localISO(now);
  const activeTasks = data.tasks.filter((task) => !task.completed && (task.today || task.startDate === today || (task.due && task.due <= today)));
  const completedTasks = data.tasks.filter((task) => task.completed && task.completedAt && localISO(new Date(task.completedAt)) === today);
  const inbox = data.tasks.filter((task) => !task.completed && !task.quadrant);
  const timeline = todayTimelineItems(now);
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const upcoming = timeline.find((item) => item.end >= currentTime);
  const focuses = focusTasks(3);
  const later = timeline.filter((item) => item.end >= currentTime).slice(0, 6);
  const deadlines = data.tasks.filter((task) => !task.completed && task.due).sort((a, b) => `${a.due}T${a.dueTime || "23:59"}`.localeCompare(`${b.due}T${b.dueTime || "23:59"}`)).slice(0, 5);
  const total = activeTasks.length + completedTasks.length;
  const percent = total ? Math.round((completedTasks.length / total) * 100) : 0;

  $("#todayHeading").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(now);
  $("#todaySummary").textContent = focuses.length ? `已经替你收敛到 ${focuses.length} 个现在可做的选择。` : "今天没有必须立刻处理的事项。";
  $("#todayInboxCount").textContent = inbox.length;
  $("#todayInboxBtn").classList.toggle("has-items", inbox.length > 0);
  $("#todayNextSchedule").innerHTML = upcoming ? `<span class="eyebrow">${upcoming.start <= currentTime && upcoming.end >= currentTime ? "正在进行" : "下一安排"}</span><button type="button" data-${upcoming.kind === "course" ? "course" : "task"}-id="${upcoming.id}" style="--item-color:${upcoming.color}"><time>${escapeHTML(upcoming.start)}${upcoming.end !== upcoming.start ? `–${escapeHTML(upcoming.end)}` : ""}</time><i></i><div><strong>${escapeHTML(upcoming.title)}</strong><span>${escapeHTML(upcoming.subtitle)}</span></div></button>` : '<span class="eyebrow">下一安排</span><p>今天暂时没有时间约束，可以主动安排一段深度工作。</p>';
  $("#todayFocusList").innerHTML = focuses.length ? focuses.map((task) => `<article class="focus-task ${task.focusPinned ? "pinned" : ""}" data-task-id="${task.id}"><button class="complete-btn" data-complete-id="${task.id}" aria-label="完成${escapeHTML(task.title)}"></button><div class="focus-task-main"><strong>${escapeHTML(task.title)}</strong><span>${escapeHTML(focusReason(task))}${task.estimateMinutes ? ` · 约 ${task.estimateMinutes} 分钟` : ""}</span></div><div class="focus-actions"><button type="button" data-focus-pin="${task.id}" aria-label="${task.focusPinned ? "取消固定" : "固定"}">${task.focusPinned ? "已固定" : "固定"}</button><button type="button" data-focus-dismiss="${task.id}" aria-label="今天稍后处理">稍后</button></div></article>`).join("") : '<div class="today-empty">没有需要系统推荐的任务。可以添加一件事，或享受一段无硬性节点的时间。</div>';
  $("#todayLaterList").innerHTML = later.length ? later.map((item) => `<button type="button" class="today-timeline-row" data-${item.kind === "course" ? "course" : "task"}-id="${item.id}" style="--item-color:${item.color}"><time>${escapeHTML(item.start)}</time><i></i><div><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.subtitle)}</span></div></button>`).join("") : '<div class="today-empty compact">今天稍后没有已经安排的课程或日程。</div>';
  $("#todayDeadlineList").innerHTML = deadlines.length ? deadlines.map((task) => { const state = deadlineState(task); return `<button type="button" class="today-ddl-row ${state.kind}" data-task-id="${task.id}"><time>${escapeHTML(deadlineLabel(task))}</time><strong>${escapeHTML(task.title)}</strong><span>${escapeHTML(task.courseId ? courseById(task.courseId)?.name || "课程" : formatDate(task.due))}</span></button>`; }).join("") : '<div class="today-empty compact">最近没有 DDL。</div>';
  $("#todayProgressText").textContent = `已完成 ${completedTasks.length} / ${total}`;
  $("#todayProgressBar").style.width = `${percent}%`;

  $("#todayList").innerHTML = [...activeTasks, ...completedTasks].map((task) => renderListRow(task, "today")).join("");
  $("#todayPanelCount").textContent = `${activeTasks.length} 项待完成`;
  $("#doneToday").textContent = completedTasks.length;
  $("#progressValue").textContent = `${percent}%`;
  $("#progressRing").style.setProperty("--progress", `${percent}%`);
  renderTodaySchedule();
}

function slotByNumber(number) {
  return data.timeSlots.find((slot) => Number(slot.number) === Number(number));
}

function courseTimeText(course) {
  const start = slotByNumber(course.startSection);
  const end = slotByNumber(course.endSection);
  return start && end ? `${start.startTime}–${end.endTime}` : `第 ${course.startSection}–${course.endSection} 节`;
}

function renderTodaySchedule() {
  const today = new Date();
  const courses = data.courses.map((course) => courseOccurrence(course, today)).filter(Boolean).sort((a, b) => a.startSection - b.startSection);
  $("#todaySchedule").innerHTML = courses.length ? courses.map((course) => `<article class="today-class" data-course-id="${course.id}" style="--course-color:${course.color}">
    <time>${escapeHTML(courseTimeText(course))}</time><div><strong>${escapeHTML(course.name)}</strong><span>${escapeHTML([coursePlace(course), course.teacher].filter(Boolean).join(" · ") || "暂无地点信息")}</span></div>
  </article>`).join("") : '<div class="today-no-class">今天没有课程安排，可以留一段完整时间给重要的事。</div>';
}

function pendingCourseTasks(courseId) {
  return data.tasks.filter((task) => task.courseId === courseId && !task.completed).sort((a, b) => (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31"));
}

function renderSemesterOverview() {
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const activeDays = data.semester.showWeekend ? 7 : 5;
  $("#semesterOverview").innerHTML = `<div class="overview-summary"><div><strong>${data.courses.length}</strong><span>门课程</span></div><div><strong>${data.tasks.filter((task) => task.courseId && !task.completed).length}</strong><span>项课程任务</span></div><div><strong>${data.tasks.filter((task) => task.courseId && task.due && !task.completed).length}</strong><span>个待完成 DDL</span></div></div><div class="overview-days">${Array.from({ length: activeDays }, (_, index) => index + 1).map((day) => {
    const courses = data.courses.filter((course) => course.day === day).sort((a, b) => a.startSection - b.startSection);
    return `<section class="overview-day"><h3>${weekdays[day - 1]}</h3>${courses.length ? courses.map((course) => {
      const pending = pendingCourseTasks(course.id);
      return `<article class="overview-course" data-course-id="${course.id}" style="--course-color:${course.color}"><i></i><div><strong>${escapeHTML(course.name)}</strong><span>${escapeHTML(courseTimeText(course))} · ${escapeHTML(formatWeeks(course.weeks))} 周</span><small>${escapeHTML(coursePlace(course) || "地点待定")}${pending.length ? ` · ${pending.length} 个待办` : ""}</small></div></article>`;
    }).join("") : '<p class="overview-empty">无课程</p>'}</section>`;
  }).join("")}</div>`;
}

function renderDaySchedule(start, dayCount) {
  const weekEnd = addDays(start, dayCount - 1);
  let selected = dateFromISO(displayedDay);
  if (selected < start || selected > weekEnd) selected = localISO() >= localISO(start) && localISO() <= localISO(weekEnd) ? dateFromISO(localISO()) : start;
  displayedDay = localISO(selected);
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const rule = calendarRuleForDate(selected);
  const courses = data.courses.map((course) => courseOccurrence(course, selected)).filter(Boolean).sort((a, b) => a.startSection - b.startSection);
  const tasks = data.tasks.filter((task) => !task.completed && (task.due === displayedDay || task.startDate === displayedDay)).sort((a, b) => (a.startTime || a.dueTime || "23:59").localeCompare(b.startTime || b.dueTime || "23:59"));
  $("#daySchedule").innerHTML = `<div class="day-strip">${Array.from({ length: dayCount }, (_, index) => addDays(start, index)).map((date) => {
    const dateRule = calendarRuleForDate(date);
    return `<button type="button" data-day-date="${localISO(date)}" class="${localISO(date) === displayedDay ? "active" : ""} ${dateRule ? `has-rule ${dateRule.type}` : ""}"><span>${weekdays[date.getDay()]}</span><strong>${date.getDate()}</strong>${dateRule ? `<em>${escapeHTML(dateRule.name)}</em>` : ""}</button>`;
  }).join("")}</div><div class="day-heading"><div><h3>${formatDate(displayedDay)} · ${weekdays[selected.getDay()]}</h3><p>${rule ? escapeHTML(rule.name) : "按时间顺序查看今天的课程与截止事项"}</p></div><span>${courses.length} 门课 · ${tasks.length} 个事项</span></div><div class="day-timeline">${courses.map((course) => `<article class="day-course-card" data-course-id="${course.id}" style="--course-color:${course.color}"><time>${escapeHTML(courseTimeText(course))}</time><i></i><div><strong>${escapeHTML(course.name)}</strong><span>${escapeHTML([course.teacher, coursePlace(course)].filter(Boolean).join(" · ") || "暂无地点信息")}</span></div><em>${pendingCourseTasks(course.id).length} 个待办</em></article>`).join("")}${tasks.map((task) => `<article class="day-task-card" data-task-id="${task.id}"><time>${escapeHTML(task.startTime || task.dueTime || "DDL")}</time><i></i><div><strong>${escapeHTML(task.title)}</strong><span>${task.courseId ? escapeHTML(courseById(task.courseId)?.name || "课程任务") : "事项"}</span></div></article>`).join("")}${!courses.length && !tasks.length ? '<div class="empty-state">这一天没有课程和事项</div>' : ""}</div>`;
}

function calendarItemsForDate(date) {
  const key = localISO(date);
  const tasks = data.tasks.filter((task) => !task.completed && (task.due === key || task.startDate === key));
  const courses = data.courses.map((course) => courseOccurrence(course, date)).filter(Boolean).sort((a, b) => a.startSection - b.startSection);
  return { key, tasks, courses, rule: calendarRuleForDate(date) };
}

function monthGridDates(year, month) {
  const first = new Date(year, month, 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function renderYearCalendar() {
  $("#yearCalendar").innerHTML = `<div class="year-grid">${Array.from({ length: 12 }, (_, month) => {
    const dates = monthGridDates(displayedYear, month);
    return `<section class="mini-month"><header><strong>${month + 1} 月</strong><span>${dates.reduce((sum, date) => sum + (date.getMonth() === month ? calendarItemsForDate(date).tasks.filter((task) => task.due === localISO(date)).length : 0), 0)} 个 DDL</span></header><div class="mini-weekdays">${["一","二","三","四","五","六","日"].map((day) => `<span>${day}</span>`).join("")}</div><div class="mini-days">${dates.map((date) => {
      const items = calendarItemsForDate(date);
      const outside = date.getMonth() !== month;
      const deadlineCount = items.tasks.filter((task) => task.due === items.key).length;
      return `<button type="button" data-calendar-date="${items.key}" class="${outside ? "outside" : ""} ${items.key === localISO() ? "today" : ""} ${deadlineCount ? "has-ddl" : ""} ${items.courses.length ? "has-course" : ""} ${items.rule ? `has-rule ${items.rule.type}` : ""}" title="${escapeHTML([items.rule?.name, deadlineCount ? `${deadlineCount} 个 DDL` : "", items.courses.length ? `${items.courses.length} 门课` : ""].filter(Boolean).join(" · "))}"><span>${date.getDate()}</span>${deadlineCount ? `<i>${deadlineCount}</i>` : ""}</button>`;
    }).join("")}</div></section>`;
  }).join("")}</div>`;
}

function renderMonthCalendar() {
  const dates = monthGridDates(displayedYear, displayedMonth);
  $("#monthCalendar").innerHTML = `<div class="month-weekdays">${["周一","周二","周三","周四","周五","周六","周日"].map((day) => `<span>${day}</span>`).join("")}</div><div class="month-grid">${dates.map((date) => {
    const items = calendarItemsForDate(date);
    const outside = date.getMonth() !== displayedMonth;
    const entries = [
      ...items.tasks.filter((task) => task.due === items.key).map((task) => ({ kind: "ddl", label: `${task.dueTime || "DDL"} ${task.title}`, id: task.id })),
      ...items.courses.map((course) => ({ kind: "course", label: `${slotByNumber(course.startSection)?.startTime || ""} ${course.name}`, id: course.id, color: course.color })),
      ...items.tasks.filter((task) => task.startDate === items.key && task.due !== items.key).map((task) => ({ kind: "task", label: `${task.startTime || "事项"} ${task.title}`, id: task.id })),
    ];
    return `<article class="month-day ${outside ? "outside" : ""} ${items.key === localISO() ? "today" : ""}" data-calendar-date="${items.key}"><header><strong>${date.getDate()}</strong>${items.rule ? `<span class="calendar-rule-name">${escapeHTML(items.rule.name)}</span>` : ""}</header><div>${entries.slice(0, 4).map((entry) => `<button type="button" class="calendar-entry ${entry.kind}" ${entry.kind === "course" ? `data-course-id="${entry.id}" style="--course-color:${entry.color}"` : `data-task-id="${entry.id}"`}><i></i><span>${escapeHTML(entry.label)}</span></button>`).join("")}${entries.length > 4 ? `<button type="button" class="calendar-more" data-calendar-date="${items.key}">＋${entries.length - 4} 项</button>` : ""}</div></article>`;
  }).join("")}</div>`;
}

function renderDeadlineRadar() {
  const deadlines = data.tasks.filter((task) => !task.completed && task.due).sort((a, b) => a.due.localeCompare(b.due) || (a.dueTime || "23:59").localeCompare(b.dueTime || "23:59")).slice(0, 6);
  $("#weekDeadlines").innerHTML = '<span class="deadline-label"><strong>DDL 雷达</strong><small>优先显示最近节点</small></span>' + (deadlines.length ? deadlines.map((task) => {
    const state = deadlineState(task);
    return `<article class="deadline-chip ${state.kind}" data-task-id="${task.id}"><time>${escapeHTML(deadlineLabel(task))}</time><strong>${escapeHTML(task.title)}</strong><span>${task.courseId ? escapeHTML(courseById(task.courseId)?.name || "课程") : formatDate(task.due)}</span></article>`;
  }).join("") : '<span class="deadline-empty">目前没有 DDL，可以安心安排深度工作。</span>');
}

async function deleteOwnAccount() {
  if (syncState.user?.role !== "user") return showToast("管理员账号不能在应用内注销");
  const password = $("#deleteAccountPassword").value;
  if (!password) return showToast("请输入当前密码");
  const username = syncState.user.username;
  if (!confirm(`确定永久注销账号“${username}”吗？方寸服务器中的任务、课表、同步令牌和历史快照都会删除，且无法恢复。`)) return;
  const button = $("#deleteAccountBtn");
  button.disabled = true;
  try {
    await apiRequest("/api/auth/account", { method: "DELETE", body: JSON.stringify({ password }) });
    [STORAGE_KEY, SYNC_META_KEY, PRE_CLOUD_BACKUP_KEY, CALENDAR_SUBSCRIPTION_URL_KEY, ANDROID_CALENDAR_MAP_KEY].forEach((key) => localStorage.removeItem(accountKey(key)));
    localStorage.removeItem(LAST_USER_KEY);
    currentUser = null;
    syncState.authenticated = false;
    syncState.user = null;
    $("#deleteAccountPassword").value = "";
    $("#cloudModal").close();
    showAuthGate();
    showToast("账号及方寸云端数据已永久删除");
  } catch (error) {
    showToast(error.message);
  } finally { button.disabled = false; }
}

function calendarWeekTitle(week, currentWeek = currentSemesterWeek()) {
  const totalWeeks = Number(data.semester.totalWeeks) || 20;
  const label = week < 1 ? `学期前第 ${1 - week} 周` : week > totalWeeks ? `学期后第 ${week - totalWeeks} 周` : `第 ${week} 教学周`;
  return `${label}${week === currentWeek ? " · 本周" : ""}`;
}

function timeMinutes(value, fallback = 0) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
}

function minutesLabel(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function weekCalendarModel(start) {
  const firstKey = localISO(start);
  const lastKey = localISO(addDays(start, 6));
  const inWeek = (value) => value && value >= firstKey && value <= lastKey;
  const dayIndex = (value) => Math.round((dateFromISO(value) - dateFromISO(firstKey)) / 86400000);
  const timed = [];
  const allDay = Array.from({ length: 7 }, () => []);

  for (let day = 0; day < 7; day += 1) {
    const date = addDays(start, day);
    data.courses.map((course) => courseOccurrence(course, date)).filter(Boolean).forEach((course) => {
      const startSlot = slotByNumber(course.startSection);
      const endSlot = slotByNumber(course.endSection);
      if (!startSlot || !endSlot) return;
      timed.push({ kind: "course", id: course.id, day, start: timeMinutes(startSlot.startTime), end: timeMinutes(endSlot.endTime), title: course.name, detail: coursePlace(course), color: course.color });
    });
  }

  data.tasks.filter((task) => !task.completed).forEach((task) => {
    if (inWeek(task.startDate)) {
      const day = dayIndex(task.startDate);
      if (task.startTime) {
        const startMinutes = timeMinutes(task.startTime);
        const sameDayEnd = !task.endDate || task.endDate === task.startDate;
        const inferredEnd = startMinutes + Math.max(30, Number(task.estimateMinutes) || 60);
        const endMinutes = sameDayEnd && task.endTime ? timeMinutes(task.endTime, inferredEnd) : inferredEnd;
        timed.push({ kind: "event", id: task.id, day, start: startMinutes, end: Math.max(startMinutes + 30, endMinutes), title: task.title, detail: task.location || taskTypeLabels[task.type] || "日程" });
      } else allDay[day].push({ kind: "event", id: task.id, title: task.title });
    }
    if (inWeek(task.due) && (!task.startDate || task.due !== task.startDate)) {
      const day = dayIndex(task.due);
      if (task.dueTime) {
        const startMinutes = timeMinutes(task.dueTime);
        timed.push({ kind: "deadline", id: task.id, day, start: startMinutes, end: startMinutes + 30, title: task.title, detail: "截止" });
      } else allDay[day].push({ kind: "deadline", id: task.id, title: task.title });
    }
  });
  return { timed, allDay };
}

function renderWeekCalendar(start) {
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const { timed, allDay } = weekCalendarModel(start);
  const startMinute = 7 * 60;
  const endMinute = 23 * 60;
  const hasAllDay = allDay.some((items) => items.length);
  let html = `<div class="calendar-week-grid ${hasAllDay ? "" : "no-all-day"}"><div class="calendar-week-corner">${hasAllDay ? "全天" : "时间"}</div>`;
  for (let day = 0; day < 7; day += 1) {
    const date = addDays(start, day);
    const key = localISO(date);
    html += `<button type="button" class="calendar-week-head ${key === localISO() ? "today" : ""}" data-calendar-date="${key}" data-calendar-past-date="${key}" style="grid-column:${day + 2};grid-row:1"><strong>${weekdays[day]}</strong><span>${date.getMonth() + 1}/${date.getDate()}</span></button>`;
    html += `<div class="calendar-all-day" data-calendar-all-day="${key}" style="grid-column:${day + 2};grid-row:2">${allDay[day].slice(0, 3).map((item) => `<button type="button" class="calendar-all-day-item ${item.kind}" data-task-id="${item.id}">${escapeHTML(item.title)}</button>`).join("")}${allDay[day].length > 3 ? `<span>＋${allDay[day].length - 3}</span>` : ""}</div>`;
  }
  for (let minute = startMinute; minute < endMinute; minute += 30) {
    const row = 3 + (minute - startMinute) / 30;
    if (minute % 60 === 0) html += `<div class="calendar-hour" style="grid-column:1;grid-row:${row}/span 2">${minutesLabel(minute)}</div>`;
    for (let day = 0; day < 7; day += 1) {
      html += `<button type="button" class="calendar-time-cell" data-calendar-past-date="${localISO(addDays(start, day))}" data-calendar-slot-date="${localISO(addDays(start, day))}" data-calendar-slot-time="${minutesLabel(minute)}" aria-label="${localISO(addDays(start, day))} ${minutesLabel(minute)} 新建日程" style="grid-column:${day + 2};grid-row:${row}"></button>`;
    }
  }
  timed.forEach((item) => {
    if (item.end <= startMinute || item.start >= endMinute) return;
    const visibleStart = Math.max(startMinute, item.start);
    const visibleEnd = Math.min(endMinute, item.end);
    const row = 3 + Math.floor((visibleStart - startMinute) / 30);
    const span = Math.max(1, Math.ceil((visibleEnd - visibleStart) / 30));
    const attribute = item.kind === "course" ? `data-course-id="${item.id}"` : `data-task-id="${item.id}"`;
    const endAt = new Date(addDays(start, item.day));
    endAt.setHours(0, item.end, 0, 0);
    html += `<button type="button" class="calendar-week-event ${item.kind}" ${attribute} data-calendar-end="${endAt.getTime()}" style="grid-column:${item.day + 2};grid-row:${row}/span ${span};${item.color ? `--event-color:${item.color};` : ""}"><time>${minutesLabel(item.start)}</time><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.detail || "")}</span></button>`;
  });
  html += "</div>";
  $("#weekCalendar").innerHTML = html;
}

function refreshCalendarPast(now = new Date()) {
  const today = localISO(now);
  $$("[data-calendar-past-date]").forEach((element) => element.classList.toggle("past", element.dataset.calendarPastDate < today));
  $$("[data-calendar-end]").forEach((element) => element.classList.toggle("past", Number(element.dataset.calendarEnd) < now.getTime()));
  $$(".month-day[data-calendar-date]").forEach((element) => element.classList.toggle("past", element.dataset.calendarDate < today));
}

function calendarZoomValue() {
  const value = Number(localStorage.getItem(accountKey("fangcun-calendar-zoom")));
  return Number.isFinite(value) && value >= 0.35 && value <= 1.8 ? value : 0.8;
}

function applyCalendarZoom(value = calendarZoomValue(), anchor = null) {
  const zoom = Math.max(0.35, Math.min(1.8, value));
  const wrap = $(".schedule-board-wrap");
  const old = Number(wrap.dataset.zoom) || calendarZoomValue();
  const center = anchor || { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 };
  const left = wrap.scrollLeft, top = wrap.scrollTop;
  wrap.dataset.zoom = String(zoom);
  wrap.style.setProperty("--calendar-scale", zoom);
  wrap.style.setProperty("--calendar-step", Math.max(14, 28 * zoom) + "px");
  wrap.style.setProperty("--calendar-day-width", (120 * zoom) + "px");
  wrap.style.setProperty("--calendar-slot-height", (48 * zoom) + "px");
  if (anchor) {
    wrap.scrollLeft = (left + center.x) * zoom / old - center.x;
    wrap.scrollTop = (top + center.y) * zoom / old - center.y;
  }
  $("#calendarZoomFit").textContent = Math.round(zoom * 100) + "%";
  $("#calendarZoomFit").setAttribute("aria-label", "当前缩放 " + Math.round(zoom * 100) + "%，点击适应屏幕宽度");
  $("#calendarZoomOut").disabled = zoom <= 0.35;
  $("#calendarZoomIn").disabled = zoom >= 1.8;
  localStorage.setItem(accountKey("fangcun-calendar-zoom"), String(zoom));
}

function initCalendarZoom() {
  const wrap = $(".schedule-board-wrap");
  $("#calendarZoomOut").addEventListener("click", () => applyCalendarZoom(calendarZoomValue() - 0.1, { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 }));
  $("#calendarZoomIn").addEventListener("click", () => applyCalendarZoom(calendarZoomValue() + 0.1, { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 }));
  $("#calendarZoomFit").addEventListener("click", () => { applyCalendarZoom((wrap.clientWidth - 44) / (7 * 120)); wrap.scrollLeft = 0; });
  let pinch = null;
  const distance = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  wrap.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 2 || !["week", "timetable"].includes(scheduleMode)) return;
    event.preventDefault();
    pinch = { distance: distance(event.touches), zoom: calendarZoomValue() };
  }, { passive: false });
  wrap.addEventListener("touchmove", (event) => {
    if (!pinch || event.touches.length !== 2) return;
    event.preventDefault();
    const rect = wrap.getBoundingClientRect();
    applyCalendarZoom(pinch.zoom * distance(event.touches) / Math.max(1, pinch.distance), { x: (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left, y: (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top });
  }, { passive: false });
  const end = () => { pinch = null; };
  wrap.addEventListener("touchend", end);
  wrap.addEventListener("touchcancel", end);
  wrap.addEventListener("wheel", (event) => {
    if (!event.ctrlKey || !["week", "timetable"].includes(scheduleMode)) return;
    event.preventDefault();
    applyCalendarZoom(calendarZoomValue() + (event.deltaY < 0 ? 0.05 : -0.05), { x: event.offsetX, y: event.offsetY });
  }, { passive: false });
}

function renderSchedule() {
  $("#scheduleView").dataset.mode = scheduleMode;
  const start = weekStartDate(displayedWeek);
  const end = addDays(start, 6);
  const currentWeek = currentSemesterWeek();
  const dayCount = data.semester.showWeekend ? 7 : 5;
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const datedTasks = data.tasks.filter((task) => !task.completed && (task.startDate || task.due)).length;
  $("#semesterSummary").textContent = `${datedTasks} 个已排期事项 · ${data.courses.length} 门课程 · 可继续浏览学期外日期`;
  const titles = {
    year: [`${displayedYear} 年`, "全年课程、DDL 与校历"],
    month: [`${displayedYear} 年 ${displayedMonth + 1} 月`, "课程和截止事项统一月历"],
    week: [`${formatDate(localISO(start))} — ${formatDate(localISO(end))}`, "按真实时间统一显示日程、任务、期限和课程"],
    day: [formatDate(displayedDay), "课程、日程与 DDL 时间线"],
    timetable: [calendarWeekTitle(displayedWeek, currentWeek), `${formatDate(localISO(start))} — ${formatDate(localISO(end))} · 教学课表`],
  };
  $("#weekTitle").textContent = titles[scheduleMode]?.[0] || titles.week[0];
  $("#weekRange").textContent = titles[scheduleMode]?.[1] || titles.week[1];
  $("#prevWeekBtn").disabled = false;
  $("#nextWeekBtn").disabled = false;
  renderDeadlineRadar();
  renderWeekCalendar(start);

  const board = $("#scheduleBoard");
  board.style.setProperty("--day-count", dayCount);
  let html = '<div class="schedule-corner" style="grid-column:1;grid-row:1">节次 / 日期</div>';
  for (let day = 1; day <= dayCount; day += 1) {
    const date = addDays(start, day - 1);
    const isToday = localISO(date) === localISO();
    const rule = calendarRuleForDate(date);
    html += `<div class="schedule-day-head ${isToday ? "today" : ""} ${rule ? `has-rule ${rule.type}` : ""}" style="grid-column:${day + 1};grid-row:1"><strong>${weekdays[day - 1]}</strong><span>${date.getMonth() + 1}/${date.getDate()}${rule ? ` · ${escapeHTML(rule.name)}` : ""}</span></div>`;
  }
  data.timeSlots.forEach((slot, rowIndex) => {
    html += `<div class="schedule-time" style="grid-column:1;grid-row:${rowIndex + 2}"><strong>${slot.number}</strong><span>${escapeHTML(slot.startTime)}<br>${escapeHTML(slot.endTime)}</span></div>`;
    for (let day = 1; day <= dayCount; day += 1) {
      const date = addDays(start, day - 1);
      html += `<div class="schedule-cell ${localISO(date) === localISO() ? "today" : ""}" data-course-drop-day="${day}" data-course-drop-section="${slot.number}" style="grid-column:${day + 1};grid-row:${rowIndex + 2}"></div>`;
    }
  });
  const weekCourses = [];
  for (let day = 1; day <= dayCount; day += 1) {
    const date = addDays(start, day - 1);
    data.courses.forEach((course) => {
      const occurrence = courseOccurrence(course, date);
      if (occurrence) weekCourses.push({ ...occurrence, day, occurrenceDate: localISO(date) });
    });
  }
  weekCourses.forEach((course) => {
    const startIndex = data.timeSlots.findIndex((slot) => Number(slot.number) === Number(course.startSection));
    const endIndex = data.timeSlots.findIndex((slot) => Number(slot.number) === Number(course.endSection));
    if (startIndex < 0 || endIndex < 0) return;
    const date = addDays(start, course.day - 1);
    const now = new Date();
    const startSlot = slotByNumber(course.startSection);
    const endSlot = slotByNumber(course.endSection);
    const startAt = new Date(`${localISO(date)}T${startSlot.startTime}:00`);
    const endAt = new Date(`${localISO(date)}T${endSlot.endTime}:00`);
    const state = now > endAt ? "past" : now >= startAt && now <= endAt ? "current" : "";
    html += `<button class="course-block ${state}" draggable="true" data-course-id="${course.id}" style="--course-color:${course.color};grid-column:${course.day + 1};grid-row:${startIndex + 2}/${endIndex + 3}"><strong>${escapeHTML(course.name)}${course.occurrenceChanged ? " · 调" : ""}</strong><span>${escapeHTML(coursePlace(course) || "地点待定")}</span><span>${escapeHTML(courseTimeText(course))}</span></button>`;
  });
  board.innerHTML = html;

  $("#courseAgenda").innerHTML = Array.from({ length: dayCount }, (_, index) => index + 1).map((day) => {
    const date = addDays(start, day - 1);
    const courses = weekCourses.filter((course) => course.day === day).sort((a, b) => a.startSection - b.startSection);
    if (!courses.length) return "";
    return `<section class="agenda-day"><h3>${weekdays[day - 1]} · ${formatDate(localISO(date))}</h3>${courses.map((course) => `<article class="agenda-course" data-course-id="${course.id}" style="--course-color:${course.color}"><time>${escapeHTML(courseTimeText(course))}</time><i></i><div><strong>${escapeHTML(course.name)}</strong><span>${escapeHTML([course.code, course.teacher, coursePlace(course)].filter(Boolean).join(" · ") || "暂无详细信息")}</span></div><em>${formatWeeks(course.weeks)}周</em></article>`).join("")}</section>`;
  }).join("") || '<div class="empty-state" style="margin:20px">这一周没有课程。</div>';
  if (scheduleMode === "day") renderDaySchedule(mondayOf(dateFromISO(displayedDay)), 7);
  if (scheduleMode === "year") renderYearCalendar();
  if (scheduleMode === "month") renderMonthCalendar();
  board.classList.toggle("hidden", scheduleMode !== "timetable");
  $("#weekCalendar").classList.toggle("hidden", scheduleMode !== "week");
  $("#yearCalendar").classList.toggle("hidden", scheduleMode !== "year");
  $("#monthCalendar").classList.toggle("hidden", scheduleMode !== "month");
  $("#semesterOverview").classList.add("hidden");
  $("#daySchedule").classList.toggle("hidden", scheduleMode !== "day");
  $("#courseAgenda").classList.add("hidden");
  $("#weekDeadlines").classList.toggle("hidden", scheduleMode !== "timetable");
  $$("[data-schedule-mode]").forEach((button) => button.classList.toggle("active", button.dataset.scheduleMode === scheduleMode));
  $(".calendar-zoom-tools").classList.toggle("hidden", !["week", "timetable"].includes(scheduleMode));
  applyCalendarZoom();
  refreshCalendarPast();
}

function projectMetrics(project) {
  const tasks = data.tasks.filter((task) => task.projectId === project.id);
  const milestones = project.milestones || [];
  const completedUnits = tasks.filter((task) => task.completed).length + milestones.filter((item) => item.completed).length;
  const totalUnits = tasks.length + milestones.length;
  const actual = totalUnits ? Math.round((completedUnits / totalUnits) * 100) : 0;
  const start = dateFromISO(project.startDate || localISO(new Date(project.createdAt || Date.now())));
  const due = project.due ? dateFromISO(project.due) : null;
  const totalDays = due ? Math.max(1, Math.round((due - start) / 86400000)) : 0;
  const elapsedDays = due ? Math.round((dateFromISO(localISO()) - start) / 86400000) : 0;
  const time = due ? Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100))) : 0;
  const pending = tasks.filter((task) => !task.completed).sort((a, b) => Number(Boolean(b.important)) - Number(Boolean(a.important)) || (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31") || a.createdAt - b.createdAt);
  const status = actual === 100 && totalUnits ? "done" : project.due && project.due < localISO() ? "overdue" : due && time > 20 && actual + 15 < time ? "risk" : "steady";
  return { tasks, milestones, completedUnits, totalUnits, actual, time, pending, status };
}

function renderProjects() {
  const grid = $("#projectGrid");
  const metrics = data.projects.map((project) => ({ project, ...projectMetrics(project) }));
  const pendingActions = metrics.reduce((sum, item) => sum + item.pending.length, 0);
  const risks = metrics.filter((item) => item.status === "risk" || item.status === "overdue").length;
  $("#projectDashboard").innerHTML = `<div><strong>${data.projects.length}</strong><span>进行中项目</span></div><div><strong>${pendingActions}</strong><span>待执行行动</span></div><div class="${risks ? "attention" : ""}"><strong>${risks}</strong><span>需要关注</span></div>`;
  if (!data.projects.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:50px 20px">还没有长期项目。先定义结果、期限和第一个里程碑。</div>';
    return;
  }
  const statusLabels = { done: "已完成", overdue: "已逾期", risk: "进度落后", steady: "按计划推进" };
  grid.innerHTML = metrics.map(({ project, milestones, completedUnits, totalUnits, actual, time, pending, status }) => `<article class="project-card ${project.color || "sage"} ${status}" data-project-id="${project.id}" style="--project-progress:${actual}%;--project-time:${time}%">
      <header><span class="project-status">${statusLabels[status]}</span><time>${project.due ? `目标 ${formatDate(project.due)}` : "持续项目"}</time></header>
      <h3>${escapeHTML(project.name)}</h3>
      <p class="goal">${escapeHTML(project.goal || "还没有定义清晰的完成结果。")}</p>
      <div class="project-progress-head"><span>计划节点完成率</span><strong>${actual}%</strong></div>
      <div class="project-progress"><i></i><b title="时间已消耗 ${time}%"></b></div>
      <div class="project-stats"><span>${completedUnits}/${totalUnits || 0} 个交付项完成</span><span>${project.due ? `时间已用 ${time}%` : "未设期限"}</span></div>
      <section class="project-milestones"><div class="project-section-title"><strong>里程碑</strong><span>${milestones.filter((item) => item.completed).length}/${milestones.length}</span></div>${milestones.length ? milestones.slice(0, 4).map((item) => `<button type="button" class="project-check-row ${item.completed ? "completed" : ""}" data-project-milestone="${item.id}" data-project-owner="${project.id}"><i>${item.completed ? "✓" : ""}</i><span>${escapeHTML(item.title)}</span><time>${item.due ? formatDate(item.due) : ""}</time></button>`).join("") : '<p class="project-empty-line">还没有里程碑</p>'}</section>
      <section class="project-actions-list"><div class="project-section-title"><strong>接下来可执行</strong><span>${pending.length} 项</span></div>${pending.length ? pending.slice(0, 3).map((task) => `<div class="project-action-row"><button type="button" class="project-action-check" data-project-task-complete="${task.id}" aria-label="完成${escapeHTML(task.title)}"></button><button type="button" class="project-action-open" data-task-id="${task.id}"><span>${escapeHTML(task.title)}</span><time>${task.due ? formatDate(task.due) : "未排期"}</time></button></div>`).join("") : '<p class="project-empty-line">没有可执行行动，项目会停在原地</p>'}</section>
      <div class="project-card-actions"><button type="button" class="project-next-button" data-project-next="${project.id}">＋ 添加行动</button><button type="button" class="project-edit-button" data-project-edit="${project.id}">编辑计划</button></div>
    </article>`).join("");
}

function renderCounts() {
  const active = data.tasks.filter((task) => !task.completed);
  $("#matrixCount").textContent = active.filter((task) => task.quadrant).length;
  $("#inboxCount").textContent = active.filter((task) => !task.quadrant).length;
  $("#todayCount").textContent = active.filter((task) => task.today || (task.due && task.due <= localISO())).length;
  $("#scheduleCount").textContent = data.courses.filter((course) => courseOccursOn(course, new Date())).length + active.filter((task) => task.due === localISO() || task.startDate === localISO()).length;
  $("#projectCount").textContent = data.projects.length;
  ["q1", "q2", "q3", "q4"].forEach((quadrant) => {
    $(`#mobile${quadrant.toUpperCase()}Count`).textContent = active.filter((task) => task.quadrant === quadrant).length;
  });
}

function dailyTipModel() {
  const today = localISO();
  const pending = data.tasks.filter((task) => !task.completed);
  const overdue = pending.filter((task) => task.due && task.due < today).sort((a, b) => a.due.localeCompare(b.due));
  const dueToday = pending.filter((task) => task.due === today).sort((a, b) => (a.dueTime || "23:59").localeCompare(b.dueTime || "23:59"));
  const urgentImportant = pending.find((task) => task.important && task.urgent && (task.today || !task.due || task.due <= today));
  const important = pending.find((task) => task.important && !task.urgent && (task.today || !task.due || task.due <= today));
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const courses = data.courses.map((course) => courseOccurrence(course, now)).filter(Boolean).sort((a, b) => a.startSection - b.startSection);
  const upcoming = courses.find((course) => {
    const slot = slotByNumber(course.startSection);
    if (!slot) return false;
    const [hour, minute] = slot.startTime.split(":").map(Number);
    return hour * 60 + minute >= minutesNow;
  });
  if (overdue.length) return { tone: "danger", badge: `${overdue.length} 项逾期`, title: `先收口：${overdue[0].title}`, text: "完成、改期或删去它，让旧节点不再占据注意力。", action: "处理逾期事项 →", view: "today" };
  if (dueToday.length) return { tone: "warning", badge: `${dueToday.length} 个 DDL`, title: dueToday[0].title, text: `${dueToday[0].dueTime ? `${dueToday[0].dueTime} 前完成。` : "今天截止。"}先留出完整时间块，再处理零碎消息。`, action: "查看今日节点 →", view: "today" };
  if (urgentImportant) return { tone: "danger", badge: "重要且紧急", title: urgentImportant.title, text: "这是今天最值得优先清空的一件事。", action: "开始处理 →", view: "today" };
  if (upcoming) return { tone: "course", badge: `${slotByNumber(upcoming.startSection)?.startTime || "稍后"} 上课`, title: upcoming.name, text: `${coursePlace(upcoming) || "地点待确认"} · 提前整理资料和出发时间。`, action: "打开今日课表 →", view: "schedule" };
  if (important) return { tone: "focus", badge: "今日推进", title: important.title, text: "没有临近节点时，最适合为长期重要的事情推进一步。", action: "查看重要事项 →", view: "today" };
  if (courses.length) return { tone: "course", badge: `${courses.length} 门课`, title: "今天的课程已经结束", text: "用十分钟整理课堂记录，未来会少一次重新理解。", action: "查看课表 →", view: "schedule" };
  return { tone: "calm", badge: "节奏清爽", title: "今天没有硬性节点", text: "给长期项目留一个不被打断的时间块，哪怕只推进三十分钟。", action: "选择下一项行动 →", view: "projects" };
}

function renderDailyTip() {
  const tip = dailyTipModel();
  $("#dailyTipCard").dataset.tone = tip.tone;
  $("#dailyTipBadge").textContent = tip.badge;
  $("#dailyTipTitle").textContent = tip.title;
  $("#dailyTipText").textContent = tip.text;
  $("#dailyTipAction").textContent = tip.action;
  $("#dailyTipAction").dataset.tipView = tip.view;
}

let dynamicEventsController;
function bindDynamicEvents() {
  dynamicEventsController?.abort();
  dynamicEventsController = new AbortController();
  const listen = (target, type, handler) => target.addEventListener(type, handler, { signal: dynamicEventsController.signal });
  $$('[data-focus-pin]').forEach((button) => listen(button, "click", (event) => {
    event.stopPropagation();
    const task = data.tasks.find((item) => item.id === button.dataset.focusPin);
    if (!task) return;
    task.focusPinned = !task.focusPinned;
    saveData();
    showToast(task.focusPinned ? "已固定到今日专注" : "已取消固定");
  }));
  $$('[data-focus-dismiss]').forEach((button) => listen(button, "click", (event) => {
    event.stopPropagation();
    const task = data.tasks.find((item) => item.id === button.dataset.focusDismiss);
    if (!task) return;
    task.focusDismissedDate = localISO();
    saveData();
    showToast("今天先不推荐这件事");
  }));
  $$('[data-inbox-reparse]').forEach((button) => listen(button, "click", (event) => { event.stopPropagation(); reparseInboxTask(button.dataset.inboxReparse); }));
  $$('[data-calendar-slot-date]').forEach((button) => listen(button, "click", () => {
    const start = button.dataset.calendarSlotTime;
    const endMinutes = timeMinutes(start) + 60;
    openTaskModal("", null, { type: "event", startDate: button.dataset.calendarSlotDate, startTime: start, endDate: button.dataset.calendarSlotDate, endTime: minutesLabel(endMinutes), reminderMinutes: 10 });
  }));
  $$('[data-calendar-all-day]').forEach((element) => listen(element, "click", (event) => {
    if (event.target.closest('[data-task-id]')) return;
    openTaskModal("", null, { type: "event", startDate: element.dataset.calendarAllDay });
  }));
  $$("[data-day-date]").forEach((button) => listen(button, "click", () => { displayedDay = button.dataset.dayDate; scheduleMode = "day"; renderAll(); }));
  $$("[data-calendar-date]").forEach((element) => listen(element, "click", (event) => {
    if (event.target.closest("[data-task-id], [data-course-id]") || event.currentTarget !== element) return;
    displayedDay = element.dataset.calendarDate;
    const selected = dateFromISO(displayedDay);
    displayedYear = selected.getFullYear();
    displayedMonth = selected.getMonth();
    displayedWeek = currentSemesterWeek(selected);
    scheduleMode = "day";
    localStorage.setItem("fangcun-schedule-mode", scheduleMode);
    renderAll();
  }));
  $$("[data-task-id]").forEach((element) => {
    listen(element, "click", (event) => {
      if (event.target.closest("[data-complete-id], [data-focus-pin], [data-focus-dismiss], [data-inbox-reparse]")) return;
      event.stopPropagation();
      openTaskModal(element.dataset.taskId);
    });
  });
  $$("[data-complete-id]").forEach((button) => {
    listen(button, "click", (event) => {
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true;
      toggleComplete(button.dataset.completeId, button.dataset.completeTo !== "false");
    });
  });
  $$(".task-card").forEach((card) => {
    listen(card, "dragstart", () => {
      card.classList.add("dragging");
      window.draggedTaskId = card.dataset.taskId;
    });
    listen(card, "dragend", () => card.classList.remove("dragging"));
  });
  $$("[data-project-id]").forEach((card) => listen(card, "click", (event) => {
    const milestoneButton = event.target.closest("[data-project-milestone]");
    if (milestoneButton) {
      event.stopPropagation();
      const project = data.projects.find((item) => item.id === milestoneButton.dataset.projectOwner);
      const milestone = project?.milestones.find((item) => item.id === milestoneButton.dataset.projectMilestone);
      if (milestone) { milestone.completed = !milestone.completed; milestone.completedAt = milestone.completed ? Date.now() : null; saveData(); }
      return;
    }
    const taskButton = event.target.closest("[data-project-task-complete]");
    if (taskButton) { event.stopPropagation(); toggleComplete(taskButton.dataset.projectTaskComplete, true); return; }
    const editButton = event.target.closest("[data-project-edit]");
    if (editButton) { event.stopPropagation(); openProjectModal(editButton.dataset.projectEdit); return; }
    const nextButton = event.target.closest("[data-project-next]");
    if (nextButton) {
      event.stopPropagation();
      const project = data.projects.find((item) => item.id === nextButton.dataset.projectNext);
      openTaskModal("", "q2", { projectId: project.id, important: true, urgent: false });
      return;
    }
    openProjectModal(card.dataset.projectId);
  }));
  $$("[data-course-id]").forEach((element) => {
    listen(element, "click", (event) => {
      event.stopPropagation();
      openCourseModal(element.dataset.courseId);
    });
    if (element.classList.contains("course-block")) {
      listen(element, "dragstart", (event) => {
        window.draggedCourseId = element.dataset.courseId;
        event.dataTransfer.effectAllowed = "move";
        element.classList.add("dragging");
      });
      listen(element, "dragend", () => element.classList.remove("dragging"));
    }
  });
  $$("[data-course-drop-day]").forEach((cell) => {
    listen(cell, "dragover", (event) => { event.preventDefault(); cell.classList.add("drag-over"); });
    listen(cell, "dragleave", () => cell.classList.remove("drag-over"));
    listen(cell, "drop", (event) => {
      event.preventDefault();
      cell.classList.remove("drag-over");
      const course = courseById(window.draggedCourseId);
      if (!course) return;
      const span = Math.max(0, data.timeSlots.findIndex((slot) => Number(slot.number) === Number(course.endSection)) - data.timeSlots.findIndex((slot) => Number(slot.number) === Number(course.startSection)));
      const startIndex = data.timeSlots.findIndex((slot) => Number(slot.number) === Number(cell.dataset.courseDropSection));
      course.day = Number(cell.dataset.courseDropDay);
      course.startSection = data.timeSlots[startIndex].number;
      course.endSection = data.timeSlots[Math.min(startIndex + span, data.timeSlots.length - 1)].number;
      saveData();
      showToast(`已将“${course.name}”调整到周${"一二三四五六日"[course.day - 1]}`);
    });
  });
}

function renderAll() {
  renderQuadrants();
  renderInbox();
  renderToday();
  if (activeView === "schedule") renderSchedule();
  renderProjects();
  renderCounts();
  renderDailyTip();
  renderProjectOptions();
  bindDynamicEvents();
}

function showToast(message) {
  const toast = $("#toast");
  const host = $$("dialog[open]").at(-1) || document.body;
  if (typeof host.appendChild === "function" && toast.parentElement !== host) host.appendChild(toast);
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function switchView(view) {
  if (!viewInfo[view] || !$(`#${view}View`)) view = "today";
  const enteringSchedule = view === "schedule" && activeView !== "schedule";
  activeView = view;
  const menuHost = view === "schedule" ? $(".week-toolbar") : $(".topbar");
  if (typeof menuHost.prepend === "function") menuHost.prepend($("#mobileMenu"));
  document.body.dataset.activeView = view;
  $$(".view").forEach((element) => element.classList.remove("active"));
  $(`#${view}View`).classList.add("active");
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$("[data-mobile-view]").forEach((button) => button.classList.toggle("active", button.dataset.mobileView === view));
  $("#pageTitle").textContent = viewInfo[view];
  $("#sidebar").classList.remove("open");
  $("#mobileMenu").setAttribute("aria-expanded", "false");
  const activePanel = $(`#${view}View`);
  if (activePanel) activePanel.scrollTop = 0;
  if (typeof window.scrollTo === "function") window.scrollTo({ top: 0, behavior: "smooth" });
  if (enteringSchedule) renderAll();
}

function selectMobileQuadrant(quadrant, scroll = true) {
  mobileQuadrant = quadrant;
  $$("[data-mobile-quadrant]").forEach((button) => button.classList.toggle("active", button.dataset.mobileQuadrant === quadrant));
  $$(".quadrant", $(".matrix-board")).forEach((panel) => panel.classList.toggle("mobile-active", panel.dataset.quadrant === quadrant));
  if (!scroll || !mediaMatches("(max-width: 720px) and (orientation: portrait)", window.innerWidth <= 720)) return;
  const board = $(".matrix-board");
  const target = $(`.quadrant[data-quadrant="${quadrant}"]`, board);
  if (target) board.scrollTo({ left: target.offsetLeft, behavior: "smooth" });
}

function updateMobileQuadrantFromScroll() {
  cancelAnimationFrame(matrixScrollFrame);
  matrixScrollFrame = requestAnimationFrame(() => {
    const board = $(".matrix-board");
    if (!mediaMatches("(max-width: 720px) and (orientation: portrait)", window.innerWidth <= 720)) return;
    const center = board.scrollLeft + board.clientWidth / 2;
    const nearest = $$(".quadrant", board).sort((a, b) => Math.abs(a.offsetLeft + a.offsetWidth / 2 - center) - Math.abs(b.offsetLeft + b.offsetWidth / 2 - center))[0];
    if (nearest?.dataset.quadrant && nearest.dataset.quadrant !== mobileQuadrant) selectMobileQuadrant(nearest.dataset.quadrant, false);
  });
}

function moveCalendar(direction) {
  if (scheduleMode === "year") displayedYear += direction;
  else if (scheduleMode === "month") {
    const shifted = new Date(displayedYear, displayedMonth + direction, 1, 12);
    displayedYear = shifted.getFullYear();
    displayedMonth = shifted.getMonth();
  } else if (scheduleMode === "day") {
    const shifted = addDays(dateFromISO(displayedDay), direction);
    displayedDay = localISO(shifted);
    displayedYear = shifted.getFullYear();
    displayedMonth = shifted.getMonth();
    displayedWeek = currentSemesterWeek(shifted);
  } else displayedWeek += direction;
  renderAll();
}

function returnCalendarToToday() {
  const now = new Date();
  displayedDay = localISO(now);
  displayedYear = now.getFullYear();
  displayedMonth = now.getMonth();
  displayedWeek = currentSemesterWeek(now);
  renderAll();
}

function updateDecisionUI() {
  ["important", "urgent"].forEach((type) => {
    const value = taskDecision[type];
    const root = $(`#${type}Segment`);
    $$(`button`, root).forEach((button) => button.classList.toggle("selected", value !== null && String(value) === button.dataset.value));
  });
  const quadrant = classify(taskDecision.important, taskDecision.urgent);
  const preview = $("#quadrantPreview");
  const info = quadrantInfo[quadrant];
  $("strong", preview).textContent = info ? info.name : "收集箱";
  preview.style.setProperty("--preview-color", info ? info.color : "var(--muted)");
}

function renderProjectOptions() {
  const select = $("#taskProject");
  const current = select.value;
  select.innerHTML = '<option value="">无项目</option>' + data.projects.map((project) => `<option value="${project.id}">${escapeHTML(project.name)}</option>`).join("");
  select.value = data.projects.some((project) => project.id === current) ? current : "";
  const courseSelect = $("#taskCourse");
  const currentCourse = courseSelect.value;
  courseSelect.innerHTML = '<option value="">无课程</option>' + data.courses.map((course) => `<option value="${course.id}">${escapeHTML(course.name)}</option>`).join("");
  courseSelect.value = data.courses.some((course) => course.id === currentCourse) ? currentCourse : "";
}

function openTaskModal(taskId = "", presetQuadrant = null, preset = {}) {
  const task = data.tasks.find((item) => item.id === taskId);
  $("#taskForm").reset();
  $("#taskId").value = task?.id || "";
  $("#taskTitle").value = task?.title || "";
  $("#taskNotes").value = task?.notes || "";
  $("#taskDue").value = task?.due || "";
  $("#taskDueTime").value = task?.dueTime || preset.dueTime || "";
  $("#taskStartDate").value = task?.startDate || preset.startDate || "";
  $("#taskStartTime").value = task?.startTime || preset.startTime || "";
  $("#taskEndDate").value = task?.endDate || preset.endDate || "";
  $("#taskEndTime").value = task?.endTime || preset.endTime || "";
  $("#taskLocation").value = task?.location || preset.location || "";
  $("#taskReminder").value = String(task?.reminderMinutes ?? preset.reminderMinutes ?? -1);
  $("#taskAlarmMode").checked = Boolean(task?.alarmMode || preset.alarmMode);
  $("#taskEstimate").value = task?.estimateMinutes || preset.estimateMinutes || "";
  $("#taskType").value = task?.type || preset.type || "task";
  $("#taskRepeat").value = task?.repeat || preset.repeat || "none";
  renderProjectOptions();
  $("#taskProject").value = task?.projectId || preset.projectId || "";
  $("#taskCourse").value = task?.courseId || preset.courseId || "";
  $("#taskDue").value = task?.due || preset.due || "";
  $("#taskTitle").value = task?.title || preset.title || "";
  $("#taskNotes").value = task?.notes || preset.notes || "";
  $("#taskToday").checked = Boolean(task?.today || preset.today);
  taskDecision = task ? { important: task.important, urgent: task.urgent } : preset.important !== undefined ? { important: preset.important ?? null, urgent: preset.urgent ?? null } : decisionForQuadrant(presetQuadrant);
  $("#modalEyebrow").textContent = task ? "编辑事项" : "新建事项";
  $("#modalTitle").textContent = task ? "调整下一步行动" : "把想法变成行动";
  $("#deleteTaskBtn").classList.toggle("hidden", !task);
  updateDecisionUI();
  $("#taskModal").showModal();
  setTimeout(() => $("#taskTitle").focus(), 40);
}

function saveTask(event) {
  event.preventDefault();
  const id = $("#taskId").value;
  const existing = data.tasks.find((task) => task.id === id);
  const values = {
    title: $("#taskTitle").value.trim(),
    notes: $("#taskNotes").value.trim(),
    due: $("#taskDue").value,
    dueTime: $("#taskDueTime").value,
    startDate: $("#taskStartDate").value,
    startTime: $("#taskStartTime").value,
    endDate: $("#taskEndDate").value,
    endTime: $("#taskEndTime").value,
    location: $("#taskLocation").value.trim(),
    reminderMinutes: Number($("#taskReminder").value),
    alarmMode: $("#taskAlarmMode").checked && Number($("#taskReminder").value) >= 0,
    estimateMinutes: Math.max(0, Number($("#taskEstimate").value) || 0),
    type: $("#taskType").value,
    repeat: $("#taskRepeat").value,
    courseId: $("#taskCourse").value,
    projectId: $("#taskProject").value,
    important: taskDecision.important,
    urgent: taskDecision.urgent,
    quadrant: classify(taskDecision.important, taskDecision.urgent),
    today: $("#taskToday").checked,
  };
  if (!values.title) return;
  if (values.startDate && values.startTime && values.endDate && values.endTime && new Date(`${values.endDate}T${values.endTime}`) < new Date(`${values.startDate}T${values.startTime}`)) return showToast("结束时间不能早于开始时间");
  if (existing) Object.assign(existing, values, { updatedAt: Date.now() });
  else data.tasks.unshift({ id: uid(), ...values, completed: false, createdAt: Date.now(), updatedAt: Date.now() });
  $("#taskModal").close();
  saveData();
  showToast(existing ? "事项已更新" : values.quadrant ? `已添加到“${quadrantInfo[values.quadrant].name}”` : "已保存到收集箱");
}

function deleteTask() {
  const id = $("#taskId").value;
  if (!id || !confirm("确定删除这件事项吗？")) return;
  data.tasks = data.tasks.filter((task) => task.id !== id);
  $("#taskModal").close();
  saveData();
  showToast("事项已删除");
}

function nextRepeatDate(task) {
  const base = task.due ? dateFromISO(task.due) : new Date();
  if (task.repeat === "daily") return localISO(addDays(base, 1));
  if (task.repeat === "weekly") return localISO(addDays(base, 7));
  if (task.repeat === "weekdays") {
    let next = addDays(base, 1);
    while (next.getDay() === 0 || next.getDay() === 6) next = addDays(next, 1);
    return localISO(next);
  }
  if (task.repeat === "monthly") {
    const day = base.getDate();
    const next = new Date(base.getFullYear(), base.getMonth() + 2, 0);
    next.setDate(Math.min(day, next.getDate()));
    return localISO(next);
  }
  return "";
}

function createNextOccurrence(task) {
  if (!task.repeat || task.repeat === "none" || task.nextOccurrenceId) return null;
  const nextId = uid();
  const nextTask = {
    ...task,
    id: nextId,
    due: nextRepeatDate(task),
    today: false,
    completed: false,
    completedAt: null,
    createdAt: Date.now(),
    recurrenceSourceId: task.id,
    nextOccurrenceId: null,
  };
  task.nextOccurrenceId = nextId;
  data.tasks.unshift(nextTask);
  return nextTask;
}

function toggleComplete(id, desiredState) {
  const task = data.tasks.find((item) => item.id === id);
  if (!task) return;
  const nextState = typeof desiredState === "boolean" ? desiredState : !task.completed;
  if (task.completed === nextState) return;
  task.completed = nextState;
  task.completedAt = task.completed ? Date.now() : null;
  const next = task.completed ? createNextOccurrence(task) : null;
  saveData();
  showToast(next ? `已完成，下一次安排在 ${formatDate(next.due)}` : task.completed ? "完成一件，做得好" : "事项已恢复");
}

function parseProjectLines(source) {
  return String(source || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const completed = /^\[x\]\s*/i.test(line);
    const clean = line.replace(/^\[[x ]\]\s*/i, "");
    const match = clean.match(/^(\d{4}-\d{2}-\d{2})\s*[|｜]\s*(.+)$/);
    return { title: (match ? match[2] : clean).trim(), due: match ? match[1] : "", completed };
  }).filter((item) => item.title);
}

function openProjectModal(projectId = "") {
  const project = data.projects.find((item) => item.id === projectId);
  $("#projectForm").reset();
  $("#projectId").value = project?.id || "";
  $("#projectName").value = project?.name || "";
  $("#projectGoal").value = project?.goal || "";
  $("#projectStart").value = project?.startDate || localISO();
  $("#projectDue").value = project?.due || "";
  $("#projectColor").value = project?.color || "sage";
  $("#projectMilestones").value = (project?.milestones || []).map((item) => `${item.completed ? "[x] " : ""}${item.due ? `${item.due} | ` : ""}${item.title}`).join("\n");
  $("#projectActions").value = "";
  $("#projectEyebrow").textContent = project ? "编辑项目" : "新建项目";
  $("#deleteProjectBtn").classList.toggle("hidden", !project);
  $("#projectModal").showModal();
  setTimeout(() => $("#projectName").focus(), 40);
}

function saveProject(event) {
  event.preventDefault();
  const id = $("#projectId").value;
  let existing = data.projects.find((project) => project.id === id);
  const wasExisting = Boolean(existing);
  const milestoneLines = parseProjectLines($("#projectMilestones").value);
  const values = { name: $("#projectName").value.trim(), goal: $("#projectGoal").value.trim(), startDate: $("#projectStart").value || localISO(), due: $("#projectDue").value, color: $("#projectColor").value };
  if (!values.name) return;
  if (values.due && values.due < values.startDate) return showToast("目标日期不能早于开始日期");
  if (existing) {
    const previous = existing.milestones || [];
    Object.assign(existing, values, { milestones: milestoneLines.map((item) => {
      const saved = previous.find((old) => old.title === item.title && old.due === item.due);
      return { id: saved?.id || uid(), title: item.title, due: item.due, completed: saved ? saved.completed : item.completed, completedAt: saved?.completedAt || null };
    }) });
  }
  else {
    existing = { id: uid(), ...values, milestones: milestoneLines.map((item) => ({ id: uid(), ...item, completedAt: item.completed ? Date.now() : null })), nextActionTaskId: "", createdAt: Date.now() };
    data.projects.unshift(existing);
  }
  const actions = parseProjectLines($("#projectActions").value);
  actions.forEach((action) => {
    const duplicate = data.tasks.some((task) => task.projectId === existing.id && !task.completed && task.title === action.title && task.due === action.due);
    if (!duplicate) data.tasks.unshift({ id: uid(), title: action.title, notes: "", due: action.due, dueTime: "", reminderMinutes: -1, projectId: existing.id, courseId: "", type: "task", repeat: "none", important: true, urgent: false, quadrant: "q2", today: false, completed: false, createdAt: Date.now() });
  });
  $("#projectModal").close();
  saveData();
  showToast(wasExisting ? `项目已更新${actions.length ? `，新增 ${actions.length} 项行动` : ""}` : `项目已建立：${milestoneLines.length} 个里程碑，${actions.length} 项行动`);
}

function deleteProject() {
  const id = $("#projectId").value;
  if (!id || !confirm("删除项目后，项目内的任务会保留但不再归属项目。确定继续吗？")) return;
  data.projects = data.projects.filter((project) => project.id !== id);
  data.tasks.forEach((task) => { if (task.projectId === id) task.projectId = ""; });
  $("#projectModal").close();
  saveData();
  showToast("项目已删除，原有任务已保留");
}

function submitQuickTask(event) {
  event.preventDefault();
  const input = $("#quickInput");
  const source = input.value.trim();
  if (!source) return input.focus();
  if (!globalThis.FangcunSmartParser) return showToast("智能识别组件尚未加载，请刷新页面");
  smartDrafts = globalThis.FangcunSmartParser.parseNaturalBatch(source, {
    now: new Date(),
    totalWeeks: data.semester.totalWeeks,
    projects: data.projects,
    courses: data.courses,
  });
  if (!smartDrafts.length) return showToast("还没有识别到可以添加的内容");
  if (quickDecision.touched) smartDrafts.filter((draft) => draft.kind === "task").forEach((draft) => {
    draft.important = quickDecision.important;
    draft.urgent = quickDecision.urgent;
  });
  $("#smartCaptureSource").textContent = source;
  renderSmartCapturePreview();
  $("#smartCaptureModal").showModal();
}

function smartDraftMeta(draft) {
  if (draft.kind === "course") return [
    `周${"一二三四五六日"[draft.day - 1]}`,
    `第 ${draft.startSection}–${draft.endSection} 节`,
    `${formatWeeks(draft.weeks)} 周`,
    [draft.campus, draft.location].filter(Boolean).join(" · "),
  ].filter(Boolean);
  if (draft.kind === "project") return [draft.due ? `目标 ${formatDate(draft.due)}` : "持续项目", draft.nextAction ? `下一步：${draft.nextAction}` : "稍后补充下一项行动"].filter(Boolean);
  const quadrant = classify(draft.important, draft.urgent);
  const scheduled = draft.startDate && draft.startTime
    ? `${formatDate(draft.startDate)} ${draft.startTime}${draft.endTime ? `–${draft.endTime}${draft.endDate && draft.endDate !== draft.startDate ? ` (${formatDate(draft.endDate)})` : ""}` : ""}`
    : "";
  return [
    scheduled,
    [draft.due ? formatDate(draft.due) : "", draft.dueTime].filter(Boolean).join(" "),
    quadrant ? quadrantInfo[quadrant].name : "收集箱",
    draft.repeat !== "none" ? ({ daily: "每天", weekdays: "工作日", weekly: "每周", monthly: "每月" }[draft.repeat]) : "",
    draft.reminderMinutes >= 0 ? (draft.reminderMinutes ? `提前 ${draft.reminderMinutes} 分钟提醒` : "准时提醒") : "",
  ].filter(Boolean);
}

function renderSmartCapturePreview() {
  const labels = { task: "事项", project: "长期项目", course: "课程" };
  const quadrantOptions = Object.entries(quadrantInfo).map(([value, info]) => `<option value="${value}">${escapeHTML(info.name)}</option>`).join("");
  const courseOptions = data.courses.map((course) => `<option value="${course.id}">${escapeHTML(course.name)}</option>`).join("");
  const projectOptions = data.projects.map((project) => `<option value="${project.id}">${escapeHTML(project.name)}</option>`).join("");
  $("#smartCapturePreview").innerHTML = smartDrafts.map((draft, index) => {
    const issues = draft.issues || [];
    const status = issues.length ? `${issues.length} 项待确认` : "可直接添加";
    const commonHeader = `<header><span>${labels[draft.kind] || "内容"}</span><em class="${issues.length ? "uncertain" : "resolved"}">${status}</em></header>${draft.timeSuggestion ? `<p class="smart-time-suggestion">建议安排：${escapeHTML(draft.startDate || draft.due || "")} ${escapeHTML(draft.startTime || draft.dueTime || "")}。原文“${escapeHTML(draft.timeSuggestion.label)}”${draft.timeSuggestion.rangeEnd && draft.timeSuggestion.rangeEnd !== draft.timeSuggestion.rangeStart ? `涵盖 ${escapeHTML(draft.timeSuggestion.rangeStart)} 至 ${escapeHTML(draft.timeSuggestion.rangeEnd)}` : "没有指定精确时刻"}，可修改，确认添加即采用建议。</p>` : ""}${draft.originalText ? `<details class="smart-original"><summary>查看原文 / 恢复标题</summary><p>${escapeHTML(draft.originalText)}</p><button type="button" class="secondary-button" data-smart-original="${index}">用原文作标题</button></details>` : ""}`;
    if (draft.kind === "task") {
      const quadrant = classify(draft.important, draft.urgent) || "";
      const isEvent = draft.type === "event";
      const typeOptions = Object.entries(taskTypeLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
      return `<article class="smart-preview-card ${issues.length ? "has-issues" : ""}" data-smart-index="${index}">${commonHeader}<div class="smart-field-grid">
        <label class="smart-field wide"><span>事项</span><input data-smart-field="title" value="${escapeHTML(draft.title)}" /></label>
        <label class="smart-field"><span>类型</span><select data-smart-field="type">${typeOptions}</select></label>
        ${isEvent ? `<label class="smart-field"><span>开始日期</span><input type="date" data-smart-field="startDate" value="${escapeHTML(draft.startDate || "")}" /></label><label class="smart-field"><span>开始时间</span><input type="time" data-smart-field="startTime" value="${escapeHTML(draft.startTime || "")}" /></label><label class="smart-field"><span>结束日期</span><input type="date" data-smart-field="endDate" value="${escapeHTML(draft.endDate || draft.startDate || "")}" /></label><label class="smart-field"><span>结束时间</span><input type="time" data-smart-field="endTime" value="${escapeHTML(draft.endTime || "")}" /></label><label class="smart-field"><span>地点</span><input data-smart-field="location" value="${escapeHTML(draft.location || "")}" placeholder="教室、会议室或地址" /></label>` : `<label class="smart-field"><span>日期 / DDL</span><input type="date" data-smart-field="due" value="${escapeHTML(draft.due || "")}" /></label><label class="smart-field"><span>时间</span><input type="time" data-smart-field="dueTime" value="${escapeHTML(draft.dueTime || "")}" /></label>`}
        <label class="smart-field"><span>优先级</span><select data-smart-field="quadrant"><option value="">待确认</option>${quadrantOptions}</select></label>
        <label class="smart-field"><span>预计时长</span><input type="number" min="0" step="5" data-smart-field="estimateMinutes" value="${draft.estimateMinutes || ""}" placeholder="分钟" /></label>
        <label class="smart-field"><span>关联课程</span><select data-smart-field="courseId"><option value="">无课程</option>${courseOptions}</select></label>
        <label class="smart-field"><span>关联项目</span><select data-smart-field="projectId"><option value="">无项目</option>${projectOptions}</select></label>
      </div><div class="smart-preview-meta">${smartDraftMeta(draft).map((item) => `<span>${escapeHTML(item)}</span>`).join("")}</div>${issues.length ? `<ul class="smart-issue-list">${issues.map((issue) => `<li>${escapeHTML(issue.message)}</li>`).join("")}</ul>` : ""}<script type="application/json" class="smart-selected-values">${JSON.stringify({ type: draft.type || "task", quadrant, courseId: draft.courseId || "", projectId: draft.projectId || "" }).replace(/</g, "\\u003c")}</script></article>`;
    }
    if (draft.kind === "project") return `<article class="smart-preview-card ${issues.length ? "has-issues" : ""}" data-smart-index="${index}">${commonHeader}<div class="smart-field-grid"><label class="smart-field wide"><span>项目名称</span><input data-smart-field="name" value="${escapeHTML(draft.name)}" /></label><label class="smart-field"><span>目标日期</span><input type="date" data-smart-field="due" value="${escapeHTML(draft.due || "")}" /></label><label class="smart-field wide"><span>第一项行动</span><input data-smart-field="nextAction" value="${escapeHTML(draft.nextAction || "")}" placeholder="写成一个能直接开始的动作" /></label></div>${issues.length ? `<ul class="smart-issue-list">${issues.map((issue) => `<li>${escapeHTML(issue.message)}</li>`).join("")}</ul>` : ""}</article>`;
    return `<article class="smart-preview-card ${issues.length ? "has-issues" : ""}" data-smart-index="${index}">${commonHeader}<div class="smart-field-grid"><label class="smart-field wide"><span>课程名称</span><input data-smart-field="name" value="${escapeHTML(draft.name)}" /></label><label class="smart-field"><span>星期</span><select data-smart-field="day">${[1,2,3,4,5,6,7].map((day) => `<option value="${day}" ${day === draft.day ? "selected" : ""}>周${"一二三四五六日"[day - 1]}</option>`).join("")}</select></label><label class="smart-field"><span>开始节次</span><input type="number" min="1" data-smart-field="startSection" value="${draft.startSection}" /></label><label class="smart-field"><span>结束节次</span><input type="number" min="1" data-smart-field="endSection" value="${draft.endSection}" /></label></div><div class="smart-preview-meta">${smartDraftMeta(draft).map((item) => `<span>${escapeHTML(item)}</span>`).join("")}</div>${issues.length ? `<ul class="smart-issue-list">${issues.map((issue) => `<li>${escapeHTML(issue.message)}</li>`).join("")}</ul>` : ""}</article>`;
  }).join("");
  $$(".smart-preview-card[data-smart-index]").forEach((card) => {
    const values = $(".smart-selected-values", card);
    if (!values) return;
    const selected = JSON.parse(values.textContent);
    Object.entries(selected).forEach(([field, value]) => { const control = $(`[data-smart-field="${field}"]`, card); if (control) control.value = value; });
  });
  const unresolved = smartDrafts.flatMap((draft) => draft.issues || []);
  $("#smartCaptureIssues").classList.toggle("hidden", !unresolved.length);
  $("#smartCaptureIssues").innerHTML = unresolved.length ? `<strong>只需确认 ${unresolved.length} 个字段</strong><span>${escapeHTML([...new Set(unresolved.map((issue) => issue.message))].join("；"))}</span>` : "";
  $("#editSmartCaptureBtn").classList.toggle("hidden", smartDrafts.length !== 1);
}

function updateSmartDraftField(event) {
  const control = event.target.closest("[data-smart-field]");
  const card = event.target.closest("[data-smart-index]");
  if (!control || !card) return;
  const draft = smartDrafts[Number(card.dataset.smartIndex)];
  const field = control.dataset.smartField;
  if (!draft) return;
  const previousValue = draft[field];
  if (field === "quadrant") {
    Object.assign(draft, decisionForQuadrant(control.value));
  } else if (["day", "startSection", "endSection", "estimateMinutes"].includes(field)) draft[field] = Math.max(0, Number(control.value) || 0);
  else draft[field] = control.value.trim();
  if (field === "title") draft.title = control.value.trim();
  if (field === "name") { draft.name = control.value.trim(); draft.title = draft.name; }
  if (field === "startDate" && (!draft.endDate || draft.endDate === previousValue)) {
    draft.endDate = draft.startDate;
    const endDateInput = card.querySelector('[data-smart-field="endDate"]');
    if (endDateInput) endDateInput.value = draft.endDate;
  }
  if (field === "type") {
    if (draft.type === "event" && !draft.startDate && draft.due) { draft.startDate = draft.due; draft.startTime = draft.dueTime; draft.due = ""; draft.dueTime = ""; }
    if (draft.type !== "event" && !draft.due && draft.startDate) { draft.due = draft.startDate; draft.dueTime = draft.startTime; }
  }
  const issueField = ["startSection", "endSection"].includes(field) ? "section" : field;
  const resolved = field === "quadrant" ? Boolean(control.value) : Boolean(control.value);
  if (resolved) draft.issues = (draft.issues || []).filter((issue) => issue.field !== issueField);
  draft.confidence = draft.issues?.length ? "needs-confirmation" : "high";
  if (field === "type") renderSmartCapturePreview();
}

function addSmartDraft(draft) {
  if (draft.kind === "course") {
    if (!slotByNumber(draft.startSection) || !slotByNumber(draft.endSection)) throw new Error(`课表还没有第 ${draft.endSection} 节，请先在学期设置中应用 13 节模板`);
    data.courses.push({ id: uid(), name: draft.name, code: draft.code || "", campus: draft.campus || "", teacher: draft.teacher || "", location: draft.location || "", day: draft.day, startSection: draft.startSection, endSection: draft.endSection, color: intelligentCourseColor(draft), colorAuto: true, weeks: draft.weeks, reminderMinutes: draft.reminderMinutes ?? 10, notes: draft.notes || "", createdAt: Date.now() });
    return;
  }
  if (draft.kind === "project") {
    const project = { id: uid(), name: draft.name, goal: draft.goal || "", startDate: localISO(), due: draft.due || "", color: draft.color || "sage", milestones: [], nextActionTaskId: "", createdAt: Date.now() };
    data.projects.unshift(project);
    if (draft.nextAction) {
      const task = { id: uid(), title: draft.nextAction, notes: "", due: "", dueTime: "", reminderMinutes: -1, projectId: project.id, courseId: "", type: "task", repeat: "none", important: true, urgent: false, quadrant: "q2", today: false, completed: false, createdAt: Date.now() };
      project.nextActionTaskId = task.id;
      data.tasks.unshift(task);
    }
    return;
  }
  const confirmationIssues = (draft.issues || []).filter((issue) => issue.field !== "timeSuggestion");
  draft.notes = draft.originalText ? [draft.notes, "原始输入：" + draft.originalText, draft.timeSuggestion ? "模糊时间：" + draft.timeSuggestion.label + "（已确认建议或修改后的时间）" : ""].filter(Boolean).join("\n") : draft.notes;
  const quadrant = confirmationIssues.length ? null : classify(draft.important ?? null, draft.urgent ?? null);
  data.tasks.unshift({ id: uid(), title: draft.title, notes: draft.notes || "", location: draft.location || "", originalText: draft.originalText || "", timeSuggestion: draft.timeSuggestion || null, due: draft.due || "", dueTime: draft.dueTime || "", startDate: draft.startDate || "", startTime: draft.startTime || "", endDate: draft.endDate || "", endTime: draft.endTime || "", reminderMinutes: draft.reminderMinutes ?? -1, estimateMinutes: draft.estimateMinutes || 0, projectId: draft.projectId || "", courseId: draft.courseId || "", type: draft.type || "task", repeat: draft.repeat || "none", important: draft.important ?? null, urgent: draft.urgent ?? null, quadrant, today: Boolean(draft.today), source: "natural-language", confirmationIssues, completed: false, createdAt: Date.now() });
}

function confirmSmartCapture(event) {
  event.preventDefault();
  if (smartDrafts.some((draft) => !String(draft.title || draft.name || "").trim())) return showToast("请填写事项标题");
  const invalidEnd = smartDrafts.some((draft) => draft.startDate && draft.startTime && draft.endTime && new Date((draft.endDate || draft.startDate) + "T" + draft.endTime) <= new Date(draft.startDate + "T" + draft.startTime));
  if (invalidEnd) return showToast("结束时间需要晚于开始时间，跨天日程请调整结束日期");
  const unavailableCourse = smartDrafts.find((draft) => draft.kind === "course" && (!slotByNumber(draft.startSection) || !slotByNumber(draft.endSection)));
  if (unavailableCourse) return showToast(`课表还没有第 ${unavailableCourse.endSection} 节，请先在学期设置中应用 13 节模板`);
  try {
    smartDrafts.forEach(addSmartDraft);
  } catch (error) {
    return showToast(error.message);
  }
  const count = smartDrafts.length;
  $("#smartCaptureModal").close();
  $("#quickInput").value = "";
  $("#mobileCaptureInput").value = "";
  smartDrafts = [];
  quickDecision = { important: false, urgent: false, touched: false };
  updateQuickButtons();
  saveData();
  showToast(count > 1 ? `已智能添加 ${count} 项` : "已按识别结果添加");
}

function editSmartCapture() {
  const draft = smartDrafts[0];
  if (!draft) return;
  $("#smartCaptureModal").close();
  if (draft.kind === "task") {
    openTaskModal("", null, { ...draft, notes: [draft.notes, draft.originalText ? "原始输入：" + draft.originalText : ""].filter(Boolean).join("\n") });
    return;
  }
  if (draft.kind === "project") {
    openProjectModal();
    $("#projectName").value = draft.name;
    $("#projectDue").value = draft.due || "";
    $("#projectActions").value = draft.nextAction || "";
    return;
  }
  openCourseModal();
  $("#courseName").value = draft.name;
  $("#courseCode").value = draft.code || "";
  $("#courseCampus").value = draft.campus || "";
  $("#courseTeacher").value = draft.teacher || "";
  $("#courseLocation").value = draft.location || "";
  $("#courseDay").value = String(draft.day);
  renderSectionOptions(draft.startSection, draft.endSection);
  $("#courseWeeks").value = formatWeeks(draft.weeks);
  $("#courseReminder").value = String(draft.reminderMinutes ?? 10);
}

function updateQuickButtons() {
  $("#quickImportant").setAttribute("aria-pressed", String(quickDecision.important));
  $("#quickUrgent").setAttribute("aria-pressed", String(quickDecision.urgent));
}

function renderSectionOptions(selectedStart = 1, selectedEnd = 1) {
  const options = data.timeSlots.map((slot) => `<option value="${slot.number}">第 ${slot.number} 节 · ${escapeHTML(slot.startTime)}–${escapeHTML(slot.endTime)}</option>`).join("");
  $("#courseStartSection").innerHTML = options;
  $("#courseEndSection").innerHTML = options;
  $("#courseStartSection").value = selectedStart;
  $("#courseEndSection").value = selectedEnd;
}

function renderCourseLinkedTasks(courseId) {
  const panel = $("#courseLinkedPanel");
  panel.classList.toggle("hidden", !courseId);
  if (!courseId) return;
  const tasks = data.tasks.filter((task) => task.courseId === courseId).sort((a, b) => Number(a.completed) - Number(b.completed) || (a.due || "9999-12-31").localeCompare(b.due || "9999-12-31"));
  $("#courseTaskCount").textContent = `${tasks.filter((task) => !task.completed).length} 项待完成`;
  $("#courseLinkedTasks").innerHTML = tasks.length ? tasks.map((task) => `<button type="button" class="course-linked-task ${task.completed ? "completed" : ""}" data-linked-task-id="${task.id}"><span>${taskTypeLabels[task.type] || "任务"}</span><strong>${escapeHTML(task.title)}</strong><time>${task.due ? `${formatDate(task.due)}${task.dueTime ? ` ${task.dueTime}` : ""}` : "未设置 DDL"}</time></button>`).join("") : '<div class="empty-state">还没有作业或考试，使用上方快捷按钮添加</div>';
}

function openCourseModal(courseId = "") {
  const course = courseById(courseId);
  $("#courseForm").reset();
  $("#courseId").value = course?.id || "";
  $("#courseName").value = course?.name || "";
  $("#courseCode").value = course?.code || "";
  $("#courseCampus").value = course?.campus || "";
  $("#courseTeacher").value = course?.teacher || "";
  $("#courseLocation").value = course?.location || "";
  $("#courseCredits").value = course?.credits || "";
  $("#courseLink").value = course?.link || "";
  $("#courseDay").value = course?.day || Math.min(new Date().getDay() || 7, data.semester.showWeekend ? 7 : 5);
  $("#courseColor").value = course?.colorAuto === false ? vividCourseColor(course.color, data.courses.length) : "auto";
  $("#courseReminder").value = String(course?.reminderMinutes ?? 10);
  $("#courseAlarmMode").checked = Boolean(course?.alarmMode);
  renderSectionOptions(course?.startSection || data.timeSlots[0]?.number || 1, course?.endSection || data.timeSlots[0]?.number || 1);
  $("#courseWeeks").value = course ? formatWeeks(course.weeks) : `1-${data.semester.totalWeeks}`;
  $("#courseNotes").value = course?.notes || "";
  $("#courseEyebrow").textContent = course ? "编辑课程" : "添加课程";
  $("#courseModalTitle").textContent = course ? course.name : "安排一门课程";
  $("#deleteCourseBtn").classList.toggle("hidden", !course);
  $("#duplicateCourseBtn").classList.toggle("hidden", !course);
  $("#courseTaskActions").classList.toggle("hidden", !course);
  renderCourseLinkedTasks(course?.id || "");
  const exception = course ? exceptionForWeek(course, displayedWeek) : null;
  $("#cancelOccurrenceBtn").textContent = exception?.type === "cancel" ? "恢复本周上课" : "本周停课";
  $("#rescheduleOccurrenceBtn").textContent = exception?.type === "reschedule" ? "恢复原时间" : "本周调课";
  $("#courseModal").showModal();
  setTimeout(() => $("#courseName").focus(), 40);
}

function saveCourse(event) {
  event.preventDefault();
  const id = $("#courseId").value;
  const existing = courseById(id);
  const weeks = parseWeeks($("#courseWeeks").value);
  const startIndex = data.timeSlots.findIndex((slot) => String(slot.number) === $("#courseStartSection").value);
  const endIndex = data.timeSlots.findIndex((slot) => String(slot.number) === $("#courseEndSection").value);
  if (!weeks.length) return showToast("请填写有效的上课周数");
  if (endIndex < startIndex) return showToast("结束节次不能早于开始节次");
  const values = {
    name: $("#courseName").value.trim(),
    code: $("#courseCode").value.trim(),
    campus: $("#courseCampus").value.trim(),
    teacher: $("#courseTeacher").value.trim(),
    location: $("#courseLocation").value.trim(),
    credits: $("#courseCredits").value,
    link: $("#courseLink").value.trim(),
    day: Number($("#courseDay").value),
    startSection: Number($("#courseStartSection").value),
    endSection: Number($("#courseEndSection").value),
    color: $("#courseColor").value === "auto" ? intelligentCourseColor({ name: $("#courseName").value.trim(), code: $("#courseCode").value.trim() }) : $("#courseColor").value,
    colorAuto: $("#courseColor").value === "auto",
    weeks,
    reminderMinutes: Number($("#courseReminder").value),
    alarmMode: $("#courseAlarmMode").checked && Number($("#courseReminder").value) >= 0,
    notes: $("#courseNotes").value.trim(),
  };
  if (!values.name) return;
  if (existing) Object.assign(existing, values);
  else data.courses.push({ id: uid(), ...values, createdAt: Date.now() });
  $("#courseModal").close();
  saveData();
  showToast(existing ? "课程已更新" : "课程已加入课表");
}

function duplicateCourseTime() {
  const course = courseById($("#courseId").value);
  if (!course) return;
  $("#courseModal").close();
  openCourseModal();
  $("#courseName").value = course.name;
  $("#courseCode").value = course.code || "";
  $("#courseCampus").value = course.campus || "";
  $("#courseTeacher").value = course.teacher || "";
  $("#courseLocation").value = course.location || "";
  $("#courseCredits").value = course.credits || "";
  $("#courseLink").value = course.link || "";
  $("#courseColor").value = course.colorAuto === false ? course.color : "auto";
  $("#courseReminder").value = String(course.reminderMinutes ?? 10);
  $("#courseAlarmMode").checked = Boolean(course.alarmMode);
  $("#courseWeeks").value = formatWeeks(course.weeks);
  $("#courseNotes").value = course.notes || "";
  $("#courseEyebrow").textContent = "同一课程 · 新时段";
  $("#courseModalTitle").textContent = `为“${course.name}”增加上课时段`;
}

function deleteCourse() {
  const id = $("#courseId").value;
  const course = courseById(id);
  if (!course || !confirm(`确定删除“${course.name}”吗？关联的作业会保留。`)) return;
  data.courses = data.courses.filter((item) => item.id !== id);
  data.courseExceptions = data.courseExceptions.filter((item) => item.courseId !== id);
  data.tasks.forEach((task) => { if (task.courseId === id) task.courseId = ""; });
  $("#courseModal").close();
  saveData();
  showToast("课程已删除，关联任务已保留");
}

function createTaskForCourse(type) {
  const courseId = $("#courseId").value;
  const course = courseById(courseId);
  if (!course) return;
  const labels = { assignment: "作业：", exam: "考试：", review: "复习：" };
  $("#courseModal").close();
  openTaskModal("", "q2", { type, courseId });
  $("#taskTitle").value = `${labels[type]}${course.name}`;
}

function toggleCurrentOccurrence() {
  const course = courseById($("#courseId").value);
  if (!course || !course.weeks.includes(displayedWeek)) return showToast("这门课在当前教学周没有安排");
  const date = localISO(addDays(weekStartDate(displayedWeek), course.day - 1));
  const existingIndex = data.courseExceptions.findIndex((item) => item.courseId === course.id && item.date === date);
  if (existingIndex >= 0 && data.courseExceptions[existingIndex].type === "cancel") {
    data.courseExceptions.splice(existingIndex, 1);
    showToast("已恢复本周课程");
  } else {
    if (existingIndex >= 0) data.courseExceptions.splice(existingIndex, 1);
    data.courseExceptions.push({ id: uid(), courseId: course.id, date, type: "cancel" });
    showToast("本周课程已标记停课");
  }
  $("#courseModal").close();
  saveData();
}

function rescheduleCurrentOccurrence() {
  const course = courseById($("#courseId").value);
  if (!course || !course.weeks.includes(displayedWeek)) return showToast("这门课在当前教学周没有安排");
  const date = localISO(addDays(weekStartDate(displayedWeek), course.day - 1));
  const existingIndex = data.courseExceptions.findIndex((item) => item.courseId === course.id && item.date === date);
  if (existingIndex >= 0 && data.courseExceptions[existingIndex].type === "reschedule") {
    data.courseExceptions.splice(existingIndex, 1);
    $("#courseModal").close();
    saveData();
    return showToast("本周课程已恢复原时间");
  }
  const day = Number(prompt("本周调整到星期几？请输入 1-7", course.day));
  if (!Number.isInteger(day) || day < 1 || day > 7) return showToast("星期输入无效");
  const sectionText = prompt(`调整到第几节？可输入单节或范围，例如 3 或 3-4`, `${course.startSection}-${course.endSection}`);
  if (sectionText === null) return;
  const match = sectionText.trim().match(/^(\d+)(?:\s*[-~]\s*(\d+))?$/);
  const startSection = match ? Number(match[1]) : 0;
  const endSection = match ? Number(match[2] || match[1]) : 0;
  if (!slotByNumber(startSection) || !slotByNumber(endSection) || endSection < startSection) return showToast("节次输入无效");
  if (existingIndex >= 0) data.courseExceptions.splice(existingIndex, 1);
  data.courseExceptions.push({ id: uid(), courseId: course.id, date, type: "reschedule", day, startSection, endSection });
  $("#courseModal").close();
  saveData();
  showToast("本周调课已保存");
}

function renderTimeSlotEditor() {
  $("#timeSlotEditor").innerHTML = semesterDraftSlots.map((slot, index) => `<div class="time-slot-row" data-slot-index="${index}"><span>第 ${index + 1} 节</span><input type="time" data-slot-start value="${escapeHTML(slot.startTime)}" aria-label="开始时间" /><input type="time" data-slot-end value="${escapeHTML(slot.endTime)}" aria-label="结束时间" /><button type="button" class="remove-slot" data-remove-slot="${index}" aria-label="删除节次">×</button></div>`).join("");
}

function dateRangeRules(start, end, name, type = "holiday") {
  const rules = [];
  for (let date = dateFromISO(start); localISO(date) <= end; date = addDays(date, 1)) rules.push({ id: uid(), date: localISO(date), type, name, useDay: 1, source: "2026-cn-official" });
  return rules;
}

function chinaHolidayRules2026() {
  const holidays = [
    ["2026-01-01", "2026-01-03", "元旦"], ["2026-02-15", "2026-02-23", "春节"],
    ["2026-04-04", "2026-04-06", "清明节"], ["2026-05-01", "2026-05-05", "劳动节"],
    ["2026-06-19", "2026-06-21", "端午节"], ["2026-09-25", "2026-09-27", "中秋节"],
    ["2026-10-01", "2026-10-07", "国庆节"],
  ].flatMap(([start, end, name]) => dateRangeRules(start, end, name));
  const workdays = [
    ["2026-01-04", "元旦调休上班"], ["2026-02-14", "春节调休上班"], ["2026-02-28", "春节调休上班"],
    ["2026-05-09", "劳动节调休上班"], ["2026-09-20", "国庆节调休上班"], ["2026-10-10", "国庆节调休上班"],
  ].map(([date, name]) => ({ id: uid(), date, type: "workday", name, useDay: 1, source: "2026-cn-official" }));
  return [...holidays, ...workdays];
}

function renderCalendarRules() {
  const labels = { holiday: "停课", teaching: "补课", workday: "调休上班" };
  const rules = [...data.calendarRules].sort((a, b) => a.date.localeCompare(b.date));
  $("#calendarRuleList").innerHTML = rules.length ? rules.map((rule) => `<article class="calendar-rule-item ${rule.type}"><div><strong>${formatDate(rule.date)} · ${escapeHTML(rule.name)}</strong><span>${labels[rule.type] || "规则"}${rule.type === "teaching" ? ` · 按周${"一二三四五六日"[Number(rule.useDay) - 1]}课表` : ""}</span></div><button type="button" data-delete-calendar-rule="${rule.id}">删除</button></article>`).join("") : '<div class="empty-state">尚未添加校历规则</div>';
}

function openCalendarRulesModal() {
  $("#calendarRuleForm").reset();
  $("#calendarRuleDate").value = localISO();
  $("#calendarUseDayField").classList.add("hidden");
  renderCalendarRules();
  $("#calendarRulesModal").showModal();
}

function saveCalendarRule(event) {
  event.preventDefault();
  const value = { id: uid(), date: $("#calendarRuleDate").value, type: $("#calendarRuleType").value, name: $("#calendarRuleName").value.trim(), useDay: Number($("#calendarRuleUseDay").value) };
  if (!value.date || !value.name) return;
  data.calendarRules = data.calendarRules.filter((rule) => rule.date !== value.date);
  data.calendarRules.push(value);
  saveData();
  renderCalendarRules();
  $("#calendarRuleName").value = "";
  showToast("校历规则已添加");
}

function importChinaHolidayPreset() {
  const incoming = chinaHolidayRules2026();
  const existingDates = new Set(data.calendarRules.map((rule) => rule.date));
  const additions = incoming.filter((rule) => !existingDates.has(rule.date));
  data.calendarRules.push(...additions);
  saveData();
  renderCalendarRules();
  showToast(`已导入 ${additions.length} 条 2026 节假日规则`);
}

function openSemesterModal() {
  $("#semesterName").value = data.semester.name;
  $("#semesterStart").value = data.semester.startDate;
  $("#semesterWeeks").value = data.semester.totalWeeks;
  $("#semesterWeekend").value = String(data.semester.showWeekend);
  semesterDraftSlots = data.timeSlots.map((slot) => ({ ...slot }));
  renderTimeSlotEditor();
  $("#semesterModal").showModal();
}

function saveSemester(event) {
  event.preventDefault();
  $$("[data-slot-index]").forEach((row) => {
    const index = Number(row.dataset.slotIndex);
    semesterDraftSlots[index].startTime = $("[data-slot-start]", row).value;
    semesterDraftSlots[index].endTime = $("[data-slot-end]", row).value;
  });
  if (!semesterDraftSlots.length || semesterDraftSlots.some((slot) => !slot.startTime || !slot.endTime || slot.startTime >= slot.endTime)) return showToast("请检查作息时间");
  data.semester = { name: $("#semesterName").value.trim(), startDate: $("#semesterStart").value, totalWeeks: Number($("#semesterWeeks").value), showWeekend: $("#semesterWeekend").value === "true" };
  data.timeSlots = semesterDraftSlots.map((slot, index) => ({ number: index + 1, startTime: slot.startTime, endTime: slot.endTime }));
  data.courses.forEach((course) => {
    course.startSection = Math.min(course.startSection, data.timeSlots.length);
    course.endSection = Math.min(Math.max(course.endSection, course.startSection), data.timeSlots.length);
    course.weeks = course.weeks.filter((week) => week <= data.semester.totalWeeks);
  });
  displayedWeek = currentSemesterWeek();
  $("#semesterModal").close();
  saveData();
  showToast("学期设置已保存");
}

function colorFromShiguang(value) {
  if (typeof value === "string" && value.startsWith("#")) return vividCourseColor(value);
  return COURSE_PALETTE[Math.abs(Number(value) || 0) % COURSE_PALETTE.length];
}

function importCourseSignature(course) {
  return `${String(course.name || "").trim().toLowerCase()}|${course.day}|${course.startSection}|${course.endSection}`;
}

function courseWeeksOverlap(first, second) {
  const weeks = new Set((first.weeks || []).map(Number));
  return (second.weeks || []).some((week) => weeks.has(Number(week)));
}

function courseTimesOverlap(first, second) {
  return Number(first.day) === Number(second.day) && Number(first.startSection) <= Number(second.endSection) && Number(second.startSection) <= Number(first.endSection) && courseWeeksOverlap(first, second);
}

function stageScheduleImport({ source, courses, timeSlots = data.timeSlots, semesterPatch = {}, existingSectionMap = null }) {
  const slots = Array.isArray(timeSlots) && timeSlots.length ? timeSlots : data.timeSlots;
  const comparisonCourses = data.courses.map((course) => existingSectionMap ? { ...course, startSection: existingSectionMap[course.startSection] || course.startSection, endSection: existingSectionMap[course.endSection] || course.endSection } : course);
  const staged = courses.map((course, index) => {
    const item = { ...course, importIndex: index };
    const startExists = slots.some((slot) => Number(slot.number) === Number(item.startSection));
    const endExists = slots.some((slot) => Number(slot.number) === Number(item.endSection));
    if (!item.name || item.day < 1 || item.day > 7 || !startExists || !endExists || Number(item.endSection) < Number(item.startSection)) {
      item.importStatus = "anomaly";
      item.importMessage = "星期或节次无效";
      return item;
    }
    const duplicate = comparisonCourses.find((existing) => importCourseSignature(existing) === importCourseSignature(item));
    if (duplicate) {
      item.importStatus = "duplicate";
      item.duplicateOf = duplicate.id;
      item.importMessage = `将与已有课程合并周次${item.importWarnings?.length ? `；${item.importWarnings.join("；")}` : ""}`;
      return item;
    }
    const conflict = [...comparisonCourses, ...courses.slice(0, index)].find((existing) => courseTimesOverlap(existing, item));
    item.importStatus = conflict ? "conflict" : "ready";
    item.importMessage = `${conflict ? `与“${conflict.name}”时间重叠` : "可导入"}${item.importWarnings?.length ? `；${item.importWarnings.join("；")}` : ""}`;
    return item;
  });
  pendingScheduleImport = { source, courses: staged, timeSlots: slots.map((slot) => ({ ...slot })), semesterPatch, existingSectionMap, batchId: `import-${Date.now().toString(36)}` };
  renderScheduleImportPreview();
}

function renderScheduleImportPreview() {
  const preview = $("#scheduleImportPreview");
  if (!pendingScheduleImport) return preview.classList.add("hidden");
  const labels = { ready: "可导入", duplicate: "重复", conflict: "冲突", anomaly: "异常" };
  const counts = pendingScheduleImport.courses.reduce((result, course) => { result[course.importStatus] = (result[course.importStatus] || 0) + 1; return result; }, {});
  preview.classList.remove("hidden");
  preview.innerHTML = `<header><div><span class="eyebrow">${escapeHTML(pendingScheduleImport.source)} 预览</span><strong>${pendingScheduleImport.courses.length} 门课程</strong></div><div class="import-preview-counts"><span>${counts.ready || 0} 可导入</span><span class="warning">${counts.conflict || 0} 冲突</span><span>${counts.duplicate || 0} 重复</span><span class="danger">${counts.anomaly || 0} 异常</span></div></header><div class="import-preview-list">${pendingScheduleImport.courses.slice(0, 30).map((course) => `<article class="${course.importStatus}"><i></i><div><strong>${escapeHTML(course.name)}</strong><span>周${"一二三四五六日"[course.day - 1] || "?"} · 第 ${course.startSection}–${course.endSection} 节 · ${escapeHTML(formatWeeks(course.weeks || []))} 周</span></div><em>${labels[course.importStatus]} · ${escapeHTML(course.importMessage)}</em></article>`).join("")}</div>${pendingScheduleImport.courses.length > 30 ? `<p>另有 ${pendingScheduleImport.courses.length - 30} 门课程未展开显示。</p>` : ""}<footer><span>异常项不会写入；重复项合并周次；冲突项保留并明确标记。</span><button type="button" class="primary-button" id="confirmScheduleImportBtn">确认导入</button></footer>`;
}

function confirmScheduleImport() {
  if (!pendingScheduleImport) return;
  const snapshot = { courses: data.courses.map((course) => ({ ...course, weeks: [...(course.weeks || [])] })), semester: { ...data.semester }, timeSlots: data.timeSlots.map((slot) => ({ ...slot })) };
  Object.assign(data.semester, pendingScheduleImport.semesterPatch || {});
  if (pendingScheduleImport.existingSectionMap) data.courses.forEach((course) => {
    course.startSection = pendingScheduleImport.existingSectionMap[course.startSection] || course.startSection;
    course.endSection = pendingScheduleImport.existingSectionMap[course.endSection] || course.endSection;
  });
  data.timeSlots = pendingScheduleImport.timeSlots.map((slot) => ({ ...slot }));
  let added = 0;
  let merged = 0;
  pendingScheduleImport.courses.filter((course) => course.importStatus !== "anomaly").forEach((course) => {
    if (course.duplicateOf) {
      const existing = courseById(course.duplicateOf);
      if (existing) existing.weeks = [...new Set([...(existing.weeks || []), ...(course.weeks || [])])].sort((a, b) => a - b);
      merged += 1;
      return;
    }
    const { importIndex, importStatus, importMessage, duplicateOf, ...values } = course;
    data.courses.push({ id: uid(), ...values, importBatchId: pendingScheduleImport.batchId, importConflict: importStatus === "conflict", createdAt: Date.now() });
    added += 1;
  });
  data.settings.lastScheduleImportUndo = { batchId: pendingScheduleImport.batchId, snapshot, createdAt: Date.now() };
  const source = pendingScheduleImport.source;
  pendingScheduleImport = null;
  $("#cloudModal").close();
  saveData();
  showToast(`${source} 导入完成：新增 ${added}，合并 ${merged}`);
}

function undoScheduleImport() {
  const undo = data.settings.lastScheduleImportUndo;
  if (!undo?.snapshot) return showToast("没有可撤销的课表导入");
  data.courses = undo.snapshot.courses;
  data.semester = undo.snapshot.semester;
  data.timeSlots = undo.snapshot.timeSlots;
  delete data.settings.lastScheduleImportUndo;
  saveData();
  showToast("已撤销上次课表导入");
}

function importShiguang(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.courses)) throw new Error("缺少 courses");
      const proposedSlots = Array.isArray(imported.timeSlots) && imported.timeSlots.length ? imported.timeSlots.map((slot, index) => ({ number: Number(slot.number) || index + 1, startTime: slot.startTime, endTime: slot.endTime })) : data.timeSlots;
      const semesterPatch = imported.config ? { startDate: imported.config.semesterStartDate || data.semester.startDate, totalWeeks: Number(imported.config.semesterTotalWeeks) || data.semester.totalWeeks } : {};
      const courses = imported.courses.map((course) => {
        const normalized = { name: String(course.name || "未命名课程"), code: String(course.code || ""), campus: String(course.campus || ""), teacher: String(course.teacher || ""), location: String(course.position || course.location || ""), day: Number(course.day), startSection: Number(course.startSection), endSection: Number(course.endSection), color: colorFromShiguang(course.color), weeks: (course.weeks || []).map(Number).filter(Boolean), reminderMinutes: Number.isFinite(Number(course.reminderMinutes)) ? Number(course.reminderMinutes) : 10, notes: String(course.notes || "由课表 JSON 导入") };
        if (!normalized.weeks.length) normalized.weeks = Array.from({ length: semesterPatch.totalWeeks || data.semester.totalWeeks }, (_, index) => index + 1);
        return normalized;
      });
      stageScheduleImport({ source: "拾光 JSON", courses, timeSlots: proposedSlots, semesterPatch });
    } catch (error) {
      showToast(`导入失败：${error.message}`);
    }
    event.target.value = "";
  };
  reader.readAsText(file);
}

async function importWordSchedule(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (/\.doc$/i.test(file.name) && !/\.docx$/i.test(file.name)) {
      const preview = $("#scheduleImportPreview");
      preview.classList.remove("hidden");
      preview.innerHTML = '<header><div><span class="eyebrow">Word 课表</span><strong>这是旧版 .doc 文件</strong></div></header><div class="import-format-help"><strong>请先在 WPS 或 Word 中另存为 DOCX</strong><span>操作：文件 → 另存为 → Word 文档（.docx）。旧版 DOC 是二进制格式，浏览器无法可靠读取，方寸不会冒险猜错课表。</span></div>';
      return;
    }
    if (!globalThis.DocxScheduleParser) throw new Error("Word 解析模块没有加载，请刷新页面后重试");
    showToast("正在本机读取 Word 课表…");
    const parsed = await globalThis.DocxScheduleParser.parseDocx(await file.arrayBuffer(), { totalWeeks: data.semester.totalWeeks });
    if (!parsed.courses.length) throw new Error(parsed.warnings.join("；") || "没有识别到课程");
    const proposedSlots = data.timeSlots.map((slot) => ({ ...slot }));
    parsed.timeSlots.forEach((slot) => {
      const existing = proposedSlots.find((item) => Number(item.number) === Number(slot.number));
      if (existing) Object.assign(existing, slot);
      else proposedSlots.push(slot);
    });
    proposedSlots.sort((a, b) => Number(a.number) - Number(b.number));
    const warning = parsed.warnings.filter(Boolean);
    const courses = parsed.courses.map((course) => ({ ...course, importWarnings: [...(course.importWarnings || []), ...warning], notes: `${course.notes || "由 Word DOCX 课表导入"}${warning.length ? `；${warning.join("；")}` : ""}` }));
    stageScheduleImport({ source: "Word DOCX", courses, timeSlots: proposedSlots });
  } catch (error) {
    const preview = $("#scheduleImportPreview");
    preview.classList.remove("hidden");
    preview.innerHTML = `<header><div><span class="eyebrow">Word 课表</span><strong>没有完成导入</strong></div></header><div class="import-format-help error"><strong>${escapeHTML(error.message)}</strong><span>请确认文件是 DOCX，表格中包含“星期一…星期日”和“第 1 节”一类表头。若学校导出的版式不同，请保留原文件作为适配样本。</span></div>`;
  } finally {
    event.target.value = "";
  }
}

function downloadFile(content, filename, type) {
  if (typeof window.FangcunNative?.saveDocument === "function") {
    window.FangcunNative.saveDocument(filename, type.split(";")[0], content);
    showToast("请选择文件保存位置");
    return;
  }
  if (isNativeAndroid()) return showToast("当前 APK 不支持文件保存，请安装本次新版 APK");
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  showToast("已发起下载，请在浏览器下载列表中查看");
}

window.FangcunDocumentSaved = (error) => showToast(error || "文件已保存到所选位置");

function exportScheduleJson() {
  const payload = { courses: data.courses.map((course) => ({ id: course.id, name: course.name, code: course.code, campus: course.campus, teacher: course.teacher, position: course.location, day: course.day, startSection: course.startSection, endSection: course.endSection, color: course.color, weeks: course.weeks, reminderMinutes: course.reminderMinutes, notes: course.notes })), timeSlots: data.timeSlots, config: { semesterStartDate: data.semester.startDate, semesterTotalWeeks: data.semester.totalWeeks } };
  downloadFile(JSON.stringify(payload, null, 2), `方寸课表-${localISO()}.json`, "application/json");
}

function icsEscape(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsDateTime(date, time) {
  return `${localISO(date).replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function exportIcs() {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fangcun//Schedule//ZH", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-TIMEZONE:Asia/Shanghai"];
  data.courses.forEach((course) => {
    const startSlot = slotByNumber(course.startSection);
    const endSlot = slotByNumber(course.endSection);
    if (!startSlot || !endSlot) return;
    course.weeks.forEach((week) => {
      const date = addDays(weekStartDate(week), course.day - 1);
      if (data.courseExceptions.some((item) => item.courseId === course.id && item.date === localISO(date) && item.type === "cancel")) return;
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
      lines.push("BEGIN:VEVENT", `UID:${course.id}-${week}@fangcun`, `DTSTAMP:${stamp}`, `DTSTART;TZID=Asia/Shanghai:${icsDateTime(date, startSlot.startTime)}`, `DTEND;TZID=Asia/Shanghai:${icsDateTime(date, endSlot.endTime)}`, `SUMMARY:${icsEscape(course.name)}`, `LOCATION:${icsEscape(coursePlace(course))}`, `DESCRIPTION:${icsEscape([course.code, course.teacher, course.notes].filter(Boolean).join(" · "))}`, "END:VEVENT");
    });
  });
  lines.push("END:VCALENDAR");
  downloadFile(lines.join("\r\n"), `方寸课表-${localISO()}.ics`, "text/calendar;charset=utf-8");
}

function renderCalendarSubscription(subscription = {}) {
  const status = $("#calendarSubscriptionStatus");
  const createButton = $("#createCalendarSubscriptionBtn");
  const copyButton = $("#copyCalendarSubscriptionBtn");
  const revokeButton = $("#revokeCalendarSubscriptionBtn");
  const urlRow = $("#calendarSubscriptionUrlRow");
  const urlInput = $("#calendarSubscriptionUrl");
  if (!status || !createButton) return;
  const savedUrl = localStorage.getItem(accountKey(CALENDAR_SUBSCRIPTION_URL_KEY)) || "";
  if (!syncState.authenticated) {
    status.textContent = "请先登录云端账号，再生成属于你的只读订阅链接。";
    createButton.disabled = true;
    copyButton.classList.add("hidden");
    revokeButton.classList.add("hidden");
    urlRow.classList.add("hidden");
    return;
  }
  createButton.disabled = false;
  createButton.textContent = subscription.enabled ? "重新生成链接" : "生成订阅链接";
  status.textContent = subscription.enabled
    ? `订阅已启用${subscription.lastAccessAt ? ` · 最近读取 ${formatSyncTime(subscription.lastAccessAt)}` : " · 尚未被日历读取"}${savedUrl ? "" : " · 本机未保存原链接，如需添加新设备请重新生成"}`
    : "尚未启用；生成后可添加到 Google 日历或 Outlook。";
  revokeButton.classList.toggle("hidden", !subscription.enabled);
  copyButton.classList.toggle("hidden", !savedUrl);
  urlRow.classList.toggle("hidden", !savedUrl);
  urlInput.value = savedUrl;
}

async function loadCalendarSubscription() {
  if (!syncState.authenticated) return renderCalendarSubscription();
  try { renderCalendarSubscription(await apiRequest("/api/calendar/subscription")); }
  catch { renderCalendarSubscription(); }
}

async function createCalendarSubscription() {
  if (!syncState.authenticated) return showAuthGate();
  if (localStorage.getItem(accountKey(CALENDAR_SUBSCRIPTION_URL_KEY)) && !confirm("重新生成后，旧日历链接会立即失效，需要在手机和电脑日历中替换。是否继续？")) return;
  try {
    const result = await apiRequest("/api/calendar/subscription", { method: "POST", body: "{}" });
    localStorage.setItem(accountKey(CALENDAR_SUBSCRIPTION_URL_KEY), result.url);
    renderCalendarSubscription(result);
    showToast("订阅链接已生成，请复制到日历应用");
  } catch (error) { showToast(error.message); }
}

async function copyCalendarSubscription() {
  const input = $("#calendarSubscriptionUrl");
  if (!input?.value) return;
  try { await navigator.clipboard.writeText(input.value); }
  catch { input.select(); document.execCommand("copy"); }
  showToast("订阅链接已复制");
}

async function revokeCalendarSubscription() {
  if (!confirm("撤销后，手机和电脑日历将无法继续刷新这份方寸日历。是否继续？")) return;
  try {
    await apiRequest("/api/calendar/subscription", { method: "DELETE" });
    localStorage.removeItem(accountKey(CALENDAR_SUBSCRIPTION_URL_KEY));
    renderCalendarSubscription({ enabled: false });
    showToast("订阅链接已撤销");
  } catch (error) { showToast(error.message); }
}

const integrationUI = {
  outlook: { name: "Outlook", suffix: "Outlook", status: null, busy: false },
  google: { name: "Google", suffix: "Google", status: null, busy: false },
};
let externalProvider = "";
function integrationFeedback(provider, message, error = false) {
  const detail = $("#" + provider + "SyncDetail");
  detail.textContent = message;
  detail.classList.remove("hidden");
  detail.classList.toggle("error", error);
  detail.setAttribute("role", error ? "alert" : "status");
}
function renderIntegrationStatus(provider, status = {}) {
  const ui = integrationUI[provider];
  ui.status = status;
  const label = $("#" + provider + "IntegrationStatus");
  const connect = $("#connect" + ui.suffix + "Btn");
  const sync = $("#sync" + ui.suffix + "Btn");
  const disconnect = $("#disconnect" + ui.suffix + "Btn");
  const connected = Boolean(status.connected && syncState.authenticated);
  connect.classList.toggle("hidden", connected);
  sync.classList.toggle("hidden", !connected);
  disconnect.classList.toggle("hidden", !connected);
  connect.disabled = sync.disabled = disconnect.disabled = ui.busy;
  if (!syncState.authenticated) {
    label.textContent = "需要先登录方寸账号，再连接自己的 " + ui.name + " 账号。";
    connect.textContent = "查看登录要求";
  } else if (status.error) {
    label.textContent = "暂时无法检查连接状态";
    connect.textContent = "重试检查";
    integrationFeedback(provider, status.error, true);
  } else if (!status.configured) {
    label.textContent = ui.name + " 尚未配置，点击查看需要的配置；账号同步与文件备份仍可用。";
    connect.textContent = "查看配置要求";
  } else if (!connected) {
    label.textContent = "连接后使用独立的“方寸”日历，支持新增、修改、删除和提醒双向同步。";
    connect.textContent = "连接 " + ui.name;
  } else {
    label.textContent = "已连接 " + (status.account || ui.name + " 账号") + " · 自动每 " + (status.intervalMinutes || 5) + " 分钟同步";
    sync.textContent = "立即同步";
    integrationFeedback(provider, status.lastError ? "最近同步异常：" + status.lastError : status.lastSyncAt ? formatSyncTime(status.lastSyncAt) + " · 在 " + ui.name + " 的“方寸”日历中编辑" : "连接成功，尚未执行首次同步。", Boolean(status.lastError));
  }
}
function renderOutlookStatus(status = {}) { renderIntegrationStatus("outlook", status); }
function renderGoogleStatus(status = {}) { renderIntegrationStatus("google", status); }
async function loadIntegrationStatus(provider) {
  const ui = integrationUI[provider];
  if (ui.busy) return;
  if (!syncState.authenticated) return renderIntegrationStatus(provider, {});
  ui.busy = true;
  const connect = $("#connect" + ui.suffix + "Btn");
  connect.disabled = true;
  connect.textContent = "检查中…";
  $("#sync" + ui.suffix + "Btn").disabled = $("#disconnect" + ui.suffix + "Btn").disabled = true;
  $("#" + provider + "IntegrationStatus").textContent = "正在检查账号连接状态…";
  try {
    const status = await apiRequest("/api/integrations/" + provider + "/status");
    ui.busy = false;
    renderIntegrationStatus(provider, status);
  } catch (error) {
    ui.busy = false;
    renderIntegrationStatus(provider, { error: error.message });
  }
}
async function loadOutlookStatus() { return loadIntegrationStatus("outlook"); }
async function loadGoogleStatus() { return loadIntegrationStatus("google"); }

async function runIntegrationAction(provider, action) {
  const ui = integrationUI[provider];
  if (ui.busy) return;
  if (!syncState.authenticated) return integrationFeedback(provider, "请先在“方寸账号”页登录，再回来连接日历。", true);
  if (action === "connect" && ui.status?.error) return loadIntegrationStatus(provider);
  if (action === "connect" && !ui.status?.configured) {
    const variables = provider === "outlook" ? "MICROSOFT_CLIENT_ID、MICROSOFT_CLIENT_SECRET、MICROSOFT_TENANT、MICROSOFT_REDIRECT_URI" : "GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、GOOGLE_REDIRECT_URI";
    return integrationFeedback(provider, "需要管理员在服务器 /etc/fangcun.env 配置 " + variables + "，重启服务后重新打开本页检查。密钥不要填进聊天或前端。", true);
  }
  if (syncState.syncing || syncState.reconciling || syncState.pulling || syncState.integrationSyncing) return integrationFeedback(provider, "另一项同步正在进行，请完成后重试。");
  if (action === "sync" && (syncState.conflict || syncMeta().needsChoice)) return integrationFeedback(provider, "本机与云端版本尚未确认，请先在“方寸账号”页选择保留版本。", true);
  if (action === "disconnect" && !confirm("断开 " + ui.name + " 双向同步？外部现有的“方寸”日历会保留。")) return;
  const button = $("#" + (action === "connect" ? "connect" : action === "sync" ? "sync" : "disconnect") + ui.suffix + "Btn");
  const originalLabel = button.textContent;
  ui.busy = true;
  $("#connect" + ui.suffix + "Btn").disabled = $("#sync" + ui.suffix + "Btn").disabled = $("#disconnect" + ui.suffix + "Btn").disabled = true;
  button.textContent = action === "sync" ? "同步中…" : action === "connect" ? "连接中…" : "断开中…";
  integrationFeedback(provider, action === "sync" ? "正在同步本机与 " + ui.name + "，请稍候；完成后这里会显示结果。" : "正在处理 " + ui.name + " 请求…");
  const account = currentUser?.id;
  let ownsSync = false;
  try {
    if (action === "connect") {
      const result = await apiRequest("/api/integrations/" + provider + "/connect", { method: "POST", body: JSON.stringify({ source: isNativeAndroid() ? "android" : "web" }) });
      const url = new URL(result.authUrl);
      const allowed = provider === "google" ? url.hostname === "accounts.google.com" : url.hostname === "login.microsoftonline.com" || url.hostname.endsWith(".microsoftonline.com");
      if (url.protocol !== "https:" || !allowed) throw new Error("服务器返回了无效的授权地址，请检查日历配置");
      externalProvider = provider;
      integrationFeedback(provider, "正在打开系统浏览器完成授权；返回后可再次点击连接。");
      if (isNativeAndroid() && typeof window.FangcunNative.openExternal === "function") window.FangcunNative.openExternal(url.href);
      else location.assign(url.href);
    } else if (action === "disconnect") {
      await apiRequest("/api/integrations/" + provider, { method: "DELETE" });
      renderIntegrationStatus(provider, { configured: true, connected: false });
      integrationFeedback(provider, "已断开；外部日历仍保留。");
    } else {
      if (syncMeta().dirty && !(await syncToCloud())) throw new Error(syncState.lastError || "请先完成方寸账号同步");
      syncState.integrationSyncing = true; ownsSync = true;
      renderCloudPanel();
      clearTimeout(syncTimer);
      const before = JSON.stringify(data);
      const result = await apiRequest("/api/integrations/" + provider + "/sync", { method: "POST", body: "{}", timeoutMs: 60000 });
      const remote = await fetchCloudState();
      if (currentUser?.id !== account || !syncState.authenticated) return;
      if (JSON.stringify(data) !== before || syncMeta().dirty) {
        syncState.conflict = true;
        updateSyncMeta({ needsChoice: true });
        integrationFeedback(provider, ui.name + " 已处理请求，但期间本机有新修改，未覆盖本机；请到“方寸账号”页确认版本。", true);
        renderCloudPanel();
      } else {
        if (remote.data) applyCloudData(remote);
        integrationFeedback(provider, "同步完成 · 上传 " + (result.stats?.pushed || 0) + " · 拉取 " + (result.stats?.pulled || 0) + " · 导入 " + (result.stats?.imported || 0) + " · " + new Date().toLocaleTimeString("zh-CN"));
      }
    }
  } catch (error) {
    integrationFeedback(provider, error.message + "。本机内容已保留，可以重试。" + (error.message.includes("超时") ? "超时不代表服务器已撤销操作。" : ""), true);
  } finally {
    ui.busy = false;
    if (ownsSync) { syncState.integrationSyncing = false; renderCloudPanel(); }
    $("#connect" + ui.suffix + "Btn").disabled = $("#sync" + ui.suffix + "Btn").disabled = $("#disconnect" + ui.suffix + "Btn").disabled = false;
    button.textContent = originalLabel;
  }
}
async function connectOutlook() { return runIntegrationAction("outlook", "connect"); }
async function syncOutlookNow() { return runIntegrationAction("outlook", "sync"); }
async function disconnectOutlook() { return runIntegrationAction("outlook", "disconnect"); }
async function connectGoogle() { return runIntegrationAction("google", "connect"); }
async function syncGoogleNow() { return runIntegrationAction("google", "sync"); }
async function disconnectGoogle() { return runIntegrationAction("google", "disconnect"); }
window.FangcunExternalOpened = (error) => {
  if (externalProvider) integrationFeedback(externalProvider, error || "已打开浏览器，请完成授权后返回方寸。", Boolean(error));
};

async function handleCalendarReturn() {
  if (typeof URLSearchParams === "undefined" || typeof history === "undefined") return;
  const params = new URLSearchParams(location.search);
  const outlookState = params.get("outlook");
  const googleState = params.get("google");
  if (!outlookState && !googleState) return;
  const message = params.get("message");
  history.replaceState(null, "", `${location.pathname}${location.hash}`);
  if (outlookState === "connected") {
    showToast("Outlook 已授权，正在执行首次双向同步…");
    await loadOutlookStatus();
    await syncOutlookNow();
  } else if (outlookState) showToast(message || "Outlook 授权失败，请重试");
  if (googleState === "connected") {
    showToast("Google 已授权，正在执行首次双向同步…");
    await loadGoogleStatus();
    await syncGoogleNow();
  } else if (googleState) showToast(message || "Google 授权失败，请重试");
}

function parseIcsDate(value) {
  const match = String(value).match(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0));
}

function importIcs(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result).replace(/\r?\n[ \t]/g, "");
      const baseEvents = [...text.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)].map((match) => {
        const lines = match[1].split(/\r?\n/).filter(Boolean);
        const get = (name) => lines.find((line) => line.split(":")[0].split(";")[0] === name)?.slice(lines.find((line) => line.split(":")[0].split(";")[0] === name).indexOf(":") + 1) || "";
        return { start: parseIcsDate(get("DTSTART")), end: parseIcsDate(get("DTEND")), rrule: get("RRULE"), name: get("SUMMARY").replace(/\\([,;n\\])/g, (_, char) => char === "n" ? "\n" : char), location: get("LOCATION").replace(/\\([,;n\\])/g, "$1") };
      }).filter((item) => item.start && item.end);
      const events = baseEvents.flatMap((item) => {
        if (!item.rrule || !/FREQ=WEEKLY/i.test(item.rrule)) return [item];
        const count = Math.min(Number(item.rrule.match(/COUNT=(\d+)/i)?.[1] || data.semester.totalWeeks), 100);
        const until = parseIcsDate(item.rrule.match(/UNTIL=([^;]+)/i)?.[1] || "");
        const duration = item.end - item.start;
        const occurrences = [];
        for (let index = 0; index < count; index += 1) {
          const start = addDays(item.start, index * 7);
          if (until && start > until) break;
          occurrences.push({ ...item, start, end: new Date(start.getTime() + duration), rrule: "" });
        }
        return occurrences;
      });
      if (!events.length) throw new Error("没有找到可导入的日程");
      const outsideCurrentSemester = events.every((item) => currentSemesterWeek(item.start) < 1 || currentSemesterWeek(item.start) > data.semester.totalWeeks);
      const earliest = events.reduce((min, item) => item.start < min ? item.start : min, events[0].start);
      const proposedStart = outsideCurrentSemester ? localISO(mondayOf(earliest)) : data.semester.startDate;
      const semesterPatch = outsideCurrentSemester ? { startDate: proposedStart, name: "导入的学期" } : {};
      const weekFor = (date) => Math.floor((mondayOf(date) - mondayOf(dateFromISO(proposedStart))) / (7 * 86400000)) + 1;
      const proposedSlots = data.timeSlots.map((slot) => ({ ...slot }));
      const groups = new Map();
      events.forEach((item) => {
        const day = item.start.getDay() || 7;
        const startTime = `${String(item.start.getHours()).padStart(2, "0")}:${String(item.start.getMinutes()).padStart(2, "0")}`;
        const endTime = `${String(item.end.getHours()).padStart(2, "0")}:${String(item.end.getMinutes()).padStart(2, "0")}`;
        let slot = proposedSlots.find((candidate) => candidate.startTime === startTime && candidate.endTime === endTime);
        if (!slot) { slot = { number: proposedSlots.length + 1, startTime, endTime }; proposedSlots.push(slot); }
        const key = `${item.name}|${day}|${slot.number}|${item.location}`;
        if (!groups.has(key)) groups.set(key, { name: item.name || "导入课程", teacher: "", location: item.location, day, startSection: slot.number, endSection: slot.number, color: colorFromShiguang(groups.size), weeks: new Set(), reminderMinutes: 10, notes: "由 ICS 日历导入" });
        const week = weekFor(item.start);
        if (week >= 1 && week <= data.semester.totalWeeks) groups.get(key).weeks.add(week);
      });
      proposedSlots.sort((a, b) => a.startTime.localeCompare(b.startTime));
      const numberMap = new Map(proposedSlots.map((slot, index) => [slot.number, index + 1]));
      const courses = [...groups.values()].filter((course) => course.weeks.size).map((course) => ({ ...course, startSection: numberMap.get(course.startSection), endSection: numberMap.get(course.endSection), weeks: [...course.weeks].sort((a, b) => a - b) }));
      const existingSectionMap = Object.fromEntries(numberMap);
      stageScheduleImport({ source: "ICS", courses, timeSlots: proposedSlots.map((slot, index) => ({ ...slot, number: index + 1 })), semesterPatch, existingSectionMap });
    } catch (error) { showToast(`ICS 导入失败：${error.message}`); }
    event.target.value = "";
  };
  reader.readAsText(file);
}

function isNativeAndroid() {
  return typeof window !== "undefined" && window.FangcunNative && typeof window.FangcunNative.syncReminders === "function";
}

function taskReminderDateTime(task) {
  if (task.startDate && task.startTime) return { date: task.startDate, time: task.startTime, label: "日程即将开始" };
  if (task.due && task.dueTime) return { date: task.due, time: task.dueTime, label: "事项即将到期" };
  return null;
}

function storedTestReminder() {
  try {
    return JSON.parse(localStorage.getItem(TEST_REMINDER_KEY) || "null");
  } catch { return null; }
}

function pendingTestReminder() {
  const item = storedTestReminder();
  return item && Number(item.at) > Date.now() ? item : null;
}

function nativeReminderItems() {
  const now = new Date();
  const items = [];
  data.tasks.filter((task) => !task.completed && task.reminderMinutes >= 0 && taskReminderDateTime(task)).forEach((task) => {
    const reminderTarget = taskReminderDateTime(task);
    const target = new Date(`${reminderTarget.date}T${reminderTarget.time}:00`).getTime();
    const at = target - task.reminderMinutes * 60000;
    if (at > now.getTime()) items.push({ id: `task-${task.id}-${reminderTarget.date}-${reminderTarget.time}`, title: `${task.title} · ${reminderTarget.date}`, body: `${reminderTarget.time} · ${task.title}`, at, systemAlarm: Boolean(task.alarmMode) });
  });
  const preparedSystemCourses = new Set();
  for (let offset = 0; offset <= 90; offset += 1) {
    const date = addDays(now, offset);
    data.courses.map((course) => courseOccurrence(course, date)).filter((course) => course && course.reminderMinutes >= 0).forEach((course) => {
      const slot = slotByNumber(course.startSection);
      if (!slot) return;
      const start = new Date(`${localISO(date)}T${slot.startTime}:00`).getTime();
      const at = start - course.reminderMinutes * 60000;
      if (at > now.getTime() && (!course.alarmMode || !preparedSystemCourses.has(course.id))) {
        items.push({ id: `course-${course.id}-${localISO(date)}`, title: `${course.name} · ${localISO(date)}`, body: `${courseTimeText(course)}${coursePlace(course) ? ` · ${coursePlace(course)}` : ""}`, at, systemAlarm: Boolean(course.alarmMode) });
        if (course.alarmMode) preparedSystemCourses.add(course.id);
      }
    });
  }
  const testReminder = pendingTestReminder();
  if (testReminder) items.push(testReminder);
  return items.sort((a, b) => a.at - b.at).slice(0, 240);
}

function syncNativeReminders() {
  if (!isNativeAndroid()) return;
  try { window.FangcunNative.syncReminders(JSON.stringify({ items: nativeReminderItems() })); } catch (error) { console.warn("无法同步安卓提醒", error); }
}

let nativeCalendarTimer = null;
let nativeCalendarSyncing = false;
const ANDROID_CALENDAR_MAP_KEY = "fangcun-android-calendar-map-v1";

function supportsNativeCalendar() {
  return isNativeAndroid()
    && typeof window.FangcunNative.readSystemCalendar === "function"
    && typeof window.FangcunNative.syncSystemCalendar === "function";
}

function nativeCalendarAccount() {
  return String(currentUser?.id || localStorage.getItem(LAST_USER_KEY) || "local");
}

function androidCalendarMap() {
  try {
    const saved = JSON.parse(localStorage.getItem(accountKey(ANDROID_CALENDAR_MAP_KEY)) || "{}");
    return { knownKeys: Array.isArray(saved.knownKeys) ? saved.knownKeys : [], nativeIds: saved.nativeIds && typeof saved.nativeIds === "object" ? saved.nativeIds : {} };
  }
  catch { return { knownKeys: [], nativeIds: {} }; }
}

function saveAndroidCalendarMap(value) {
  localStorage.setItem(accountKey(ANDROID_CALENDAR_MAP_KEY), JSON.stringify(value));
}

function epochFor(date, time = "00:00", utc = false) {
  if (!date) return 0;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return utc ? Date.UTC(year, month - 1, day, hour || 0, minute || 0) : new Date(year, month - 1, day, hour || 0, minute || 0).getTime();
}

function dateTimeFromEpoch(value, allDay = false) {
  const date = new Date(Number(value));
  const iso = allDay ? date.toISOString().slice(0, 10) : localISO(date);
  const time = allDay ? "" : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return { date: iso, time };
}

function nativeCalendarItems() {
  const mapping = androidCalendarMap();
  const items = [];
  data.tasks.filter((task) => !task.completed && (task.startDate || task.due)).forEach((task) => {
    const date = task.startDate || task.due;
    const time = task.startTime || task.dueTime || "";
    const allDay = !time;
    const startAt = epochFor(date, time || "00:00", allDay);
    let endAt;
    if (allDay) endAt = epochFor(localISO(addDays(dateFromISO(date), 1)), "00:00", true);
    else {
      const endDate = task.endDate || date;
      const endTime = task.endTime || (() => { const value = new Date(startAt + (task.startDate ? 60 : 15) * 60000); return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`; })();
      endAt = epochFor(endDate, endTime, false);
      if (endAt <= startAt) endAt = startAt + 30 * 60000;
    }
    const key = `task:${task.id}`;
    items.push({ key, kind: "task", nativeId: mapping.nativeIds?.[key] || 0, title: task.due && !task.startDate ? `DDL · ${task.title}` : task.title, description: task.notes || "由方寸双向同步", location: task.location || "", startAt, endAt, allDay, reminderMinutes: task.alarmMode ? -1 : Number(task.reminderMinutes ?? -1) });
  });
  if (data.semester?.startDate) data.courses.forEach((course) => {
    (course.weeks || []).forEach((week) => {
      const originalDate = localISO(addDays(weekStartDate(week), Number(course.day) - 1));
      const exception = data.courseExceptions.find((item) => item.courseId === course.id && item.date === originalDate);
      if (exception?.type === "cancel") return;
      const date = exception?.type === "reschedule" ? (exception.targetDate || (exception.day ? localISO(addDays(weekStartDate(week), Number(exception.day) - 1)) : originalDate)) : originalDate;
      if (calendarRuleForDate(date)?.type === "holiday") return;
      const startSlot = slotByNumber(exception?.type === "reschedule" ? exception.startSection : course.startSection);
      const endSlot = slotByNumber(exception?.type === "reschedule" ? exception.endSection : course.endSection);
      if (!startSlot || !endSlot) return;
      const key = `course:${course.id}:${originalDate}`;
      items.push({ key, kind: "course", nativeId: mapping.nativeIds?.[key] || 0, title: exception?.name || course.name, description: [course.code, course.teacher, course.notes].filter(Boolean).join(" · "), location: exception?.location || coursePlace(course), startAt: epochFor(date, startSlot.startTime), endAt: epochFor(date, endSlot.endTime), allDay: false, reminderMinutes: course.alarmMode ? -1 : Number(course.reminderMinutes ?? -1) });
    });
  });
  return items;
}

function upsertExactTimeSlot(startTime, endTime) {
  let slot = data.timeSlots.find((item) => item.startTime === startTime && item.endTime === endTime);
  if (slot) return slot.number;
  const nextNumber = Math.max(0, ...data.timeSlots.map((item) => Number(item.number) || 0)) + 1;
  data.timeSlots.push({ number: nextNumber, startTime, endTime });
  data.timeSlots.sort((a, b) => a.startTime.localeCompare(b.startTime));
  return nextNumber;
}

function applyNativeCalendarEvent(event) {
  const key = String(event.key || "");
  const start = dateTimeFromEpoch(event.startAt, event.allDay);
  const end = dateTimeFromEpoch(event.endAt, event.allDay);
  if (key.startsWith("task:")) {
    const id = key.slice(5);
    const task = data.tasks.find((item) => item.id === id);
    if (!task) return false;
    task.title = String(event.title || task.title).replace(/^DDL\s*[·・-]\s*/, "");
    task.notes = event.description || "";
    task.location = event.location || "";
    task.reminderMinutes = Number(event.reminderMinutes ?? -1);
    if (task.startDate || !task.due) {
      task.startDate = start.date; task.startTime = start.time; task.endDate = event.allDay ? "" : end.date; task.endTime = end.time;
    } else {
      task.due = start.date; task.dueTime = start.time;
    }
    task.updatedAt = Date.now();
    return true;
  }
  if (key.startsWith("course:")) {
    const match = key.match(/^course:([^:]+):(\d{4}-\d{2}-\d{2})$/);
    if (!match) return false;
    const course = courseById(match[1]);
    if (!course) return false;
    const startSection = upsertExactTimeSlot(start.time, end.time || start.time);
    const week = currentSemesterWeek(dateFromISO(start.date));
    const replacement = { id: uid(), courseId: course.id, date: match[2], targetDate: start.date, type: "reschedule", day: dateFromISO(start.date).getDay() || 7, startSection, endSection: startSection, name: event.title || course.name, location: event.location || coursePlace(course), source: "android-calendar", updatedAt: Date.now() };
    data.courseExceptions = data.courseExceptions.filter((item) => !(item.courseId === course.id && item.date === match[2]));
    if (week >= 1 && week <= data.semester.totalWeeks) data.courseExceptions.push(replacement);
    return true;
  }
  return false;
}

function applyNativeCalendarDeletion(key) {
  if (key.startsWith("task:")) {
    const before = data.tasks.length;
    data.tasks = data.tasks.filter((item) => item.id !== key.slice(5));
    return data.tasks.length !== before;
  }
  const match = key.match(/^course:([^:]+):(\d{4}-\d{2}-\d{2})$/);
  if (!match || !courseById(match[1])) return false;
  data.courseExceptions = data.courseExceptions.filter((item) => !(item.courseId === match[1] && item.date === match[2]));
  data.courseExceptions.push({ id: uid(), courseId: match[1], date: match[2], type: "cancel", source: "android-calendar", updatedAt: Date.now() });
  return true;
}

function importNativeCalendarEvent(event) {
  const start = dateTimeFromEpoch(event.startAt, event.allDay);
  const end = dateTimeFromEpoch(event.endAt, event.allDay);
  const id = uid();
  data.tasks.unshift({ id, title: event.title || "系统日历事项", notes: event.description || "", location: event.location || "", due: "", dueTime: "", startDate: start.date, startTime: start.time, endDate: event.allDay ? "" : end.date, endTime: end.time, reminderMinutes: Number(event.reminderMinutes ?? -1), estimateMinutes: 0, type: "event", repeat: "none", courseId: "", projectId: "", important: null, urgent: null, quadrant: null, today: start.date === localISO(), completed: false, source: "android-calendar", createdAt: Date.now(), updatedAt: Date.now() });
  return { key: `task:${id}`, nativeId: event.nativeId };
}

function updateSystemCalendarStatus(result = null) {
  const setting = $("#systemCalendarSetting");
  const status = $("#systemCalendarStatus");
  if (!setting || !status) return;
  const enabled = Boolean(data.settings.systemCalendarEnabled);
  const supported = supportsNativeCalendar();
  setting.classList.toggle("ready", supported && enabled && result?.permission !== false);
  setting.classList.toggle("warning", supported && result?.permission === false);
  $("#enableSystemCalendarBtn").classList.toggle("hidden", supported && enabled);
  $("#syncSystemCalendarBtn").classList.toggle("hidden", !supported || !enabled);
  $("#openSystemCalendarBtn").classList.toggle("hidden", !supported || !enabled);
  if (!supported) status.textContent = "请安装方寸 APK 后开启；浏览器网页不会读取手机日历。";
  else if (!enabled) status.textContent = "开启后会建立“方寸”系统日历，支持小米日历双向修改。";
  else if (result?.permission === false) status.textContent = "尚未获得日历读写权限，请在系统设置中允许。";
  else if (result?.error) status.textContent = `系统日历同步失败：${result.error}`;
  else status.textContent = `已与小米 / Android 系统日历双向同步${result?.events ? ` · ${result.events.length} 条` : ""}`;
  const detail = $("#systemCalendarDetail");
  if (enabled && result && !result.error) {
    detail.classList.remove("hidden");
    detail.innerHTML = `<span>方寸专用日历</span><span>改动在打开或返回 App 时合并</span><span>提醒由系统日历和方寸共同保障</span>`;
  } else detail.classList.add("hidden");
}

function reconcileNativeCalendar(result) {
  if (!result?.permission || !Array.isArray(result.events)) return false;
  const mapping = androidCalendarMap();
  const providerByKey = new Map(result.events.filter((event) => event.key).map((event) => [event.key, event]));
  let changed = false;
  result.events.filter((event) => !event.key).forEach((event) => {
    const adopted = importNativeCalendarEvent(event);
    mapping.nativeIds[adopted.key] = adopted.nativeId;
    changed = true;
  });
  result.events.filter((event) => event.key && event.contentHash && event.syncHash && event.contentHash !== event.syncHash).forEach((event) => { changed = applyNativeCalendarEvent(event) || changed; });
  if (result.calendarId) (mapping.knownKeys || []).filter((key) => !providerByKey.has(key)).forEach((key) => { changed = applyNativeCalendarDeletion(key) || changed; });
  saveAndroidCalendarMap(mapping);
  return changed;
}

const nativeCalendarRequests = new Map();
window.FangcunCalendarResult = (id, result) => {
  const request = nativeCalendarRequests.get(id);
  if (!request) return;
  nativeCalendarRequests.delete(id);
  clearTimeout(request.timer);
  try { request.resolve(JSON.parse(result)); } catch { request.reject(new Error("系统日历返回了无效数据")); }
};
function requestNativeCalendar(operation, payload) {
  if (typeof window.FangcunNative.calendarRequest !== "function") {
    return Promise.resolve(JSON.parse(operation === "read" ? window.FangcunNative.readSystemCalendar(payload) : window.FangcunNative.syncSystemCalendar(payload)));
  }
  return new Promise((resolve, reject) => {
    const id = uid();
    const timer = setTimeout(() => { nativeCalendarRequests.delete(id); reject(new Error("系统日历响应超时，请稍后重试")); }, 30000);
    nativeCalendarRequests.set(id, { resolve, reject, timer });
    window.FangcunNative.calendarRequest(id, operation, payload);
  });
}

async function runNativeCalendarSync() {
  if (!supportsNativeCalendar() || !data.settings.systemCalendarEnabled || nativeCalendarSyncing) return;
  nativeCalendarSyncing = true;
  try {
    const account = nativeCalendarAccount();
    const readResult = await requestNativeCalendar("read", account);
    if (account !== nativeCalendarAccount()) return false;
    if (readResult.error || !readResult.permission) throw new Error(readResult.error || "请先允许日历读写权限");
    const changed = reconcileNativeCalendar(readResult);
    if (changed) {
      localStorage.setItem(accountKey(STORAGE_KEY), JSON.stringify(data));
      updateSyncMeta({ dirty: true });
      scheduleCloudSync();
      renderAll();
    }
    const payload = { account: nativeCalendarAccount(), displayName: currentUser?.displayName || currentUser?.username || "本机", events: nativeCalendarItems() };
    const syncResult = await requestNativeCalendar("sync", JSON.stringify(payload));
    if (account !== nativeCalendarAccount()) return false;
    if (syncResult.error || !syncResult.permission) throw new Error(syncResult.error || "请先允许日历读写权限");
    if (syncResult.permission && Array.isArray(syncResult.events)) {
      const mapping = androidCalendarMap();
      mapping.knownKeys = syncResult.events.filter((event) => event.key).map((event) => event.key);
      mapping.nativeIds = Object.fromEntries(syncResult.events.filter((event) => event.key).map((event) => [event.key, event.nativeId]));
      saveAndroidCalendarMap(mapping);
    }
    updateSystemCalendarStatus(syncResult);
    return true;
  } catch (error) {
    console.warn("无法同步安卓系统日历", error);
    updateSystemCalendarStatus({ error: error.message });
    return false;
  } finally { nativeCalendarSyncing = false; }
}

function scheduleNativeCalendarSync() {
  if (!supportsNativeCalendar() || !data.settings.systemCalendarEnabled || nativeCalendarSyncing) return;
  clearTimeout(nativeCalendarTimer);
  nativeCalendarTimer = setTimeout(runNativeCalendarSync, 500);
}

function enableSystemCalendar() {
  if (!supportsNativeCalendar()) return showToast("请先安装方寸 APK");
  data.settings.systemCalendarEnabled = true;
  localStorage.setItem(accountKey(STORAGE_KEY), JSON.stringify(data));
  window.FangcunNative.requestCalendarPermissions();
  updateSystemCalendarStatus({ permission: false });
}

window.FangcunNativeCalendarPermission = (granted) => {
  updateSystemCalendarStatus({ permission: granted });
  if (granted) { runNativeCalendarSync(); showToast("已开启小米系统日历双向同步"); }
  else showToast("需要日历读写权限才能双向联动");
};
window.FangcunNativeCalendarResume = async () => {
  await runNativeCalendarSync();
  if (syncState.authenticated) await reconcileCloud();
  scheduleNativeCalendarSync();
};

function updateReminderTestAvailability() {
  const native = isNativeAndroid();
  $("#testSystemAlarmBtn").classList.toggle("hidden", !native);
  $("#systemAlarmTestHint").classList.toggle("hidden", native);
}

function openReminderSettings() {
  updateReminderTestAvailability();
  $("#sidebar").classList.remove("open");
  $("#mobileMenu").setAttribute("aria-expanded", "false");
  $("#remindersModal").showModal();
}

async function scheduleTestNotification() {
  if (!isNativeAndroid()) {
    if (!("Notification" in window)) return showToast("当前浏览器不支持系统通知");
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return showToast("未获得通知权限，无法安排测试");
  } else window.FangcunNative.requestReminderPermissions?.();
  const at = Date.now() + 60000;
  const triggerText = new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const item = { id: "fangcun-test-reminder", title: "方寸测试提醒", body: `计划触发时间 ${triggerText}`, at, systemAlarm: false };
  // 固定存储键和原生提醒 id 会覆盖旧测试，因此同一分钟反复点击只保留最后一次，避免测试项爆量。
  localStorage.setItem(TEST_REMINDER_KEY, JSON.stringify(item));
  syncNativeReminders();
  $("#reminderTestStatus").textContent = `测试提醒已安排，将在 ${triggerText} 触发。`;
  showToast("已安排 1 分钟后的测试提醒");
}

function openTestSystemAlarm() {
  if (!isNativeAndroid()) return showToast("请在方寸 Android App 中测试系统闹钟");
  const nextHour = new Date();
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
  const item = { id: "fangcun-test-system-alarm", title: "方寸测试闹钟", body: "请在系统时钟中确认保存", at: nextHour.getTime(), systemAlarm: true };
  try { window.FangcunNative.syncReminders(JSON.stringify({ items: [...nativeReminderItems(), item] })); }
  catch (error) { console.warn("无法打开系统闹钟测试", error); }
}

function updateNotificationStatus() {
  if (isNativeAndroid()) {
    $("#notificationStatus").textContent = "安卓系统提醒可在应用关闭后触发";
    $("#enableNotificationsBtn").disabled = false;
    $("#enableNotificationsBtn").textContent = "设置系统提醒权限";
    return;
  }
  const permission = "Notification" in window ? Notification.permission : "unsupported";
  const labels = { granted: "已允许，页面运行时会提醒", denied: "已被浏览器拒绝", default: "尚未授权", unsupported: "当前浏览器不支持" };
  $("#notificationStatus").textContent = labels[permission] || labels.default;
  $("#enableNotificationsBtn").disabled = permission === "granted" || permission === "unsupported";
}

async function enableNotifications() {
  if (isNativeAndroid()) {
    data.settings.notificationsEnabled = true;
    saveData();
    window.FangcunNative.requestReminderPermissions();
    syncNativeReminders();
    updateNotificationStatus();
    return showToast("请在系统页面允许通知与闹钟提醒");
  }
  if (!("Notification" in window)) return showToast("当前浏览器不支持系统通知");
  const permission = await Notification.requestPermission();
  data.settings.notificationsEnabled = permission === "granted";
  saveData();
  updateNotificationStatus();
  showToast(permission === "granted" ? "课程提醒已开启" : "未获得通知权限");
}

async function showSystemNotification(title, body, tag) {
  if (Notification.permission !== "granted") return;
  const options = { body, tag, icon: "icon.svg", badge: "icon.svg", data: { url: "./" } };
  if (navigator.serviceWorker) {
    const registration = await navigator.serviceWorker.ready;
    registration.showNotification(title, options);
  } else new Notification(title, options);
}

function checkReminders() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const sent = JSON.parse(localStorage.getItem("fangcun-sent-reminders") || "{}");
  const now = new Date();
  const testReminder = storedTestReminder();
  if (testReminder && Number(testReminder.at) <= now.getTime()) {
    showSystemNotification(testReminder.title, testReminder.body, testReminder.id);
    localStorage.removeItem(TEST_REMINDER_KEY);
  }
  data.courses.map((course) => courseOccurrence(course, now)).filter((course) => course && course.reminderMinutes >= 0 && !course.alarmMode).forEach((course) => {
    const slot = slotByNumber(course.startSection);
    if (!slot) return;
    const startsAt = new Date(`${localISO()}T${slot.startTime}:00`);
    const minutes = Math.round((startsAt - now) / 60000);
    const key = `course-${course.id}-${localISO()}`;
    if (minutes >= 0 && minutes <= course.reminderMinutes && !sent[key]) {
      showSystemNotification(`${course.name} 即将开始`, `${courseTimeText(course)}${coursePlace(course) ? ` · ${coursePlace(course)}` : ""}`, key);
      sent[key] = Date.now();
    }
  });
  data.tasks.filter((task) => !task.completed && !task.alarmMode && (task.due === localISO() || task.startDate === localISO())).forEach((task) => {
    const reminderTarget = taskReminderDateTime(task);
    const key = `task-${task.id}-${reminderTarget?.date || task.due}-${reminderTarget?.time || "day"}`;
    if (sent[key]) return;
    if (reminderTarget && task.reminderMinutes >= 0) {
      const target = new Date(`${reminderTarget.date}T${reminderTarget.time}:00`);
      const minutes = Math.round((target - now) / 60000);
      if (minutes >= 0 && minutes <= task.reminderMinutes) {
        showSystemNotification(reminderTarget.label, `${reminderTarget.time} · ${task.title}`, key);
        sent[key] = Date.now();
      }
    } else if (task.due === localISO() && !task.dueTime && now.getHours() >= 8) {
      showSystemNotification("今天截止", task.title, key);
      sent[key] = Date.now();
    }
  });
  localStorage.setItem("fangcun-sent-reminders", JSON.stringify(sent));
}

function exportData() {
  closeSidebar();
  downloadFile(JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2), `方寸备份-${localISO()}.json`, "application/json");
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (syncState.syncing || syncState.reconciling || syncState.pulling || syncState.integrationSyncing) throw new Error("正在同步，请完成后再恢复备份");
    if (file.size > 4 * 1024 * 1024) throw new Error("备份文件超过 4 MB，请确认选择的是方寸 JSON 备份");
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.tasks) || !Array.isArray(imported.projects)) throw new Error("请选择方寸导出的 JSON 备份");
    const restored = normalizeData(imported);
    if (!restored) throw new Error("备份数据结构不正确");
    if (syncState.syncing || syncState.reconciling || syncState.pulling || syncState.integrationSyncing) throw new Error("正在同步，请完成后再恢复备份");
    if (!confirm(`恢复备份中的 ${restored.tasks.length} 个事项、${restored.courses.length} 门课程？当前本机内容会保留恢复副本，云端不会自动被覆盖。`)) return;
    localStorage.setItem(accountKey(PRE_CLOUD_BACKUP_KEY), JSON.stringify({ data, savedAt: new Date().toISOString() }));
    clearTimeout(syncTimer);
    syncState.conflict = Boolean(syncState.authenticated);
    updateSyncMeta({ needsChoice: true });
    data = restored;
    saveData();
    closeSidebar();
    showToast("备份已恢复；登录状态下请在同步页确认保留版本");
  } catch (error) {
    showToast(`无法导入：${error.message}`);
  } finally { event.target.value = ""; }
}

function initStaticEvents() {
  $("#authGateForm").addEventListener("submit", submitAuthGate);
  $("#authTabs").addEventListener("click", (event) => { const button = event.target.closest("[data-auth-mode]"); if (button) setAuthMode(button.dataset.authMode); });
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $$("[data-mobile-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.mobileView)));
  $$("[data-mobile-quadrant]").forEach((button) => button.addEventListener("click", () => selectMobileQuadrant(button.dataset.mobileQuadrant)));
  $(".matrix-board").addEventListener("scroll", updateMobileQuadrantFromScroll, { passive: true });
  $("#mobileMenu").addEventListener("click", () => {
    const open = $("#sidebar").classList.toggle("open");
    $("#mobileMenu").setAttribute("aria-expanded", String(open));
  });
  $("#sidebarBackdrop").addEventListener("click", () => { $("#sidebar").classList.remove("open"); $("#mobileMenu").setAttribute("aria-expanded", "false"); });
  $("#dailyTipAction").addEventListener("click", () => switchView($("#dailyTipAction").dataset.tipView || "today"));
  $("#openCreateBtn").addEventListener("click", openPrimaryCreate);
  $("#mobileNavCreate").addEventListener("click", openPrimaryCreate);
  $("#todayInboxBtn").addEventListener("click", () => switchView("inbox"));
  $("#refreshFocusBtn").addEventListener("click", () => { focusRotation += 1; renderAll(); showToast("已换一组今日建议"); });
  $("#mobileCreateForm").addEventListener("submit", submitMobileCreate);
  $$("[data-capture-example]").forEach((button) => button.addEventListener("click", () => { $("#mobileCaptureInput").value = button.dataset.captureExample; $("#mobileCaptureInput").focus(); }));
  $$("[data-mobile-create]").forEach((button) => button.addEventListener("click", () => openDetailedMobileCreate(button.dataset.mobileCreate)));
  $("#installAppBtn").addEventListener("click", installMobileApp);
  $$("[data-add-quadrant]").forEach((button) => button.addEventListener("click", () => openTaskModal("", button.dataset.addQuadrant)));
  $("#taskForm").addEventListener("submit", saveTask);
  $("#deleteTaskBtn").addEventListener("click", deleteTask);
  $("#addProjectBtn").addEventListener("click", () => openProjectModal());
  $("#projectForm").addEventListener("submit", saveProject);
  $("#deleteProjectBtn").addEventListener("click", deleteProject);
  $("#addCourseBtn").addEventListener("click", () => openCourseModal());
  $("#addCalendarEventBtn").addEventListener("click", () => openTaskModal("", null, { type: "event", startDate: localISO(), reminderMinutes: 10 }));
  $$('[data-landscape-schedule-action]').forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.landscapeScheduleAction;
    if (action === "add") openTaskModal("", null, { type: "event", startDate: localISO(), reminderMinutes: 10 });
    else if (action === "course") openCourseModal();
    else if (action === "import") $("#scheduleImportBtn").click();
    else if (action === "rules") $("#calendarRulesBtn").click();
    else if (action === "settings") $("#semesterSettingsBtn").click();
    button.closest("details")?.removeAttribute("open");
  }));
  $("#courseForm").addEventListener("submit", saveCourse);
  $("#deleteCourseBtn").addEventListener("click", deleteCourse);
  $("#duplicateCourseBtn").addEventListener("click", duplicateCourseTime);
  $$("[data-week-preset]").forEach((button) => button.addEventListener("click", () => {
    const total = Number(data.semester.totalWeeks) || 20;
    $("#courseWeeks").value = button.dataset.weekPreset === "odd" ? `1-${total}单周` : button.dataset.weekPreset === "even" ? `1-${total}双周` : `1-${total}`;
  }));
  $("#courseTaskActions").addEventListener("click", (event) => { const button = event.target.closest("[data-course-task]"); if (button) createTaskForCourse(button.dataset.courseTask); });
  $("#courseLinkedTasks").addEventListener("click", (event) => { const button = event.target.closest("[data-linked-task-id]"); if (!button) return; $("#courseModal").close(); openTaskModal(button.dataset.linkedTaskId); });
  $("#cancelOccurrenceBtn").addEventListener("click", toggleCurrentOccurrence);
  $("#rescheduleOccurrenceBtn").addEventListener("click", rescheduleCurrentOccurrence);
  $("#courseStartSection").addEventListener("change", () => {
    const start = data.timeSlots.findIndex((slot) => String(slot.number) === $("#courseStartSection").value);
    const end = data.timeSlots.findIndex((slot) => String(slot.number) === $("#courseEndSection").value);
    if (end < start) $("#courseEndSection").value = $("#courseStartSection").value;
  });
  $("#semesterSettingsBtn").addEventListener("click", openSemesterModal);
  $("#calendarRulesBtn").addEventListener("click", openCalendarRulesModal);
  $("#calendarRuleForm").addEventListener("submit", saveCalendarRule);
  $("#calendarRuleType").addEventListener("change", () => $("#calendarUseDayField").classList.toggle("hidden", $("#calendarRuleType").value !== "teaching"));
  $("#chinaHolidayPresetBtn").addEventListener("click", importChinaHolidayPreset);
  $("#calendarRuleList").addEventListener("click", (event) => { const button = event.target.closest("[data-delete-calendar-rule]"); if (!button) return; data.calendarRules = data.calendarRules.filter((rule) => rule.id !== button.dataset.deleteCalendarRule); saveData(); renderCalendarRules(); });
  $("#semesterForm").addEventListener("submit", saveSemester);
  $("#universitySlotPresetBtn").addEventListener("click", () => {
    if (data.courses.length && !confirm("应用 13 节模板后，现有课程会保留原节次编号。请在保存后检查课程时间，是否继续？")) return;
    semesterDraftSlots = defaultTimeSlots().map((slot) => ({ ...slot }));
    renderTimeSlotEditor();
    showToast("已载入 13 节模板，可继续修改具体时间");
  });
  $("#addTimeSlotBtn").addEventListener("click", () => {
    $$("[data-slot-index]").forEach((row) => { const index = Number(row.dataset.slotIndex); semesterDraftSlots[index].startTime = $("[data-slot-start]", row).value; semesterDraftSlots[index].endTime = $("[data-slot-end]", row).value; });
    semesterDraftSlots.push({ number: semesterDraftSlots.length + 1, startTime: "08:00", endTime: "09:00" });
    renderTimeSlotEditor();
  });
  $("#timeSlotEditor").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-slot]");
    if (!button || semesterDraftSlots.length <= 1) return;
    $$("[data-slot-index]").forEach((row) => { const index = Number(row.dataset.slotIndex); semesterDraftSlots[index].startTime = $("[data-slot-start]", row).value; semesterDraftSlots[index].endTime = $("[data-slot-end]", row).value; });
    semesterDraftSlots.splice(Number(button.dataset.removeSlot), 1);
    renderTimeSlotEditor();
  });
  $("#scheduleImportBtn").addEventListener("click", () => openDataHub("calendar"));
  $$("[data-sync-tab]").forEach((button) => button.addEventListener("click", () => selectDataHubTab(button.dataset.syncTab)));
  $("#shiguangImportInput").addEventListener("change", importShiguang);
  $("#icsImportInput").addEventListener("change", importIcs);
  $("#wordScheduleInput").addEventListener("change", importWordSchedule);
  $("#scheduleImportPreview").addEventListener("click", (event) => { if (event.target.closest("#confirmScheduleImportBtn")) confirmScheduleImport(); });
  $("#undoScheduleImportBtn").addEventListener("click", undoScheduleImport);
  $("#exportScheduleJsonBtn").addEventListener("click", exportScheduleJson);
  $("#exportIcsBtn").addEventListener("click", exportIcs);
  $("#enableNotificationsBtn").addEventListener("click", enableNotifications);
  $("#createCalendarSubscriptionBtn").addEventListener("click", createCalendarSubscription);
  $("#copyCalendarSubscriptionBtn").addEventListener("click", copyCalendarSubscription);
  $("#revokeCalendarSubscriptionBtn").addEventListener("click", revokeCalendarSubscription);
  $("#connectOutlookBtn").addEventListener("click", connectOutlook);
  $("#syncOutlookBtn").addEventListener("click", syncOutlookNow);
  $("#disconnectOutlookBtn").addEventListener("click", disconnectOutlook);
  $("#connectGoogleBtn").addEventListener("click", connectGoogle);
  $("#syncGoogleBtn").addEventListener("click", syncGoogleNow);
  $("#disconnectGoogleBtn").addEventListener("click", disconnectGoogle);
  $("#enableSystemCalendarBtn").addEventListener("click", enableSystemCalendar);
  $("#syncSystemCalendarBtn").addEventListener("click", async () => {
    const button = $("#syncSystemCalendarBtn");
    if (nativeCalendarSyncing) return showToast("系统日历正在同步，请稍候");
    button.disabled = true;
    button.textContent = "正在同步…";
    try { showToast(await runNativeCalendarSync() ? "系统日历同步完成" : "未完成同步，请查看权限或错误提示"); }
    finally { button.disabled = false; button.textContent = "立即同步系统日历"; }
  });
  $("#openSystemCalendarBtn").addEventListener("click", () => window.FangcunNative?.openSystemCalendar?.());
  $("#dismissUpdateBtn").addEventListener("click", () => $("#updateBanner").classList.add("hidden"));
  $("#applyUpdateBtn").addEventListener("click", () => {
    if (!waitingServiceWorker) return location.reload();
    waitingServiceWorker.postMessage({ type: "SKIP_WAITING" });
  });
  $("#prevWeekBtn").addEventListener("click", () => moveCalendar(-1));
  $("#nextWeekBtn").addEventListener("click", () => moveCalendar(1));
  $("#currentWeekBtn").addEventListener("click", returnCalendarToToday);
  $("#weekPickerBtn").addEventListener("click", () => {
    if (scheduleMode !== "week" && scheduleMode !== "timetable") return;
    const value = prompt(`跳转到哪一周？教学周为 1-${data.semester.totalWeeks}，学期前可填 0、-1，学期后可继续填 ${data.semester.totalWeeks + 1}、${data.semester.totalWeeks + 2}…`, displayedWeek);
    if (value === null) return;
    const week = Number(value);
    if (Number.isInteger(week)) { displayedWeek = week; renderAll(); }
    else showToast("请输入整数周次");
  });
  $$("[data-schedule-mode]").forEach((button) => button.addEventListener("click", () => { scheduleMode = button.dataset.scheduleMode; localStorage.setItem("fangcun-schedule-mode", scheduleMode); renderAll(); }));
  $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`).close()));
  $("#quickAddForm").addEventListener("submit", submitQuickTask);
  $("#smartCaptureForm").addEventListener("submit", confirmSmartCapture);
  $("#smartCapturePreview").addEventListener("change", updateSmartDraftField);
  $("#smartCapturePreview").addEventListener("click", (event) => {
    const button = event.target.closest("[data-smart-original]");
    if (!button) return;
    const draft = smartDrafts[Number(button.dataset.smartOriginal)];
    if (draft?.originalText) { draft.title = draft.originalText; renderSmartCapturePreview(); }
  });
  $("#editSmartCaptureBtn").addEventListener("click", editSmartCapture);
  $("#quickImportant").addEventListener("click", () => { quickDecision.important = !quickDecision.important; quickDecision.touched = true; updateQuickButtons(); });
  $("#quickUrgent").addEventListener("click", () => { quickDecision.urgent = !quickDecision.urgent; quickDecision.touched = true; updateQuickButtons(); });
  $$(".segmented").forEach((segment) => segment.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const type = segment.id === "importantSegment" ? "important" : "urgent";
    taskDecision[type] = button.dataset.value === "true";
    updateDecisionUI();
  }));
  $$(".quadrant").forEach((quadrant) => {
    quadrant.addEventListener("dragover", (event) => { event.preventDefault(); quadrant.classList.add("drag-over"); });
    quadrant.addEventListener("dragleave", (event) => { if (!quadrant.contains(event.relatedTarget)) quadrant.classList.remove("drag-over"); });
    quadrant.addEventListener("drop", (event) => {
      event.preventDefault();
      quadrant.classList.remove("drag-over");
      const task = data.tasks.find((item) => item.id === window.draggedTaskId);
      if (!task) return;
      const decision = decisionForQuadrant(quadrant.dataset.quadrant);
      Object.assign(task, decision, { quadrant: quadrant.dataset.quadrant });
      saveData();
      showToast(`已移动到“${quadrantInfo[task.quadrant].name}”`);
    });
  });
  $("#exportBtn").addEventListener("click", exportData);
  $("#importInput").addEventListener("change", importData);
  $("#reminderSettingsBtn").addEventListener("click", openReminderSettings);
  $("#testNotificationBtn").addEventListener("click", scheduleTestNotification);
  $("#testSystemAlarmBtn").addEventListener("click", openTestSystemAlarm);
  $("#cloudBtn").addEventListener("click", () => openDataHub("account"));
  $("#cloudBtn").addEventListener("click", closeSidebar);
  $("#sidebarCloseBtn").addEventListener("click", closeSidebar);
  $("#syncNowBtn").addEventListener("click", syncNow);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSidebar(); });
  $("#cloudAuthForm").addEventListener("submit", submitCloudAuth);
  $("#cloudRegisterBtn").addEventListener("click", () => { $("#cloudModal").close(); showAuthGate(); setAuthMode("register"); });
  $("#pullCloudBtn").addEventListener("click", pullCloudData);
  $("#pushCloudBtn").addEventListener("click", pushCloudData);
  $("#restoreLocalBtn").addEventListener("click", restorePreCloudData);
  $("#logoutCloudBtn").addEventListener("click", logoutCloud);
  $("#changeCloudPasswordBtn").addEventListener("click", changeCloudPassword);
  $("#deleteAccountBtn").addEventListener("click", deleteOwnAccount);
  $("#registrationToggle").addEventListener("change", toggleRegistration);
  $("#refreshAdminBtn").addEventListener("click", loadAdminPanel);
  $("#migrateOwnerDataBtn").addEventListener("click", migrateOwnerToMember);
  $("#adminLogoutBtn").addEventListener("click", logoutCloud);
  $("#adminUsers").addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view-user-id]");
    const statusButton = event.target.closest("[data-user-status-id]");
    const resetButton = event.target.closest("[data-reset-user-id]");
    const deleteButton = event.target.closest("[data-delete-user-id]");
    if (viewButton) viewAdminUser(viewButton.dataset.viewUserId);
    else if (resetButton) resetAdminUserPassword(resetButton);
    else if (statusButton) changeUserStatus(statusButton);
    else if (deleteButton) deleteAdminUser(deleteButton);
  });
  $("#themeBtn").addEventListener("click", () => {
    document.body.classList.toggle("dark");
    localStorage.setItem(THEME_KEY, document.body.classList.contains("dark") ? "dark" : "light");
  });
  document.addEventListener("click", (event) => {
    if (window.innerWidth <= 720 && !event.target.closest("#sidebar") && !event.target.closest("#mobileMenu")) { $("#sidebar").classList.remove("open"); $("#mobileMenu").setAttribute("aria-expanded", "false"); }
  });
  $$("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }));
}

function updateLiveClock() {
  const now = new Date();
  $("#liveClock strong").textContent = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  $("#liveClock span").textContent = now.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" });
  $("#dateLine").textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now);
}

function init() {
  const formatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  $("#dateLine").textContent = formatter.format(new Date());
  if (localStorage.getItem(THEME_KEY) === "dark") document.body.classList.add("dark");
  const mobileLayout = mobileAppLayout();
  scheduleMode = localStorage.getItem("fangcun-schedule-mode") || (mobileLayout ? "day" : "month");
  if (!["year", "month", "week", "day", "timetable"].includes(scheduleMode)) scheduleMode = "month";
  displayedWeek = currentSemesterWeek();
  initStaticEvents();
  initCalendarZoom();
  renderAll();
  selectMobileQuadrant(mobileQuadrant, false);
  syncNativeReminders();
  initializeCloud().then(handleCalendarReturn);
  updateSystemCalendarStatus();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    let refreshing = false;
    const offerUpdate = (worker) => {
      waitingServiceWorker = worker;
      $("#updateBanner").classList.remove("hidden");
    };
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!refreshing) { refreshing = true; location.reload(); } });
    navigator.serviceWorker.register(`service-worker.js?v=${APP_VERSION}`).then((registration) => {
      if (registration.waiting) offerUpdate(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) offerUpdate(worker);
        });
      });
      registration.update();
    }).catch(() => {});
  }
  if (typeof window.addEventListener === "function") window.addEventListener("online", () => { if (syncMeta().dirty) initializeCloud(); });
  checkReminders();
  updateLiveClock();
  setInterval(updateLiveClock, 1000);
  setInterval(checkReminders, 60000);
  setInterval(() => { if (activeView === "schedule") refreshCalendarPast(); }, 60000);
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    $("#installAppBtn")?.classList.remove("hidden");
  });
  window.addEventListener("appinstalled", () => { installPrompt = null; $("#installAppBtn")?.classList.add("hidden"); });
}

init();
