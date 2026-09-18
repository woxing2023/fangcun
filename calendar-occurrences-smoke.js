"use strict";

// calendar-occurrences-smoke.js —— 语义对照测试（唯一质量闸）
//
// 目的：calendar-occurrences.js（服务端权威镜像）与 app.js 的
// courseOccurrence()/semesterCourseOccurrences()（浏览器端）必须逐分支等价。
// 覆盖：基础周课 / 同周调课 / 挪入实例 / 停课 / 补课日重放 /
//       补课日删除 / 补课日挪走 / 节假日 / 非补课星期 / 本周已停不再重放 / 周末课。
// 任一侧修改后必须同步另一侧并重跑 `npm run check`。

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { semesterCourseOccurrences } = require("./calendar-occurrences");

// ---------------- vm 引导（同 runtime-smoke.js 模式） ----------------

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

const documentStub = {
  body: element,
  querySelector() { return element; },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() { return { ...element, click() {} }; },
};

const context = {
  AbortController,
  console,
  document: documentStub,
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

// ---------------- 夹具（学期 2026-08-31 起 4 周，每周一起算） ----------------

const fixture = {
  semester: { startDate: "2026-08-31", totalWeeks: 4 },
  timeSlots: [
    { number: 1, startTime: "08:00", endTime: "08:45" },
    { number: 2, startTime: "08:50", endTime: "09:35" },
    { number: 3, startTime: "14:00", endTime: "14:45" },
    { number: 4, startTime: "14:50", endTime: "15:35" },
    { number: 5, startTime: "19:00", endTime: "19:45" },
    { number: 6, startTime: "19:50", endTime: "20:35" },
  ],
  courses: [
    { id: "c-basic", name: "基础课", day: 1, startSection: 1, endSection: 2, weeks: [1, 2, 3, 4], reminderMinutes: 15 },
    { id: "c-resched-same", name: "同周调课", day: 1, startSection: 1, endSection: 2, weeks: [2], reminderMinutes: 15 },
    { id: "c-moved-in", name: "挪入课", day: 1, startSection: 1, endSection: 2, weeks: [3], reminderMinutes: 15 },
    { id: "c-cancel", name: "停课", day: 2, startSection: 3, endSection: 4, weeks: [2], reminderMinutes: 15 },
    { id: "c-makeup", name: "补课调整", day: 5, startSection: 3, endSection: 4, weeks: [1, 2, 3, 4], reminderMinutes: 15 },
    { id: "c-makeup-cancel", name: "补课日删除", day: 5, startSection: 5, endSection: 6, weeks: [2], reminderMinutes: 15 },
    { id: "c-makeup-moved", name: "补课日挪走", day: 5, startSection: 1, endSection: 2, weeks: [2], reminderMinutes: 15 },
    { id: "c-holiday", name: "假日课", day: 4, startSection: 1, endSection: 2, weeks: [2], reminderMinutes: 15 },
    { id: "c-teaching-otherday", name: "非补课星期", day: 3, startSection: 3, endSection: 4, weeks: [2], reminderMinutes: 15 },
    { id: "c-teaching-cancel-weekly", name: "本周已停", day: 5, startSection: 1, endSection: 2, weeks: [2], reminderMinutes: 15 },
    { id: "c-weekend", name: "周日晚课", day: 7, startSection: 5, endSection: 6, weeks: [1, 4], reminderMinutes: 15 },
  ],
  courseExceptions: [
    { id: "e1", courseId: "c-resched-same", type: "reschedule", date: "2026-09-07", day: 2, startSection: 1, endSection: 2 },
    { id: "e2", courseId: "c-moved-in", type: "reschedule", date: "2026-09-14", targetDate: "2026-09-16", day: 3, startSection: 5, endSection: 6 },
    { id: "e3", courseId: "c-cancel", type: "cancel", date: "2026-09-08" },
    { id: "e4", courseId: "c-makeup", type: "reschedule", date: "2026-09-13", startSection: 5, endSection: 6 },
    { id: "e5", courseId: "c-makeup-cancel", type: "cancel", date: "2026-09-13" },
    { id: "e6", courseId: "c-makeup-moved", type: "reschedule", date: "2026-09-13", targetDate: "2026-09-15", day: 2, startSection: 1, endSection: 2 },
    { id: "e7", courseId: "c-teaching-cancel-weekly", type: "cancel", date: "2026-09-11" },
  ],
  calendarRules: [
    { date: "2026-09-13", type: "teaching", useDay: 5 },
    { date: "2026-09-10", type: "holiday" },
  ],
};

vm.runInContext(`
  data.semester = ${JSON.stringify(fixture.semester)};
  data.timeSlots = ${JSON.stringify(fixture.timeSlots)};
  data.courses = ${JSON.stringify(fixture.courses)};
  data.courseExceptions = ${JSON.stringify(fixture.courseExceptions)};
  data.calendarRules = ${JSON.stringify(fixture.calendarRules)};
  const project = (items) => items.map(({ course, occurrence, dateKey, keyDate, record }) => ({
    courseId: course.id,
    dateKey: dateKey ?? null,
    keyDate: keyDate ?? null,
    day: (occurrence.day ?? course.day) ?? null,
    startSection: occurrence.startSection ?? null,
    endSection: occurrence.endSection ?? null,
    changed: Boolean(occurrence.occurrenceChanged),
    recType: record?.type ?? null,
    recDate: record?.date ?? null,
    recStart: record?.startSection ?? null,
    recEnd: record?.endSection ?? null,
  }));
  globalThis.__parityJson = JSON.stringify(project(semesterCourseOccurrences()));
`, context);

const browserItems = JSON.parse(context.__parityJson);

const moduleItems = semesterCourseOccurrences(fixture).map(({ course, occurrence, dateKey, keyDate, record }) => ({
  courseId: course.id,
  dateKey: dateKey ?? null,
  keyDate: keyDate ?? null,
  day: (occurrence.day ?? course.day) ?? null,
  startSection: occurrence.startSection ?? null,
  endSection: occurrence.endSection ?? null,
  changed: Boolean(occurrence.occurrenceChanged),
  recType: record?.type ?? null,
  recDate: record?.date ?? null,
  recStart: record?.startSection ?? null,
  recEnd: record?.endSection ?? null,
}));

// ---------------- 1) 全量对照：两侧逐条一致（含顺序） ----------------

assert.deepEqual(moduleItems, browserItems, "服务端模块与浏览器端 semesterCourseOccurrences() 输出必须逐条一致");
assert.ok(moduleItems.length > 0, "对照集不能为空");

// ---------------- 2) 分支语义锁定（对照通过之外，再钉死每个分支的预期行为） ----------------

const find = (courseId, dateKey) => moduleItems.find((item) => item.courseId === courseId && item.dateKey === dateKey) || null;

// 基础周课：四周各一次，未调整。
assert.equal(moduleItems.filter((item) => item.courseId === "c-basic").length, 4);
const basic = find("c-basic", "2026-08-31");
assert.ok(basic && basic.changed === false && basic.startSection === 1 && basic.endSection === 2, "基础周课应为原节次");

// 同周调课：09-07（周一）取消落点、09-08（周二）出现在记录节次，稳定键沿用原日期。
assert.equal(find("c-resched-same", "2026-09-07"), null, "同周调课的原始日期不应出现");
const resched = find("c-resched-same", "2026-09-08");
assert.ok(resched && resched.changed === true && resched.keyDate === "2026-09-07", "同周调课应在目标日出现且 keyDate 稳定");

// 挪入实例：09-14 原日期不出现、09-16 出现（节次用记录值），keyDate 指向原日期。
assert.equal(find("c-moved-in", "2026-09-14"), null, "被挪走的实例不应在原始日期出现");
const movedIn = find("c-moved-in", "2026-09-16");
assert.ok(movedIn && movedIn.startSection === 5 && movedIn.endSection === 6 && movedIn.keyDate === "2026-09-14", "挪入实例应在目标日出现并保留原日期作 keyDate");

// 停课：该日不出现在课程表。
assert.equal(find("c-cancel", "2026-09-08"), null, "停课实例不应出现");

// 补课日（09-13 周日补周五课程）：
// - 补课日重放正常课（沿用原节次）；
// - 同落点调整记录（09-13 当日 reschedule）沿用其节次；
// - 当日 cancel 的补课不重复出现；
// - 已挪走的补课不重复出现，改为出现在其目标日；
// - 非补课星期（课程 day≠useDay）不重放；
// - 本周被取消的实例（09-11 cancel）不因补课日而复活。
const makeupFriday = find("c-makeup", "2026-09-11");
assert.ok(makeupFriday && makeupFriday.changed === false && makeupFriday.startSection === 3, "补课日所属周的周五原课应照常出现");
const makeupReplay = find("c-makeup", "2026-09-13");
assert.ok(makeupReplay && makeupReplay.changed === true && makeupReplay.startSection === 5 && makeupReplay.endSection === 6, "补课日应重放假日课程并沿用当日调整记录的节次");
assert.equal(makeupReplay.recType, "reschedule", "补课日调整的来源记录应被保留");
assert.equal(find("c-makeup-cancel", "2026-09-13"), null, "补课日当日被删除的实例不应重放");
assert.equal(find("c-makeup-moved", "2026-09-13"), null, "已挪走的补课实例不应在补课日重复出现");
const makeupMoved = find("c-makeup-moved", "2026-09-15");
assert.ok(makeupMoved && makeupMoved.startSection === 1 && makeupMoved.keyDate === "2026-09-13", "挪走实例应出现在目标日且 keyDate 指向补课日");
assert.ok(find("c-makeup-moved", "2026-09-11"), "补课实例被挪走后，其周五原课仍应照常出现");
assert.equal(find("c-teaching-otherday", "2026-09-13"), null, "非补课星期的课程不参与补课日重放");
assert.ok(find("c-teaching-otherday", "2026-09-09"), "非补课星期的课程应在其原本星期出现");
assert.equal(find("c-teaching-cancel-weekly", "2026-09-11"), null, "周五停课实例不应出现");
assert.equal(find("c-teaching-cancel-weekly", "2026-09-13"), null, "本周已停课的实例不应因补课日复活");

// 节假日：09-10 整日无课。
assert.equal(find("c-holiday", "2026-09-10"), null, "节假日规则应隐藏全部课程");

// 周末课：第 1/4 周周日出现、第 2 周（教学周内非开课周）不出现。
assert.ok(find("c-weekend", "2026-09-06"), "第 1 周周日课应出现");
assert.equal(find("c-weekend", "2026-09-13"), null, "第 2 周周日课（未开课周）不应出现");
assert.ok(find("c-weekend", "2026-09-27"), "第 4 周周日课应出现");

console.log(`calendar-occurrences-smoke: OK（对照 ${moduleItems.length} 条实例 × 2 实现逐条一致，20 项分支断言全过）`);
