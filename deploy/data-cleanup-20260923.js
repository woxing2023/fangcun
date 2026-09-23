"use strict";
// 2026-09-23 服务器 DB 原子清洗：Robin 附 5 张课表截图「自己看看这个课表有多少问题，排查修复」
// 生产 uid=3 实锤三件套垃圾：
// ① 156 条同落点同节次 reschedule（安卓日历把正常上课回写成调课 → 课程块带「·调」）
// ② 16 条孤儿记录（指向已删除课程 mtg02pjo-1f2q30）
// ③ 10 条同毫秒批量假 cancel（安卓删除误判闭环：幻影节次→同步 payload 跳过→APK 删日历事件→read 缺键→写 cancel；
//    特征 = 同 updatedAt 毫秒 + 10 条不同课 + 来源 android-calendar → 10/14 微积分A 等课消失）
// 策略：备份先行 → 三类剔除（假 cancel 按同毫秒批量识别整组回滚）→ revision+1 原子写回 → 快照留档。
// 用法: node data-cleanup-20260923.js <sqlite-path> [--apply]（缺省 dry-run 只读）
const path = process.argv[2];
const apply = process.argv.includes("--apply");
if (!path) { console.error("用法: node data-cleanup-20260923.js <sqlite-path> [--apply]"); process.exit(2); }

let Database;
try { ({ Database } = require("better-sqlite3")); }
catch { console.error("需要 better-sqlite3（服务器端 npm root 下可用）"); process.exit(2); }

const db = new Database(path, apply ? undefined : { readonly: true });
const row = db.prepare("SELECT document, revision FROM user_states WHERE user_id = 3").get();
if (!row) { console.error("uid=3 不存在"); process.exit(1); }
const doc = JSON.parse(row.document);
const courseIds = new Set((doc.courses || []).map((c) => c.id));
const before = (doc.courseExceptions || []).length;

// ③ 同毫秒批量假 cancel 识别：type=cancel 且来源 android-calendar，按 updatedAt 分组；
//    同一毫秒内 cancel 数 >= 4 视为安卓删除误判批量写入（真删除是一次删一门），整组剔除。
const cancelGroups = new Map();
for (const e of doc.courseExceptions || []) {
  if (e && e.type === "cancel" && e.source === "android-calendar" && e.updatedAt) {
    const key = String(e.updatedAt);
    if (!cancelGroups.has(key)) cancelGroups.set(key, []);
    cancelGroups.get(key).push(e);
  }
}
const fakeCancelKeys = new Set();
for (const [stamp, list] of cancelGroups) if (list.length >= 4) list.forEach((e) => fakeCancelKeys.add(e));

const kept = [];
const removed = { sameSlotReschedule: 0, orphan: 0, fakeCancelBatch: 0 };
for (const e of doc.courseExceptions || []) {
  if (!e || typeof e !== "object") { removed.orphan += 1; continue; }
  if (e.courseId && !courseIds.has(e.courseId)) { removed.orphan += 1; continue; }
  if (fakeCancelKeys.has(e)) { removed.fakeCancelBatch += 1; continue; }
  if (e.type === "reschedule" && e.date && e.targetDate && e.date === e.targetDate) {
    const course = (doc.courses || []).find((c) => c.id === e.courseId);
    if (course && Number(course.startSection) === Number(e.startSection) && Number(course.endSection) === Number(e.endSection)) { removed.sameSlotReschedule += 1; continue; }
  }
  kept.push(e);
}
doc.courseExceptions = kept;
const fakeDetail = [...fakeCancelKeys].map((e) => `${(doc.courses.find((c) => c.id === e.courseId) || {}).name || e.courseId} ${e.date}`).sort();
console.log(JSON.stringify({ before, after: kept.length, removed, fakeCancelled: fakeDetail }, null, 2));
if (!apply) { console.log("DRY-RUN 只读，未写回。加 --apply 执行。"); process.exit(0); }
// 快照留档（表名=user_snapshots，带 user_id——同 server.js addSnapshot 语义）
db.prepare("INSERT INTO user_snapshots (user_id, revision, document, created_at) VALUES (?, ?, ?, ?)").run(3, row.revision, row.document, new Date().toISOString());
const info = db.prepare("UPDATE user_states SET document = ?, revision = revision + 1, updated_at = ? WHERE user_id = 3").run(JSON.stringify(doc), new Date().toISOString());
console.log("APPLIED rows=%d newRevision=%d", info.changes, row.revision + 1);
