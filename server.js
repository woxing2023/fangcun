const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { OutlookIntegration } = require("./outlook-sync");
const { GoogleIntegration } = require("./google-sync");

const APP_VERSION = "2.8.0";
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const root = __dirname;
const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const databasePath = path.join(dataDirectory, "fangcun.sqlite");
const trustProxy = process.env.TRUST_PROXY === "true";
const sessionMaxAge = 30 * 24 * 60 * 60;
const maxBodyBytes = 2 * 1024 * 1024;
const agentMaxBodyBytes = 64 * 1024;
const agentRequests = new Map();
const publicFiles = new Set(["index.html", "privacy.html", "styles.css", "v22-layout.css", "smart-parser.js", "docx-schedule-parser.js", "app.js", "manifest.webmanifest", "icon.svg", "service-worker.js", "appearance.css", "xuan.css", "xuan-fibers.svg", "xuan-fibers-mobile.png", "xuan-sans.woff2", "xuan-serif.woff2", "material-light.js", "touch-material.js", "mobile-ui.css", "mobile-material.css", "mobile-calendar.css", "calendar-surface.css", "appearance-controls.js", "liquid.css", "liquid-select.js", "appearance.js", "liquid-renderer.js", "three.module.min.js", "three.core.min.js"]);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
const attempts = new Map();

fs.mkdirSync(dataDirectory, { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), document TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, revision INTEGER NOT NULL, document TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_record TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS user_states (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    document TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    document TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS user_snapshots_owner ON user_snapshots(user_id, id DESC);
  CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS user_sessions_owner ON user_sessions(user_id);
  CREATE TABLE IF NOT EXISTS calendar_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    last_access_at TEXT
  );
  CREATE INDEX IF NOT EXISTS calendar_tokens_owner ON calendar_tokens(user_id);
  CREATE TABLE IF NOT EXISTS agent_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER,
    expires_at INTEGER,
    last_used_at INTEGER,
    UNIQUE(user_id, name)
  );
  CREATE TABLE IF NOT EXISTS agent_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    action TEXT,
    detail TEXT,
    created_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS agent_audit_owner ON agent_audit(user_id, id DESC);
  DROP TABLE IF EXISTS voice_commands;
  DROP TABLE IF EXISTS voice_tokens;
