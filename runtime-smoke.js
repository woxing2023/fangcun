const fs = require("node:fs");
const vm = require("node:vm");

const storage = new Map();
const element = {
  value: "",
  checked: false,
  disabled: false,
  innerHTML: "",
  textContent: "",
  dataset: {},
  style: { setProperty() {} },
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {},
  setAttribute() {},
  querySelector() { return element; },
  querySelectorAll() { return []; },
  reset() {},
  showModal() {},
  close() {},
  focus() {},
};

const document = {
  body: element,
  querySelector() { return element; },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() { return { ...element, click() {} }; },
};

const context = {
  AbortController,
  console,
  document,
  navigator: {},
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
  },
  Intl,
  Date,
  Math,
  JSON,
  Blob,
  URL,
  confirm: () => true,
  prompt: () => null,
  setTimeout(callback) { callback(); return 1; },
  clearTimeout() {},
  setInterval() { return 1; },
};
context.window = context;

vm.createContext(context);
vm.runInContext(fs.readFileSync("smart-parser.js", "utf8"), context, { filename: "smart-parser.js" });
vm.runInContext(fs.readFileSync("app.js", "utf8"), context, { filename: "app.js" });

const saved = JSON.parse(storage.get("fangcun-data-v1"));
if (!saved?.semester || !saved?.timeSlots?.length || !Array.isArray(saved?.courses)) {
  throw new Error("课程数据模型未正确初始化");
}

vm.runInContext(`
  const idempotentTask = { id: "completion-idempotent", title: "重复完成保护", completed: false, repeat: "none" };
  data.tasks.push(idempotentTask);
  toggleComplete(idempotentTask.id, true);
  toggleComplete(idempotentTask.id, true);
  if (!idempotentTask.completed) throw new Error("重复完成不能恢复事项");
  toggleComplete(idempotentTask.id, false);
  if (idempotentTask.completed) throw new Error("显式恢复仍应可用");
  data.tasks = data.tasks.filter((task) => task.id !== idempotentTask.id);
  const recurringTestTask = data.tasks[0];
  recurringTestTask.repeat = "weekly";
  recurringTestTask.due = "2026-08-24";
  const recurringCountBefore = data.tasks.length;
  toggleComplete(recurringTestTask.id);
  globalThis.__recurrenceResult = {
    before: recurringCountBefore,
    after: data.tasks.length,
    next: data.tasks.find((task) => task.recurrenceSourceId === recurringTestTask.id),
  };
`, context);
if (context.__recurrenceResult.after !== context.__recurrenceResult.before + 1 || context.__recurrenceResult.next?.due !== "2026-08-31") {
  throw new Error("循环任务未正确生成下一次事项");
}

vm.runInContext(`
  const smartProject = FangcunSmartParser.parseNaturalInput("建立长期项目：毕业论文，下一步：阅读三篇综述", { now: new Date("2026-08-25T09:00:00+08:00"), totalWeeks: 17 });
  addSmartDraft(smartProject);
  const createdProject = data.projects.find((project) => project.name === "毕业论文");
  const createdNextAction = data.tasks.find((task) => task.id === createdProject?.nextActionTaskId);
  const smartTask = FangcunSmartParser.parseNaturalInput("明天下午三点交作业，重要紧急，提前一小时", { now: new Date("2026-08-25T09:00:00+08:00"), totalWeeks: 17 });
  addSmartDraft(smartTask);
  globalThis.__smartRuntimeResult = { createdProject, createdNextAction, smartTask: data.tasks[0] };
`, context);
if (!context.__smartRuntimeResult.createdNextAction || context.__smartRuntimeResult.createdNextAction.quadrant !== "q2") {
  throw new Error("长期项目未正确创建下一项行动");
}
if (context.__smartRuntimeResult.smartTask.due !== "2026-08-26" || context.__smartRuntimeResult.smartTask.dueTime !== "15:00" || context.__smartRuntimeResult.smartTask.reminderMinutes !== 60) {
  throw new Error("智能任务未正确保留日期、时间或提醒");
}

