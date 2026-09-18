#![allow(dead_code)]

mod sync;
mod agent;

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, StatusCode, Uri},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use fangcun_core::validate;
use rand::{rngs::OsRng, TryRngCore};
use rusqlite::{params, Connection, OptionalExtension};
use scrypt::{scrypt, Params as ScryptParams};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{HashMap, HashSet}, env, net::SocketAddr, path::PathBuf, sync::{Arc, Mutex}};

const VERSION: &str = "2.7.0";
const SESSION_AGE: i64 = 30 * 24 * 60 * 60;
type Db = Arc<Mutex<Connection>>;

#[derive(Clone)]
struct AppState {
    db: Db,
    root: PathBuf,
    operator: String,
    contact: String,
    app_beian: String,
    icp_beian: String,
    agent_requests: Arc<Mutex<HashMap<String, Vec<i64>>>>,
    external_syncing: Arc<Mutex<HashSet<i64>>>,
}

fn now() -> String { Utc::now().to_rfc3339() }
fn db(state: &AppState) -> std::sync::MutexGuard<'_, Connection> { state.db.lock().expect("database mutex poisoned") }
fn hash(value: &str) -> String { format!("{:x}", Sha256::digest(value.as_bytes())) }
fn token() -> String { let mut bytes = [0u8; 32]; OsRng.try_fill_bytes(&mut bytes).unwrap(); URL_SAFE_NO_PAD.encode(bytes) }
fn json_error(status: StatusCode, message: &str) -> Response { (status, Json(json!({"error": message}))).into_response() }
fn json_ok(status: StatusCode, value: Value) -> Response { (status, Json(value)).into_response() }
fn with_cookie(mut response: Response, cookie: String) -> Response { response.headers_mut().append(header::SET_COOKIE, cookie.parse().unwrap()); response }
fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers.get(header::COOKIE)?.to_str().ok()?.split(';').filter_map(|part| part.trim().split_once('=')).find_map(|(key, value)| (key == name).then(|| value.to_string()))
}
fn session_token(headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers.get(header::AUTHORIZATION).and_then(|value| value.to_str().ok()) {
        let mut parts = value.splitn(2, ' ');
        let scheme = parts.next().unwrap_or_default();
        let token = parts.next().unwrap_or_default();
        if scheme.eq_ignore_ascii_case("Session") && token.len() == 43 && token.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-') {
            return Some(token.to_string());
        }
    }
    cookie_value(headers, "fangcun_session")
}
fn clear_cookie() -> String { "fangcun_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0".into() }
fn session_cookie(value: &str) -> String { format!("fangcun_session={value}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_AGE}") }
fn session_cookie_for(value: &str, headers: &HeaderMap) -> String {
    let secure = env::var("COOKIE_SECURE").ok().as_deref() == Some("true") || headers.get("x-forwarded-proto").and_then(|v|v.to_str().ok()) == Some("https");
    format!("fangcun_session={value}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_AGE}{}", if secure { "; Secure" } else { "" })
}
fn password_record(password: &str) -> String {
    let mut salt = [0u8; 16]; OsRng.try_fill_bytes(&mut salt).unwrap();
    let mut output = [0u8; 64];
    scrypt(password.as_bytes(), &salt, &ScryptParams::new(14, 8, 5, 64).unwrap(), &mut output).unwrap();
    json!({"algorithm":"scrypt","N":16384,"r":8,"p":5,"salt":hex(&salt),"hash":hex(&output)}).to_string()
}
fn hex(bytes: &[u8]) -> String { bytes.iter().map(|b| format!("{b:02x}")).collect() }
fn from_hex(value: &str) -> Option<Vec<u8>> { (value.len() % 2 == 0).then(|| (0..value.len()).step_by(2).map(|i| u8::from_str_radix(&value[i..i+2], 16)).collect::<Result<Vec<_>, _>>().ok()).flatten() }
fn verify_password(password: &str, stored: &str) -> bool {
    let Ok(record) = serde_json::from_str::<Value>(stored) else { return false };
    let (Some(salt), Some(expected)) = (record["salt"].as_str().and_then(from_hex), record["hash"].as_str().and_then(from_hex)) else { return false };
    let mut actual = vec![0u8; expected.len()];
    if scrypt(password.as_bytes(), &salt, &ScryptParams::new(14, 8, 5, expected.len()).unwrap(), &mut actual).is_err() { return false }
    actual == expected
}
fn valid_username(value: &str) -> bool { let len = value.chars().count(); (3..=32).contains(&len) && value.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') }
fn valid_password(value: &str) -> bool { (8..=128).contains(&value.chars().count()) }
fn valid_document(value: &Value, serialized_len: usize) -> bool { serialized_len <= 2*1024*1024 && value.is_object() && ["tasks","projects","courses","timeSlots","courseExceptions"].iter().all(|key|value.get(*key).map(Value::is_array).unwrap_or(false)) }
fn public_user(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> { Ok(json!({"id": row.get::<_, i64>(0)?, "username": row.get::<_, String>(1)?, "displayName": row.get::<_, String>(2)?, "role": row.get::<_, String>(3)?})) }
fn user_by_session(state: &AppState, headers: &HeaderMap) -> Option<(i64, String, String)> {
    let raw = session_token(headers)?;
    let conn = db(state);
    conn.query_row("SELECT u.id,u.username,u.role FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?1 AND s.expires_at>?2 AND u.status='active'", params![hash(&raw), Utc::now().timestamp_millis()], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional().ok().flatten()
}
fn configured(state: &AppState) -> bool { db(state).query_row("SELECT COUNT(*) FROM users", [], |r| r.get::<_, i64>(0)).unwrap_or(0) > 0 }
fn registration_open(state: &AppState) -> bool { db(state).query_row("SELECT value FROM config WHERE key='registration_mode'", [], |r| r.get::<_, String>(0)).optional().ok().flatten().as_deref() == Some("open") }
fn configured_value(state: &AppState, key: &str) -> Option<String> { db(state).query_row("SELECT value FROM config WHERE key=?1", params![key], |r| r.get(0)).optional().ok().flatten() }

fn summary_for(document: Option<&str>) -> Value {
    let raw = document.unwrap_or("{}");
    let Ok(summary) = fangcun_core::summarize(raw) else { return json!({"tasks":0,"pendingTasks":0,"projects":0,"courses":0}) };
    json!({"tasks":summary.counts.tasks,"pendingTasks":summary.counts.pending_tasks,"projects":summary.counts.projects,"courses":summary.counts.courses})
}

fn migration_status_conn(conn: &Connection) -> Value {
    let user = |name: &str| conn.query_row("SELECT id FROM users WHERE username=?1 COLLATE NOCASE", params![name], |r| r.get::<_, i64>(0)).optional().ok().flatten();
    let source = user("owner"); let target = user("member");
    let has_data = |id: Option<i64>| id.and_then(|value| conn.query_row("SELECT 1 FROM user_states WHERE user_id=?1", params![value], |r| r.get::<_, i64>(0)).optional().ok().flatten()).is_some();
    let completed = conn.query_row("SELECT value FROM config WHERE key='owner_data_migration'", [], |r| r.get::<_,String>(0)).optional().ok().flatten().and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    json!({"sourceExists":source.is_some(),"targetExists":target.is_some(),"sourceHasData":has_data(source),"targetHasData":has_data(target),"completed":completed.is_some(),"completedAt":completed.as_ref().and_then(|v|v["completedAt"].as_str()),"targetUsername":"member"})
}
fn migration_status(state: &AppState) -> Value { let conn = db(state); migration_status_conn(&conn) }

fn migrate_owner_data(state: &AppState, force: bool) -> Result<Value, (StatusCode, Value)> {
    let conn = db(state);
    let find = |name: &str| conn.query_row("SELECT id FROM users WHERE username=?1 COLLATE NOCASE", params![name], |r| r.get::<_, i64>(0)).optional().ok().flatten();
    let Some(source) = find("owner") else { return Err((StatusCode::NOT_FOUND, json!({"error":"owner 管理员账号不存在"}))) };
    let Some(target) = find("member") else { return Err((StatusCode::CONFLICT, json!({"error":"请先注册用户名 member，再执行迁移","code":"TARGET_MISSING"}))) };
    let source_state: Option<(String, i64, String)> = conn.query_row("SELECT document,revision,updated_at FROM user_states WHERE user_id=?1", params![source], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().unwrap();
    let target_state: Option<(String, i64, String)> = conn.query_row("SELECT document,revision,updated_at FROM user_states WHERE user_id=?1", params![target], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().unwrap();
    let Some((source_doc, source_rev, _)) = source_state else {
        if conn.query_row("SELECT value FROM config WHERE key='owner_data_migration'",[],|r|r.get::<_,String>(0)).optional().ok().flatten().and_then(|v|serde_json::from_str::<Value>(&v).ok()).is_some() { return Ok(json!({"ok":true,"alreadyMigrated":true})); }
        return Err((StatusCode::CONFLICT, json!({"error":"owner 账号中没有可迁移的数据","code":"SOURCE_EMPTY"}))); 
    };
    if target_state.is_some() && !force { return Err((StatusCode::CONFLICT, json!({"error":"member 已有数据，需要确认后才能覆盖","code":"TARGET_HAS_DATA","requiresConfirmation":true}))); }
    let at = now(); let revision = target_state.as_ref().map(|(_,r,_)|r+1).unwrap_or(1);
    let tx = conn.unchecked_transaction().map_err(|e|(StatusCode::INTERNAL_SERVER_ERROR,json!({"error":e.to_string()})))?;
    tx.execute("INSERT INTO user_snapshots(user_id,revision,document,created_at) VALUES(?1,?2,?3,?4)",params![source,source_rev,source_doc,at]).unwrap();
    if let Some((old, old_rev, _)) = target_state { tx.execute("INSERT INTO user_snapshots(user_id,revision,document,created_at) VALUES(?1,?2,?3,?4)",params![target,old_rev,old,at]).unwrap(); tx.execute("UPDATE user_states SET document=?1,revision=?2,updated_at=?3 WHERE user_id=?4",params![source_doc,revision,at,target]).unwrap(); }
    else { tx.execute("INSERT INTO user_states(user_id,document,revision,updated_at) VALUES(?1,?2,?3,?4)",params![target,source_doc,revision,at]).unwrap(); }
    tx.execute("DELETE FROM user_states WHERE user_id=?1",params![source]).unwrap();
    tx.execute("INSERT INTO config(key,value) VALUES('owner_data_migration',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![json!({"sourceUserId":source,"targetUserId":target,"completedAt":at}).to_string()]).unwrap();
    tx.execute("DELETE FROM user_sessions WHERE user_id=?1",params![target]).unwrap();
    tx.commit().map_err(|e|(StatusCode::INTERNAL_SERVER_ERROR,json!({"error":e.to_string()})))?; drop(conn);
    Ok(json!({"ok":true,"revision":revision}))
}

fn migrate_legacy_owner(conn: &Connection) {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap_or(0);
    if count == 0 {
        let legacy_password: Option<String> = conn.query_row("SELECT value FROM config WHERE key='password'", [], |r| r.get(0)).optional().ok().flatten();
        let env_password = env::var("FANGCUN_PASSWORD").ok();
        if let Some(password) = legacy_password.or_else(|| env_password.filter(|v| valid_password(v)).map(|v|password_record(&v))) {
            let proposed = env::var("FANGCUN_OWNER_USERNAME").unwrap_or_else(|_| "owner".into());
            let username = if valid_username(&proposed) { proposed } else { "owner".into() };
            let at = now();
            conn.execute("INSERT INTO users(username,display_name,password_record,role,status,created_at) VALUES(?1,'管理员',?2,'admin','active',?3)",params![username,password,at]).unwrap();
            let user = conn.last_insert_rowid();
            let has_legacy_state = conn.query_row("SELECT 1 FROM sqlite_master WHERE type='table' AND name='state'", [], |r| r.get::<_,i64>(0)).optional().unwrap().is_some();
            if has_legacy_state { if let Some((document,revision,updated)) = conn.query_row("SELECT document,revision,updated_at FROM state WHERE id=1", [], |r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?))).optional().unwrap() {
                conn.execute("INSERT INTO user_states(user_id,document,revision,updated_at) VALUES(?1,?2,?3,?4)",params![user,document,revision,updated]).unwrap();
                let mut stmt = conn.prepare("SELECT revision,document,created_at FROM snapshots ORDER BY id").unwrap();
                let rows = stmt.query_map([], |r| Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?))).unwrap();
                for row in rows.flatten() { conn.execute("INSERT INTO user_snapshots(user_id,revision,document,created_at) VALUES(?1,?2,?3,?4)",params![user,row.0,row.1,row.2]).unwrap(); }
            } }
        }
    }
    conn.execute("INSERT OR IGNORE INTO config(key,value) VALUES('registration_mode','closed')", []).unwrap();
}

async fn security_middleware(request: axum::extract::Request, next: Next) -> Response {
    let is_api = request.uri().path().starts_with("/api/");
    let allowed = if !is_api { true } else if let Some(origin) = request.headers().get(header::ORIGIN).and_then(|v|v.to_str().ok()) {
        url::Url::parse(origin).ok().and_then(|parsed| { let host = request.headers().get(header::HOST)?.to_str().ok()?; Some(parsed.host_str().unwrap_or("") == host.split(':').next().unwrap_or("") && parsed.port_or_known_default() == host.parse::<Uri>().ok().and_then(|u|u.port_u16()).or_else(||parsed.port_or_known_default())) }).unwrap_or(false)
    } else { true };
    let mut response = if allowed { next.run(request).await } else { json_error(StatusCode::FORBIDDEN,"请求来源不受信任") };
    let headers = response.headers_mut();
    headers.insert("x-content-type-options", "nosniff".parse().unwrap());
    headers.insert("x-frame-options", "DENY".parse().unwrap());
    headers.insert("referrer-policy", "no-referrer".parse().unwrap());
    headers.insert("permissions-policy", "camera=(), microphone=(), geolocation=()".parse().unwrap());
    headers.insert("content-security-policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'".parse().unwrap());
    response
}

async fn health(State(state): State<AppState>) -> Response { json_ok(StatusCode::OK, json!({"ok":true,"service":"fangcun","version":VERSION,"configured":configured(&state),"time":now()})) }
async fn api_v1_index() -> Response {
    json_ok(StatusCode::OK, json!({
        "ok": true,
        "api": "v1",
        "service": "fangcun",
        "version": VERSION,
        "compatibility": "The unversioned /api routes remain supported for existing web clients.",
        "resources": ["health", "auth", "data", "link/health", "link/snapshot", "calendar/subscription", "admin", "integrations", "agent"]
    }))
}
async fn auth_session(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let user = user_by_session(&state, &headers);
    let public = user.as_ref().and_then(|(id, name, role)| db(&state).query_row("SELECT display_name FROM users WHERE id=?1",params![id],|r|r.get::<_,String>(0)).optional().ok().flatten().map(|display|json!({"id":id,"username":name,"displayName":display,"role":role})));
    json_ok(StatusCode::OK, json!({"configured":configured(&state),"authenticated":user.is_some(),"user":public,"registrationOpen":registration_open(&state),"version":VERSION}))
}
fn create_session(state: &AppState, user_id: i64) -> String { let raw = token(); let ts = Utc::now().timestamp_millis(); db(state).execute("INSERT INTO user_sessions(token_hash,user_id,created_at,expires_at) VALUES(?1,?2,?3,?4)", params![hash(&raw),user_id,ts,ts+SESSION_AGE*1000]).unwrap(); raw }
fn find_user(state: &AppState, username: &str) -> Option<(i64,String,String,String,String)> { db(state).query_row("SELECT id,username,display_name,password_record,role FROM users WHERE username=?1 COLLATE NOCASE", params![username], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().ok().flatten() }
async fn setup(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<Value>) -> Response {
    if configured(&state) { return json_error(StatusCode::CONFLICT,"管理员账号已经初始化") }
    let username = body["username"].as_str().unwrap_or("owner").trim(); let password = body["password"].as_str().unwrap_or("");
    if !valid_username(username) { return json_error(StatusCode::BAD_REQUEST,"用户名需为 3 到 32 个字符，只能包含文字、数字、下划线或短横线") }
    if !valid_password(password) { return json_error(StatusCode::BAD_REQUEST,"密码长度需要在 8 到 128 个字符之间") }
    let display = body["displayName"].as_str().unwrap_or("管理员").trim();
    let result = db(&state).execute("INSERT INTO users(username,display_name,password_record,role,status,created_at) VALUES(?1,?2,?3,'admin','active',?4)",params![username,if display.is_empty(){username}else{display},password_record(password),now()]);
    if result.is_err() { return json_error(StatusCode::CONFLICT,"这个用户名已被使用") }
    db(&state).execute("INSERT OR IGNORE INTO config(key,value) VALUES('registration_mode','closed')",[]).unwrap();
    let id = db(&state).last_insert_rowid(); let public = find_user(&state,username).map(|(_,u,d,_,r)|json!({"id":id,"username":u,"displayName":d,"role":r})).unwrap();
    with_cookie(json_ok(StatusCode::CREATED,json!({"ok":true,"user":public})),session_cookie_for(&create_session(&state,id),&headers))
}
async fn register(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<Value>) -> Response {
    if !configured(&state) || !registration_open(&state) { return json_error(StatusCode::FORBIDDEN,"管理员暂未开放注册") }
    let username=body["username"].as_str().unwrap_or("").trim(); let password=body["password"].as_str().unwrap_or("");
    if !valid_username(username) { return json_error(StatusCode::BAD_REQUEST,"用户名需为 3 到 32 个字符，只能包含文字、数字、下划线或短横线") }
    if !valid_password(password) { return json_error(StatusCode::BAD_REQUEST,"密码长度需要在 8 到 128 个字符之间") }
    if find_user(&state,username).is_some() { return json_error(StatusCode::CONFLICT,"这个用户名已被使用") }
    let display=body["displayName"].as_str().unwrap_or(username).trim(); let result=db(&state).execute("INSERT INTO users(username,display_name,password_record,role,status,created_at) VALUES(?1,?2,?3,'user','active',?4)",params![username,if display.is_empty(){username}else{display},password_record(password),now()]);
    if result.is_err(){return json_error(StatusCode::CONFLICT,"这个用户名已被使用")} let id=db(&state).last_insert_rowid(); let public=json!({"id":id,"username":username,"displayName":if display.is_empty(){username}else{display},"role":"user"}); with_cookie(json_ok(StatusCode::CREATED,json!({"ok":true,"user":public})),session_cookie_for(&create_session(&state,id),&headers))
}
async fn login(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<Value>) -> Response {
    if !configured(&state) { return json_error(StatusCode::CONFLICT,"请先初始化管理员账号") }
    let provided=body["username"].as_str().unwrap_or("").trim().to_string(); let username=if provided.is_empty() && db(&state).query_row("SELECT COUNT(*) FROM users",[],|r|r.get::<_,i64>(0)).unwrap_or(0)==1 { db(&state).query_row("SELECT username FROM users ORDER BY id LIMIT 1",[],|r|r.get::<_,String>(0)).unwrap_or_default() } else { provided }; let password=body["password"].as_str().unwrap_or("");
    let Some((id,u,d,stored,role))=find_user(&state,&username) else { return json_error(StatusCode::UNAUTHORIZED,"用户名或密码不正确") };
    let active=db(&state).query_row("SELECT status FROM users WHERE id=?1",params![id],|r|r.get::<_,String>(0)).unwrap_or_default()=="active";
    if !active || password.is_empty() || !verify_password(password,&stored) { return json_error(StatusCode::UNAUTHORIZED,"用户名或密码不正确") }
    db(&state).execute("UPDATE users SET last_login_at=?1 WHERE id=?2",params![now(),id]).unwrap(); let public=json!({"id":id,"username":u,"displayName":d,"role":role}); let access_token=create_session(&state,id); let mut response=json!({"ok":true,"user":public}); if body["client"].as_str()==Some("flutter") { response["accessToken"]=json!(access_token); response["tokenType"]=json!("Session"); response["expiresIn"]=json!(SESSION_AGE); } with_cookie(json_ok(StatusCode::OK,response),session_cookie_for(&access_token,&headers))
}
async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response { if let Some(raw)=session_token(&headers){db(&state).execute("DELETE FROM user_sessions WHERE token_hash=?1",params![hash(&raw)]).unwrap();} with_cookie(json_ok(StatusCode::OK,json!({"ok":true})),clear_cookie()) }

async fn change_password(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<Value>) -> Response { let Some((id,username,_))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};let Some((_,_,_,stored,_))=find_user(&state,&username) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};let current=body["currentPassword"].as_str().unwrap_or("");let next=body["newPassword"].as_str().unwrap_or("");if !verify_password(current,&stored){return json_error(StatusCode::UNAUTHORIZED,"当前密码不正确")};if !valid_password(next){return json_error(StatusCode::BAD_REQUEST,"新密码长度需要在 8 到 128 个字符之间")};db(&state).execute("UPDATE users SET password_record=?1 WHERE id=?2",params![password_record(next),id]).unwrap();db(&state).execute("DELETE FROM user_sessions WHERE user_id=?1",params![id]).unwrap();with_cookie(json_ok(StatusCode::OK,json!({"ok":true})),session_cookie_for(&create_session(&state,id),&headers)) }
async fn delete_account(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<Value>) -> Response { let Some((id,username,role))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};if role!="user"{return json_error(StatusCode::FORBIDDEN,"管理员账号不能在应用内注销")};let Some((_,_,_,stored,_))=find_user(&state,&username) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};if !verify_password(body["password"].as_str().unwrap_or(""),&stored){return json_error(StatusCode::UNAUTHORIZED,"当前密码不正确")};db(&state).execute("DELETE FROM users WHERE id=?1",params![id]).unwrap();with_cookie(json_ok(StatusCode::OK,json!({"ok":true,"deleted":true})),clear_cookie()) }
async fn admin_detail(State(state): State<AppState>, Path(id): Path<i64>, headers: HeaderMap) -> Response { let Some((_,_,role))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};if role!="admin"{return json_error(StatusCode::FORBIDDEN,"需要管理员权限")};let Some(row)=db(&state).query_row("SELECT id,username,display_name,role,status,created_at,last_login_at FROM users WHERE id=?1",params![id],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"username":r.get::<_,String>(1)?,"displayName":r.get::<_,String>(2)?,"role":r.get::<_,String>(3)?,"status":r.get::<_,String>(4)?,"createdAt":r.get::<_,String>(5)?,"lastLoginAt":r.get::<_,Option<String>>(6)?}))).optional().unwrap() else{return json_error(StatusCode::NOT_FOUND,"账号不存在")};json_ok(StatusCode::OK,json!({"user":row})) }
async fn admin_detail_full(State(state): State<AppState>, Path(id): Path<i64>, headers: HeaderMap) -> Response { let Some((_,_,role))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};if role!="admin"{return json_error(StatusCode::FORBIDDEN,"需要管理员权限")};let Some(row)=db(&state).query_row("SELECT u.id,u.username,u.display_name,u.role,u.status,u.created_at,u.last_login_at,s.document,s.revision,s.updated_at FROM users u LEFT JOIN user_states s ON s.user_id=u.id WHERE u.id=?1",params![id],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,Option<i64>>(8)?,r.get::<_,Option<String>>(9)?))).optional().unwrap() else{return json_error(StatusCode::NOT_FOUND,"账号不存在")};let summary=summary_for(row.7.as_deref());json_ok(StatusCode::OK,json!({"user":{"id":row.0,"username":row.1,"displayName":row.2,"role":row.3,"status":row.4,"createdAt":row.5,"lastLoginAt":row.6,"revision":row.8.unwrap_or(0),"updatedAt":row.9,"dataBytes":row.7.as_ref().map(|v|v.len()).unwrap_or(0),"counts":summary}})) }
async fn admin_detail_ui(State(state): State<AppState>, Path(id): Path<i64>, headers: HeaderMap) -> Response { let Some((_,_,role))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};if role!="admin"{return json_error(StatusCode::FORBIDDEN,"需要管理员权限")};let conn=db(&state);let Some(row)=conn.query_row("SELECT u.id,u.username,u.display_name,u.role,u.status,u.created_at,u.last_login_at,s.document,s.revision,s.updated_at FROM users u LEFT JOIN user_states s ON s.user_id=u.id WHERE u.id=?1",params![id],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,Option<String>>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,Option<i64>>(8)?,r.get::<_,Option<String>>(9)?))).optional().unwrap() else{return json_error(StatusCode::NOT_FOUND,"账号不存在")};let document=row.7.as_deref().unwrap_or("{}");let parsed=serde_json::from_str::<Value>(document).unwrap_or_else(|_|json!({}));let counts=summary_for(Some(document))["counts"].clone();let snapshots: i64=conn.query_row("SELECT COUNT(*) FROM user_snapshots WHERE user_id=?1",params![id],|r|r.get(0)).unwrap_or(0);let take=|key:&str|parsed[key].as_array().cloned().unwrap_or_default().into_iter().take(if key=="tasks"{100}else{50}).collect::<Vec<_>>();let content=json!({"tasks":take("tasks"),"projects":take("projects"),"courses":take("courses")});drop(conn);json_ok(StatusCode::OK,json!({"user":{"id":row.0,"username":row.1,"displayName":row.2,"role":row.3,"status":row.4,"createdAt":row.5,"lastLoginAt":row.6,"revision":row.8.unwrap_or(0),"updatedAt":row.9,"dataBytes":document.len(),"counts":counts,"snapshots":snapshots,"content":content}})) }
async fn admin_migrate(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<Value>) -> Response { let Some((_,_,role))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};if role!="admin"{return json_error(StatusCode::FORBIDDEN,"需要管理员权限")};match migrate_owner_data(&state,body["force"].as_bool()==Some(true)){Ok(value)=>json_ok(StatusCode::OK,value),Err((status,value))=>json_ok(status,value)} }
async fn admin_reset_password(State(state): State<AppState>, Path(id): Path<i64>, headers: HeaderMap) -> Response { let Some((_,_,role))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};if role!="admin"{return json_error(StatusCode::FORBIDDEN,"需要管理员权限")};let Some((username,target_role))=db(&state).query_row("SELECT username,role FROM users WHERE id=?1",params![id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional().unwrap() else{return json_error(StatusCode::NOT_FOUND,"账号不存在")};if target_role=="admin"{return json_error(StatusCode::BAD_REQUEST,"不能从这里重置管理员密码")};let temporary=token();db(&state).execute("UPDATE users SET password_record=?1 WHERE id=?2",params![password_record(&temporary),id]).unwrap();db(&state).execute("DELETE FROM user_sessions WHERE user_id=?1",params![id]).unwrap();json_ok(StatusCode::OK,json!({"ok":true,"username":username,"temporaryPassword":temporary})) }

async fn get_data(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some((user_id,_,_))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};
    let row=db(&state).query_row("SELECT document,revision,updated_at FROM user_states WHERE user_id=?1",params![user_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?))).optional().ok().flatten();
    match row {Some((doc,rev,at))=>json_ok(StatusCode::OK,json!({"data":serde_json::from_str::<Value>(&doc).unwrap_or(Value::Null),"revision":rev,"updatedAt":at})),None=>json_ok(StatusCode::OK,json!({"data":null,"revision":0,"updatedAt":null}))}
}
async fn put_data(State(state): State<AppState>, headers: HeaderMap, Query(query): Query<HashMap<String,String>>, Json(body): Json<Value>) -> Response {
    let Some((user_id,_,_))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};
    let value=body.get("data").cloned().unwrap_or(Value::Null); let serialized=serde_json::to_string(&value).unwrap(); if !valid_document(&value,serialized.len()) || validate(&serialized).is_err(){return json_error(StatusCode::BAD_REQUEST,"数据结构不正确或内容过大")};
    let current=db(&state).query_row("SELECT document,revision,updated_at FROM user_states WHERE user_id=?1",params![user_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?))).optional().ok().flatten(); let force=query.get("force").map(|v|v=="1").unwrap_or(false); let base=body["baseRevision"].as_i64().unwrap_or(0);
    if let Some((_,rev,at))=&current { if !force && base!=*rev{return json_ok(StatusCode::CONFLICT,json!({"error":"云端数据已被另一台设备更新","revision":rev,"updatedAt":at}))} }
    let at=now(); let rev=current.as_ref().map(|(_,r,_)|r+1).unwrap_or(1); let mut conn=db(&state); let tx=conn.transaction().unwrap(); if let Some((old,old_rev,_))=current {tx.execute("INSERT INTO user_snapshots(user_id,revision,document,created_at) VALUES(?1,?2,?3,?4)",params![user_id,old_rev,old,at]).unwrap(); tx.execute("UPDATE user_states SET document=?1,revision=?2,updated_at=?3 WHERE user_id=?4",params![serialized,rev,at,user_id]).unwrap();} else {tx.execute("INSERT INTO user_states(user_id,document,revision,updated_at) VALUES(?1,?2,?3,?4)",params![user_id,serialized,rev,at]).unwrap();} tx.execute("DELETE FROM user_snapshots WHERE user_id=?1 AND id NOT IN (SELECT id FROM user_snapshots WHERE user_id=?1 ORDER BY id DESC LIMIT 30)",params![user_id]).unwrap();tx.commit().unwrap(); json_ok(StatusCode::OK,json!({"ok":true,"revision":rev,"updatedAt":at}))
}