`);

const statements = {
  getConfig: database.prepare("SELECT value FROM config WHERE key = ?"),
  setConfig: database.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"),
  userCount: database.prepare("SELECT COUNT(*) AS count FROM users"),
  getUserByName: database.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE"),
  getUserById: database.prepare("SELECT * FROM users WHERE id = ?"),
  getOnlyUser: database.prepare("SELECT * FROM users ORDER BY id LIMIT 1"),
  addUser: database.prepare("INSERT INTO users (username, display_name, password_record, role, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)"),
  touchLogin: database.prepare("UPDATE users SET last_login_at = ? WHERE id = ?"),
  changePassword: database.prepare("UPDATE users SET password_record = ? WHERE id = ?"),
  listUsers: database.prepare("SELECT u.id, u.username, u.display_name AS displayName, u.role, u.status, u.created_at AS createdAt, u.last_login_at AS lastLoginAt, s.document, s.revision, s.updated_at AS updatedAt FROM users u LEFT JOIN user_states s ON s.user_id = u.id ORDER BY u.id"),
  setUserStatus: database.prepare("UPDATE users SET status = ? WHERE id = ?"),
  getState: database.prepare("SELECT document, revision, updated_at AS updatedAt FROM user_states WHERE user_id = ?"),
  insertState: database.prepare("INSERT INTO user_states (user_id, document, revision, updated_at) VALUES (?, ?, 1, ?)"),
  updateState: database.prepare("UPDATE user_states SET document = ?, revision = ?, updated_at = ? WHERE user_id = ?"),
  addSnapshot: database.prepare("INSERT INTO user_snapshots (user_id, revision, document, created_at) VALUES (?, ?, ?, ?)"),
  pruneSnapshots: database.prepare("DELETE FROM user_snapshots WHERE user_id = ? AND id NOT IN (SELECT id FROM user_snapshots WHERE user_id = ? ORDER BY id DESC LIMIT 30)"),
  addSession: database.prepare("INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
  getSessionUser: database.prepare("SELECT u.* FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'"),
  deleteSession: database.prepare("DELETE FROM user_sessions WHERE token_hash = ?"),
  deleteUserSessions: database.prepare("DELETE FROM user_sessions WHERE user_id = ?"),
  deleteUser: database.prepare("DELETE FROM users WHERE id = ?"),
  snapshotCount: database.prepare("SELECT COUNT(*) AS count FROM user_snapshots WHERE user_id = ?"),
  deleteExpiredSessions: database.prepare("DELETE FROM user_sessions WHERE expires_at <= ?"),
  getCalendarTokenForUser: database.prepare("SELECT created_at AS createdAt, last_access_at AS lastAccessAt FROM calendar_tokens WHERE user_id = ?"),
  setCalendarToken: database.prepare("INSERT INTO calendar_tokens (token_hash, user_id, created_at, last_access_at) VALUES (?, ?, ?, NULL) ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at, last_access_at = NULL"),
  deleteCalendarToken: database.prepare("DELETE FROM calendar_tokens WHERE user_id = ?"),
  getCalendarOwner: database.prepare("SELECT u.id, u.display_name, u.status, s.document, s.revision, s.updated_at FROM calendar_tokens c JOIN users u ON u.id = c.user_id LEFT JOIN user_states s ON s.user_id = u.id WHERE c.token_hash = ? AND u.status = 'active'"),
  touchCalendarToken: database.prepare("UPDATE calendar_tokens SET last_access_at = ? WHERE token_hash = ?"),
  addAgentToken: database.prepare("INSERT INTO agent_tokens (token_hash, user_id, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"),
  listAgentTokens: database.prepare("SELECT name, created_at AS createdAt, expires_at AS expiresAt, last_used_at AS lastUsedAt FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC, name"),
  getAgentTokenByName: database.prepare("SELECT token_hash FROM agent_tokens WHERE user_id = ? AND name = ?"),
  deleteAgentToken: database.prepare("DELETE FROM agent_tokens WHERE user_id = ? AND name = ?"),
  getAgentOwner: database.prepare("SELECT a.token_hash, a.user_id, a.expires_at, u.status FROM agent_tokens a JOIN users u ON u.id = a.user_id WHERE a.token_hash = ?"),
  touchAgentToken: database.prepare("UPDATE agent_tokens SET last_used_at = ? WHERE token_hash = ?"),
  addAgentAudit: database.prepare("INSERT INTO agent_audit (token_hash, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)"),
  pruneAgentAudit: database.prepare("DELETE FROM agent_audit WHERE user_id IS ? AND id NOT IN (SELECT id FROM agent_audit WHERE user_id IS ? ORDER BY id DESC LIMIT 500)"),
  listAgentAudit: database.prepare("SELECT action, detail, created_at AS createdAt FROM agent_audit WHERE user_id = ? ORDER BY id DESC LIMIT 10"),
  legacyState: database.prepare("SELECT document, revision, updated_at FROM state WHERE id = 1"),
  legacySnapshots: database.prepare("SELECT revision, document, created_at FROM snapshots ORDER BY id"),
};
const outlook = new OutlookIntegration(database);
const google = new GoogleIntegration(database);
const externalSyncing = new Set();

function passwordRecord(password) {
  const salt = crypto.randomBytes(16);
  const params = { N: 2 ** 14, r: 8, p: 5, maxmem: 64 * 1024 * 1024 };
  const hash = crypto.scryptSync(password, salt, 64, params);
  return JSON.stringify({ algorithm: "scrypt", N: params.N, r: params.r, p: params.p, salt: salt.toString("hex"), hash: hash.toString("hex") });
}
function verifyPassword(password, stored) {
  try {
    const record = JSON.parse(stored);
    const expected = Buffer.from(record.hash, "hex");
    const options = record.N ? { N: record.N, r: record.r, p: record.p, maxmem: 64 * 1024 * 1024 } : undefined;
    const actual = crypto.scryptSync(password, Buffer.from(record.salt, "hex"), expected.length, options);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}
function validUsername(username) { return typeof username === "string" && /^[\p{L}\p{N}_-]{3,32}$/u.test(username.trim()); }
function validPassword(password) { return typeof password === "string" && password.length >= 8 && password.length <= 128; }
function validLoginPassword(password) { return typeof password === "string" && password.length > 0 && password.length <= 128; }
function publicUser(user) { return user ? { id: user.id, username: user.username, displayName: user.display_name, role: user.role } : null; }
function escapePublicText(value) { return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }

function migrateLegacyOwner() {
  if (statements.userCount.get().count) return;
  const legacyPassword = statements.getConfig.get("password")?.value;
  const envPassword = process.env.FANGCUN_PASSWORD;
  if (!legacyPassword && !envPassword) return;
  if (!legacyPassword && !validPassword(envPassword)) throw new Error("FANGCUN_PASSWORD 必须为 8 到 128 个字符");
  const proposed = String(process.env.FANGCUN_OWNER_USERNAME || "owner").trim();
  const username = validUsername(proposed) ? proposed : "owner";
  const now = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = statements.addUser.run(username, "管理员", legacyPassword || passwordRecord(envPassword), "admin", now);
    const userId = Number(result.lastInsertRowid);
    const legacyState = statements.legacyState.get();
    if (legacyState) database.prepare("INSERT INTO user_states (user_id, document, revision, updated_at) VALUES (?, ?, ?, ?)").run(userId, legacyState.document, legacyState.revision, legacyState.updated_at);
    for (const snapshot of statements.legacySnapshots.all()) statements.addSnapshot.run(userId, snapshot.revision, snapshot.document, snapshot.created_at);
    if (!statements.getConfig.get("registration_mode")) statements.setConfig.run("registration_mode", "closed");
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}
migrateLegacyOwner();
if (!statements.getConfig.get("registration_mode")) statements.setConfig.run("registration_mode", "closed");

function securityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}
function json(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", ...extraHeaders });
  response.end(body);
}
function readJson(request, byteLimit = maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let oversized = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (oversized) return;
      if (size > byteLimit) {
        oversized = true;
        chunks.length = 0;
        reject(Object.assign(new Error("请求内容过大"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (oversized) return;
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(Object.assign(new Error("JSON 格式不正确"), { status: 400 })); }
    });
    request.on("error", reject);
    request.on("aborted", () => reject(Object.assign(new Error("请求已中断"), { status: 400 })));
  });
}

function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}
function sessionToken(request) { return parseCookies(request).fangcun_session || ""; }
function requestUser(request) {
  const token = sessionToken(request);
  return token ? statements.getSessionUser.get(hashToken(token), Date.now()) || null : null;
}
function secureRequest(request) {
  const forwarded = trustProxy ? request.headers["x-forwarded-proto"] : "";
  return Boolean(request.socket.encrypted || forwarded === "https" || process.env.COOKIE_SECURE === "true");
}
function sessionCookie(token, request) { return `fangcun_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionMaxAge}${secureRequest(request) ? "; Secure" : ""}`; }
function clearSessionCookie(request) { return `fangcun_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureRequest(request) ? "; Secure" : ""}`; }
function createSession(userId, request, response) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  statements.addSession.run(hashToken(token), userId, now, now + sessionMaxAge * 1000);
  response.setHeader("Set-Cookie", sessionCookie(token, request));
}

function originAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const hostHeader = String((trustProxy && request.headers["x-forwarded-host"]) || request.headers.host || "").split(",")[0].trim();
    return originUrl.host === hostHeader;
  } catch { return false; }
}
function clientAddress(request) { return String((trustProxy && request.headers["x-forwarded-for"]) || request.socket.remoteAddress || "unknown").split(",")[0].trim(); }
function attemptKey(request, purpose, username = "") { return `${purpose}:${clientAddress(request)}:${String(username).toLowerCase()}`; }
function blocked(request, purpose, username, limit = 10) {
  const key = attemptKey(request, purpose, username);
  const recent = (attempts.get(key) || []).filter((time) => Date.now() - time < 15 * 60 * 1000);
  attempts.set(key, recent);
  return recent.length >= limit;
}
function recordFailure(request, purpose, username) { const key = attemptKey(request, purpose, username); attempts.set(key, [...(attempts.get(key) || []), Date.now()]); }
function clearFailures(request, purpose, username) { attempts.delete(attemptKey(request, purpose, username)); }
function registrationOpen() { return statements.getConfig.get("registration_mode")?.value === "open"; }
function parseDocument(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}
function summarizeUser(row, includeContent = false) {
  const document = parseDocument(row.document);
  const tasks = Array.isArray(document?.tasks) ? document.tasks : [];
  const projects = Array.isArray(document?.projects) ? document.projects : [];
  const courses = Array.isArray(document?.courses) ? document.courses : [];
  const result = {
    id: row.id, username: row.username, displayName: row.displayName ?? row.display_name,
    role: row.role, status: row.status, createdAt: row.createdAt ?? row.created_at,
    lastLoginAt: row.lastLoginAt ?? row.last_login_at, revision: row.revision || 0,
    updatedAt: row.updatedAt || null, dataBytes: row.document ? Buffer.byteLength(row.document) : 0,
    counts: { tasks: tasks.length, pendingTasks: tasks.filter((item) => !item.completed).length, projects: projects.length, courses: courses.length },
  };
  if (includeContent) {
    result.snapshots = statements.snapshotCount.get(row.id).count;
    result.content = {
      tasks: tasks.slice(0, 100).map((item) => ({ id: item.id, title: item.title, type: item.type, due: item.due, dueTime: item.dueTime, completed: Boolean(item.completed), quadrant: item.quadrant })),
      projects: projects.slice(0, 50).map((item) => ({ id: item.id, name: item.name, targetDate: item.targetDate, status: item.status, progress: item.progress })),
      courses: courses.slice(0, 50).map((item) => ({ id: item.id, name: item.name, code: item.code, teacher: item.teacher, location: item.location })),
    };
  }
  return result;
}
function ownerMigrationStatus() {
  const source = statements.getUserByName.get("owner");
  const target = statements.getUserByName.get("member");
  const sourceState = source ? statements.getState.get(source.id) : null;
  const targetState = target ? statements.getState.get(target.id) : null;
  const completed = parseDocument(statements.getConfig.get("owner_data_migration")?.value);
  return {
    sourceExists: Boolean(source), targetExists: Boolean(target), sourceHasData: Boolean(sourceState), targetHasData: Boolean(targetState),
    completed: Boolean(completed), completedAt: completed?.completedAt || null, targetUsername: "member",
  };
}
function migrateOwnerData(force = false) {
  const source = statements.getUserByName.get("owner");
  const target = statements.getUserByName.get("member");
  if (!source) return { status: 404, error: "owner 管理员账号不存在" };
  if (!target) return { status: 409, error: "请先注册用户名 member，再执行迁移", code: "TARGET_MISSING" };
  const sourceState = statements.getState.get(source.id);
  const targetState = statements.getState.get(target.id);
  if (!sourceState) {
    const completed = parseDocument(statements.getConfig.get("owner_data_migration")?.value);
    return completed ? { status: 200, ok: true, alreadyMigrated: true, migration: ownerMigrationStatus() } : { status: 409, error: "owner 账号中没有可迁移的数据", code: "SOURCE_EMPTY" };
  }
  if (targetState && !force) return { status: 409, error: "member 已有数据，需要确认后才能覆盖", code: "TARGET_HAS_DATA", requiresConfirmation: true, target: summarizeUser({ ...target, ...targetState }) };
  const now = new Date().toISOString();
  const revision = (targetState?.revision || 0) + 1;
  database.exec("BEGIN IMMEDIATE");
  try {
    statements.addSnapshot.run(source.id, sourceState.revision, sourceState.document, now);
    if (targetState) statements.addSnapshot.run(target.id, targetState.revision, targetState.document, now);
    if (targetState) statements.updateState.run(sourceState.document, revision, now, target.id);
    else database.prepare("INSERT INTO user_states (user_id, document, revision, updated_at) VALUES (?, ?, ?, ?)").run(target.id, sourceState.document, revision, now);
    database.prepare("DELETE FROM user_states WHERE user_id = ?").run(source.id);
    statements.setConfig.run("owner_data_migration", JSON.stringify({ sourceUserId: source.id, targetUserId: target.id, completedAt: now }));
    statements.pruneSnapshots.run(source.id, source.id);
    statements.pruneSnapshots.run(target.id, target.id);
    statements.deleteUserSessions.run(target.id);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  return { status: 200, ok: true, revision, migration: ownerMigrationStatus() };
}
function validDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return false;
  if (!Array.isArray(document.tasks) || !Array.isArray(document.projects)) return false;
  if (!Array.isArray(document.courses) || !Array.isArray(document.timeSlots) || !Array.isArray(document.courseExceptions)) return false;
  return JSON.stringify(document).length <= maxBodyBytes;
}

function persistExternalDocument(userId, document) {
  if (!validDocument(document)) throw Object.assign(new Error("外部日历返回的数据结构不正确"), { status: 502 });
  const current = statements.getState.get(userId);
  const serialized = JSON.stringify(document);
  const now = new Date().toISOString();
  const revision = current ? current.revision + 1 : 1;
  database.exec("BEGIN IMMEDIATE");
  try {
    if (current) statements.addSnapshot.run(userId, current.revision, current.document, now);
    if (current) statements.updateState.run(serialized, revision, now, userId); else statements.insertState.run(userId, serialized, now);
    statements.pruneSnapshots.run(userId, userId);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
  return { revision, updatedAt: now };
}

async function syncCalendarForUser(userId, integration, label) {
  if (externalSyncing.has(userId)) throw Object.assign(new Error("外部日历正在同步，请稍后再试"), { status: 409 });
  const current = statements.getState.get(userId);
  if (!current?.document) throw Object.assign(new Error("请先在方寸中保存至少一项数据"), { status: 409 });
  externalSyncing.add(userId);
  try {
    const result = await integration.sync(userId, JSON.parse(current.document));
    const saved = result.changed ? persistExternalDocument(userId, result.document) : { revision: current.revision, updatedAt: current.updatedAt };
    return { ok: true, ...saved, stats: result.stats, syncedAt: result.syncedAt, changed: result.changed };
  } catch (error) {
    integration.recordError(userId, error);
    throw error;
  } finally { externalSyncing.delete(userId); }
}

function syncOutlookForUser(userId) { return syncCalendarForUser(userId, outlook, "Outlook"); }
function syncGoogleForUser(userId) { return syncCalendarForUser(userId, google, "Google"); }

function publicRequestOrigin(request) {
  const forwardedHost = String((trustProxy && request.headers["x-forwarded-host"]) || request.headers.host || "localhost").split(",")[0].trim();
  const forwardedProto = String((trustProxy && request.headers["x-forwarded-proto"]) || "").split(",")[0].trim();
  return `${forwardedProto || (secureRequest(request) ? "https" : "http")}://${forwardedHost}`;
}