vm.runInContext(`
  const legacySchedule = normalizeData({
    tasks: [], projects: [], semester: defaultSemester(), courseExceptions: [], settings: {},
    timeSlots: [
      { number: 1, startTime: "08:00", endTime: "09:35" }, { number: 2, startTime: "10:05", endTime: "11:40" },
      { number: 3, startTime: "14:00", endTime: "15:35" }, { number: 4, startTime: "16:05", endTime: "17:40" },
      { number: 5, startTime: "19:00", endTime: "20:35" }, { number: 6, startTime: "20:45", endTime: "22:20" }
    ],
    courses: [{ id: "legacy", name: "旧课程", startSection: 1, endSection: 4 }]
  });
  const ranged = FangcunSmartParser.parseNaturalInput("明天下午3点到5点开组会，重要不紧急", { now: new Date("2026-08-25T09:00:00+08:00") });
  globalThis.__migrationResult = { slotCount: legacySchedule.timeSlots.length, course: legacySchedule.courses[0], ranged };
`, context);
if (context.__migrationResult.slotCount !== 13 || context.__migrationResult.course.startSection !== 1 || context.__migrationResult.course.endSection !== 10) {
  throw new Error("旧 6 大节课表没有正确迁移为 13 小节");
}
if (context.__migrationResult.ranged.startTime !== "15:00" || context.__migrationResult.ranged.endTime !== "17:00" || context.__migrationResult.ranged.urgent !== false) {
  throw new Error("自然语言起止时间或重要性未正确进入任务模型");
}

vm.runInContext(`
  data.semester = { name: "校历测试", startDate: "2026-02-16", totalWeeks: 20, showWeekend: true };
  const calendarCourse = { id: "calendar-course", name: "校历课程", day: 1, startSection: 1, endSection: 2, weeks: [1], reminderMinutes: 10 };
  data.courses = [calendarCourse];
  data.calendarRules = [
    { id: "holiday", date: "2026-02-16", type: "holiday", name: "春节" },
    { id: "makeup", date: "2026-02-22", type: "teaching", name: "按周一补课", useDay: 1 },
  ];
  globalThis.__calendarResult = {
    holiday: courseOccurrence(calendarCourse, new Date("2026-02-16T12:00:00+08:00")),
    makeup: courseOccurrence(calendarCourse, new Date("2026-02-22T12:00:00+08:00")),
    presetCount: chinaHolidayRules2026().length,
  };
`, context);
if (context.__calendarResult.holiday || context.__calendarResult.makeup?.id !== "calendar-course" || context.__calendarResult.presetCount !== 39) {
  throw new Error("节假日停课、补课映射或 2026 官方预设不正确");
}

vm.runInContext(`
  const visualData = normalizeData({
    tasks: [{ id: "late", title: "补交实验报告", due: "2000-01-01", completed: false, important: true, urgent: true }],
    projects: [], semester: defaultSemester(), timeSlots: defaultTimeSlots(), courseExceptions: [], calendarRules: [], settings: {},
    courses: [{ id: "legacy-color", name: "旧配色课程", day: 1, startSection: 1, endSection: 2, weeks: [1], color: "#52778e", colorAuto: false }],
  });
  data = visualData;
  globalThis.__visualResult = { color: data.courses[0].color, tip: dailyTipModel() };
`, context);
if (context.__visualResult.color !== "#4F6BED" || context.__visualResult.tip.tone !== "danger" || !context.__visualResult.tip.title.includes("补交实验报告")) {
  throw new Error("旧课程配色升级或每日焦点优先级不正确");
}

vm.runInContext(`
  const semanticCourses = normalizeData({
    tasks: [], projects: [], semester: defaultSemester(), timeSlots: defaultTimeSlots(), courseExceptions: [], calendarRules: [], settings: {},
    courses: [
      { id: "physics-tue", name: "大学物理", code: "GEN1001", day: 2, startSection: 1, endSection: 2, weeks: [1] },
      { id: "physics-fri", name: "大学物理", code: "GEN1001", day: 5, startSection: 1, endSection: 2, weeks: [1] },
      { id: "chemistry", name: "化学原理I", code: "CHEM1001", day: 3, startSection: 3, endSection: 3, weeks: [1] },
      { id: "calculus", name: "微积分A（上）", code: "MATH1004", day: 1, startSection: 4, endSection: 5, weeks: [1] },
    ],
  });
  globalThis.__courseColors = semanticCourses.courses.map((course) => ({ name: course.name, color: course.color, family: course.colorFamily }));
`, context);
if (context.__courseColors[0].color !== context.__courseColors[1].color) {
  throw new Error("同一门课程的多个时段没有保持同色");
}
if (context.__courseColors[0].color === context.__courseColors[2].color || context.__courseColors[0].family !== "science" || context.__courseColors[2].family !== "science") {
  throw new Error("同类课程没有保持同色系下的不同颜色");
}
if (context.__courseColors[3].family !== "quantitative") {
  throw new Error("课程类型色系识别不正确");
}