async fn admin_users(State(state): State<AppState>, headers: HeaderMap) -> Response { let Some((_,_,role))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")}; if role!="admin"{return json_error(StatusCode::FORBIDDEN,"需要管理员权限")}; let conn=db(&state); let mut stmt=conn.prepare("SELECT u.id,u.username,u.display_name,u.role,u.status,u.created_at,u.last_login_at,COALESCE(s.revision,0),COALESCE(length(s.document),0) FROM users u LEFT JOIN user_states s ON s.user_id=u.id ORDER BY u.id").unwrap(); let users=stmt.query_map([],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"username":r.get::<_,String>(1)?,"displayName":r.get::<_,String>(2)?,"role":r.get::<_,String>(3)?,"status":r.get::<_,String>(4)?,"createdAt":r.get::<_,String>(5)?,"lastLoginAt":r.get::<_,Option<String>>(6)?,"revision":r.get::<_,i64>(7)?,"dataBytes":r.get::<_,i64>(8)?}))).unwrap().filter_map(Result::ok).collect::<Vec<_>>(); json_ok(StatusCode::OK,json!({"users":users,"registrationOpen":registration_open(&state),"stats":{"total":users.len(),"active":users.iter().filter(|u|u["status"]=="active").count(),"ordinary":users.iter().filter(|u|u["role"]=="user").count(),"withData":users.iter().filter(|u|u["revision"].as_i64().unwrap_or(0)>0).count()}})) }
async fn admin_users_full(State(state): State<AppState>, headers: HeaderMap) -> Response { let Some((_,_,role))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};if role!="admin"{return json_error(StatusCode::FORBIDDEN,"需要管理员权限")};let conn=db(&state);let mut stmt=conn.prepare("SELECT u.id,u.username,u.display_name,u.role,u.status,u.created_at,u.last_login_at,COALESCE(s.revision,0),COALESCE(length(s.document),0) FROM users u LEFT JOIN user_states s ON s.user_id=u.id ORDER BY u.id").unwrap();let users=stmt.query_map([],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"username":r.get::<_,String>(1)?,"displayName":r.get::<_,String>(2)?,"role":r.get::<_,String>(3)?,"status":r.get::<_,String>(4)?,"createdAt":r.get::<_,String>(5)?,"lastLoginAt":r.get::<_,Option<String>>(6)?,"revision":r.get::<_,i64>(7)?,"dataBytes":r.get::<_,i64>(8)?}))).unwrap().filter_map(Result::ok).collect::<Vec<_>>();let migration=migration_status_conn(&conn);drop(stmt);drop(conn);json_ok(StatusCode::OK,json!({"users":users,"registrationOpen":registration_open(&state),"migration":migration,"stats":{"total":users.len(),"active":users.iter().filter(|u|u["status"]=="active").count(),"ordinary":users.iter().filter(|u|u["role"]=="user").count(),"withData":users.iter().filter(|u|u["revision"].as_i64().unwrap_or(0)>0).count()}})) }
async fn admin_registration(State(state): State<AppState>, headers: HeaderMap, Json(body): Json<Value>) -> Response { let Some((_,_,role))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")}; if role!="admin"{return json_error(StatusCode::FORBIDDEN,"需要管理员权限")};let open=body["open"].as_bool()==Some(true);db(&state).execute("INSERT INTO config(key,value) VALUES('registration_mode',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![if open{"open"}else{"closed"}]).unwrap();json_ok(StatusCode::OK,json!({"ok":true,"registrationOpen":open})) }
async fn admin_status(State(state): State<AppState>, Path(id): Path<i64>, headers: HeaderMap, Json(body): Json<Value>) -> Response { let Some((admin,_,role))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};if role!="admin"{return json_error(StatusCode::FORBIDDEN,"需要管理员权限")};if admin==id{return json_error(StatusCode::BAD_REQUEST,"不能停用当前登录的管理员账号")};let status=match body["status"].as_str(){Some("active")=>"active",Some("disabled")=>"disabled",_=>return json_error(StatusCode::BAD_REQUEST,"账号状态不正确")};if db(&state).execute("UPDATE users SET status=?1 WHERE id=?2",params![status,id]).unwrap()==0{return json_error(StatusCode::NOT_FOUND,"账号不存在")};if status=="disabled"{db(&state).execute("DELETE FROM user_sessions WHERE user_id=?1",params![id]).unwrap();}json_ok(StatusCode::OK,json!({"ok":true})) }
async fn admin_delete(State(state): State<AppState>, Path(id): Path<i64>, headers: HeaderMap) -> Response { let Some((admin,_,role))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};if role!="admin"{return json_error(StatusCode::FORBIDDEN,"需要管理员权限")};let target=db(&state).query_row("SELECT username,role FROM users WHERE id=?1",params![id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional().ok().flatten();let Some((username,target_role))=target else{return json_error(StatusCode::NOT_FOUND,"账号不存在")};if admin==id||target_role=="admin"{return json_error(StatusCode::BAD_REQUEST,"管理员账号不能在这里删除")};db(&state).execute("DELETE FROM users WHERE id=?1",params![id]).unwrap();json_ok(StatusCode::OK,json!({"ok":true,"deleted":{"id":id,"username":username}})) }

async fn subscription(State(state): State<AppState>, headers: HeaderMap, method: axum::http::Method, _uri: Uri) -> Response { let Some((user_id,_,_))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};match method { axum::http::Method::GET=>{let row=db(&state).query_row("SELECT created_at,last_access_at FROM calendar_tokens WHERE user_id=?1",params![user_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?))).optional().ok().flatten();json_ok(StatusCode::OK,json!({"enabled":row.is_some(),"createdAt":row.as_ref().map(|r|&r.0),"lastAccessAt":row.as_ref().and_then(|r|r.1.as_ref())}))},axum::http::Method::POST=>{let raw=token();let created=now();db(&state).execute("INSERT INTO calendar_tokens(token_hash,user_id,created_at) VALUES(?1,?2,?3) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,created_at=excluded.created_at,last_access_at=NULL",params![hash(&raw),user_id,created]).unwrap();let host=headers.get(header::HOST).and_then(|v|v.to_str().ok()).unwrap_or("127.0.0.1");let scheme=if headers.get("x-forwarded-proto").and_then(|v|v.to_str().ok())==Some("https")||env::var("COOKIE_SECURE").ok().as_deref()==Some("true"){"https"}else{"http"};json_ok(StatusCode::CREATED,json!({"enabled":true,"createdAt":created,"url":format!("{scheme}://{host}/calendar/{raw}.ics")}))},axum::http::Method::DELETE=>{db(&state).execute("DELETE FROM calendar_tokens WHERE user_id=?1",params![user_id]).unwrap();json_ok(StatusCode::OK,json!({"ok":true,"enabled":false}))},_=>json_error(StatusCode::METHOD_NOT_ALLOWED,"不支持的请求方法")}}