function icsEscape(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function compactDate(value) {
  return String(value || "").replaceAll("-", "");
}

function compactDateTime(date, time) {
  return `${compactDate(date)}T${String(time || "00:00").replace(":", "")}00`;
}

function addDateDays(value, amount) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return "";
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return date.toISOString().slice(0, 10);
}

function calendarAlarm(lines, minutes, label) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < 0) return;
  lines.push("BEGIN:VALARM", `TRIGGER:${value === 0 ? "PT0M" : `-PT${value}M`}`, "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(label)}`, "END:VALARM");
}

function buildCalendar(document, ownerName = "方寸") {
  const courses = Array.isArray(document?.courses) ? document.courses : [];
  const tasks = Array.isArray(document?.tasks) ? document.tasks : [];
  const timeSlots = Array.isArray(document?.timeSlots) ? document.timeSlots : [];
  const exceptions = Array.isArray(document?.courseExceptions) ? document.courseExceptions : [];
  const semesterStart = document?.semester?.startDate;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fangcun//Calendar Subscription//ZH", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-TIMEZONE:Asia/Shanghai", `X-WR-CALNAME:${icsEscape(`方寸 · ${ownerName}`)}`];
  const slot = (number) => timeSlots.find((item) => Number(item.number) === Number(number));

  if (semesterStart) courses.forEach((course) => {
    (Array.isArray(course.weeks) ? course.weeks : []).forEach((week) => {
      const originalDate = addDateDays(semesterStart, (Number(week) - 1) * 7 + Number(course.day || 1) - 1);
      const exception = exceptions.find((item) => item.courseId === course.id && item.date === originalDate);
      if (!originalDate || exception?.type === "cancel") return;
      const eventDate = exception?.type === "reschedule" && exception.day ? addDateDays(semesterStart, (Number(week) - 1) * 7 + Number(exception.day) - 1) : originalDate;
      const startSlot = slot(exception?.type === "reschedule" ? exception.startSection : course.startSection);
      const endSlot = slot(exception?.type === "reschedule" ? exception.endSection : course.endSection);
      if (!startSlot || !endSlot) return;
      const title = String(course.name || "课程");
      lines.push("BEGIN:VEVENT", `UID:course-${icsEscape(course.id || crypto.randomUUID())}-${week}@fangcun`, `DTSTAMP:${stamp}`, `DTSTART;TZID=Asia/Shanghai:${compactDateTime(eventDate, startSlot.startTime)}`, `DTEND;TZID=Asia/Shanghai:${compactDateTime(eventDate, endSlot.endTime)}`, `SUMMARY:${icsEscape(title)}`, `LOCATION:${icsEscape([course.campus, course.location].filter(Boolean).join(" · "))}`, `DESCRIPTION:${icsEscape([course.code, course.teacher, course.notes].filter(Boolean).join(" · "))}`);
      calendarAlarm(lines, course.reminderMinutes, `${title} 即将开始`);
      lines.push("END:VEVENT");
    });
  });

  tasks.filter((task) => !task.completed).forEach((task) => {
    const startDate = task.startDate || task.due;
    if (!startDate) return;
    const title = `${task.due && !task.startDate ? "DDL · " : ""}${task.title || "事项"}`;
    lines.push("BEGIN:VEVENT", `UID:task-${icsEscape(task.id || crypto.randomUUID())}@fangcun`, `DTSTAMP:${stamp}`);
    if (task.startTime || task.dueTime) {
      const startTime = task.startTime || task.dueTime;
      let endDate = task.endDate || startDate;
      let crossesMidnight = false;
      const endTime = task.endTime || (() => {
        const [hour, minute] = startTime.split(":").map(Number);
        const total = hour * 60 + minute + (task.startTime ? 60 : 15);
        crossesMidnight = total >= 24 * 60;
        return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
      })();
      if (!task.endDate && crossesMidnight) endDate = addDateDays(startDate, 1);
      lines.push(`DTSTART;TZID=Asia/Shanghai:${compactDateTime(startDate, startTime)}`, `DTEND;TZID=Asia/Shanghai:${compactDateTime(endDate, endTime)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(startDate)}`, `DTEND;VALUE=DATE:${compactDate(addDateDays(startDate, 1))}`);
    }
    lines.push(`SUMMARY:${icsEscape(title)}`, `DESCRIPTION:${icsEscape(task.notes || "由方寸同步")}`);
    calendarAlarm(lines, task.reminderMinutes, title);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function serveCalendarSubscription(request, response, url) {
  const match = url.pathname.match(/^\/calendar\/([A-Za-z0-9_-]{40,80})\.ics$/);
  if (!match) return false;
  const tokenHash = hashToken(match[1]);
  const owner = statements.getCalendarOwner.get(tokenHash);
  if (!owner?.document) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("Calendar not found");
    return true;
  }
  const etag = `W/\"fangcun-calendar-${owner.id}-${owner.revision || 0}\"`;
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, { ETag: etag, "Cache-Control": "private, max-age=300" });
    response.end();
    return true;
  }
  const content = buildCalendar(parseDocument(owner.document), owner.display_name);
  statements.touchCalendarToken.run(new Date().toISOString(), tokenHash);
  response.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Length": Buffer.byteLength(content), "Cache-Control": "private, max-age=300", ETag: etag, "X-Robots-Tag": "noindex, nofollow" });
  if (request.method === "HEAD") response.end(); else response.end(content);
  return true;
}