vm.runInContext(`
  const projectPlan = { id: "plan", name: "科研项目", startDate: "2026-08-01", due: "2026-12-31", milestones: [
    { id: "m1", title: "完成综述", due: "2026-09-01", completed: true },
    { id: "m2", title: "完成实验", due: "2026-11-01", completed: false },
  ] };
  data.projects = [projectPlan];
  data.tasks = [
    { id: "a1", title: "整理文献", projectId: "plan", completed: true, createdAt: 1 },
    { id: "a2", title: "设计实验", projectId: "plan", completed: false, important: true, due: "2026-09-10", createdAt: 2 },
  ];
  const parsedPlan = parseProjectLines("2026-09-15 | 完成中期汇报\\n联系导师确认方案");
  const metrics = projectMetrics(projectPlan);
  const monthDates = monthGridDates(2026, 7);
  data.semester = { name: "跨学期导航", startDate: "2026-02-16", totalWeeks: 20, showWeekend: true };
  scheduleMode = "week";
  displayedWeek = 24;
  const futureWeekTitle = calendarWeekTitle(displayedWeek, 10);
  moveCalendar(1);
  globalThis.__planningResult = { parsedPlan, metrics, monthDates, futureWeekTitle, displayedWeek };
`, context);
if (context.__planningResult.metrics.actual !== 50 || context.__planningResult.metrics.pending.length !== 1 || context.__planningResult.parsedPlan.length !== 2) {
  throw new Error("长期项目里程碑、多个行动或真实进度计算不正确");
}
if (context.__planningResult.monthDates.length !== 42 || context.__planningResult.monthDates[0].getDay() !== 1) {
  throw new Error("统一月历没有生成从周一开始的完整六周网格");
}
if (!context.__planningResult.futureWeekTitle.includes("学期后第 4 周") || context.__planningResult.displayedWeek !== 25) throw new Error("周日历应能继续浏览学期结束后的普通日期");

vm.runInContext(`
  const generalWeekStart = weekStartDate(25);
  const generalDate = localISO(addDays(generalWeekStart, 2));
  data.tasks = [
    { id: "general-event", title: "跨学期会议", type: "event", startDate: generalDate, startTime: "14:00", endDate: generalDate, endTime: "15:00", completed: false },
    { id: "general-deadline", title: "跨学期资料", due: generalDate, dueTime: "18:00", completed: false },
  ];
  const generalWeek = weekCalendarModel(generalWeekStart);
  globalThis.__generalWeek = { timed: generalWeek.timed.map((item) => ({ kind: item.kind, id: item.id, start: item.start })), generalDate };
`, context);
if (!context.__generalWeek.timed.some((item) => item.id === "general-event" && item.kind === "event" && item.start === 840)) throw new Error("通用周历未按真实时间显示学期外日程");
if (!context.__generalWeek.timed.some((item) => item.id === "general-deadline" && item.kind === "deadline" && item.start === 1080)) throw new Error("通用周历未同时显示任务期限");

