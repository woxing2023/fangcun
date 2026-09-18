# 方寸 API v1

Rust 服务从 `/api/v1` 提供版本化入口。现有网页客户端仍使用 `/api`，因此旧路径继续保留，便于平滑升级；两套路径使用相同的请求体、响应体、Cookie 会话和错误格式。

## 当前覆盖

已迁移到 Rust 的 v1 资源包括。网页使用 HttpOnly Cookie；Flutter 使用登录响应中的 Session 令牌，两者最终映射到同一套服务端会话表：

- `GET /api/v1/health`
- `GET /api/v1/auth/session`
- `POST /api/v1/auth/setup`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/password`
- `DELETE /api/v1/auth/account`
- `GET|PUT /api/v1/data`
- `GET|POST|DELETE /api/v1/calendar/subscription`
- `GET /api/v1/admin/*`、`PUT /api/v1/admin/registration`、`PATCH /api/v1/admin/users/:id/status`
- `GET|POST|DELETE /api/v1/integrations/:provider/*`
- `/api/v1/agent/*`：令牌管理、审计、能力发现、日程读取、完整数据读写、任务和长期项目写入

`GET /api/v1` 返回服务版本和资源清单，可用于客户端启动时探测。日历订阅的公开 ICS 地址仍是 `/calendar/:token`，因为它不是 API 会话端点。

## 约束

v1 是 Rust 服务的版本化兼容入口；现有网页继续使用未版本化 `/api`，Agent 客户端可使用 `/api/v1/agent/*`，旧的 `/api/agent/*` 入口也保持兼容。Agent 写入沿用 `expectedRevision` 版本保护，令牌只存 hash，业务请求受限流和审计约束。