function agentError(status, message) { return Object.assign(new Error(message), { status }); }
function agentObject(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw agentError(400, "请求内容必须是 JSON 对象");
  return body;
}
function validAgentName(name) {
  return typeof name === "string" && [...name.trim()].length >= 1 && [...name.trim()].length <= 60 && ![".", ".."].includes(name.trim()) && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(name);
}
function validAgentDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function agentOwner(request) {
  const match = String(request.headers.authorization || "").match(/^Bearer ([A-Za-z0-9_-]{43})$/i);
  return match ? statements.getAgentOwner.get(hashToken(match[1])) || null : null;
}
function activeAgent(owner) { return owner && owner.status === "active" && owner.expires_at > Date.now(); }
function agentRateAllowed(tokenHash) {
  const now = Date.now();
  for (const [key, times] of agentRequests) if (!times.length || now - times[times.length - 1] >= 60000) agentRequests.delete(key);
  const recent = (agentRequests.get(tokenHash) || []).filter((time) => now - time < 60000);
  if (recent.length >= 60) return false;
  recent.push(now);
  agentRequests.set(tokenHash, recent);
  return true;
}
function recordAgentAudit(owner, action, status) {
  // Only fixed route labels and status codes: request bodies and bearer values never enter the audit.
  const userId = owner && statements.getUserById.get(owner.user_id) ? owner.user_id : null;
  statements.addAgentAudit.run(userId ? owner.token_hash : null, userId, action, JSON.stringify({ status }).slice(0, 200), Date.now());
  statements.pruneAgentAudit.run(userId, userId);
}
function agentDocument(userId) {
  const row = statements.getState.get(userId);
  if (!row) return { row: null, document: { schemaVersion: 3, tasks: [], projects: [], courses: [], timeSlots: [], courseExceptions: [], semester: {}, settings: {} } };
  const document = parseDocument(row.document);
  if (!validDocument(document)) throw agentError(409, "日程数据需要先在方寸中修复并同步");
  return { row, document };
}
function validateAgentTask(body, document, existing = null) {
  agentObject(body);
  const allowed = new Set(["title", "notes", "due", "dueTime", "important", "urgent", "courseId", existing ? "completed" : "quadrant"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw agentError(400, "包含不支持的任务字段");
  if (existing && !Object.keys(body).length) throw agentError(400, "请提供至少一个要修改的字段");
  const has = (key) => Object.hasOwn(body, key);
  if ((!existing || has("title")) && (typeof body.title !== "string" || !body.title.trim() || [...body.title.trim()].length > 120)) throw agentError(400, "title 需要为 1 到 120 个字");
  if (has("notes") && (typeof body.notes !== "string" || [...body.notes].length > 2000)) throw agentError(400, "notes 最多 2000 个字");
  if (has("due") && body.due !== "" && !validAgentDate(body.due)) throw agentError(400, "due 需要为有效的 YYYY-MM-DD 日期，或空字符串");
  if (has("dueTime") && (typeof body.dueTime !== "string" || (body.dueTime !== "" && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.dueTime)))) throw agentError(400, "dueTime 需要为 HH:mm，或空字符串");
  for (const key of ["important", "urgent", "completed"]) if (has(key) && typeof body[key] !== "boolean") throw agentError(400, `${key} 必须为布尔值`);
  if (has("quadrant") && !["q1", "q2", "q3", "q4"].includes(body.quadrant)) throw agentError(400, "quadrant 只能为 q1 到 q4，实际分类由 important/urgent 推导");
  if (has("courseId") && (typeof body.courseId !== "string" || body.courseId.length > 120 || (body.courseId !== "" && !document.courses.some((course) => course.id === body.courseId)))) throw agentError(400, "courseId 必须是当前用户已有的课程，或空字符串");
  const now = Date.now();
  const task = existing ? { ...existing } : {
    id: crypto.randomUUID(), title: "", notes: "", due: "", dueTime: "", courseId: "", projectId: "",
    type: "task", repeat: "none", reminderMinutes: -1, important: false, urgent: false,
    completed: false, today: false, source: "agent", createdAt: now,
  };
  for (const key of allowed) if (key !== "quadrant" && has(key)) task[key] = key === "title" ? body.title.trim() : body[key];
  if (has("due") && body.due === "" && !has("dueTime")) task.dueTime = "";
  if (task.dueTime && !task.due) throw agentError(400, "dueTime 需要同时有截止日期 due");
  if (!existing || has("important") || has("urgent")) {
    task.quadrant = task.important == null || task.urgent == null ? null : task.important ? (task.urgent ? "q1" : "q2") : (task.urgent ? "q3" : "q4");
  }
  if (has("completed")) task.completedAt = task.completed ? (existing?.completedAt || now) : null;
  task.updatedAt = now;
  return task;
}
function nextAgentOccurrence(task) {
  if (!["daily", "weekly", "weekdays", "monthly"].includes(task.repeat) || task.nextOccurrenceId) return null;
  // Match the app's calendar-date recurrence rules, including month-end clamping.
  const base = task.due ? new Date(`${task.due}T12:00:00`) : new Date();
  if (!Number.isFinite(base.getTime())) throw agentError(400, "重复任务的截止日期不正确");
  let next = new Date(base);
  if (task.repeat === "monthly") {
    next = new Date(base.getFullYear(), base.getMonth() + 2, 0, 12);
    next.setDate(Math.min(base.getDate(), next.getDate()));
  } else {
    next.setDate(next.getDate() + (task.repeat === "weekly" ? 7 : 1));
    if (task.repeat === "weekdays") while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  }
  const due = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  const nextTask = { ...task, id: crypto.randomUUID(), due, today: false, completed: false, completedAt: null, createdAt: Date.now(), recurrenceSourceId: task.id, nextOccurrenceId: null };
  task.nextOccurrenceId = nextTask.id;
  return nextTask;
}
async function handleAgentManagement(request, response, url, user) {
  if (!user || request.headers.authorization) return json(response, 401, { error: "令牌管理需要用户会话，请勿使用 Bearer 令牌" });
  if (url.pathname === "/api/agent/audit") {
    if (request.method !== "GET") return json(response, 405, { error: "此接口只支持 GET" }, { Allow: "GET" });
    return json(response, 200, { audit: statements.listAgentAudit.all(user.id) });
  }
  if (url.pathname === "/api/agent/tokens") {
    if (request.method === "GET") return json(response, 200, { tokens: statements.listAgentTokens.all(user.id) });
    if (request.method === "POST") {
      const body = agentObject(await readJson(request, agentMaxBodyBytes));
      if (Object.keys(body).some((key) => !["name", "expiresInDays"].includes(key))) throw agentError(400, "包含不支持的令牌字段");
      if (!validAgentName(body.name)) throw agentError(400, "名称需要为 1 到 60 个字，不能含控制字符");
      const expiresInDays = Object.hasOwn(body, "expiresInDays") ? body.expiresInDays : 90;
      if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365) throw agentError(400, "expiresInDays 必须为 1 到 365 的整数");
      // Recheck after reading the body so logout/account disable also takes effect in flight.
      if (!requestUser(request)) return json(response, 401, { error: "会话已失效，请重新登录" });
      const name = body.name.trim();
      if (statements.getAgentTokenByName.get(user.id, name)) return json(response, 409, { error: "这个令牌名称已经存在，请使用其他名称" });
      const token = crypto.randomBytes(32).toString("base64url");
      const createdAt = Date.now();
      const expiresAt = createdAt + expiresInDays * 86400000;
      statements.addAgentToken.run(hashToken(token), user.id, name, createdAt, expiresAt);
      return json(response, 201, { token, name, createdAt, expiresAt });
    }
    return json(response, 405, { error: "此接口支持 GET、POST" }, { Allow: "GET, POST" });
  }
  const match = url.pathname.match(/^\/api\/agent\/tokens\/([^/]+)$/);
  if (match) {
    if (request.method !== "DELETE") return json(response, 405, { error: "此接口只支持 DELETE" }, { Allow: "DELETE" });
    let name;
    try { name = decodeURIComponent(match[1]); } catch { throw agentError(400, "令牌名称编码不正确"); }
    if (!validAgentName(name) || name !== name.trim()) throw agentError(400, "令牌名称不正确");
    const token = statements.getAgentTokenByName.get(user.id, name);
    if (!token) return json(response, 404, { error: "令牌不存在" });
    statements.deleteAgentToken.run(user.id, name);
    agentRequests.delete(token.token_hash);
    return json(response, 200, { ok: true });
  }
  return json(response, 404, { error: "接口不存在" });
}
async function handleAgentBusiness(request, response, url) {
  let owner = agentOwner(request);
  const taskMatch = url.pathname.match(/^\/api\/agent\/tasks\/([^/]+)$/);
  const action = request.method === "GET" && url.pathname === "/api/agent/schedule" ? "schedule.read"
    : request.method === "POST" && url.pathname === "/api/agent/tasks" ? "tasks.create"
      : request.method === "PATCH" && taskMatch ? "tasks.update" : "request.unsupported";
  const send = (status, payload, headers = {}) => {
    recordAgentAudit(owner, action, status);
    return json(response, status, payload, headers);
  };
  try {
    if (!activeAgent(owner)) return send(401, { error: "Agent 令牌无效、已过期或已吊销" });
    if (!agentRateAllowed(owner.token_hash)) return send(429, { error: "每个令牌每分钟最多 60 次请求" }, { "Retry-After": "60" });
    statements.touchAgentToken.run(Date.now(), owner.token_hash);
    if (!originAllowed(request)) return send(403, { error: "请求来源不受信任" });
    if (action === "schedule.read") {
      const { row, document } = agentDocument(owner.user_id);
      return send(200, { tasks: document.tasks, courses: document.courses, semester: document.semester || {}, timeSlots: document.timeSlots, courseExceptions: document.courseExceptions, calendarRules: document.calendarRules || [], revision: row?.revision || 0, updatedAt: row?.updatedAt || null });
    }
    if (action === "tasks.create" || action === "tasks.update") {
      const body = await readJson(request, agentMaxBodyBytes);
      const currentOwner = agentOwner(request);
      if (!activeAgent(currentOwner)) return send(401, { error: "Agent 令牌无效、已过期或已吊销" });
      owner = currentOwner;
      if (externalSyncing.has(owner.user_id)) return send(409, { error: "外部日历正在同步，请完成后重试" });
      const { document } = agentDocument(owner.user_id);
      let existing = null;
      if (taskMatch) {
        let id;
        try { id = decodeURIComponent(taskMatch[1]); } catch { throw agentError(400, "任务 ID 编码不正确"); }
        if (!id || id.length > 120 || /[\u0000-\u001f\u007f]/.test(id)) throw agentError(400, "任务 ID 不正确");
        existing = document.tasks.find((task) => task.id === id);
        if (!existing) return send(404, { error: "任务不存在" });
      }
      const task = validateAgentTask(body, document, existing);
      if (existing) document.tasks[document.tasks.indexOf(existing)] = task;
      else document.tasks.unshift(task);
      if (existing && !existing.completed && task.completed) {
        const nextTask = nextAgentOccurrence(task);
        if (nextTask) document.tasks.unshift(nextTask);
      }
      if (!validDocument(document)) throw agentError(400, "日程内容过大，请先整理已有数据");
      const saved = persistExternalDocument(owner.user_id, document);
      return send(existing ? 200 : 201, { task, ...saved });
    }
    if (url.pathname === "/api/agent/schedule" || url.pathname === "/api/agent/tasks" || taskMatch) return send(405, { error: "Agent v1 不支持此操作" }, { Allow: taskMatch ? "PATCH" : url.pathname.endsWith("schedule") ? "GET" : "POST" });
    return send(404, { error: "接口不存在" });
  } catch (error) {
    // Do not log request data or raw exceptions from agent requests.
    return send(error.status || 500, { error: error.status ? error.message : "服务器内部错误" });
  }
}

