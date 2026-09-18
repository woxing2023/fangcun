use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, Method, StatusCode, Uri},
    response::Response,
    routing::any,
    Router,
};
use chrono::{Datelike, Duration, NaiveDate, Utc, Weekday};
use serde_json::{json, Map, Value};
use rusqlite::OptionalExtension;

use crate::{db, hash, json_error, json_ok, now, token, AppState};

const AGENT_BODY_LIMIT: usize = 64 * 1024;

#[derive(Clone)]
struct AgentOwner {
    token_hash: String,
    user_id: i64,
    expires_at: i64,
    status: String,
}

pub fn routes() -> Router<AppState> {
    let paths = [
        "/api/agent/tokens",
        "/api/agent/tokens/{*name}",
        "/api/agent/audit",
        "/api/agent/capabilities",
        "/api/agent/data",
        "/api/agent/schedule",
        "/api/agent/tasks",
        "/api/agent/tasks/{*id}",
        "/api/agent/projects",
        "/api/agent/projects/{*id}",
        "/api/v1/agent/tokens",
        "/api/v1/agent/tokens/{*name}",
        "/api/v1/agent/audit",
        "/api/v1/agent/capabilities",
        "/api/v1/agent/data",
        "/api/v1/agent/schedule",
        "/api/v1/agent/tasks",
        "/api/v1/agent/tasks/{*id}",
        "/api/v1/agent/projects",
        "/api/v1/agent/projects/{*id}",
    ];
    paths.into_iter().fold(Router::new(), |router, path| {
        router.route(path, any(agent_request))
    })
}

fn canonical_path(uri: &Uri) -> String {
    if let Some(rest) = uri.path().strip_prefix("/api/v1/agent") {
        format!("/api/agent{rest}")
    } else {
        uri.path().to_string()
    }
}

fn parse_body(body: &Bytes) -> Result<Value, (StatusCode, String)> {
    if body.len() > AGENT_BODY_LIMIT {
        return Err((StatusCode::PAYLOAD_TOO_LARGE, "请求内容过大".into()));
    }
    serde_json::from_slice(body).map_err(|_| (StatusCode::BAD_REQUEST, "JSON 格式不正确".into()))
}

fn object(body: Value) -> Result<Map<String, Value>, (StatusCode, String)> {
    body.as_object()
        .cloned()
        .ok_or((StatusCode::BAD_REQUEST, "请求内容必须是 JSON 对象".into()))
}

fn valid_agent_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.chars().count() <= 60
        && trimmed != "."
        && trimmed != ".."
        && !value.chars().any(|c| c.is_control())
}

fn valid_date(value: &str) -> bool {
    value.len() == 10
        && !value.starts_with("0000")
        && NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .map(|date| date.format("%Y-%m-%d").to_string() == value)
            .unwrap_or(false)
}

fn valid_agent_document(value: &Value) -> bool {
    value.is_object()
        && ["tasks", "projects", "courses", "timeSlots", "courseExceptions"]
            .iter()
            .all(|key| value.get(*key).map(Value::is_array).unwrap_or(false))
        && serde_json::to_vec(value)
            .map(|bytes| bytes.len() <= AGENT_BODY_LIMIT)
            .unwrap_or(false)
}

fn default_document() -> Value {
    json!({
        "schemaVersion": 3,
        "tasks": [], "projects": [], "courses": [], "timeSlots": [],
        "courseExceptions": [], "semester": {}, "settings": {}
    })
}

fn agent_owner(state: &AppState, headers: &HeaderMap) -> Option<AgentOwner> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let mut parts = value.split_whitespace();
    let scheme = parts.next()?;
    let raw = parts.next()?;
    if parts.next().is_some()
        || !scheme.eq_ignore_ascii_case("Bearer")
        || raw.len() != 43
        || !raw.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return None;
    }
    let token_hash = hash(raw);
    db(state)
        .query_row(
            "SELECT a.token_hash,a.user_id,a.expires_at,u.status FROM agent_tokens a JOIN users u ON u.id=a.user_id WHERE a.token_hash=?1",
            rusqlite::params![token_hash],
            |row| {
                Ok(AgentOwner {
                    token_hash: row.get(0)?,
                    user_id: row.get(1)?,
                    expires_at: row.get(2)?,
                    status: row.get(3)?,
                })
            },
        )
        .optional()
        .ok()
        .flatten()
}

fn active(owner: &AgentOwner) -> bool {
    owner.status == "active" && owner.expires_at > Utc::now().timestamp_millis()
}

fn rate_allowed(state: &AppState, token_hash: &str) -> bool {
    let current = Utc::now().timestamp_millis();
    let mut requests = state.agent_requests.lock().expect("agent rate mutex poisoned");
    requests.retain(|_, times| {
        times.retain(|time| current - *time < 60_000);
        !times.is_empty()
    });
    let times = requests.entry(token_hash.to_string()).or_default();
    if times.len() >= 60 {
        return false;
    }
    times.push(current);
    true
}