fn ics_escape(value: &str) -> String { value.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace('\n', "\\n") }
async fn calendar_ics_checked(State(state): State<AppState>, Path(token): Path<String>) -> Response { if token.trim_end_matches(".ics").len() < 40 { return json_error(StatusCode::NOT_FOUND,"日历订阅不存在"); } calendar_ics(State(state),Path(token)).await }
async fn calendar_ics(State(state): State<AppState>, Path(token): Path<String>) -> Response { let raw=token.trim_end_matches(".ics");let row=db(&state).query_row("SELECT u.id,s.document FROM calendar_tokens c JOIN users u ON u.id=c.user_id LEFT JOIN user_states s ON s.user_id=u.id WHERE c.token_hash=?1 AND u.status='active'",params![hash(raw)],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,Option<String>>(1)?))).optional().ok().flatten();let Some((user,document))=row else{return json_error(StatusCode::NOT_FOUND,"日历订阅不存在")};let _=user;db(&state).execute("UPDATE calendar_tokens SET last_access_at=?1 WHERE token_hash=?2",params![now(),hash(raw)]).unwrap();let events=fangcun_core::local_events(&document.unwrap_or_else(||"{}".into())).unwrap_or_default();let mut ics=String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Fangcun//Calendar//CN\r\nX-WR-CALNAME:方寸\r\n");for event in events{let uid=ics_escape(&event.local_key);ics.push_str(&format!("BEGIN:VEVENT\r\nUID:{uid}@fangcun\r\nSUMMARY:{}\r\n",ics_escape(&event.title)));if !event.description.is_empty(){ics.push_str(&format!("DESCRIPTION:{}\r\n",ics_escape(&event.description)));}if !event.location.is_empty(){ics.push_str(&format!("LOCATION:{}\r\n",ics_escape(&event.location)));}if event.all_day{ics.push_str(&format!("DTSTART;VALUE=DATE:{}\r\nDTEND;VALUE=DATE:{}\r\n",event.date.replace('-',""),event.end_date.replace('-',"")));}else{ics.push_str(&format!("DTSTART;TZID=Asia/Shanghai:{}T{}00\r\nDTEND;TZID=Asia/Shanghai:{}T{}00\r\n",event.date.replace('-',""),event.time.replace(':',""),event.end_date.replace('-',""),event.end_time.replace(':',"")));}ics.push_str("END:VEVENT\r\n");}ics.push_str("END:VCALENDAR\r\n");Response::builder().status(StatusCode::OK).header(header::CONTENT_TYPE,"text/calendar; charset=utf-8").header("cache-control","no-store").body(Body::from(ics)).unwrap() }