async function handleApi(request, response, url) {
  const agentManagement = url.pathname === "/api/agent/tokens" || url.pathname.startsWith("/api/agent/tokens/") || url.pathname === "/api/agent/audit";
  if (url.pathname.startsWith("/api/agent/") && !agentManagement) return handleAgentBusiness(request, response, url);
  if (!originAllowed(request)) return json(response, 403, { error: "请求来源不受信任" });
  const configured = statements.userCount.get().count > 0;
  const user = requestUser(request);
  if (agentManagement) return handleAgentManagement(request, response, url, user);
  if (request.method === "GET" && url.pathname === "/api/health") return json(response, 200, { ok: true, service: "fangcun", version: APP_VERSION, configured, time: new Date().toISOString() });
  if (request.method === "GET" && url.pathname === "/api/auth/session") return json(response, 200, { configured, authenticated: Boolean(user), user: publicUser(user), registrationOpen: registrationOpen(), version: APP_VERSION });
  if (request.method === "GET" && url.pathname === "/api/integrations/outlook/callback") {
    try {
      const result = await outlook.callback(url.searchParams.get("code"), url.searchParams.get("state"));
      response.writeHead(302, { Location: result.source === "android" ? "fangcun://outlook-connected" : "/?outlook=connected", "Cache-Control": "no-store" });
      return response.end();
    } catch (error) {
      const message = encodeURIComponent(String(error.message || "Outlook 授权失败").slice(0, 180));
      response.writeHead(302, { Location: `/?outlook=error&message=${message}`, "Cache-Control": "no-store" });
      return response.end();
    }
  }
  if (request.method === "GET" && url.pathname === "/api/integrations/google/callback") {
    try {
      const result = await google.callback(url.searchParams.get("code"), url.searchParams.get("state"));
      response.writeHead(302, { Location: result.source === "android" ? "fangcun://google-connected" : "/?google=connected", "Cache-Control": "no-store" });
      return response.end();
    } catch (error) {
      const message = encodeURIComponent(String(error.message || "Google 授权失败").slice(0, 180));
      response.writeHead(302, { Location: `/?google=error&message=${message}`, "Cache-Control": "no-store" });
      return response.end();
    }
  }

  if (request.method === "POST" && url.pathname === "/api/auth/setup") {
    if (configured) return json(response, 409, { error: "管理员账号已经初始化" });
    const body = await readJson(request);
    const username = String(body.username || "owner").trim();
    if (!validUsername(username)) return json(response, 400, { error: "用户名需为 3 到 32 个字符，只能包含文字、数字、下划线或短横线" });
    if (!validPassword(body.password)) return json(response, 400, { error: "密码长度需要在 8 到 128 个字符之间" });
    const now = new Date().toISOString();
    const result = statements.addUser.run(username, String(body.displayName || "管理员").trim().slice(0, 40) || username, passwordRecord(body.password), "admin", now);
    const newUser = statements.getUserById.get(Number(result.lastInsertRowid));
    createSession(newUser.id, request, response);
    return json(response, 201, { ok: true, user: publicUser(newUser) });
  }
  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    if (!configured || !registrationOpen()) return json(response, 403, { error: "管理员暂未开放注册" });
    const body = await readJson(request);
    const username = String(body.username || "").trim();
    if (blocked(request, "register", username, 5)) return json(response, 429, { error: "注册尝试过多，请 15 分钟后再试" });
    if (!validUsername(username)) return json(response, 400, { error: "用户名需为 3 到 32 个字符，只能包含文字、数字、下划线或短横线" });
    if (!validPassword(body.password)) return json(response, 400, { error: "密码长度需要在 8 到 128 个字符之间" });
    if (statements.getUserByName.get(username)) { recordFailure(request, "register", username); return json(response, 409, { error: "这个用户名已被使用" }); }
    const displayName = String(body.displayName || username).trim().slice(0, 40) || username;
    const result = statements.addUser.run(username, displayName, passwordRecord(body.password), "user", new Date().toISOString());
    const newUser = statements.getUserById.get(Number(result.lastInsertRowid));
    createSession(newUser.id, request, response);
    clearFailures(request, "register", username);
    return json(response, 201, { ok: true, user: publicUser(newUser) });
  }
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    if (!configured) return json(response, 409, { error: "请先初始化管理员账号" });
    const body = await readJson(request);
    let username = String(body.username || "").trim();
    if (!username && statements.userCount.get().count === 1) username = statements.getOnlyUser.get().username;
    if (blocked(request, "login", username)) return json(response, 429, { error: "尝试次数过多，请 15 分钟后再试" });
    const loginUser = statements.getUserByName.get(username);
    if (!loginUser || loginUser.status !== "active" || !validLoginPassword(body.password) || !verifyPassword(body.password, loginUser.password_record)) {
      recordFailure(request, "login", username);
      return json(response, 401, { error: "用户名或密码不正确" });
    }
    clearFailures(request, "login", username);
    statements.touchLogin.run(new Date().toISOString(), loginUser.id);
    createSession(loginUser.id, request, response);
    return json(response, 200, { ok: true, user: publicUser(loginUser) });
  }
  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = sessionToken(request);
    if (token) statements.deleteSession.run(hashToken(token));
    return json(response, 200, { ok: true }, { "Set-Cookie": clearSessionCookie(request) });
  }
  if (!configured) return json(response, 428, { error: "请先初始化管理员账号" });
  if (!user) return json(response, 401, { error: "请先登录" });
  if (url.pathname === "/api/calendar/subscription") {
    if (request.method === "GET") {
      const subscription = statements.getCalendarTokenForUser.get(user.id);
      return json(response, 200, { enabled: Boolean(subscription), createdAt: subscription?.createdAt || null, lastAccessAt: subscription?.lastAccessAt || null });
    }
    if (request.method === "POST") {
      const token = crypto.randomBytes(32).toString("base64url");
      const createdAt = new Date().toISOString();
      statements.setCalendarToken.run(hashToken(token), user.id, createdAt);
      return json(response, 201, { enabled: true, createdAt, url: `${publicRequestOrigin(request)}/calendar/${token}.ics` });
    }
    if (request.method === "DELETE") {
      statements.deleteCalendarToken.run(user.id);
      return json(response, 200, { ok: true, enabled: false });
    }
  }

  if (url.pathname === "/api/integrations/outlook/status" && request.method === "GET") {
    return json(response, 200, outlook.status(user.id));
  }
  if (url.pathname === "/api/integrations/outlook/connect" && request.method === "POST") {
    const body = await readJson(request);
    return json(response, 200, { ok: true, ...outlook.begin(user.id, body.source) });
  }
  if (url.pathname === "/api/integrations/outlook/sync" && request.method === "POST") {
    return json(response, 200, await syncOutlookForUser(user.id));
  }
  if (url.pathname === "/api/integrations/outlook" && request.method === "DELETE") {
    outlook.disconnect(user.id);
    return json(response, 200, { ok: true, connected: false, remoteCalendarRetained: true });
  }
  if (url.pathname === "/api/integrations/google/status" && request.method === "GET") {
    return json(response, 200, google.status(user.id));
  }
  if (url.pathname === "/api/integrations/google/connect" && request.method === "POST") {
    const body = await readJson(request);
    return json(response, 200, { ok: true, ...google.begin(user.id, body.source) });
  }
  if (url.pathname === "/api/integrations/google/sync" && request.method === "POST") {
    return json(response, 200, await syncGoogleForUser(user.id));
  }
  if (url.pathname === "/api/integrations/google" && request.method === "DELETE") {
    google.disconnect(user.id);
    return json(response, 200, { ok: true, connected: false, remoteCalendarRetained: true });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/password") {
    const body = await readJson(request);
    if (typeof body.currentPassword !== "string" || !verifyPassword(body.currentPassword, user.password_record)) return json(response, 401, { error: "当前密码不正确" });
    if (!validPassword(body.newPassword)) return json(response, 400, { error: "新密码长度需要在 8 到 128 个字符之间" });
    statements.changePassword.run(passwordRecord(body.newPassword), user.id);
    statements.deleteUserSessions.run(user.id);
    createSession(user.id, request, response);
    return json(response, 200, { ok: true });
  }
  if (request.method === "DELETE" && url.pathname === "/api/auth/account") {
    if (user.role !== "user") return json(response, 403, { error: "管理员账号不能在应用内注销" });
    const body = await readJson(request);
    if (blocked(request, "delete-account", user.username, 5)) return json(response, 429, { error: "验证尝试过多，请 15 分钟后再试" });
    if (typeof body.password !== "string" || !verifyPassword(body.password, user.password_record)) {
      recordFailure(request, "delete-account", user.username);
      return json(response, 401, { error: "当前密码不正确" });
    }
    statements.deleteUser.run(user.id);
    clearFailures(request, "delete-account", user.username);
    return json(response, 200, { ok: true, deleted: true }, { "Set-Cookie": clearSessionCookie(request) });
  }
  if (request.method === "GET" && url.pathname === "/api/data") {
    const row = statements.getState.get(user.id);
    return json(response, 200, row ? { data: JSON.parse(row.document), revision: row.revision, updatedAt: row.updatedAt } : { data: null, revision: 0, updatedAt: null });
  }
  if (request.method === "PUT" && url.pathname === "/api/data") {
    const body = await readJson(request);
    if (!validDocument(body.data)) return json(response, 400, { error: "数据结构不正确或内容过大" });
    const current = statements.getState.get(user.id);
    const baseRevision = Number(body.baseRevision);
    const force = url.searchParams.get("force") === "1";
    if (current && !force && baseRevision !== current.revision) return json(response, 409, { error: "云端数据已被另一台设备更新", revision: current.revision, updatedAt: current.updatedAt });
    const serialized = JSON.stringify(body.data);
    const now = new Date().toISOString();
    const revision = current ? current.revision + 1 : 1;
    database.exec("BEGIN IMMEDIATE");
    try {
      if (current) statements.addSnapshot.run(user.id, current.revision, current.document, now);
      if (current) statements.updateState.run(serialized, revision, now, user.id); else statements.insertState.run(user.id, serialized, now);
      statements.pruneSnapshots.run(user.id, user.id);
      database.exec("COMMIT");
    } catch (error) { database.exec("ROLLBACK"); throw error; }
    return json(response, 200, { ok: true, revision, updatedAt: now });
  }

  if (url.pathname.startsWith("/api/admin/")) {
    if (user.role !== "admin") return json(response, 403, { error: "需要管理员权限" });
    if (request.method === "GET" && url.pathname === "/api/admin/users") {
      const users = statements.listUsers.all().map((row) => summarizeUser(row));
      return json(response, 200, { users, registrationOpen: registrationOpen(), migration: ownerMigrationStatus(), stats: { total: users.length, active: users.filter((item) => item.status === "active").length, ordinary: users.filter((item) => item.role === "user").length, withData: users.filter((item) => item.revision > 0).length } });
    }
    if (request.method === "PUT" && url.pathname === "/api/admin/registration") {
      const body = await readJson(request);
      const mode = body.open === true ? "open" : "closed";
      statements.setConfig.run("registration_mode", mode);
      return json(response, 200, { ok: true, registrationOpen: mode === "open" });
    }
    const statusMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/status$/);
    if (request.method === "PATCH" && statusMatch) {
      const targetId = Number(statusMatch[1]);
      const body = await readJson(request);
      if (targetId === user.id) return json(response, 400, { error: "不能停用当前登录的管理员账号" });
      if (!statements.getUserById.get(targetId)) return json(response, 404, { error: "账号不存在" });
      const status = body.status === "active" ? "active" : body.status === "disabled" ? "disabled" : "";
      if (!status) return json(response, 400, { error: "账号状态不正确" });
      statements.setUserStatus.run(status, targetId);
      if (status === "disabled") statements.deleteUserSessions.run(targetId);
      return json(response, 200, { ok: true });
    }
    const resetPasswordMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/);
    if (request.method === "POST" && resetPasswordMatch) {
      const target = statements.getUserById.get(Number(resetPasswordMatch[1]));
      if (!target) return json(response, 404, { error: "账号不存在" });
      if (target.role === "admin") return json(response, 400, { error: "不能从这里重置管理员密码" });
      const temporaryPassword = crypto.randomBytes(15).toString("base64url");
      statements.changePassword.run(passwordRecord(temporaryPassword), target.id);
      statements.deleteUserSessions.run(target.id);
      return json(response, 200, { ok: true, username: target.username, temporaryPassword });
    }
    const detailMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
    if (request.method === "GET" && detailMatch) {
      const target = statements.listUsers.all().find((item) => item.id === Number(detailMatch[1]));
      if (!target) return json(response, 404, { error: "账号不存在" });
      return json(response, 200, { user: summarizeUser(target, true) });
    }
    if (request.method === "DELETE" && detailMatch) {
      const target = statements.getUserById.get(Number(detailMatch[1]));
      if (!target) return json(response, 404, { error: "账号不存在" });
      if (target.id === user.id || target.role === "admin") return json(response, 400, { error: "管理员账号不能在这里删除" });
      statements.deleteUser.run(target.id);
      return json(response, 200, { ok: true, deleted: { id: target.id, username: target.username } });
    }
    if (request.method === "POST" && url.pathname === "/api/admin/migrate-owner-data") {
      const body = await readJson(request);
      const result = migrateOwnerData(body.force === true);
      if (!result.ok) return json(response, result.status, result);
      return json(response, 200, result);
    }
  }
  return json(response, 404, { error: "接口不存在" });
}