fn audit(state: &AppState, owner: Option<&AgentOwner>, action: &str, status: StatusCode) {
    let conn = db(state);
    let token_hash = owner.map(|value| value.token_hash.as_str());
    let user_id = owner.map(|value| value.user_id);
    let detail = json!({"status": status.as_u16()}).to_string();
    let _ = conn.execute(
        "INSERT INTO agent_audit(token_hash,user_id,action,detail,created_at) VALUES(?1,?2,?3,?4,?5)",
        rusqlite::params![token_hash, user_id, action, detail, Utc::now().timestamp_millis()],
    );
    let _ = conn.execute(
        "DELETE FROM agent_audit WHERE user_id IS ?1 AND id NOT IN (SELECT id FROM agent_audit WHERE user_id IS ?1 ORDER BY id DESC LIMIT 500)",
        rusqlite::params![user_id],
    );
}

fn with_retry_after(mut response: Response) -> Response {
    response.headers_mut().insert("retry-after", "60".parse().unwrap());
    response
}

fn current_document(state: &AppState, user_id: i64) -> Result<(Value, i64, Option<String>), (StatusCode, String)> {
    let row = db(state)
        .query_row(
            "SELECT document,revision,updated_at FROM user_states WHERE user_id=?1",
            rusqlite::params![user_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?)),
        )
        .optional()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "服务器内部错误".into()))?;
    let Some((raw, revision, updated_at)) = row else {
        return Ok((default_document(), 0, None));
    };
    let document: Value = serde_json::from_str(&raw)
        .map_err(|_| (StatusCode::CONFLICT, "日程数据需要先在方寸中修复并同步".into()))?;
    if !valid_agent_document(&document) {
        return Err((StatusCode::CONFLICT, "日程数据需要先在方寸中修复并同步".into()));
    }
    Ok((document, revision, Some(updated_at)))
}

fn persist_document(
    state: &AppState,
    user_id: i64,
    document: &Value,
    expected_revision: Option<i64>,
) -> Result<(i64, String), (StatusCode, String)> {
    if !valid_agent_document(document) {
        return Err((StatusCode::BAD_REQUEST, "data 必须是有效的方寸数据文档，且不能超过服务端限制".into()));
    }
    let serialized = serde_json::to_string(document)
        .map_err(|_| (StatusCode::BAD_REQUEST, "数据结构不正确".into()))?;
    let conn = db(state);
    let current = conn
        .query_row(
            "SELECT document,revision FROM user_states WHERE user_id=?1",
            rusqlite::params![user_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "服务器内部错误".into()))?;
    let revision = current.as_ref().map(|(_, revision)| *revision).unwrap_or(0);
    if let Some(expected) = expected_revision {
        if expected != revision {
            return Err((StatusCode::CONFLICT, "数据版本已变化，请重新读取后再提交".into()));
        }
    }
    let at = now();
    let next_revision = revision + 1;
    let tx = conn
        .unchecked_transaction()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "服务器内部错误".into()))?;
    if let Some((old_document, old_revision)) = current {
        tx.execute(
            "INSERT INTO user_snapshots(user_id,revision,document,created_at) VALUES(?1,?2,?3,?4)",
            rusqlite::params![user_id, old_revision, old_document, at],
        )
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "服务器内部错误".into()))?;
        tx.execute(
            "UPDATE user_states SET document=?1,revision=?2,updated_at=?3 WHERE user_id=?4",
            rusqlite::params![serialized, next_revision, at, user_id],
        )
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "服务器内部错误".into()))?;
    } else {
        tx.execute(
            "INSERT INTO user_states(user_id,document,revision,updated_at) VALUES(?1,?2,?3,?4)",
            rusqlite::params![user_id, serialized, next_revision, at],
        )
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "服务器内部错误".into()))?;
    }
    tx.execute(
        "DELETE FROM user_snapshots WHERE user_id=?1 AND id NOT IN (SELECT id FROM user_snapshots WHERE user_id=?1 ORDER BY id DESC LIMIT 30)",
        rusqlite::params![user_id],
    )
    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "服务器内部错误".into()))?;
    tx.commit()
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "服务器内部错误".into()))?;
    Ok((next_revision, at))
}

fn id_in(document: &Value, collection: &str, id: &str) -> bool {
    document
        .get(collection)
        .and_then(Value::as_array)
        .map(|items| items.iter().any(|item| item.get("id").and_then(Value::as_str) == Some(id)))
        .unwrap_or(false)
}

fn str_value(map: &Map<String, Value>, key: &str) -> Option<String> {
    map.get(key).and_then(Value::as_str).map(str::to_string)
}