// Exercise real rendered timestamps with a small DOM adapter, then advance the clock.
const calendarRoots = new Map();
const calendarNodes = new Map();
const originalQuery = document.querySelector;
const originalQueryAll = document.querySelectorAll;
const calendarRoot = (selector) => {
  if (!calendarRoots.has(selector)) calendarRoots.set(selector, { ...element, innerHTML: "", dataset: {}, querySelectorAll: (query) => renderedCalendarNodes(selector, query) });
  return calendarRoots.get(selector);
};
const renderedCalendarNodes = (selector, query) => {
  const root = calendarRoot(selector);
  if (calendarNodes.get(selector)?.html !== root.innerHTML) {
    const nodes = [...root.innerHTML.matchAll(/<button\b([^>]*)>/g)].map(([, attributes]) => {
      const dataset = Object.fromEntries([...attributes.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(([, name, value]) => [name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
      const classes = new Set((attributes.match(/class="([^"]*)"/)?.[1] || "").split(/\s+/));
      return { dataset, classList: { contains: (name) => classes.has(name), toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } };
    });
    calendarNodes.set(selector, { html: root.innerHTML, nodes });
  }
  return calendarNodes.get(selector).nodes.filter(({ dataset }) => query === "[data-calendar-end]" ? dataset.calendarEnd !== undefined : query === "[data-course-id][data-calendar-start]" ? dataset.courseId && dataset.calendarStart : query === "[data-calendar-past-date]" ? dataset.calendarPastDate : false);
};
document.querySelector = (selector) => ["#weekCalendar", "#scheduleBoard", "#courseAgenda"].includes(selector) ? calendarRoot(selector) : element;
document.querySelectorAll = (query) => [...calendarRoots.keys()].flatMap((selector) => renderedCalendarNodes(selector, query));
try {
  vm.runInContext(`
    data = normalizeData({
      tasks: [], projects: [], courseExceptions: [], calendarRules: [], settings: {},
      semester: { name: "课程状态测试", startDate: "2026-09-07", totalWeeks: 1, showWeekend: true },
      timeSlots: [{ number: 1, startTime: "09:00", endTime: "10:00" }, { number: 2, startTime: "10:30", endTime: "11:30" }],
      courses: [
        { id: "dim-yesterday", name: "过去日期课程", day: 1, startSection: 1, endSection: 1, weeks: [1] },
        { id: "dim-ended", name: "今日已结束课程", day: 2, startSection: 1, endSection: 1, weeks: [1] },
        { id: "dim-current", name: "正在进行课程", day: 2, startSection: 2, endSection: 2, weeks: [1] },
        { id: "dim-future", name: "未来课程", day: 3, startSection: 1, endSection: 1, weeks: [1] },
      ],
    });
    displayedWeek = 1;
  `, context);
  for (const mode of ["week", "timetable"]) {
    for (const layout of ["overview", "detail", "list"]) {
      vm.runInContext(`scheduleMode = "${mode}"; localStorage.setItem(accountKey("fangcun-calendar-layout"), "${layout}"); renderSchedule(); refreshCalendarPast(new Date(2026, 8, 8, 11, 0));`, context);
      const selector = layout === "list" ? "#courseAgenda" : mode === "week" ? "#weekCalendar" : "#scheduleBoard";
      const courses = renderedCalendarNodes(selector, "[data-course-id][data-calendar-start]");
      if (courses.length !== 4) throw new Error(`${mode}/${layout} 未保留四门课程及起止时间`);
      for (const course of courses) {
        const expected = ["dim-yesterday", "dim-ended"].includes(course.dataset.courseId);
        if (course.classList.contains("dim") !== expected) throw new Error(`${mode}/${layout} 过去课程变暗状态错误：${course.dataset.courseId}`);
        if (course.classList.contains("is-current") !== (course.dataset.courseId === "dim-current")) throw new Error(`${mode}/${layout} 进行中课程高亮错误`);
      }
      vm.runInContext(`refreshCalendarPast(new Date(2026, 8, 8, 12, 0));`, context);
      if (!courses.find((course) => course.dataset.courseId === "dim-current").classList.contains("dim")) throw new Error(`${mode}/${layout} 时钟推进未更新已结束课程`);
      vm.runInContext(`refreshCalendarPast(new Date(2026, 8, 8, 10, 0));`, context);
      if (courses.find((course) => course.dataset.courseId === "dim-ended").classList.contains("dim")) throw new Error("结束时间严格小于当前时间时才应变暗");
    }
  }
} finally {
  document.querySelector = originalQuery;
  document.querySelectorAll = originalQueryAll;
}
const calendarDimCss = fs.readFileSync("calendar-surface.css", "utf8");
if (!/\.dim\s*\{[^}]*opacity:\.52\s*!important;[^}]*filter:saturate\(\.35\)/.test(calendarDimCss)) throw new Error("课程 dim 状态必须实际降低透明度与饱和度");
console.log("课程变暗检查通过：周历/课表 × 全表/详情/清单，过去日期、09:00–10:00 已结束、进行中、未来和时钟推进均已验证。");

vm.runInContext(`
  const flowToday = localISO();
  const flowYesterday = localISO(addDays(new Date(), -1));
  const flowProject = { id: "flow-project", name: "科研复现", startDate: flowYesterday, due: localISO(addDays(new Date(), 30)), milestones: [] };
  data.projects = [flowProject];
  data.tasks = [
    { id: "late-focus", title: "逾期实验报告", due: flowYesterday, completed: false, important: true, urgent: true, quadrant: "q1", createdAt: 1 },
    { id: "today-focus", title: "今天 DDL", due: flowToday, dueTime: "23:59", completed: false, important: true, urgent: true, quadrant: "q1", createdAt: 2 },
    { id: "project-focus", title: "阅读原论文", projectId: "flow-project", estimateMinutes: 45, completed: false, important: true, urgent: false, quadrant: "q2", createdAt: 3 },
    { id: "later-focus", title: "普通事项", completed: false, important: false, urgent: false, quadrant: "q4", createdAt: 4 },
  ];
  const selectedFocus = focusTasks(3);
  const deadlineCopy = deadlineLabel(data.tasks[0]);
  globalThis.__todayFlow = { selectedFocus, deadlineCopy };
`, context);
if (context.__todayFlow.selectedFocus.length !== 3 || context.__todayFlow.selectedFocus[0].id !== "late-focus" || !context.__todayFlow.selectedFocus.some((task) => task.id === "project-focus")) {
  throw new Error("Today 没有正确收敛到逾期、今日 DDL 与项目下一行动");
}
if (!context.__todayFlow.deadlineCopy.includes("逾期")) throw new Error("统一 Deadline 文案未明确显示逾期");

vm.runInContext(`
  data.timeSlots = defaultTimeSlots();
  data.courses = [{ id: "existing-course", name: "大学物理", day: 1, startSection: 1, endSection: 2, weeks: [1,2], color: "#4F6BED" }];
  const importedCourses = [
    { name: "大学物理", day: 1, startSection: 1, endSection: 2, weeks: [2,3] },
    { name: "实验课", day: 1, startSection: 2, endSection: 3, weeks: [1] },
    { name: "计算机基础", day: 2, startSection: 4, endSection: 5, weeks: [1,2] },
    { name: "异常课程", day: 9, startSection: 1, endSection: 2, weeks: [1] },
  ];
  stageScheduleImport({ source: "测试导入", courses: importedCourses });
  const stagedStatuses = pendingScheduleImport.courses.map((course) => course.importStatus);
  confirmScheduleImport();
  const afterImport = data.courses.length;
  const mergedWeeks = data.courses.find((course) => course.id === "existing-course").weeks;
  undoScheduleImport();
  globalThis.__importFlow = { stagedStatuses, afterImport, mergedWeeks, afterUndo: data.courses.length };
`, context);
if (!context.__importFlow.stagedStatuses.includes("duplicate") || !context.__importFlow.stagedStatuses.includes("conflict") || !context.__importFlow.stagedStatuses.includes("anomaly")) {
  throw new Error("课表导入预览没有识别重复、冲突和异常");
}
if (context.__importFlow.afterImport !== 3 || !context.__importFlow.mergedWeeks.includes(3) || context.__importFlow.afterUndo !== 1) {
  throw new Error("课表确认导入、周次合并或撤销没有形成闭环");
}

vm.runInContext(`
  const unresolved = FangcunSmartParser.parseNaturalInput("15:00交实验报告", { now: new Date("2026-08-25T09:00:00+08:00") });
  data.tasks = [];
  addSmartDraft(unresolved);
  globalThis.__uncertainFlow = data.tasks[0];
`, context);
if (context.__uncertainFlow.quadrant !== null || !context.__uncertainFlow.confirmationIssues.some((issue) => issue.field === "due")) {
  throw new Error("无法确定日期的自然语言任务没有进入待确认");
}

console.log(`运行时检查通过：循环任务、Today Focus、项目行动、智能歧义、导入预览撤销、统一日历与提醒均已验证。`);