function serveStatic(request, response, url) {
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (!publicFiles.has(relative)) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Not found"); return; }
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename)) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); response.end("Not found"); return; }
  if (relative === "privacy.html" || relative === "index.html") {
    const replacements = {
      "{{OPERATOR_NAME}}": process.env.FANGCUN_OPERATOR_NAME || "发布前待配置",
      "{{CONTACT}}": process.env.FANGCUN_CONTACT || "发布前待配置",
      "{{APP_BEIAN}}": process.env.FANGCUN_APP_BEIAN || "发布前待配置",
      "{{ICP_BEIAN}}": process.env.FANGCUN_ICP_BEIAN || "发布前待配置",
    };
    let content = fs.readFileSync(filename, "utf8");
    for (const [placeholder, value] of Object.entries(replacements)) content = content.replaceAll(placeholder, escapePublicText(value));
    response.writeHead(200, { "Content-Type": types[".html"], "Content-Length": Buffer.byteLength(content), "Cache-Control": "no-cache, no-store, must-revalidate" });
    if (request.method === "HEAD") response.end(); else response.end(content);
    return;
  }
  const cacheControl = relative === "icon.svg" ? "public, max-age=3600" : "no-cache, no-store, must-revalidate";
  response.writeHead(200, { "Content-Type": types[path.extname(filename)] || "application/octet-stream", "Cache-Control": cacheControl });
  if (request.method === "HEAD") response.end(); else fs.createReadStream(filename).pipe(response);
}
async function handleRequest(request, response) {
  securityHeaders(response);
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if ((request.method === "GET" || request.method === "HEAD") && serveCalendarSubscription(request, response, url)) return;
    if (url.pathname.startsWith("/api/")) await handleApi(request, response, url);
    else if (request.method === "GET" || request.method === "HEAD") serveStatic(request, response, url);
    else json(response, 405, { error: "不支持的请求方法" }, { Allow: "GET, HEAD" });
  } catch (error) {
    if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : "服务器内部错误" });
    if (!error.status) console.error(error);
  }
}