fn put_string(map: &mut Map<String, Value>, source: &Map<String, Value>, key: &str, trim: bool) {
    if let Some(value) = source.get(key).and_then(Value::as_str) {
        map.insert(key.into(), json!(if trim { value.trim() } else { value }));
    }
}

fn validate_task(body: &Map<String, Value>, document: &Value, existing: Option<&Value>) -> Result<Value, (StatusCode, String)> {
    let allowed = ["title", "notes", "due", "dueTime", "important", "urgent", "courseId", "projectId", "completed", "quadrant"];
    if body.keys().any(|key| !allowed.contains(&key.as_str()) || (existing.is_some() && key == "quadrant") || (existing.is_none() && key == "completed")) {
        return Err((StatusCode::BAD_REQUEST, "包含不支持的任务字段".into()));
    }
    if existing.is_some() && body.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "请提供至少一个要修改的字段".into()));
    }
    let has = |key: &str| body.contains_key(key);
    let title = str_value(body, "title");
    if (existing.is_none() || has("title")) && title.as_deref().map(|value| value.trim().is_empty() || value.trim().chars().count() > 120).unwrap_or(true) {
        return Err((StatusCode::BAD_REQUEST, "title 需要为 1 到 120 个字".into()));
    }
    if has("notes") && body["notes"].as_str().map(|value| value.chars().count() <= 2000).unwrap_or(false) == false {
        return Err((StatusCode::BAD_REQUEST, "notes 最多 2000 个字".into()));
    }
    if has("due") && body["due"].as_str().map(|value| value.is_empty() || valid_date(value)).unwrap_or(false) == false {
        return Err((StatusCode::BAD_REQUEST, "due 需要为有效的 YYYY-MM-DD 日期，或空字符串".into()));
    }
    if has("dueTime") && body["dueTime"].as_str().map(|value| value.is_empty() || (value.len() == 5 && value.as_bytes()[2] == b':' && value[..2].parse::<u8>().map(|v| v < 24).unwrap_or(false) && value[3..].parse::<u8>().map(|v| v < 60).unwrap_or(false))).unwrap_or(false) == false {
        return Err((StatusCode::BAD_REQUEST, "dueTime 需要为 HH:mm，或空字符串".into()));
    }
    for key in ["important", "urgent", "completed"] {
        if has(key) && !body[key].is_boolean() {
            return Err((StatusCode::BAD_REQUEST, format!("{key} 必须为布尔值")));
        }
    }
    if has("quadrant") && !matches!(body["quadrant"].as_str(), Some("q1" | "q2" | "q3" | "q4")) {
        return Err((StatusCode::BAD_REQUEST, "quadrant 只能为 q1 到 q4，实际分类由 important/urgent 推导".into()));
    }
    for key in ["courseId", "projectId"] {
        if has(key) && (body[key].as_str().map(|value| value.len() <= 120).unwrap_or(false) == false || body[key].as_str().map(|value| value.is_empty() || id_in(document, if key == "courseId" { "courses" } else { "projects" }, value)).unwrap_or(false) == false) {
            return Err((StatusCode::BAD_REQUEST, format!("{key} 必须是当前用户已有的{}，或空字符串", if key == "courseId" { "课程" } else { "项目" })));
        }
    }
    let timestamp = Utc::now().timestamp_millis();
    let mut task = existing.cloned().unwrap_or_else(|| json!({
        "id": token(), "title": "", "notes": "", "due": "", "dueTime": "", "courseId": "", "projectId": "",
        "type": "task", "repeat": "none", "reminderMinutes": -1, "important": false, "urgent": false,
        "completed": false, "today": false, "source": "agent", "createdAt": timestamp
    }));
    let target = task.as_object_mut().expect("task object");
    put_string(target, body, "title", true);
    for key in ["notes", "due", "dueTime", "courseId", "projectId"] { put_string(target, body, key, false); }
    for key in ["important", "urgent", "completed"] {
        if let Some(value) = body.get(key) { target.insert(key.into(), value.clone()); }
    }
    if has("due") && body["due"] == "" && !has("dueTime") { target.insert("dueTime".into(), json!("")); }
    let due = target.get("due").and_then(Value::as_str).unwrap_or("");
    let due_time = target.get("dueTime").and_then(Value::as_str).unwrap_or("");
    if !due_time.is_empty() && due.is_empty() { return Err((StatusCode::BAD_REQUEST, "dueTime 需要同时有截止日期 due".into())); }
    if existing.is_none() || has("important") || has("urgent") {
        let important = target.get("important").and_then(Value::as_bool).unwrap_or(false);
        let urgent = target.get("urgent").and_then(Value::as_bool).unwrap_or(false);
        target.insert("quadrant".into(), json!(match (important, urgent) { (true, true) => "q1", (true, false) => "q2", (false, true) => "q3", (false, false) => "q4" }));
    }
    if has("completed") { target.insert("completedAt".into(), if target["completed"].as_bool() == Some(true) { json!(timestamp) } else { Value::Null }); }
    target.insert("updatedAt".into(), json!(timestamp));
    Ok(task)
}

