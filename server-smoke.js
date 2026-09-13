const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const serverSource = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
assert.match(serverSource, /DROP TABLE IF EXISTS voice_commands;[\s\S]*DROP TABLE IF EXISTS voice_tokens;/, "服务器升级时应清除已停用功能遗留的令牌和命令记录");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(origin) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务器未能按时启动");
}

async function checkAgentApi(origin, ownerHeaders, otherHeaders, dataDirectory) {
  const api = (route, headers = {}, method = "GET", body) => fetch(`${origin}/api/agent${route}`, {
    method, headers: { ...headers, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const tokenHeaders = (token) => ({ Authorization: `Bearer ${token}` });
  const createToken = async (name, headers = ownerHeaders, expiresInDays) => {
    const response = await api("/tokens", headers, "POST", { name, ...(expiresInDays === undefined ? {} : { expiresInDays }) });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const created = await response.json();
    assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(created.name, name);
    return created;
  };
  for (const route of ["/schedule", "/tasks", "/tasks/missing"]) {
    const method = route === "/schedule" ? "GET" : route === "/tasks" ? "POST" : "PATCH";
    assert.equal((await api(route, {}, method)).status, 401, "业务接口必须要求 Agent 令牌");
    assert.equal((await api(route, ownerHeaders, method)).status, 401, "会话 Cookie 不能代替 Agent 令牌");
    assert.equal((await api(route, tokenHeaders("a".repeat(43)), method)).status, 401, "伪造令牌必须失败");
  }
  assert.equal((await api("/tokens")).status, 401);
  assert.equal((await api("/audit")).status, 401);
  for (const body of [null, [], {}, { name: " " }, { name: "." }, { name: ".." }, { name: "\ud800" }, { name: "n".repeat(61) }, { name: "bad\nname" }, { name: "invalid", expiresInDays: 366 }, { name: "invalid", expiresInDays: 0 }, { name: "invalid", expiresInDays: 1.5 }, { name: "invalid", expiresInDays: "90" }, { name: "invalid", expiresInDays: null }, { name: "invalid", token: "injected" }]) {
    assert.equal((await api("/tokens", ownerHeaders, "POST", body)).status, 400, "令牌管理也必须严格验证输入");
  }
  const created = await createToken("agent smoke / 主要令牌");
  const headers = tokenHeaders(created.token);
  assert.equal(created.expiresAt - created.createdAt, 90 * 86400000, "令牌默认 90 天过期");
  assert.equal((await api("/tokens", ownerHeaders, "POST", { name: created.name })).status, 409, "同用户名称不能覆盖已有令牌");
  assert.equal((await api("/tokens", headers)).status, 401);
  assert.equal((await api("/tokens", headers, "POST", { name: "nested" })).status, 401, "Agent 不能给自己生成更多令牌");
  assert.equal((await api("/audit", headers)).status, 401);
  assert.equal((await api("/tokens", { ...ownerHeaders, ...headers })).status, 401, "管理接口不接受混合 Bearer 鉴权");
  assert.equal((await fetch(`${origin}/api/data`, { headers })).status, 401, "Agent 不能访问会话 API");
  const listing = await api("/tokens", ownerHeaders).then((response) => response.json());
  assert.equal(listing.tokens[0].lastUsedAt, null);
  assert.deepEqual(Object.keys(listing.tokens[0]).sort(), ["createdAt", "expiresAt", "lastUsedAt", "name"].sort());
  assert.equal(JSON.stringify(listing).includes(created.token), false, "列表不能再次返回明文令牌");
  assert.equal((await api("/tokens", otherHeaders).then((response) => response.json())).tokens.length, 0, "令牌列表必须按用户隔离");
  assert.equal((await api(`/tokens/${encodeURIComponent(created.name)}`, otherHeaders, "DELETE")).status, 404, "其他用户不能吊销令牌");

  const seed = { schemaVersion: 3, tasks: [], projects: [{ id: "project-retained", name: "保留项目" }], courses: [{ id: "agent-course", name: "测试课程", day: 1, startSection: 1, endSection: 2, weeks: [1, 2] }], timeSlots: [{ number: 1, startTime: "09:00", endTime: "10:00" }], courseExceptions: [], semester: { startDate: "2026-09-07", totalWeeks: 20 }, settings: { privateMarker: "never-exposed" } };
  const saved = await fetch(`${origin}/api/data`, { method: "PUT", headers: { ...ownerHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ data: seed, baseRevision: 0 }) });
  assert.equal(saved.status, 200);
  const schedule = await api("/schedule", headers);
  assert.equal(schedule.status, 200);
  const summary = await schedule.json();
  assert.deepEqual(summary.courses, seed.courses);
  assert.deepEqual(summary.semester, seed.semester);
  assert.deepEqual(summary.timeSlots, seed.timeSlots);
  assert.equal(JSON.stringify(summary).includes("never-exposed"), false, "摘要不暴露账户设置");
  assert.equal(summary.revision, 1);
  const taskResponse = await api("/tasks", headers, "POST", { title: "  Agent 测试任务  ", notes: "不应进入审计的备注", due: "2026-09-14", dueTime: "15:30", important: true, urgent: false, quadrant: "q1", courseId: "agent-course" });
  assert.equal(taskResponse.status, 201);
  const first = await taskResponse.json();
  assert.equal(first.task.title, "Agent 测试任务");
  assert.equal(first.task.quadrant, "q2", "quadrant 必须由服务端推导");
  assert.equal(first.task.courseId, "agent-course");
  assert.equal(first.task.type, "task");
  assert.equal(first.revision, 2);
  const route = `/tasks/${first.task.id}`;
  const edited = await api(route, headers, "PATCH", { title: "已改期", due: "2026-09-15", dueTime: "10:00", urgent: true, completed: true });
  assert.equal(edited.status, 200);
  const edit = await edited.json();
  assert.equal(edit.task.due, "2026-09-15");
  assert.equal(edit.task.dueTime, "10:00");
  assert.equal(edit.task.completed, true);
  assert.equal(typeof edit.task.completedAt, "number");
  assert.equal(edit.task.quadrant, "q1");
  assert.equal(edit.revision, 3);
  const restored = await api(route, headers, "PATCH", { completed: false, due: "", courseId: "" }).then((response) => response.json());
  assert.equal(restored.task.completed, false);
  assert.equal(restored.task.completedAt, null);
  assert.equal(restored.task.dueTime, "", "清除日期会一并清除时间");
  assert.equal(restored.task.courseId, "");
  const synced = await fetch(`${origin}/api/data`, { headers: ownerHeaders }).then((response) => response.json());
  assert.equal(synced.revision, 4);
  assert.equal(synced.data.tasks[0].id, first.task.id);
  assert.deepEqual(synced.data.projects, seed.projects, "Agent 写入必须保留整个日程文档的其他字段");
  assert.deepEqual(synced.data.settings, seed.settings);
  assert.equal((await fetch(`${origin}/api/data`, { method: "PUT", headers: { ...ownerHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ data: seed, baseRevision: 1 }) })).status, 409, "Agent 修改必须触发原有多端版本冲突保护");

  const invalidBodies = [null, [], {}, { title: " " }, { title: "字".repeat(121) }, { title: "invalid", notes: "字".repeat(2001) }, { title: "invalid", notes: null }, { title: "invalid", due: "2026-02-29" }, { title: "invalid", due: "2026-13-01" }, { title: "invalid", due: null }, { title: "invalid", dueTime: "24:00" }, { title: "invalid", dueTime: "9:00" }, { title: "invalid", dueTime: "09:00" }, { title: "invalid", important: 1 }, { title: "invalid", urgent: "false" }, { title: "invalid", courseId: "foreign-course" }, { title: "invalid", courseId: 123 }, { title: "invalid", completed: true }, { title: "invalid", quadrant: "q5" }, { title: "invalid", id: "injected" }];
  for (const body of invalidBodies) assert.equal((await api("/tasks", headers, "POST", body)).status, 400, "非法任务 body 必须返回 400");
  for (const body of [{}, { title: "" }, { completed: "true" }, { due: "not-a-date" }, { notes: [] }, { quadrant: "q4" }, { courseId: null }]) assert.equal((await api(route, headers, "PATCH", body)).status, 400, "PATCH 字段必须使用相同验证");
  const rawHeaders = { ...headers, "Content-Type": "application/json" };
  const invalidJson = await fetch(`${origin}/api/agent/tasks`, { method: "POST", headers: rawHeaders, body: "{invalid" });
  assert.equal(invalidJson.status, 400, "JSON 解析失败应返回 400");
  const tooLarge = await api("/tasks", headers, "POST", { title: "oversized", notes: "x".repeat(64 * 1024) });
  assert.equal(tooLarge.status, 413, "超过 64KB 必须返回真实 413，不能断开 socket");
  const chunked = await fetch(`${origin}/api/agent/tasks`, { method: "POST", headers: rawHeaders, duplex: "half", body: (async function* () { yield '{"title":"large","notes":"'; yield "x".repeat(64 * 1024); yield '"}'; })() });
  assert.equal(chunked.status, 413, "无 Content-Length 的分块请求也应限制到 64KB");
  assert.equal((await api(route, headers, "DELETE")).status, 405, "Agent v1 不提供删除任务");
  assert.equal((await api("/schedule", { ...headers, Origin: "https://untrusted.example" })).status, 403);
  assert.equal((await api("/schedule", headers).then((response) => response.json())).tasks.length, 1, "所有失败请求不得产生副作用");

  const otherToken = await createToken("agent smoke / 主要令牌", otherHeaders, 365);
  assert.equal(otherToken.expiresAt - otherToken.createdAt, 365 * 86400000);
  const otherTokenHeaders = tokenHeaders(otherToken.token);
  assert.equal((await api(route, otherTokenHeaders, "PATCH", { title: "不能编辑" })).status, 404, "他人任务 ID 必须返回 404");
  const mixed = await api("/schedule", { ...ownerHeaders, ...otherTokenHeaders }).then((response) => response.json());
  assert.equal(mixed.tasks.length, 0, "业务接口即便带另一个用户 Cookie 也只使用 Bearer 所属用户");
  assert.equal((await api("/tasks", otherTokenHeaders, "POST", { title: "不能关联", courseId: "agent-course" })).status, 400, "课程归属必须按 token 用户校验");

  const db = new DatabaseSync(path.join(dataDirectory, "fangcun.sqlite"));
  try {
    const tokenHash = crypto.createHash("sha256").update(created.token).digest("hex");
    const stored = db.prepare("SELECT * FROM agent_tokens WHERE token_hash = ?").get(tokenHash);
    assert.ok(stored.last_used_at >= created.createdAt, "业务请求必须更新 last_used_at");
    assert.equal(JSON.stringify(db.prepare("SELECT * FROM agent_tokens").all()).includes(created.token), false, "令牌明文不得落库");
    assert.deepEqual(db.prepare("SELECT revision FROM user_snapshots WHERE user_id = ? ORDER BY id DESC LIMIT 3").all(stored.user_id).map((row) => row.revision), [3, 2, 1], "Agent 写入必须保留原同步快照");
    const auditRows = db.prepare("SELECT * FROM agent_audit WHERE user_id = ?").all(stored.user_id);
    assert.ok(auditRows.some((row) => row.action === "tasks.create" && row.detail === '{"status":201}'));
    assert.ok(auditRows.some((row) => row.action === "tasks.create" && row.detail === '{"status":413}'));
    assert.ok(auditRows.some((row) => row.action === "tasks.update" && row.detail === '{"status":400}'));
    assert.ok(auditRows.every((row) => row.detail.length <= 200));
    assert.equal(JSON.stringify(auditRows).includes(created.token), false);
    assert.equal(JSON.stringify(auditRows).includes("不应进入审计的备注"), false, "审计不保留用户提交的正文");
    const activity = await api("/audit", ownerHeaders).then((response) => response.json());
    assert.equal(activity.audit.length, 10);
    assert.ok(activity.audit.every((row) => !Object.hasOwn(row, "token_hash") && !Object.hasOwn(row, "user_id")));
    assert.ok(activity.audit.every((row, index) => index === 0 || activity.audit[index - 1].createdAt >= row.createdAt));

    const repeatToken = await createToken("repeat-check");
    const repeatHeaders = tokenHeaders(repeatToken.token);
    const repeatCases = [["daily", "2026-09-11", "2026-09-12"], ["weekly", "2026-09-11", "2026-09-18"], ["weekdays", "2026-09-11", "2026-09-14"], ["monthly", "2026-01-31", "2026-02-28"]];
    const beforeRepeat = await fetch(`${origin}/api/data`, { headers: ownerHeaders }).then((response) => response.json());
    for (const [repeat, due] of repeatCases) beforeRepeat.data.tasks.push({ id: `repeat-${repeat}`, title: `重复 ${repeat}`, due, dueTime: "09:00", repeat, completed: false, important: true, urgent: false, quadrant: "q2" });
    assert.equal((await fetch(`${origin}/api/data`, { method: "PUT", headers: { ...ownerHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ data: beforeRepeat.data, baseRevision: beforeRepeat.revision }) })).status, 200);
    for (const [repeat, , expectedDue] of repeatCases) {
      const repeatRoute = `/tasks/repeat-${repeat}`;
      const complete = await api(repeatRoute, repeatHeaders, "PATCH", { completed: true });
      assert.equal(complete.status, 200);
      const completed = (await complete.json()).task;
      assert.ok(completed.nextOccurrenceId, "完成重复任务必须创建下一次事项");
      const repeated = await api(repeatRoute, repeatHeaders, "PATCH", { completed: true }).then((response) => response.json());
      assert.equal(repeated.task.nextOccurrenceId, completed.nextOccurrenceId, "重试完成不能重复创建下一次事项");
      assert.equal(repeated.task.completedAt, completed.completedAt, "重试完成应保留原完成时间");
      assert.equal((await api(repeatRoute, repeatHeaders, "PATCH", { completed: false })).status, 200);
      assert.equal((await api(repeatRoute, repeatHeaders, "PATCH", { completed: true })).status, 200);
      const current = await api("/schedule", repeatHeaders).then((response) => response.json());
      const children = current.tasks.filter((task) => task.recurrenceSourceId === completed.id);
      assert.equal(children.length, 1, "恢复后再完成也不能重复生成下一次事项");
      assert.equal(children[0].due, expectedDue);
      assert.equal(children[0].dueTime, "09:00");
      assert.equal(children[0].completed, false);
      assert.equal(children[0].completedAt, null);
    }

    const expiring = await createToken("expires", ownerHeaders, 1);
    db.prepare("UPDATE agent_tokens SET expires_at = ? WHERE name = ? AND user_id = ?").run(Date.now() - 1, expiring.name, stored.user_id);
    assert.equal((await api("/schedule", tokenHeaders(expiring.token))).status, 401, "过期必须即时生效，无令牌缓存");
    const otherUser = db.prepare("SELECT user_id FROM agent_tokens WHERE name = ? AND user_id != ?").get(created.name, stored.user_id);
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(otherUser.user_id);
    assert.equal((await api("/schedule", otherTokenHeaders)).status, 401, "账号停用必须立即影响 Agent 权限");
    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(otherUser.user_id);

    const rateToken = await createToken("rate-limit");
    const rateHeaders = tokenHeaders(rateToken.token);
    for (let index = 0; index < 60; index += 1) assert.equal((await api("/schedule", rateHeaders)).status, 200, "一分钟内前 60 次请求应成功");
    const limited = await api("/schedule", rateHeaders);
    assert.equal(limited.status, 429, "第 61 次请求必须触发每令牌限流");
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.equal((await api("/schedule", otherTokenHeaders)).status, 200, "一个令牌限流不影响其他令牌");
    assert.ok(db.prepare("SELECT 1 FROM agent_audit WHERE token_hash = ? AND detail = ?").get(crypto.createHash("sha256").update(rateToken.token).digest("hex"), '{"status":429}'), "限流请求也需要审计");
    const otherAuditCount = db.prepare("SELECT COUNT(*) AS count FROM agent_audit WHERE user_id = ?").get(otherUser.user_id).count;
    const addAudit = db.prepare("INSERT INTO agent_audit (user_id, action, detail, created_at) VALUES (?, 'test.seed', '{}', ?)");
    db.exec("BEGIN");
    for (let index = 0; index < 510; index += 1) addAudit.run(stored.user_id, Date.now());
    db.exec("COMMIT");
    assert.equal((await api("/schedule", rateHeaders)).status, 429);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_audit WHERE user_id = ?").get(stored.user_id).count, 500, "审计只保留当前用户最近 500 条");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_audit WHERE user_id = ?").get(otherUser.user_id).count, otherAuditCount, "审计清理不能删其他用户记录");
  } finally { db.close(); }
  const revoked = await api(`/tokens/${encodeURIComponent(created.name)}`, ownerHeaders, "DELETE");
  assert.equal(revoked.status, 200);
  assert.equal((await api("/schedule", headers)).status, 401, "吊销后的令牌应立即失效");
  assert.equal((await api("/tokens", ownerHeaders).then((response) => response.json())).tokens.some((token) => token.name === created.name), false);
  console.log("Agent API 检查通过：令牌生命周期、身份隔离、任务校验、同步版本与快照、64KB 限制、60 次限流及 500 条审计保留。");
}