fn provider(value: &str) -> Option<sync::Provider> { match value { "outlook" => Some(sync::Provider::Outlook), "google" => Some(sync::Provider::Google), _ => None } }
async fn integration_status(State(state): State<AppState>, Path(name): Path<String>, headers: HeaderMap) -> Response { let Some(p)=provider(&name) else{return json_error(StatusCode::NOT_FOUND,"不支持的同步服务")};let Some((user,_,_))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};json_ok(StatusCode::OK,sync::status(&state.db,p,user)) }
async fn integration_connect(State(state): State<AppState>, Path(name): Path<String>, headers: HeaderMap, Json(body): Json<Value>) -> Response { let Some(p)=provider(&name) else{return json_error(StatusCode::NOT_FOUND,"不支持的同步服务")};let Some((user,_,_))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};match sync::begin(&state.db,p,user,body["source"].as_str().unwrap_or("web")){Ok(v)=>json_ok(StatusCode::OK,json!({"ok":true,"authUrl":v["authUrl"]})),Err((code,msg))=>json_error(code,&msg)} }
async fn integration_sync(State(state): State<AppState>, Path(name): Path<String>, headers: HeaderMap, Json(_body): Json<Value>) -> Response { let Some(p)=provider(&name) else{return json_error(StatusCode::NOT_FOUND,"不支持的同步服务")};let Some((user,_,_))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};if !state.external_syncing.lock().expect("sync mutex poisoned").insert(user){return json_error(StatusCode::CONFLICT,"外部日历正在同步，请稍后再试")};let source=sync::document(&state.db,user).unwrap_or_else(||json!({}));let result=sync::sync_user(&state.db,p,user,source).await;state.external_syncing.lock().expect("sync mutex poisoned").remove(&user);match result{Ok(v)=>json_ok(StatusCode::OK,v),Err(msg)=>json_error(StatusCode::BAD_GATEWAY,&msg)} }
async fn integration_disconnect(State(state): State<AppState>, Path(name): Path<String>, headers: HeaderMap) -> Response { let Some(p)=provider(&name) else{return json_error(StatusCode::NOT_FOUND,"不支持的同步服务")};let Some((user,_,_))=user_by_session(&state,&headers) else{return json_error(StatusCode::UNAUTHORIZED,"请先登录")};sync::disconnect(&state.db,p,user);json_ok(StatusCode::OK,json!({"ok":true,"connected":false,"remoteCalendarRetained":true})) }
async fn integration_callback(State(state): State<AppState>, Path(name): Path<String>, Query(query): Query<HashMap<String,String>>) -> Response { let Some(p)=provider(&name) else{return json_error(StatusCode::NOT_FOUND,"不支持的同步服务")};let code=query.get("code").cloned().unwrap_or_default();let oauth_state=query.get("state").cloned().unwrap_or_default();match sync::callback(&state.db,p,&code,&oauth_state).await{Ok((_,source))=>{let location=if source=="android"{format!("fangcun://{name}-connected")}else{format!("/?{name}=connected")};Response::builder().status(StatusCode::FOUND).header(header::LOCATION,location).header("cache-control","no-store").body(Body::empty()).unwrap()},Err(message)=>{let location=format!("/?{name}=error&message={}",urlencoding::encode(&message[..message.len().min(180)]));Response::builder().status(StatusCode::FOUND).header(header::LOCATION,location).header("cache-control","no-store").body(Body::empty()).unwrap()}} }
async fn static_file(State(state): State<AppState>, uri: Uri) -> Response { let relative=if uri.path()=="/"{"index.html"}else{uri.path().trim_start_matches('/')};let allowed=["index.html","privacy.html","styles.css","v22-layout.css","smart-parser.js","docx-schedule-parser.js","app.js","manifest.webmanifest","icon.svg","service-worker.js","appearance.css","liquid.css","liquid-select.js","appearance.js","liquid-renderer.js","three.module.min.js","three.core.min.js"];if !allowed.contains(&relative){return json_error(StatusCode::NOT_FOUND,"Not found")};let path=state.root.join(relative);let Ok(bytes)=tokio::fs::read(path).await else{return json_error(StatusCode::NOT_FOUND,"Not found")};let content_type=match relative.rsplit('.').next().unwrap_or(""){ "html"=>"text/html; charset=utf-8","css"=>"text/css; charset=utf-8","js"=>"text/javascript; charset=utf-8","svg"=>"image/svg+xml","webmanifest"=>"application/manifest+json; charset=utf-8",_=>"application/octet-stream"};Response::builder().status(StatusCode::OK).header(header::CONTENT_TYPE,content_type).header("cache-control","no-cache, no-store, must-revalidate").body(Body::from(bytes)).unwrap() }
async fn static_file_rendered(State(state): State<AppState>, uri: Uri) -> Response { let relative=if uri.path()=="/"{"index.html"}else{uri.path().trim_start_matches('/')};if relative=="index.html"||relative=="privacy.html"{let path=state.root.join(relative);let Ok(mut content)=tokio::fs::read_to_string(path).await else{return json_error(StatusCode::NOT_FOUND,"Not found")};for (placeholder,value) in [("{{OPERATOR_NAME}}",state.operator.as_str()),("{{CONTACT}}",state.contact.as_str()),("{{APP_BEIAN}}",state.app_beian.as_str()),("{{ICP_BEIAN}}",state.icp_beian.as_str())]{let escaped=value.replace('&',"&amp;").replace('<',"&lt;").replace('>',"&gt;").replace('"',"&quot;").replace('\'',"&#39;");content=content.replace(placeholder,&escaped);}return Response::builder().status(StatusCode::OK).header(header::CONTENT_TYPE,"text/html; charset=utf-8").header("cache-control","no-cache, no-store, must-revalidate").body(Body::from(content)).unwrap()}static_file(State(state),uri).await }