fn validate_milestones(value: Option<&Value>) -> Result<Option<Vec<Value>>, (StatusCode, String)> {
    let Some(value) = value else { return Ok(None); };
    let Some(items) = value.as_array() else { return Err((StatusCode::BAD_REQUEST, "milestones 必须是不超过 100 项的数组".into())); };
    if items.len() > 100 { return Err((StatusCode::BAD_REQUEST, "milestones 必须是不超过 100 项的数组".into())); }
    let mut result = Vec::with_capacity(items.len());
    for item in items {
        let Some(object) = item.as_object() else { return Err((StatusCode::BAD_REQUEST, "里程碑格式不正确".into())); };
        if object.keys().any(|key| !["id", "title", "due", "completed"].contains(&key.as_str())) { return Err((StatusCode::BAD_REQUEST, "里程碑包含不支持的字段".into())); }
        let Some(title) = object.get("title").and_then(Value::as_str) else { return Err((StatusCode::BAD_REQUEST, "里程碑 title 需要为 1 到 200 个字".into())); };
        if title.trim().is_empty() || title.trim().chars().count() > 200 { return Err((StatusCode::BAD_REQUEST, "里程碑 title 需要为 1 到 200 个字".into())); }
        if let Some(due) = object.get("due") { if due.as_str().map(|value| value.is_empty() || valid_date(value)).unwrap_or(false) == false { return Err((StatusCode::BAD_REQUEST, "里程碑 due 需要为有效日期或空字符串".into())); } }
        if let Some(completed) = object.get("completed") { if !completed.is_boolean() { return Err((StatusCode::BAD_REQUEST, "里程碑 completed 必须为布尔值".into())); } }
        let completed = object.get("completed").and_then(Value::as_bool).unwrap_or(false);
        result.push(json!({"id": object.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()).unwrap_or_else(|| ""), "title": title.trim(), "due": object.get("due").and_then(Value::as_str).unwrap_or(""), "completed": completed, "completedAt": if completed { json!(Utc::now().timestamp_millis()) } else { Value::Null }}));
        if result.last().and_then(|item| item["id"].as_str()).unwrap_or("").is_empty() { let last = result.last_mut().unwrap().as_object_mut().unwrap(); last.insert("id".into(), json!(token())); }
    }
    Ok(Some(result))
}

fn validate_project(body: &Map<String, Value>, existing: Option<&Value>) -> Result<Value, (StatusCode, String)> {
    let allowed = ["name", "goal", "startDate", "due", "color", "status", "milestones"];
    if body.keys().any(|key| !allowed.contains(&key.as_str())) { return Err((StatusCode::BAD_REQUEST, "包含不支持的项目字段".into())); }
    if existing.is_some() && body.is_empty() { return Err((StatusCode::BAD_REQUEST, "请提供至少一个要修改的字段".into())); }
    let has = |key: &str| body.contains_key(key);
    let name = str_value(body, "name");
    if (existing.is_none() || has("name")) && name.as_deref().map(|value| value.trim().is_empty() || value.trim().chars().count() > 120).unwrap_or(true) { return Err((StatusCode::BAD_REQUEST, "name 需要为 1 到 120 个字".into())); }
    for key in ["goal", "color", "status"] { if has(key) && body[key].as_str().map(|value| value.chars().count() <= 2000).unwrap_or(false) == false { return Err((StatusCode::BAD_REQUEST, format!("{key} 必须为不超过 2000 个字的字符串"))); } }
    for key in ["startDate", "due"] { if has(key) && body[key].as_str().map(|value| value.is_empty() || valid_date(value)).unwrap_or(false) == false { return Err((StatusCode::BAD_REQUEST, format!("{key} 需要为有效的 YYYY-MM-DD 日期，或空字符串"))); } }
    let milestones = validate_milestones(body.get("milestones"))?;
    let timestamp = Utc::now().timestamp_millis();
    let mut project = existing.cloned().unwrap_or_else(|| json!({"id": token(), "name":"", "goal":"", "startDate":"", "due":"", "color":"sage", "status":"active", "milestones":[], "nextActionTaskId":"", "createdAt":timestamp}));
    let target = project.as_object_mut().expect("project object");
    put_string(target, body, "name", true);
    for key in ["goal", "startDate", "due", "color", "status"] { put_string(target, body, key, false); }
    if let Some(milestones) = milestones { target.insert("milestones".into(), Value::Array(milestones)); }
    target.insert("updatedAt".into(), json!(timestamp));
    Ok(project)
}