async function main() {
  const port = await freePort();
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fangcun-test-"));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDirectory, FANGCUN_PASSWORD: "test-password-123", FANGCUN_OPERATOR_NAME: "测试运营者", FANGCUN_CONTACT: "support@example.test", FANGCUN_APP_BEIAN: "测试 APP 备案号", FANGCUN_ICP_BEIAN: "测试 ICP 备案号", NODE_NO_WARNINGS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  try {
    await waitForServer(origin);
    const session = await fetch(`${origin}/api/auth/session`).then((response) => response.json());
    assert.equal(session.configured, true);
    assert.equal(session.authenticated, false);
    assert.equal(session.registrationOpen, false);
    assert.equal(session.version, "2.8.0");
    const mobileLayout = await fetch(`${origin}/v22-layout.css?v=2.8.0`);
    assert.equal(mobileLayout.status, 200, "服务端必须实际提供最终移动布局，不能只在安装目录里存在");
    assert.match(mobileLayout.headers.get("content-type") || "", /text\/css/);
    for (const [asset, type] of [["liquid.css?v=4", /text\/css/], ["liquid-select.js?v=4", /javascript/]]) {
      const response = await fetch(`${origin}/${asset}`);
      assert.equal(response.status, 200, `外观资源必须可获取：${asset}`);
      assert.match(response.headers.get("content-type") || "", type);
    }
    const wordParser = await fetch(`${origin}/docx-schedule-parser.js?v=2.8.0`);
    assert.equal(wordParser.status, 200, "服务端必须提供 Word 课表解析模块");
    const privacyPage = await fetch(`${origin}/privacy.html`);
    const privacyText = await privacyPage.text();
    assert.equal(privacyPage.status, 200, "服务端必须提供隐私政策");
    assert.match(privacyText, /测试运营者/);
    assert.doesNotMatch(privacyText, /\{\{[^}]+\}\}/, "隐私政策不得向用户暴露未替换占位符");
    const indexPage = await fetch(`${origin}/`).then((response) => response.text());
    assert.match(indexPage, /APP 备案号：测试 APP 备案号/);
    assert.doesNotMatch(indexPage, /\{\{APP_BEIAN\}\}/, "应用内不得暴露备案占位符");

    const failedLogin = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "owner", password: "incorrect-password" }),
    });
    assert.equal(failedLogin.status, 401);

    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "owner", password: "test-password-123" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const authHeaders = { Cookie: cookie, Origin: origin };
    const ownerSession = await fetch(`${origin}/api/auth/session`, { headers: authHeaders }).then((response) => response.json());
    assert.equal(ownerSession.user.username, "owner");
    assert.equal(ownerSession.user.role, "admin");

    const empty = await fetch(`${origin}/api/data`, { headers: authHeaders }).then((response) => response.json());
    assert.equal(empty.revision, 0);
    assert.equal(empty.data, null);

    const document = { tasks: [{ id: "owner-task", title: "迁移验证任务", completed: false, due: "2026-09-01", quadrant: "q1" }], projects: [{ id: "owner-project", name: "科研项目" }], courses: [{ id: "owner-course", name: "大学物理" }], timeSlots: [{ number: 1, startTime: "08:00", endTime: "09:00" }], courseExceptions: [], semester: {}, settings: {} };
    const firstSave = await fetch(`${origin}/api/data`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ data: document, baseRevision: 0 }),
    });
    assert.equal(firstSave.status, 200);
    assert.equal((await firstSave.json()).revision, 1);

    const staleSave = await fetch(`${origin}/api/data`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ data: document, baseRevision: 0 }),
    });
    assert.equal(staleSave.status, 409);

    const forcedSave = await fetch(`${origin}/api/data?force=1`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ data: document, baseRevision: 0 }),
    });
    assert.equal(forcedSave.status, 200);
    assert.equal((await forcedSave.json()).revision, 2);

    const retiredVoiceCommand = await fetch(`${origin}/api/voice/command`, { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ text: "记录待办" }) });
    assert.equal(retiredVoiceCommand.status, 404, "停用小爱后服务端不得继续暴露语音写入接口");
    const retiredVoiceToken = await fetch(`${origin}/api/voice/token`, { headers: authHeaders });
    assert.equal(retiredVoiceToken.status, 404, "停用小爱后服务端不得继续暴露语音令牌接口");

    const openRegistration = await fetch(`${origin}/api/admin/registration`, {
      method: "PUT",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ open: true }),
    });
    assert.equal(openRegistration.status, 200);
    const registerMember = await fetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "member", displayName: "Member", password: "memberPass8" }),
    });
    assert.equal(registerMember.status, 201);
    const memberCookie = registerMember.headers.get("set-cookie").split(";")[0];
    const migration = await fetch(`${origin}/api/admin/migrate-owner-data`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ force: false }),
    });
    assert.equal(migration.status, 200);
    const invalidatedMemberSession = await fetch(`${origin}/api/data`, { headers: { Cookie: memberCookie, Origin: origin } });
    assert.equal(invalidatedMemberSession.status, 401);
    const memberLogin = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "member", password: "memberPass8" }),
    });
    assert.equal(memberLogin.status, 200);
    const memberAuthHeaders = { Cookie: memberLogin.headers.get("set-cookie").split(";")[0], Origin: origin };
    const migratedData = await fetch(`${origin}/api/data`, { headers: memberAuthHeaders }).then((response) => response.json());
    assert.ok(migratedData.data.tasks.some((task) => task.title === "迁移验证任务"), "迁移后的数据必须保留原任务");
    const outlookStatus = await fetch(`${origin}/api/integrations/outlook/status`, { headers: memberAuthHeaders }).then((response) => response.json());
    assert.equal(outlookStatus.configured, false);
    assert.equal(outlookStatus.connected, false);
    const unavailableOutlook = await fetch(`${origin}/api/integrations/outlook/connect`, { method: "POST", headers: { ...memberAuthHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ source: "web" }) });
    assert.equal(unavailableOutlook.status, 503, "未配置 Microsoft 凭据时不能伪装为已经可连接");
    const googleStatus = await fetch(`${origin}/api/integrations/google/status`, { headers: memberAuthHeaders }).then((response) => response.json());
    assert.equal(googleStatus.configured, false);
    assert.equal(googleStatus.connected, false);
    const unavailableGoogle = await fetch(`${origin}/api/integrations/google/connect`, { method: "POST", headers: { ...memberAuthHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ source: "web" }) });
    assert.equal(unavailableGoogle.status, 503, "未配置 Google 凭据时不能伪装为已经可连接");
    const calendarSubscription = await fetch(`${origin}/api/calendar/subscription`, { method: "POST", headers: { ...memberAuthHeaders, "Content-Type": "application/json" }, body: "{}" }).then((response) => response.json());
    assert.match(calendarSubscription.url, /^http:\/\/127\.0\.0\.1:\d+\/calendar\/[A-Za-z0-9_-]+\.ics$/);
    const calendarFeed = await fetch(calendarSubscription.url);
    assert.equal(calendarFeed.status, 200);
    assert.match(calendarFeed.headers.get("content-type") || "", /text\/calendar/);
    assert.match(await calendarFeed.text(), /迁移验证任务/);
    const rotatedCalendar = await fetch(`${origin}/api/calendar/subscription`, { method: "POST", headers: { ...memberAuthHeaders, "Content-Type": "application/json" }, body: "{}" }).then((response) => response.json());
    assert.equal((await fetch(calendarSubscription.url)).status, 404, "重新生成后旧日历链接必须立即失效");
    assert.equal((await fetch(rotatedCalendar.url)).status, 200);
    const revokedCalendar = await fetch(`${origin}/api/calendar/subscription`, { method: "DELETE", headers: memberAuthHeaders });
    assert.equal(revokedCalendar.status, 200);
    assert.equal((await fetch(rotatedCalendar.url)).status, 404, "撤销后日历链接必须失效");
    const usersBeforeReset = await fetch(`${origin}/api/admin/users`, { headers: authHeaders }).then((response) => response.json());
    const member = usersBeforeReset.users.find((item) => item.username === "member");
    const resetPassword = await fetch(`${origin}/api/admin/users/${member.id}/reset-password`, { method: "POST", headers: authHeaders }).then((response) => response.json());
    assert.ok(resetPassword.temporaryPassword.length >= 10);
    const oldMemberPassword = await fetch(`${origin}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "member", password: "memberPass8" }),
    });
    assert.equal(oldMemberPassword.status, 401);
    const temporaryMemberLogin = await fetch(`${origin}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "member", password: resetPassword.temporaryPassword }),
    });
    assert.equal(temporaryMemberLogin.status, 200);
    const ownerAfterMigration = await fetch(`${origin}/api/data`, { headers: authHeaders }).then((response) => response.json());
    assert.equal(ownerAfterMigration.data, null);
    const register = await fetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "student_one", displayName: "测试同学", password: "student-password-123" }),
    });
    assert.equal(register.status, 201);
    const studentCookie = register.headers.get("set-cookie").split(";")[0];
    const studentHeaders = { Cookie: studentCookie, Origin: origin };
    await checkAgentApi(origin, authHeaders, studentHeaders, dataDirectory);
    const studentEmpty = await fetch(`${origin}/api/data`, { headers: studentHeaders }).then((response) => response.json());
    assert.equal(studentEmpty.revision, 0);
    assert.equal(studentEmpty.data, null);
    const forbiddenAdmin = await fetch(`${origin}/api/admin/users`, { headers: studentHeaders });
    assert.equal(forbiddenAdmin.status, 403);
    const users = await fetch(`${origin}/api/admin/users`, { headers: authHeaders }).then((response) => response.json());
    assert.equal(users.users.length, 3);
    assert.equal(users.migration.completed, true);
    assert.equal(users.stats.ordinary, 2);
    const student = users.users.find((item) => item.username === "student_one");
    const detail = await fetch(`${origin}/api/admin/users/${student.id}`, { headers: authHeaders }).then((response) => response.json());
    assert.equal(detail.user.counts.tasks, 0);
    const deleted = await fetch(`${origin}/api/admin/users/${student.id}`, { method: "DELETE", headers: authHeaders });
    assert.equal(deleted.status, 200);
    const deletedLogin = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "student_one", password: "student-password-123" }),
    });
    assert.equal(deletedLogin.status, 401);

    const selfRegister = await fetch(`${origin}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "member_self", displayName: "注销测试", password: "self-delete-password" }),
    });
    assert.equal(selfRegister.status, 201);
    const selfHeaders = { Cookie: selfRegister.headers.get("set-cookie").split(";")[0], Origin: origin, "Content-Type": "application/json" };
    const wrongSelfDelete = await fetch(`${origin}/api/auth/account`, { method: "DELETE", headers: selfHeaders, body: JSON.stringify({ password: "wrong-password" }) });
    assert.equal(wrongSelfDelete.status, 401, "账号注销必须校验当前密码");
    const selfDelete = await fetch(`${origin}/api/auth/account`, { method: "DELETE", headers: selfHeaders, body: JSON.stringify({ password: "self-delete-password" }) });
    assert.equal(selfDelete.status, 200, "普通用户必须可以在应用内注销账号");
    assert.equal((await fetch(`${origin}/api/data`, { headers: selfHeaders })).status, 401, "账号注销后当前会话必须失效");

    const passwordChange = await fetch(`${origin}/api/auth/password`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "test-password-123", newPassword: "ownerNew" }),
    });
    assert.equal(passwordChange.status, 200);
    const oldPasswordLogin = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "owner", password: "test-password-123" }),
    });
    assert.equal(oldPasswordLogin.status, 401);
    const newPasswordLogin = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ username: "owner", password: "ownerNew" }),
    });
    assert.equal(newPasswordLogin.status, 200);

    const privateFile = await fetch(`${origin}/data/fangcun.sqlite`);
    assert.equal(privateFile.status, 404);
    console.log("服务端检查通过：账号、会话、同步保护正常，且已停用的语音接口不可访问。");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
  if (stderr.trim()) throw new Error(stderr);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
