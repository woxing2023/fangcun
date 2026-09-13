const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const source = app.slice(app.indexOf("const agentAccess ="), app.indexOf("const integrationUI ="));
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions += 1; }
const elements = new Map();
function element(selector) {
  if (!elements.has(selector)) {
    const classes = new Set();
    elements.set(selector, {
      value: "", textContent: "", innerHTML: "", disabled: false, open: true, dataset: {}, attributes: {},
      focus() { this.focused = true; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); } },
    });
  }
  return elements.get(selector);
}
const requests = [];
let apiHandler = async (pathname) => pathname.endsWith("/tokens") ? { tokens: [] } : { audit: [] };
let confirmation = true;
let copied = "";
const context = {
  $, Date, Intl, encodeURIComponent,
  syncState: { authenticated: true }, currentUser: { id: 7 },
  escapeHTML: (value) => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]),
  apiRequest: async (pathname, options = {}) => { requests.push({ pathname, ...options }); return apiHandler(pathname, options); },
  confirm: () => confirmation,
  navigator: { clipboard: { async writeText(value) { copied = value; } } },
  showToast() {},
};
function $(selector) { return element(selector); }
vm.createContext(context);
vm.runInContext(source, context, { filename: "agent-ui-functions" });
function reset() {
  context.clearAgentAccess();
  context.syncState.authenticated = true;
  context.currentUser = { id: 7 };
  $("#cloudModal").open = true;
  $("#agentAccessPanel").classList.remove("hidden");
  requests.length = 0;
  confirmation = true;
  apiHandler = async (pathname) => pathname.endsWith("/tokens") ? { tokens: [] } : { audit: [] };
}
const submit = () => context.createAgentToken({ preventDefault() {} });
function pending() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