fn next_occurrence(task: &mut Value) -> Option<Value> {
    let object = task.as_object()?;
    let repeat = object.get("repeat").and_then(Value::as_str)?.to_string();
    if !["daily", "weekly", "weekdays", "monthly"].contains(&repeat.as_str()) || object.get("nextOccurrenceId").is_some_and(|value| !value.is_null()) { return None; }
    let timestamp = Utc::now().timestamp_millis();
    let base = object.get("due").and_then(Value::as_str).filter(|value| !value.is_empty()).and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()).unwrap_or_else(|| Utc::now().date_naive());
    let next = match repeat.as_str() {
        "daily" => base + Duration::days(1),
        "weekly" => base + Duration::days(7),
        "weekdays" => { let mut date = base + Duration::days(1); while matches!(date.weekday(), Weekday::Sat | Weekday::Sun) { date += Duration::days(1); } date },
        "monthly" => { let (year, month) = if base.month() == 12 { (base.year() + 1, 1) } else { (base.year(), base.month() + 1) }; let last = NaiveDate::from_ymd_opt(if month == 12 { year + 1 } else { year }, if month == 12 { 1 } else { month + 1 }, 1).unwrap() - Duration::days(1); NaiveDate::from_ymd_opt(year, month, base.day().min(last.day())).unwrap() },
        _ => return None,
    };
    let next_id = token();
    let source_id = object.get("id").cloned().unwrap_or(Value::Null);
    task.as_object_mut()?.insert("nextOccurrenceId".into(), json!(next_id));
    let mut next_task = task.clone();
    let next_object = next_task.as_object_mut()?;
    next_object.insert("id".into(), json!(next_id));
    next_object.insert("due".into(), json!(next.format("%Y-%m-%d").to_string()));
    next_object.insert("today".into(), json!(false));
    next_object.insert("completed".into(), json!(false));
    next_object.insert("completedAt".into(), Value::Null);
    next_object.insert("createdAt".into(), json!(timestamp));
    next_object.insert("updatedAt".into(), json!(timestamp));
    next_object.insert("recurrenceSourceId".into(), source_id);
    next_object.insert("nextOccurrenceId".into(), Value::Null);
    Some(next_task)
}

fn action(path: &str, method: &Method) -> &'static str {
    match (method, path) {
        (&Method::GET, "/api/agent/capabilities") => "capabilities.read",
        (&Method::GET, "/api/agent/data") => "data.read",
        (&Method::PUT, "/api/agent/data") => "data.update",
        (&Method::GET, "/api/agent/schedule") => "schedule.read",
        (&Method::POST, "/api/agent/tasks") => "tasks.create",
        (&Method::PATCH, p) if p.starts_with("/api/agent/tasks/") => "tasks.update",
        (&Method::POST, "/api/agent/projects") => "projects.create",
        (&Method::PATCH, p) if p.starts_with("/api/agent/projects/") => "projects.update",
        _ => "request.unsupported",
    }
}

