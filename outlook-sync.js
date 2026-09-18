const crypto = require("crypto");
const { semesterCourseOccurrences } = require("./calendar-occurrences");

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const SCOPES = "openid profile offline_access User.Read Calendars.ReadWrite";
const WINDOWS_TIME_ZONE = "China Standard Time";
const MARKER_PATTERN = /<!--\s*FANGCUN:([A-Za-z0-9_-]+)\s*-->/i;

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromIso(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function addDays(value, days) {
  const date = typeof value === "string" ? dateFromIso(value) : new Date(value);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function weekday(value) { return dateFromIso(value).getDay() || 7; }

function hash(value) { return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex"); }

function htmlEscape(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function markerFor(localKey) { return `<!-- FANGCUN:${Buffer.from(localKey).toString("base64url")} -->`; }

function markerFromEvent(event) {
  const source = `${event?.body?.content || ""}\n${event?.bodyPreview || ""}`;
  const match = source.match(MARKER_PATTERN);
  if (!match) return "";
  try { return Buffer.from(match[1], "base64url").toString("utf8"); } catch { return ""; }
}

function stripMarker(value) { return String(value || "").replace(MARKER_PATTERN, "").replace(/<p>由方寸双向同步<\/p>/gi, "").trim(); }

function plainText(value) {
  return stripMarker(value).replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function parseGraphDateTime(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? { date: match[1], time: match[2] } : { date: "", time: "" };
}

function graphDateTime(date, time = "00:00") { return `${date}T${time}:00`; }

function taskLocalEvent(task) {
  const date = task.startDate || task.due;
  if (!date || task.completed) return null;
  const time = task.startTime || task.dueTime || "";
  const allDay = !time;
  let endDate = task.endDate || date;
  let endTime = task.endTime || "";
  if (!allDay && !endTime) {
    const start = new Date(`${date}T${time}:00`);
    const end = new Date(start.getTime() + (task.startDate ? 60 : 15) * 60000);
    endDate = isoDate(end);
    endTime = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  }
  if (allDay) endDate = addDays(date, 1);
  return {
    localKey: `task:${task.id}`, kind: "task", sourceId: task.id,
    title: task.due && !task.startDate ? `DDL · ${task.title || "事项"}` : task.title || "事项",
    description: task.notes || "", location: task.location || "", date, time,
    endDate, endTime, allDay, reminderMinutes: Number(task.reminderMinutes ?? -1),
    updatedAt: Number(task.updatedAt || task.createdAt || 0),
  };
}

// 课程实例 → 本地事件：与网页端逐日扫描口径一致（含补课日重放与被挪入的实例），
// 语义由 calendar-occurrences.js 统一提供（与 app.js courseOccurrence() 对照守护）。
function courseLocalEvents(document) {
  const slots = Array.isArray(document.timeSlots) ? document.timeSlots : [];
  const slot = (number) => slots.find((item) => Number(item.number) === Number(number));
  return semesterCourseOccurrences(document).flatMap(({ course, occurrence, dateKey, keyDate, record }) => {
    const start = slot(occurrence.startSection);
    const end = slot(occurrence.endSection);
    if (!start || !end) return [];
    return [{
      localKey: `course:${course.id}:${keyDate}`, kind: "course", sourceId: course.id, occurrenceDate: keyDate,
      title: record?.name || course.name || "课程", description: [course.code, course.teacher, course.notes].filter(Boolean).join(" · "),
      location: record?.location || [course.campus, course.location].filter(Boolean).join(" · "), date: dateKey, time: start.startTime,
      endDate: dateKey, endTime: end.endTime, allDay: false, reminderMinutes: Number(course.reminderMinutes ?? -1),
      updatedAt: Number(record?.updatedAt || course.updatedAt || course.createdAt || 0),
    }];
  });
}

function localEvents(document) {
  return [
    ...(Array.isArray(document.tasks) ? document.tasks.map(taskLocalEvent).filter(Boolean) : []),
    ...courseLocalEvents(document),
  ];
}

function localEventHash(event) {
  return hash({ title: event.title, description: event.description, location: event.location, date: event.date, time: event.time, endDate: event.endDate, endTime: event.endTime, allDay: event.allDay, reminderMinutes: event.reminderMinutes });
}

function graphPayload(event) {
  const description = `${event.description ? `<p>${htmlEscape(event.description).replace(/\n/g, "<br>")}</p>` : ""}<p>由方寸双向同步</p>${markerFor(event.localKey)}`;
  return {
    subject: event.title,
    body: { contentType: "HTML", content: description },
    location: { displayName: event.location || "" },
    start: { dateTime: graphDateTime(event.date, event.time || "00:00"), timeZone: WINDOWS_TIME_ZONE },
    end: { dateTime: graphDateTime(event.endDate || event.date, event.endTime || (event.allDay ? "00:00" : event.time)), timeZone: WINDOWS_TIME_ZONE },
    isAllDay: Boolean(event.allDay),
    isReminderOn: Number(event.reminderMinutes) >= 0,
    reminderMinutesBeforeStart: Math.max(0, Number(event.reminderMinutes) || 0),
    showAs: "busy",
    sensitivity: "private",
    categories: ["方寸"],
  };
}

function remoteToTask(event, id = `outlook-${crypto.randomUUID()}`) {
  const start = parseGraphDateTime(event.start?.dateTime);
  const end = parseGraphDateTime(event.end?.dateTime);
  const allDay = Boolean(event.isAllDay);
  return {
    id, title: String(event.subject || "Outlook 日程").replace(/^DDL\s*[·・-]\s*/, ""),
    notes: plainText(event.body?.content || event.bodyPreview || ""), location: event.location?.displayName || "",
    due: "", dueTime: "", startDate: start.date, startTime: allDay ? "" : start.time,
    endDate: allDay ? "" : end.date, endTime: allDay ? "" : end.time,
    reminderMinutes: event.isReminderOn ? Number(event.reminderMinutesBeforeStart || 0) : -1,
    estimateMinutes: 0, type: "event", repeat: "none", courseId: "", projectId: "",
    important: null, urgent: null, quadrant: null, today: start.date === isoDate(new Date()), completed: false,
    source: "outlook", createdAt: Date.now(), updatedAt: Date.parse(event.lastModifiedDateTime) || Date.now(),
  };
}

class OutlookIntegration {
  constructor(database, env = process.env) {
    this.database = database;
    this.clientId = String(env.MICROSOFT_CLIENT_ID || "").trim();
    this.clientSecret = String(env.MICROSOFT_CLIENT_SECRET || "").trim();
    this.tenant = String(env.MICROSOFT_TENANT || "common").trim() || "common";
    this.redirectUri = String(env.MICROSOFT_REDIRECT_URI || "").trim();
    this.secret = String(env.FANGCUN_INTEGRATION_KEY || "");
    this.key = this.secret ? crypto.createHash("sha256").update(this.secret).digest() : null;
    this.configured = Boolean(this.clientId && this.clientSecret && this.redirectUri && this.key && this.secret.length >= 32);
    database.exec(`
      CREATE TABLE IF NOT EXISTS outlook_connections (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        access_token TEXT, refresh_token TEXT, expires_at INTEGER,
        calendar_id TEXT, account_label TEXT,
        oauth_state_hash TEXT UNIQUE, oauth_state_expires INTEGER, oauth_source TEXT,
        last_sync_at TEXT, last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS outlook_event_links (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        local_key TEXT NOT NULL, outlook_event_id TEXT NOT NULL,
        local_hash TEXT, remote_change_key TEXT, last_synced_at TEXT NOT NULL,
        PRIMARY KEY(user_id, local_key), UNIQUE(user_id, outlook_event_id)
      );
    `);
    this.getConnection = database.prepare("SELECT * FROM outlook_connections WHERE user_id = ?");
    this.getConnectionByState = database.prepare("SELECT * FROM outlook_connections WHERE oauth_state_hash = ? AND oauth_state_expires > ?");
    this.beginConnection = database.prepare("INSERT INTO outlook_connections (user_id, oauth_state_hash, oauth_state_expires, oauth_source) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET oauth_state_hash=excluded.oauth_state_hash, oauth_state_expires=excluded.oauth_state_expires, oauth_source=excluded.oauth_source, last_error=NULL");
    this.finishConnection = database.prepare("UPDATE outlook_connections SET access_token=?, refresh_token=?, expires_at=?, calendar_id=?, account_label=?, oauth_state_hash=NULL, oauth_state_expires=NULL, last_error=NULL WHERE user_id=?");
    this.updateTokens = database.prepare("UPDATE outlook_connections SET access_token=?, refresh_token=?, expires_at=? WHERE user_id=?");
    this.updateCalendar = database.prepare("UPDATE outlook_connections SET calendar_id=? WHERE user_id=?");
    this.updateStatus = database.prepare("UPDATE outlook_connections SET last_sync_at=?, last_error=? WHERE user_id=?");
    this.updateError = database.prepare("UPDATE outlook_connections SET last_error=? WHERE user_id=?");
    this.deleteConnection = database.prepare("DELETE FROM outlook_connections WHERE user_id=?");
    this.listConnected = database.prepare("SELECT user_id AS userId FROM outlook_connections WHERE refresh_token IS NOT NULL AND calendar_id IS NOT NULL");
    this.getLinks = database.prepare("SELECT * FROM outlook_event_links WHERE user_id=?");
    this.upsertLink = database.prepare("INSERT INTO outlook_event_links (user_id, local_key, outlook_event_id, local_hash, remote_change_key, last_synced_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, local_key) DO UPDATE SET outlook_event_id=excluded.outlook_event_id, local_hash=excluded.local_hash, remote_change_key=excluded.remote_change_key, last_synced_at=excluded.last_synced_at");
    this.deleteLink = database.prepare("DELETE FROM outlook_event_links WHERE user_id=? AND local_key=?");
    this.deleteLinks = database.prepare("DELETE FROM outlook_event_links WHERE user_id=?");
  }

  encrypt(value) {
    if (!this.key || !value) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
  }

  decrypt(value) {
    if (!this.key || !value) return "";
    const [iv, tag, ciphertext] = String(value).split(".").map((part) => Buffer.from(part, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }

  status(userId) {
    const row = this.getConnection.get(userId);
    return {
      configured: this.configured, connected: Boolean(row?.refresh_token && row?.calendar_id),
      account: row?.account_label || "", calendarName: row?.calendar_id ? "方寸" : "",
      lastSyncAt: row?.last_sync_at || null, lastError: row?.last_error || null,
      intervalMinutes: 5,
    };
  }

  begin(userId, source = "web") {
    if (!this.configured) throw Object.assign(new Error("服务端尚未配置 Microsoft 应用注册"), { status: 503 });
    const state = crypto.randomBytes(32).toString("base64url");
    this.beginConnection.run(userId, hash(state), Date.now() + 10 * 60 * 1000, source === "android" ? "android" : "web");
    const params = new URLSearchParams({ client_id: this.clientId, response_type: "code", redirect_uri: this.redirectUri, response_mode: "query", scope: SCOPES, state, prompt: "select_account" });
    return { authUrl: `https://login.microsoftonline.com/${encodeURIComponent(this.tenant)}/oauth2/v2.0/authorize?${params}` };
  }

  async callback(code, state) {
    if (!this.configured || !code || !state) throw Object.assign(new Error("Outlook 授权回调不完整"), { status: 400 });
    const connection = this.getConnectionByState.get(hash(state), Date.now());
    if (!connection) throw Object.assign(new Error("Outlook 授权已过期，请重新连接"), { status: 400 });
    const token = await this.tokenRequest({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: "authorization_code", code, redirect_uri: this.redirectUri, scope: SCOPES });
    const temporary = { ...connection, access_token: this.encrypt(token.access_token), refresh_token: this.encrypt(token.refresh_token), expires_at: Date.now() + Number(token.expires_in || 3600) * 1000 };
    const account = await this.graph(temporary, "GET", "/me?$select=displayName,mail,userPrincipalName");
    const calendarId = await this.ensureCalendar(temporary);
    this.finishConnection.run(temporary.access_token, temporary.refresh_token, temporary.expires_at, calendarId, account.mail || account.userPrincipalName || account.displayName || "Outlook", connection.user_id);
    return { userId: connection.user_id, source: connection.oauth_source || "web" };
  }

  async tokenRequest(fields) {
    const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(this.tenant)}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error_description || body.error || "Microsoft 授权失败"), { status: 502 });
    return body;
  }

  async accessToken(connection) {
    if (connection.expires_at > Date.now() + 60000 && connection.access_token) return this.decrypt(connection.access_token);
    const token = await this.tokenRequest({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: "refresh_token", refresh_token: this.decrypt(connection.refresh_token), redirect_uri: this.redirectUri, scope: SCOPES });
    connection.access_token = this.encrypt(token.access_token);
    connection.refresh_token = this.encrypt(token.refresh_token || this.decrypt(connection.refresh_token));
    connection.expires_at = Date.now() + Number(token.expires_in || 3600) * 1000;
    this.updateTokens.run(connection.access_token, connection.refresh_token, connection.expires_at, connection.user_id);
    return token.access_token;
  }

  async graph(connection, method, pathname, body = null) {
    const token = await this.accessToken(connection);
    const response = await fetch(pathname.startsWith("https://") ? pathname : `${GRAPH_ROOT}${pathname}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", Prefer: `outlook.timezone=\"${WINDOWS_TIME_ZONE}\"` },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error?.message || `Microsoft Graph ${response.status}`), { status: 502 });
    return result;
  }

  async ensureCalendar(connection) {
    if (connection.calendar_id) return connection.calendar_id;
    let url = "/me/calendars?$top=100";
    while (url) {
      const page = await this.graph(connection, "GET", url);
      const found = (page.value || []).find((calendar) => calendar.name === "方寸");
      if (found) return found.id;
      url = page["@odata.nextLink"] || "";
    }
    const created = await this.graph(connection, "POST", "/me/calendars", { name: "方寸" });
    return created.id;
  }

  async listRemoteEvents(connection, startDate, endDate) {
    const calendarId = encodeURIComponent(connection.calendar_id);
    let url = `/me/calendars/${calendarId}/calendarView?startDateTime=${encodeURIComponent(`${startDate}T00:00:00`)}&endDateTime=${encodeURIComponent(`${endDate}T23:59:59`)}&$top=500`;
    const events = [];
    while (url) {
      const page = await this.graph(connection, "GET", url);
      events.push(...(page.value || []));
      url = page["@odata.nextLink"] || "";
    }
    return events.filter((event) => !event.isCancelled);
  }

  link(userId, localEvent, remote) {
    this.upsertLink.run(userId, localEvent.localKey, remote.id, localEventHash(localEvent), remote.changeKey || "", new Date().toISOString());
  }

  upsertCourseException(document, localKey, remote) {
    const match = localKey.match(/^course:([^:]+):(\d{4}-\d{2}-\d{2})$/);
    if (!match || !(document.courses || []).some((item) => item.id === match[1])) return false;
    const start = parseGraphDateTime(remote.start?.dateTime);
    const end = parseGraphDateTime(remote.end?.dateTime);
    let startSlot = (document.timeSlots || []).find((item) => item.startTime === start.time);
    let endSlot = (document.timeSlots || []).find((item) => item.endTime === end.time);
    if (!startSlot || !endSlot) {
      const number = Math.max(0, ...(document.timeSlots || []).map((item) => Number(item.number) || 0)) + 1;
      const slot = { number, startTime: start.time, endTime: end.time || start.time };
      document.timeSlots ||= [];
      document.timeSlots.push(slot);
      document.timeSlots.sort((a, b) => a.startTime.localeCompare(b.startTime));
      startSlot = slot;
      endSlot = slot;
    }
    document.courseExceptions ||= [];
    document.courseExceptions = document.courseExceptions.filter((item) => !(item.courseId === match[1] && item.date === match[2]));
    document.courseExceptions.push({ id: crypto.randomUUID(), courseId: match[1], date: match[2], targetDate: start.date, type: "reschedule", day: weekday(start.date), startSection: startSlot.number, endSection: endSlot.number, name: remote.subject || "课程", location: remote.location?.displayName || "", source: "outlook", updatedAt: Date.now() });
    return true;
  }

  applyRemote(document, localKey, remote) {
    if (localKey.startsWith("task:")) {
      const id = localKey.slice(5);
      const index = (document.tasks || []).findIndex((item) => item.id === id);
      if (index < 0) return false;
      const existing = document.tasks[index];
      const next = remoteToTask(remote, id);
      next.projectId = existing.projectId || "";
      next.courseId = existing.courseId || "";
      next.important = existing.important;
      next.urgent = existing.urgent;
      next.quadrant = existing.quadrant;
      next.createdAt = existing.createdAt || next.createdAt;
      if (existing.due && !existing.startDate) {
        next.due = next.startDate; next.dueTime = next.startTime; next.startDate = ""; next.startTime = ""; next.endDate = ""; next.endTime = "";
      }
      document.tasks[index] = next;
      return true;
    }
    return this.upsertCourseException(document, localKey, remote);
  }

  applyRemoteDelete(document, localKey) {
    if (localKey.startsWith("task:")) {
      const before = (document.tasks || []).length;
      document.tasks = (document.tasks || []).filter((item) => item.id !== localKey.slice(5));
      return document.tasks.length !== before;
    }
    const match = localKey.match(/^course:([^:]+):(\d{4}-\d{2}-\d{2})$/);
    if (!match) return false;
    document.courseExceptions ||= [];
    document.courseExceptions = document.courseExceptions.filter((item) => !(item.courseId === match[1] && item.date === match[2]));
    document.courseExceptions.push({ id: crypto.randomUUID(), courseId: match[1], date: match[2], type: "cancel", source: "outlook", updatedAt: Date.now() });
    return true;
  }

  async sync(userId, sourceDocument) {
    if (!this.configured) throw Object.assign(new Error("服务端尚未配置 Microsoft 应用注册"), { status: 503 });
    const connection = this.getConnection.get(userId);
    if (!connection?.refresh_token) throw Object.assign(new Error("请先连接 Outlook"), { status: 409 });
    const document = JSON.parse(JSON.stringify(sourceDocument || {}));
    document.tasks ||= []; document.courses ||= []; document.courseExceptions ||= []; document.timeSlots ||= [];
    const now = new Date();
    const rangeStart = isoDate(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()));
    const semesterEnd = document.semester?.startDate ? addDays(document.semester.startDate, (Number(document.semester.totalWeeks || 20) + 2) * 7) : "";
    const rangeEnd = [isoDate(new Date(now.getFullYear() + 1, now.getMonth() + 3, now.getDate())), semesterEnd].sort().pop();
    const remoteEvents = await this.listRemoteEvents(connection, rangeStart, rangeEnd);
    const remoteById = new Map(remoteEvents.map((item) => [item.id, item]));
    const remoteByKey = new Map(remoteEvents.map((item) => [markerFromEvent(item), item]).filter(([key]) => key));
    const links = this.getLinks.all(userId);
    const linkByKey = new Map(links.map((item) => [item.local_key, item]));
    const linkedIds = new Set(links.map((item) => item.outlook_event_id));
    const stats = { pushed: 0, pulled: 0, deleted: 0, imported: 0, conflicts: 0 };
    let changed = false;

    for (const remote of remoteEvents.filter((item) => !markerFromEvent(item) && !linkedIds.has(item.id))) {
      const task = remoteToTask(remote);
      document.tasks.unshift(task);
      const local = taskLocalEvent(task);
      const patched = await this.graph(connection, "PATCH", `/me/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(remote.id)}`, graphPayload(local));
      this.link(userId, local, patched);
      remoteByKey.set(local.localKey, patched);
      changed = true; stats.imported += 1;
    }

    let localMap = new Map(localEvents(document).map((item) => [item.localKey, item]));
    for (const [localKey, local] of localMap) {
      const link = linkByKey.get(localKey);
      const remote = (link && remoteById.get(link.outlook_event_id)) || remoteByKey.get(localKey);
      if (link && !remote) {
        if (local.date < rangeStart || local.date > rangeEnd) continue;
        changed = this.applyRemoteDelete(document, localKey) || changed;
        this.deleteLink.run(userId, localKey); stats.pulled += 1; stats.deleted += 1;
        continue;
      }
      if (!remote) {
        const created = await this.graph(connection, "POST", `/me/calendars/${encodeURIComponent(connection.calendar_id)}/events`, graphPayload(local));
        this.link(userId, local, created); stats.pushed += 1;
        continue;
      }
      const localChanged = Boolean(link && link.local_hash && link.local_hash !== localEventHash(local));
      const remoteChanged = Boolean(link && link.remote_change_key && link.remote_change_key !== (remote.changeKey || ""));
      if (localChanged && remoteChanged) stats.conflicts += 1;
      const remoteTime = Date.parse(remote.lastModifiedDateTime || 0) || 0;
      const localTime = Number(local.updatedAt || Date.parse(document.settings?.lastLocalChangeAt || 0) || 0);
      if (remoteChanged && (!localChanged || remoteTime >= localTime)) {
        changed = this.applyRemote(document, localKey, remote) || changed;
        const refreshed = localEvents(document).find((item) => item.localKey === localKey);
        if (refreshed) this.link(userId, refreshed, remote);
        stats.pulled += 1;
      } else if (localChanged) {
        const patched = await this.graph(connection, "PATCH", `/me/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(remote.id)}`, graphPayload(local));
        this.link(userId, local, patched); stats.pushed += 1;
      } else this.link(userId, local, remote);
    }

    localMap = new Map(localEvents(document).map((item) => [item.localKey, item]));
    for (const remote of remoteEvents) {
      const key = markerFromEvent(remote);
      if (!key || localMap.has(key)) continue;
      const link = linkByKey.get(key);
      if (link) {
        await this.graph(connection, "DELETE", `/me/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(remote.id)}`);
        this.deleteLink.run(userId, key); stats.pushed += 1; stats.deleted += 1;
      }
    }

    const syncedAt = new Date().toISOString();
    document.settings ||= {};
    document.settings.outlookLastSyncAt = syncedAt;
    this.updateStatus.run(syncedAt, null, userId);
    return { document, changed: changed || stats.imported > 0 || stats.pulled > 0, stats, syncedAt };
  }

  disconnect(userId) {
    this.database.exec("BEGIN IMMEDIATE");
    try { this.deleteLinks.run(userId); this.deleteConnection.run(userId); this.database.exec("COMMIT"); }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  connectedUserIds() { return this.configured ? this.listConnected.all().map((item) => item.userId) : []; }

  recordError(userId, error) { this.updateError.run(String(error?.message || error).slice(0, 500), userId); }
}

module.exports = { OutlookIntegration, localEvents, graphPayload, markerFromEvent, remoteToTask };