async function main() {
  check([...html.matchAll(/data-sync-tab="([^"]+)"/g)].map((match) => match[1]).join(",") === "account,calendar,files,agent", "Agent 接入必须为第四个同步标签");
  check(/<section class="admin-card"><form id="agentTokenForm"/.test(html) && /aria-describedby="agentTokenNameError"/.test(html), "表单复用卡片与相邻错误提示");
  check(app.includes('$("#cloudModal").addEventListener("close", clearAgentAccess)') && app.includes('("pagehide", clearAgentAccess)'), "弹窗关闭与页面退出均须清除令牌");
  check(!/localStorage|sessionStorage|console\./.test(source), "令牌管理不得持久化或记录明文");
  check(!html.includes("?v=2.7.0") && app.includes('const APP_VERSION = "2.8.0"') && app.includes('const APP_BUILD = "20260913-agent-280"'), "版本资源参数应一致升级");

  reset();
  const token = "test-only-one-time-token";
  apiHandler = async (pathname, options) => options.method === "POST" ? { token } : pathname.endsWith("/tokens") ? { tokens: [{ name: "member-codex", createdAt: 1, expiresAt: 9999999999999, lastUsedAt: null }] } : { audit: [] };
  $("#agentTokenName").value = " member-codex ";
  await submit();
  check(JSON.parse(requests[0].body).name === "member-codex", "生成提交去除首尾空白的名称");
  check($("#agentTokenValue").textContent === token && !$("#agentTokenReveal").classList.contains("hidden"), "成功后完整令牌可见");
  check($("#agentTokenValue").focused && $("#agentTokenName").value === "", "成功后焦点进入一次性令牌并清空名称");
  check($("#agentTokenList").innerHTML.includes("member-codex") && !$("#agentTokenList").innerHTML.includes(token), "列表显示元数据而不重复展示令牌");
  check(!$("#createAgentTokenBtn").disabled, "生成后恢复按钮");
  await context.copyAgentToken();
  check(copied === token, "复制使用当次完整令牌");
  context.clearAgentAccess();
  check($("#agentTokenValue").textContent === "" && $("#agentTokenReveal").classList.contains("hidden"), "清除函数立即移除令牌内容");

  for (const invalid of ["", "   ", "x".repeat(61), "name\nline", ".", "..", "bad\ud800"]) {
    reset(); $("#agentTokenName").value = invalid; await submit();
    check(requests.length === 0 && $("#agentTokenName").attributes["aria-invalid"] === "true", "非法名称必须在提交前拒绝并关联字段错误");
  }

  reset();
  context.syncState.authenticated = false;
  await context.loadAgentAccess();
  check(requests.length === 0 && $("#createAgentTokenBtn").disabled && $("#agentAccessStatus").textContent.includes("登录"), "未登录显示原因并禁止生成");

  reset();
  apiHandler = async () => { throw Object.assign(new Error("名称重复"), { status: 409 }); };
  $("#agentTokenName").value = "member-codex";
  await submit();
  check($("#agentTokenName").value === "member-codex" && $("#agentTokenNameError").textContent.includes("换一个名称"), "同名错误保留输入并给出可修复提示");
  check(!$("#createAgentTokenBtn").disabled && $("#agentTokenValue").textContent === "", "失败恢复按钮且不显示令牌");

  reset();
  const deferred = pending();
  apiHandler = async () => deferred.promise;
  $("#agentTokenName").value = "member-codex";
  const first = submit();
  await submit();
  check(requests.length === 1 && $("#createAgentTokenBtn").disabled, "生成中避免重复 POST");
  context.clearAgentAccess();
  $("#cloudModal").open = false;
  deferred.resolve({ token });
  await first;
  check($("#agentTokenValue").textContent === "", "关闭后晚到的创建响应不能重新显示明文");

  reset();
  const switched = pending();
  apiHandler = async () => switched.promise;
  $("#agentTokenName").value = "member-codex";
  const switching = submit();
  context.currentUser = { id: 8 };
  switched.resolve({ token });
  await switching;
  check($("#agentTokenValue").textContent === "", "用户切换后丢弃原账号创建响应");

  reset();
  const olderTokens = pending(); const olderAudit = pending();
  apiHandler = async (pathname) => pathname.endsWith("/tokens") ? olderTokens.promise : olderAudit.promise;
  const olderLoad = context.loadAgentAccess();
  apiHandler = async (pathname) => pathname.endsWith("/tokens") ? { tokens: [{ name: "newest", createdAt: 1, expiresAt: 9999999999999 }] } : { audit: [] };
  await context.loadAgentAccess();
  olderTokens.resolve({ tokens: [{ name: "stale", createdAt: 1, expiresAt: 9999999999999 }] }); olderAudit.resolve({ audit: [] });
  await olderLoad;
  check($("#agentTokenList").innerHTML.includes("newest") && !$("#agentTokenList").innerHTML.includes("stale"), "较旧加载结果不能覆盖最新列表");

  reset();
  context.renderAgentAccess([{ name: '<img src=x onerror="bad()">', createdAt: 1, expiresAt: 9999999999999 }], Array.from({ length: 12 }, (_, index) => ({ action: `GET <${index}>`, createdAt: 1 })));
  check(!$("#agentTokenList").innerHTML.includes("<img") && $("#agentTokenList").innerHTML.includes("&lt;img"), "令牌名称按文本转义防止注入");
  check(($("#agentAuditList").innerHTML.match(/class="admin-user"/g) || []).length === 10 && !$("#agentAuditList").innerHTML.includes("GET <"), "审计转义并只显示最近 10 条");

  reset();
  const revokeButton = { dataset: { revokeAgentToken: "member / code" }, disabled: false, textContent: "吊销" };
  confirmation = false;
  await context.revokeAgentToken(revokeButton);
  check(requests.length === 0, "未确认不得吊销");
  confirmation = true;
  $("#agentTokenValue").textContent = token;
  await context.revokeAgentToken(revokeButton);
  check(requests[0].method === "DELETE" && requests[0].pathname === "/api/agent/tokens/member%20%2F%20code", "吊销请求正确编码名称并使用 DELETE");
  check($("#agentTokenValue").textContent === "" && !revokeButton.disabled, "吊销成功清除明文并恢复按钮");

  reset();
  apiHandler = async () => { throw Object.assign(new Error("Unauthorized"), { status: 401 }); };
  await context.loadAgentAccess();
  check($("#agentAccessStatus").textContent.includes("重新登录"), "会话过期给出重新登录路径");
  console.log(`Agent 接入界面检查通过：${assertions} 项断言（一次性令牌、异步隔离、校验、复制、确认吊销与活动列表）。`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
