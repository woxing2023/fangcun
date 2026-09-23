#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""2026-09-23 服务器 DB 原子清洗（python3 stdlib 版——服务器无 better-sqlite3，生产 server.js 用 node:sqlite）。
与 deploy/data-cleanup-20260923.js 同逻辑：
  ① 156 条同落点同节次 reschedule（安卓日历把正常上课回写成调课 → 课程块带「·调」）
  ② 16 条孤儿记录（指向已删除课程 mtg02pjo-1f2q30）
  ③ 10 条同毫秒批量假 cancel（安卓删除误判闭环，特征 = 同 updatedAt 毫秒 ≥4 条不同课 + source=android-calendar）
策略：备份先行（由升级脚本完成）→ 三类剔除 → 快照留档 user_snapshots → revision+1 原子写回。
用法: sudo python3 data-cleanup-20260923.py /var/lib/fangcun/fangcun.sqlite [--apply]（缺省 dry-run 只读）
"""
import json
import sqlite3
import sys
from datetime import datetime, timezone

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    apply = "--apply" in sys.argv
    if not args:
        print("用法: sudo python3 data-cleanup-20260923.py <sqlite-path> [--apply]")
        sys.exit(2)
    path = args[0]
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    row = con.execute("SELECT document, revision FROM user_states WHERE user_id = 3").fetchone()
    if not row:
        print("uid=3 不存在")
        sys.exit(1)
    doc = json.loads(row["document"])
    courses = doc.get("courses") or []
    course_ids = {c.get("id") for c in courses}
    exceptions = doc.get("courseExceptions") or []
    before = len(exceptions)

    # ③ 同毫秒批量假 cancel 识别：type=cancel + source=android-calendar，按 updatedAt 分组，同毫秒 ≥4 整组剔除
    groups = {}
    for e in exceptions:
        if isinstance(e, dict) and e.get("type") == "cancel" and e.get("source") == "android-calendar" and e.get("updatedAt"):
            groups.setdefault(str(e["updatedAt"]), []).append(e)
    fake_cancel = set()
    for stamp, lst in groups.items():
        if len(lst) >= 4:
            fake_cancel.update(id(x) for x in lst)

    kept = []
    removed = {"sameSlotReschedule": 0, "orphan": 0, "fakeCancelBatch": 0}
    fake_detail = []
    for e in exceptions:
        if not isinstance(e, dict):
            removed["orphan"] += 1
            continue
        if e.get("courseId") and e["courseId"] not in course_ids:
            removed["orphan"] += 1
            continue
        if id(e) in fake_cancel:
            removed["fakeCancelBatch"] += 1
            course = next((c for c in courses if c.get("id") == e.get("courseId")), None)
            fake_detail.append(f"{(course or {}).get('name') or e.get('courseId')} {e.get('date')}")
            continue
        if (e.get("type") == "reschedule" and e.get("date") and e.get("targetDate")
                and e["date"] == e["targetDate"]):
            course = next((c for c in courses if c.get("id") == e.get("courseId")), None)
            if (course and str(course.get("startSection")) == str(e.get("startSection"))
                    and str(course.get("endSection")) == str(e.get("endSection"))):
                removed["sameSlotReschedule"] += 1
                continue
        kept.append(e)
    doc["courseExceptions"] = kept
    fake_detail.sort()
    print(json.dumps({"before": before, "after": len(kept), "removed": removed, "fakeCancelled": fake_detail},
                     ensure_ascii=False, indent=2))
    if not apply:
        print("DRY-RUN 只读，未写回。加 --apply 执行。")
        sys.exit(0)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    con.execute("INSERT INTO user_snapshots (user_id, revision, document, created_at) VALUES (?, ?, ?, ?)",
                (3, row["revision"], row["document"], now))
    con.execute("UPDATE user_states SET document = ?, revision = revision + 1, updated_at = ? WHERE user_id = 3",
                (json.dumps(doc, ensure_ascii=False), now))
    con.commit()
    new_rev = con.execute("SELECT revision FROM user_states WHERE user_id = 3").fetchone()["revision"]
    print(f"APPLIED newRevision={new_rev}")
    con.close()

if __name__ == "__main__":
    main()