async fn agent_request(State(state): State<AppState>, uri: Uri, method: Method, headers: HeaderMap, body: Bytes) -> Response {
    let path = canonical_path(&uri);
    if path.starts_with("/api/agent/tokens") || path == "/api/agent/audit" {
        return management(&state, &path, &method, &headers, &body).await;
    }
    let owner = agent_owner(&state, &headers);
    let operation = action(&path, &method);
    let send = |status: StatusCode, value: Value| { audit(&state, owner.as_ref(), operation, status); json_ok(status, value) };
    if owner.as_ref().map(active) != Some(true) { return send(StatusCode::UNAUTHORIZED, json!({"error":"Agent 令牌无效、已过期或已吊销"})); }
    let owner_ref = owner.as_ref().unwrap();
    if !rate_allowed(&state, &owner_ref.token_hash) { return with_retry_after(send(StatusCode::TOO_MANY_REQUESTS, json!({"error":"每个令牌每分钟最多 60 次请求"}))); }
    let _ = db(&state).execute("UPDATE agent_tokens SET last_used_at=?1 WHERE token_hash=?2", rusqlite::params![Utc::now().timestamp_millis(), owner_ref.token_hash]);
    if operation == "request.unsupported" {
        let allow = if path.starts_with("/api/agent/tasks/") || path.starts_with("/api/agent/projects/") { "PATCH" } else if path.ends_with("/tasks") || path.ends_with("/projects") { "POST" } else if path.ends_with("/schedule") { "GET" } else { "GET, PUT, POST, PATCH" };
        let mut response = json_error(StatusCode::METHOD_NOT_ALLOWED, "Agent API 不支持此操作");
        response.headers_mut().insert(header::ALLOW, allow.parse().unwrap());
        audit(&state, owner.as_ref(), operation, StatusCode::METHOD_NOT_ALLOWED);
        return response;
    }
    if operation == "capabilities.read" {
        return send(StatusCode::OK, json!({"apiVersion":"2.9.0","capabilities":[
            {"name":"data.read","method":"GET","path":"/api/agent/data","description":"读取完整方寸数据文档"},
            {"name":"data.update","method":"PUT","path":"/api/agent/data","description":"原子替换完整数据文档，使用 expectedRevision 防止覆盖并发修改"},
            {"name":"schedule.read","method":"GET","path":"/api/agent/schedule","description":"读取课表、项目与任务"},
            {"name":"tasks.create","method":"POST","path":"/api/agent/tasks","description":"创建任务"},
            {"name":"tasks.update","method":"PATCH","path":"/api/agent/tasks/:id","description":"编辑、完成或恢复任务"},
            {"name":"projects.create","method":"POST","path":"/api/agent/projects","description":"创建长期项目"},
            {"name":"projects.update","method":"PATCH","path":"/api/agent/projects/:id","description":"编辑项目与里程碑"}
        ],"safety":{"deletes":"not_available","externalAccounts":"session_only","concurrency":"expectedRevision"}}));
    }
    if operation == "data.read" || operation == "data.update" {
        let current = match current_document(&state, owner_ref.user_id) { Ok(value) => value, Err((status, message)) => return send(status, json!({"error":message})) };
        if operation == "data.read" { return send(StatusCode::OK, json!({"data":current.0,"revision":current.1,"updatedAt":current.2})); }
        let value = match parse_body(&body).and_then(object) { Ok(value) => value, Err((status, message)) => return send(status, json!({"error":message})) };
        let expected = value.get("expectedRevision").and_then(Value::as_i64);
        if expected != Some(current.1) { return send(StatusCode::CONFLICT, json!({"error":"数据版本已变化，请重新读取后再提交","revision":current.1})); }
        let document = value.get("data").cloned().unwrap_or(Value::Null);
        if !valid_agent_document(&document) { return send(StatusCode::BAD_REQUEST, json!({"error":"data 必须是有效的方寸数据文档，且不能超过服务端限制"})); }
        return match persist_document(&state, owner_ref.user_id, &document, Some(current.1)) { Ok((revision, updated_at)) => send(StatusCode::OK, json!({"data":document,"revision":revision,"updatedAt":updated_at})), Err((status, message)) => send(status, json!({"error":message.replace('\u{0000}', ""),"revision":current.1})) };
    }
    if operation == "schedule.read" {
        let (document, revision, updated_at) = match current_document(&state, owner_ref.user_id) { Ok(value) => value, Err((status, message)) => return send(status, json!({"error":message})) };
        return send(StatusCode::OK, json!({"tasks":document["tasks"],"projects":document["projects"],"courses":document["courses"],"semester":document.get("semester").cloned().unwrap_or_else(||json!({})),"timeSlots":document["timeSlots"],"courseExceptions":document["courseExceptions"],"calendarRules":document.get("calendarRules").cloned().unwrap_or_else(||json!([])),"revision":revision,"updatedAt":updated_at}));
    }
    let value = match parse_body(&body).and_then(object) { Ok(value) => value, Err((status, message)) => return send(status, json!({"error":message})) };
    let (mut document, revision, _) = match current_document(&state, owner_ref.user_id) { Ok(value) => value, Err((status, message)) => return send(status, json!({"error":message})) };
    if (path == "/api/agent/tasks" || path.starts_with("/api/agent/tasks/") || path == "/api/agent/projects" || path.starts_with("/api/agent/projects/")) && state.external_syncing.lock().expect("sync mutex poisoned").contains(&owner_ref.user_id) {
        return send(StatusCode::CONFLICT, json!({"error":"外部日历正在同步，请完成后重试"}));
    }
    if path == "/api/agent/tasks" || path.starts_with("/api/agent/tasks/") {
        let existing_id = path.strip_prefix("/api/agent/tasks/").map(|raw| urlencoding::decode(raw).map(|value| value.into_owned()));
        let existing_id = match existing_id { Some(Ok(id)) if !id.is_empty() && id.chars().count() <= 120 && !id.chars().any(|c| c.is_control()) => Some(id), Some(_) => return send(StatusCode::BAD_REQUEST, json!({"error":"任务 ID 不正确"})), None => None };
        let existing = existing_id.as_deref().and_then(|id| document["tasks"].as_array().and_then(|items| items.iter().find(|item| item["id"].as_str() == Some(id))));
        if existing_id.is_some() && existing.is_none() { return send(StatusCode::NOT_FOUND, json!({"error":"任务不存在"})); }
        let was_completed = existing.and_then(|item| item["completed"].as_bool()).unwrap_or(false);
        let mut task = match validate_task(&value, &document, existing) { Ok(value) => value, Err((status, message)) => return send(status, json!({"error":message})) };
        let tasks = document["tasks"].as_array_mut().unwrap();
        if let Some(ref id) = existing_id { let index = tasks.iter().position(|item| item["id"].as_str() == Some(id.as_str())).unwrap(); tasks[index] = task.clone(); } else { tasks.insert(0, task.clone()); }
        if existing_id.is_some() && !was_completed && task["completed"] == true { if let Some(next) = next_occurrence(&mut task) { let id = task["id"].clone(); let index = tasks.iter().position(|item| item["id"] == id).unwrap(); tasks[index] = task.clone(); tasks.insert(0, next); } }
        return match persist_document(&state, owner_ref.user_id, &document, Some(revision)) { Ok((revision, updated_at)) => send(if existing_id.is_some() { StatusCode::OK } else { StatusCode::CREATED }, json!({"task":task,"revision":revision,"updatedAt":updated_at})), Err((status, message)) => send(status, json!({"error":message.replace('\u{0000}', "")})) };
    }
    if path == "/api/agent/projects" || path.starts_with("/api/agent/projects/") {
        let existing_id = path.strip_prefix("/api/agent/projects/").map(|raw| urlencoding::decode(raw).map(|value| value.into_owned()));
        let existing_id = match existing_id { Some(Ok(id)) if !id.is_empty() && id.chars().count() <= 120 && !id.chars().any(|c| c.is_control()) => Some(id), Some(_) => return send(StatusCode::BAD_REQUEST, json!({"error":"项目 ID 不正确"})), None => None };
        let existing = existing_id.as_deref().and_then(|id| document["projects"].as_array().and_then(|items| items.iter().find(|item| item["id"].as_str() == Some(id))));
        if existing_id.is_some() && existing.is_none() { return send(StatusCode::NOT_FOUND, json!({"error":"项目不存在"})); }
        let project = match validate_project(&value, existing) { Ok(value) => value, Err((status, message)) => return send(status, json!({"error":message})) };
        let projects = document["projects"].as_array_mut().unwrap();
        if let Some(ref id) = existing_id { let index = projects.iter().position(|item| item["id"].as_str() == Some(id.as_str())).unwrap(); projects[index] = project.clone(); } else { projects.insert(0, project.clone()); }
        return match persist_document(&state, owner_ref.user_id, &document, Some(revision)) { Ok((revision, updated_at)) => send(if existing_id.is_some() { StatusCode::OK } else { StatusCode::CREATED }, json!({"project":project,"revision":revision,"updatedAt":updated_at})), Err((status, message)) => send(status, json!({"error":message.replace('\u{0000}', "")})) };
    }
    send(StatusCode::NOT_FOUND, json!({"error":"接口不存在"}))
}

