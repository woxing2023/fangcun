const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { OutlookIntegration, localEvents, graphPayload, markerFromEvent, remoteToTask } = require("./outlook-sync");

const document = {
  tasks: [{ id: "ddl-1", title: "交实验报告", due: "2026-09-18", dueTime: "20:00", notes: "检查格式", location: "线上", reminderMinutes: 1440, completed: false, updatedAt: 10 }],
  courses: [{ id: "physics", name: "大学物理", code: "GEN1001", teacher: "张老师", campus: "湖畔", location: "B12-201", day: 2, startSection: 1, endSection: 2, weeks: [1, 2], reminderMinutes: 15, createdAt: 10 }],
  timeSlots: [{ number: 1, startTime: "08:00", endTime: "08:45" }, { number: 2, startTime: "08:50", endTime: "09:35" }],
  courseExceptions: [], calendarRules: [], semester: { startDate: "2026-08-31", totalWeeks: 20 }, settings: {}, projects: [],
};

const events = localEvents(document);
assert.equal(events.length, 3);
assert.equal(events[0].title, "DDL · 交实验报告");
assert.equal(events[1].location, "湖畔 · B12-201");
assert.equal(events[1].endTime, "09:35");

const payload = graphPayload(events[0]);
assert.equal(payload.start.timeZone, "China Standard Time");
assert.equal(payload.reminderMinutesBeforeStart, 1440);
assert.equal(markerFromEvent({ body: payload.body }), "task:ddl-1");

const imported = remoteToTask({
  subject: "Outlook 会议", body: { content: "<p>讨论进度</p>" }, location: { displayName: "会议室" },
  start: { dateTime: "2026-09-02T14:00:00" }, end: { dateTime: "2026-09-02T15:30:00" },
  isAllDay: false, isReminderOn: true, reminderMinutesBeforeStart: 30, lastModifiedDateTime: "2026-08-31T10:00:00Z",
}, "imported-1");
assert.equal(imported.startDate, "2026-09-02");
assert.equal(imported.endTime, "15:30");
assert.equal(imported.reminderMinutes, 30);

const database = new DatabaseSync(":memory:");
database.exec("CREATE TABLE users (id INTEGER PRIMARY KEY)");
database.prepare("INSERT INTO users (id) VALUES (?)").run(1);
const integration = new OutlookIntegration(database, {
  MICROSOFT_CLIENT_ID: "client-id", MICROSOFT_CLIENT_SECRET: "client-secret", MICROSOFT_TENANT: "common",
  MICROSOFT_REDIRECT_URI: "https://schedule.example/api/integrations/outlook/callback", FANGCUN_INTEGRATION_KEY: "test-integration-key-not-for-production",
});
const authorization = integration.begin(1, "android");
assert.match(authorization.authUrl, /^https:\/\/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize\?/);
assert.match(authorization.authUrl, /Calendars\.ReadWrite/);
assert.equal(integration.status(1).configured, true);
const encrypted = integration.encrypt("refresh-token");
assert.notEqual(encrypted, "refresh-token");
assert.equal(integration.decrypt(encrypted), "refresh-token");
database.close();

console.log("Outlook 双向同步检查通过：任务、课程、提醒、稳定标记、导入转换、OAuth 状态和令牌加密均正常。");