statements.deleteExpiredSessions.run(Date.now());
const tlsKey = process.env.TLS_KEY;
const tlsCert = process.env.TLS_CERT;
const server = tlsKey && tlsCert ? https.createServer({ key: fs.readFileSync(tlsKey), cert: fs.readFileSync(tlsCert) }, handleRequest) : http.createServer(handleRequest);
server.listen(port, host, () => {
  console.log(`方寸 ${APP_VERSION} 已启动：http${tlsKey && tlsCert ? "s" : ""}://${host}:${port}`);
  console.log(`数据文件：${databasePath}`);
});
const calendarPoller = setInterval(async () => {
  const users = new Set([...outlook.connectedUserIds(), ...google.connectedUserIds()]);
  for (const userId of users) {
    if (outlook.connectedUserIds().includes(userId)) {
      try { await syncOutlookForUser(userId); }
      catch (error) { if (error.status !== 409) console.error(`Outlook 后台同步失败（用户 ${userId}）：`, error.message); }
    }
    if (google.connectedUserIds().includes(userId)) {
      try { await syncGoogleForUser(userId); }
      catch (error) { if (error.status !== 409) console.error(`Google 后台同步失败（用户 ${userId}）：`, error.message); }
    }
  }
}, 5 * 60 * 1000);
calendarPoller.unref();
function shutdown() { clearInterval(calendarPoller); server.close(() => { database.close(); process.exit(0); }); setTimeout(() => process.exit(1), 5000).unref(); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