async fn management(state: &AppState, path: &str, method: &Method, headers: &HeaderMap, body: &Bytes) -> Response {
    if headers.contains_key(header::AUTHORIZATION) { return json_error(StatusCode::UNAUTHORIZED, "令牌管理需要用户会话，请勿使用 Bearer 令牌"); }
    let Some((user_id, _, _)) = crate::user_by_session(state, headers) else { return json_error(StatusCode::UNAUTHORIZED, "令牌管理需要用户会话，请勿使用 Bearer 令牌"); };
    if path == "/api/agent/audit" {
        if *method != Method::GET { let mut response = json_error(StatusCode::METHOD_NOT_ALLOWED, "此接口只支持 GET"); response.headers_mut().insert(header::ALLOW, "GET".parse().unwrap()); return response; }
        let conn = db(state);
        let mut statement = conn.prepare("SELECT action,detail,created_at FROM agent_audit WHERE user_id=?1 ORDER BY id DESC LIMIT 10").unwrap();
        let audit = statement.query_map(rusqlite::params![user_id], |row| Ok(json!({"action":row.get::<_,String>(0)?,"detail":row.get::<_,String>(1)?,"createdAt":row.get::<_,i64>(2)?}))).unwrap().filter_map(Result::ok).collect::<Vec<_>>();
        return json_ok(StatusCode::OK, json!({"audit":audit}));
    }
    if path == "/api/agent/tokens" {
        if *method == Method::GET {
            let conn = db(state);
            let mut statement = conn.prepare("SELECT name,created_at,expires_at,last_used_at FROM agent_tokens WHERE user_id=?1 ORDER BY created_at DESC,name").unwrap();
            let tokens = statement.query_map(rusqlite::params![user_id], |row| Ok(json!({"name":row.get::<_,String>(0)?,"createdAt":row.get::<_,i64>(1)?,"expiresAt":row.get::<_,i64>(2)?,"lastUsedAt":row.get::<_,Option<i64>>(3)?}))).unwrap().filter_map(Result::ok).collect::<Vec<_>>();
            return json_ok(StatusCode::OK, json!({"tokens":tokens}));
        }
        if *method == Method::POST {
            let value = match parse_body(body).and_then(object) { Ok(value) => value, Err((status, message)) => return json_error(status, &message) };
            if value.keys().any(|key| !["name", "expiresInDays"].contains(&key.as_str())) { return json_error(StatusCode::BAD_REQUEST, "包含不支持的令牌字段"); }
            let Some(raw_name) = value.get("name").and_then(Value::as_str) else { return json_error(StatusCode::BAD_REQUEST, "名称需要为 1 到 60 个字，不能含控制字符"); };
            if !valid_agent_name(raw_name) { return json_error(StatusCode::BAD_REQUEST, "名称需要为 1 到 60 个字，不能含控制字符"); }
            let expires = value.get("expiresInDays").and_then(Value::as_i64).unwrap_or(90);
            if !(1..=365).contains(&expires) { return json_error(StatusCode::BAD_REQUEST, "expiresInDays 必须为 1 到 365 的整数"); }
            let name = raw_name.trim();
            if db(state).query_row("SELECT 1 FROM agent_tokens WHERE user_id=?1 AND name=?2", rusqlite::params![user_id, name], |row| row.get::<_, i64>(0)).optional().unwrap().is_some() { return json_error(StatusCode::CONFLICT, "这个令牌名称已经存在，请使用其他名称"); }
            let raw = token();
            let created = Utc::now().timestamp_millis();
            db(state).execute("INSERT INTO agent_tokens(token_hash,user_id,name,created_at,expires_at) VALUES(?1,?2,?3,?4,?5)", rusqlite::params![hash(&raw), user_id, name, created, created + expires * 86_400_000]).unwrap();
            return json_ok(StatusCode::CREATED, json!({"token":raw,"name":name,"createdAt":created,"expiresAt":created + expires * 86_400_000}));
        }
        let mut response = json_error(StatusCode::METHOD_NOT_ALLOWED, "此接口支持 GET、POST"); response.headers_mut().insert(header::ALLOW, "GET, POST".parse().unwrap()); return response;
    }
    if let Some(raw_name) = path.strip_prefix("/api/agent/tokens/") {
        if *method != Method::DELETE { let mut response = json_error(StatusCode::METHOD_NOT_ALLOWED, "此接口只支持 DELETE"); response.headers_mut().insert(header::ALLOW, "DELETE".parse().unwrap()); return response; }
        let Ok(name) = urlencoding::decode(raw_name) else { return json_error(StatusCode::BAD_REQUEST, "令牌名称编码不正确"); };
        if !valid_agent_name(&name) || name.trim() != name { return json_error(StatusCode::BAD_REQUEST, "令牌名称不正确"); }
        if db(state).query_row("SELECT token_hash FROM agent_tokens WHERE user_id=?1 AND name=?2", rusqlite::params![user_id, name.as_ref()], |row| row.get::<_, String>(0)).optional().unwrap().is_none() { return json_error(StatusCode::NOT_FOUND, "令牌不存在"); }
        db(state).execute("DELETE FROM agent_tokens WHERE user_id=?1 AND name=?2", rusqlite::params![user_id, name.as_ref()]).unwrap();
        return json_ok(StatusCode::OK, json!({"ok":true}));
    }
    json_error(StatusCode::NOT_FOUND, "接口不存在")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> Value {
        json!({"tasks": [], "projects": [{"id":"p1"}], "courses": [{"id":"c1"}], "timeSlots": [], "courseExceptions": []})
    }

    #[test]
    fn task_validation_derives_quadrant_and_checks_ownership() {
        let body = object(json!({"title":"  写作业 ","important":true,"urgent":true,"courseId":"c1","projectId":"p1"})).unwrap();
        let task = validate_task(&body, &document(), None).unwrap();
        assert_eq!(task["title"], "写作业");
        assert_eq!(task["quadrant"], "q1");
        assert!(validate_task(&object(json!({"title":"任务","completed":true})).unwrap(), &document(), None).is_err());
        assert!(validate_task(&object(json!({"title":"任务","projectId":"other"})).unwrap(), &document(), None).is_err());
    }

    #[test]
    fn monthly_recurrence_clamps_to_next_month_end() {
        let mut task = json!({"id":"t1","title":"月度","due":"2026-01-31","repeat":"monthly","completed":true,"nextOccurrenceId":null});
        let next = next_occurrence(&mut task).unwrap();
        assert_eq!(next["due"], "2026-02-28");
        assert_eq!(task["nextOccurrenceId"], next["id"]);
    }
}