#[tokio::main]
async fn main() {
    let root=PathBuf::from(env::var("FANGCUN_ROOT").unwrap_or_else(|_|".".into())).canonicalize().unwrap();
    let data=PathBuf::from(env::var("DATA_DIR").unwrap_or_else(|_|root.join("data").to_string_lossy().into_owned()));
    std::fs::create_dir_all(&data).unwrap();
    let conn=Connection::open(data.join("fangcun.sqlite")).unwrap();
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE COLLATE NOCASE,display_name TEXT NOT NULL,password_record TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,last_login_at TEXT); CREATE TABLE IF NOT EXISTS user_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS user_states(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,document TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS user_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,revision INTEGER NOT NULL,document TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS calendar_tokens(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL,last_access_at TEXT); CREATE TABLE IF NOT EXISTS agent_tokens(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,last_used_at INTEGER,UNIQUE(user_id,name)); CREATE TABLE IF NOT EXISTS agent_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,token_hash TEXT,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,action TEXT NOT NULL,detail TEXT NOT NULL,created_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS user_snapshots_owner ON user_snapshots(user_id,id DESC); CREATE INDEX IF NOT EXISTS agent_audit_owner ON agent_audit(user_id,id DESC);").unwrap();
    migrate_legacy_owner(&conn); sync::init(&conn);
    let state=AppState{db:Arc::new(Mutex::new(conn)),root,operator:env::var("FANGCUN_OPERATOR_NAME").unwrap_or_default(),contact:env::var("FANGCUN_CONTACT").unwrap_or_default(),app_beian:env::var("FANGCUN_APP_BEIAN").unwrap_or_default(),icp_beian:env::var("FANGCUN_ICP_BEIAN").unwrap_or_default(),agent_requests:Arc::new(Mutex::new(HashMap::new())),external_syncing:Arc::new(Mutex::new(HashSet::new()))};
    let background=state.clone();tokio::spawn(async move{let mut interval=tokio::time::interval(std::time::Duration::from_secs(300));loop{interval.tick().await;for p in [sync::Provider::Outlook,sync::Provider::Google]{for user in sync::connected_users(&background.db,p){if !background.external_syncing.lock().expect("sync mutex poisoned").insert(user){continue;}if let Some(source)=sync::document(&background.db,user){if let Err(error)=sync::sync_user(&background.db,p,user,source).await{sync::record_error(&background.db,p,user,&error);}}background.external_syncing.lock().expect("sync mutex poisoned").remove(&user);}}}});
    let api=Router::new()
        .route("/api/v1",get(api_v1_index))
        .route("/api/health",get(health)).route("/api/v1/health",get(health))
        .route("/api/auth/session",get(auth_session)).route("/api/v1/auth/session",get(auth_session))
        .route("/api/auth/setup",post(setup)).route("/api/v1/auth/setup",post(setup))
        .route("/api/auth/register",post(register)).route("/api/v1/auth/register",post(register))
        .route("/api/auth/login",post(login)).route("/api/v1/auth/login",post(login))
        .route("/api/auth/logout",post(logout)).route("/api/v1/auth/logout",post(logout))
        .route("/api/auth/password",post(change_password)).route("/api/v1/auth/password",post(change_password))
        .route("/api/auth/account",delete(delete_account)).route("/api/v1/auth/account",delete(delete_account))
        .route("/api/data",get(get_data).put(put_data)).route("/api/v1/data",get(get_data).put(put_data))
        .route("/api/calendar/subscription",get(subscription).post(subscription).delete(subscription)).route("/api/v1/calendar/subscription",get(subscription).post(subscription).delete(subscription))
        .route("/calendar/{*token}",get(calendar_ics_checked)).route("/api/v1/calendar/{*token}",get(calendar_ics_checked))
        .route("/api/admin/users",get(admin_users_full)).route("/api/v1/admin/users",get(admin_users_full))
        .route("/api/admin/registration",put(admin_registration)).route("/api/v1/admin/registration",put(admin_registration))
        .route("/api/admin/migrate-owner-data",post(admin_migrate)).route("/api/v1/admin/migrate-owner-data",post(admin_migrate))
        .route("/api/admin/users/{id}/status",patch(admin_status)).route("/api/v1/admin/users/{id}/status",patch(admin_status))
        .route("/api/admin/users/{id}/reset-password",post(admin_reset_password)).route("/api/v1/admin/users/{id}/reset-password",post(admin_reset_password))
        .route("/api/admin/users/{id}",get(admin_detail_ui).delete(admin_delete)).route("/api/v1/admin/users/{id}",get(admin_detail_ui).delete(admin_delete))
        .route("/api/integrations/{provider}/callback",get(integration_callback)).route("/api/v1/integrations/{provider}/callback",get(integration_callback))
        .route("/api/integrations/{provider}/status",get(integration_status)).route("/api/v1/integrations/{provider}/status",get(integration_status))
        .route("/api/integrations/{provider}/connect",post(integration_connect)).route("/api/v1/integrations/{provider}/connect",post(integration_connect))
        .route("/api/integrations/{provider}/sync",post(integration_sync)).route("/api/v1/integrations/{provider}/sync",post(integration_sync))
        .route("/api/integrations/{provider}",delete(integration_disconnect)).route("/api/v1/integrations/{provider}",delete(integration_disconnect))
        .merge(agent::routes())
        .fallback(static_file_rendered).layer(DefaultBodyLimit::max(2*1024*1024)).layer(middleware::from_fn(security_middleware)).with_state(state.clone());
    let host=env::var("HOST").unwrap_or_else(|_|"127.0.0.1".into());let port=env::var("PORT").ok().and_then(|p|p.parse().ok()).unwrap_or(4173);let addr:SocketAddr=format!("{host}:{port}").parse().unwrap();println!("方寸 Rust {VERSION} 已启动：http://{addr}");axum::serve(tokio::net::TcpListener::bind(addr).await.unwrap(),api.into_make_service()).await.unwrap();
}