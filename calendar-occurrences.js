"use strict";

// 方寸课程发生语义的服务端权威镜像（与 app.js 的 courseOccurrence() 引擎逐分支等价）。
// 网页端由 app.js 内联实现（浏览器无法 require），服务端由本模块提供：
// server.js 的日历订阅（.ics）与 outlook-sync.js 的双向同步（Google 复用）共用。
// 两处语义必须逐分支一致，由 calendar-occurrences-smoke.js 的对照测试守护——
// 修改任一侧后必须同步另一侧并重跑 `npm run check`。

function splitDate(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

// 1=周一 … 7=周日（与浏览器端 (getDay() || 7) 一致）。
function dayNumber(value) {
  const parts = splitDate(value);
  if (!parts) return 0;
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

// 纯日历日加减（无夏令时环境下与浏览器端 addDays 等价）。
function shiftDate(value, amount) {
  const parts = splitDate(value);
  const offset = Number(amount);
  if (!parts || !Number.isFinite(offset)) return "";
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset, 12)).toISOString().slice(0, 10);
}

function mondayOf(value) {
  const weekday = dayNumber(value);
  return weekday ? shiftDate(value, 1 - weekday) : "";
}

function weekStartDate(startDate, week) {
  return shiftDate(startDate, (Number(week) - 1) * 7);
}

function currentSemesterWeek(startDate, value) {
  const start = mondayOf(startDate);
  const current = mondayOf(value);
  if (!start || !current) return 0;
  const days = Math.round((Date.parse(current + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / 86400000);
  return Math.floor(days / 7) + 1;
}

function exceptionsOf(document) {
  return Array.isArray(document?.courseExceptions) ? document.courseExceptions : [];
}

function ruleForDate(document, dateKey) {
  const rules = Array.isArray(document?.calendarRules) ? document.calendarRules : [];
  return rules.find((item) => item.date === dateKey) || null;
}

function exceptionForWeek(document, course, week) {
  const startDate = document?.semester?.startDate;
  if (!startDate) return null;
  const originalKey = shiftDate(weekStartDate(startDate, week), Number(course.day) - 1);
  if (!originalKey) return null;
  return exceptionsOf(document).find((item) => item.courseId === course.id && item.date === originalKey) || null;
}

// 与 app.js courseOccurrence() 等价：给定文档、课程与日历日（YYYY-MM-DD），
// 返回该日该课的实例（含节次、稳定键日期 keyDate 与来源记录 record），不出现则为 null。
function courseOccurrence(document, course, dateKey) {
  const exceptions = exceptionsOf(document);
  const semesterStart = document?.semester?.startDate;
  const movedHere = exceptions.find((item) => item.courseId === course.id && item.type === "reschedule" && item.targetDate === dateKey);
  if (movedHere) {
    const originalWeek = currentSemesterWeek(semesterStart, movedHere.date);
    if (!(Array.isArray(course.weeks) && course.weeks.includes(originalWeek))) return null;
    return { course, date: dateKey, keyDate: movedHere.date, day: dayNumber(dateKey), startSection: movedHere.startSection, endSection: movedHere.endSection, occurrenceChanged: true, record: movedHere };
  }
  const week = currentSemesterWeek(semesterStart, dateKey);
  const calendarRule = ruleForDate(document, dateKey);
  if (calendarRule?.type === "holiday") return null;
  const weekday = calendarRule?.type === "teaching" ? Number(calendarRule.useDay) : dayNumber(dateKey);
  if (!(Array.isArray(course.weeks) && course.weeks.includes(week))) return null;
  // 补课日实例的逐次调整（同步方在补课日本身建立的记录：删除/改时该次补课）。
  // cancel → 该次补课已删除；reschedule 且已挪往他处 → 不再重放；同落点 → 沿用其记录的节次。
  let teachingDayRecord = null;
  if (calendarRule?.type === "teaching" && Number(course.day) === Number(weekday)) {
    const sameDay = exceptions.find((item) => item.courseId === course.id && item.date === dateKey);
    if (sameDay?.type === "cancel") return null;
    if (sameDay?.type === "reschedule") {
      if (sameDay.targetDate && sameDay.targetDate !== dateKey) return null;
      teachingDayRecord = sameDay;
    }
  }
  const exception = exceptions.length ? exceptionForWeek(document, course, week) : null;
  if (exception?.type === "cancel") return null;
  if (exception?.type === "reschedule") {
    if (calendarRule?.type === "teaching") {
      if (Number(course.day) !== Number(weekday)) return null;
      const originalKey = shiftDate(weekStartDate(semesterStart, week), Number(course.day) - 1);
      const movedAway = exception.targetDate ? exception.targetDate !== originalKey : Number(exception.day) !== Number(course.day);
      if (movedAway) return null;
      const source = teachingDayRecord || exception;
      return { course, date: dateKey, keyDate: dateKey, day: weekday, startSection: source.startSection, endSection: source.endSection, occurrenceChanged: true, record: source };
    }
    if (!(exception.targetDate ? exception.targetDate === dateKey : exception.day === weekday)) return null;
    return { course, date: dateKey, keyDate: exception.date, day: exception.day, startSection: exception.startSection, endSection: exception.endSection, occurrenceChanged: true, record: exception };
  }
  if (calendarRule?.type === "teaching" && Number(course.day) === Number(weekday) && teachingDayRecord) {
    return { course, date: dateKey, keyDate: dateKey, day: weekday, startSection: teachingDayRecord.startSection, endSection: teachingDayRecord.endSection, occurrenceChanged: true, record: teachingDayRecord };
  }
  if (course.day === weekday) return { course, date: dateKey, keyDate: dateKey, day: weekday, startSection: course.startSection, endSection: course.endSection, occurrenceChanged: false, record: null };
  return null;
}

// 学期内全部课程实例（与网页端"逐日扫描"语义一致，含补课日重放与被挪入的实例）。
function semesterCourseOccurrences(document) {
  const semesterStart = document?.semester?.startDate;
  const totalWeeks = Number(document?.semester?.totalWeeks) || 0;
  const courses = Array.isArray(document?.courses) ? document.courses : [];
  if (!semesterStart || !Number.isFinite(totalWeeks) || totalWeeks < 1) return [];
  const items = [];
  for (let offset = 0; offset < totalWeeks * 7; offset += 1) {
    const dateKey = shiftDate(semesterStart, offset);
    if (!dateKey) break;
    courses.forEach((course) => {
      const occurrence = courseOccurrence(document, course, dateKey);
      if (occurrence) items.push({ course, occurrence, dateKey, keyDate: occurrence.keyDate, record: occurrence.record });
    });
  }
  return items;
}

module.exports = { courseOccurrence, semesterCourseOccurrences, currentSemesterWeek, dayNumber, shiftDate, weekStartDate };
