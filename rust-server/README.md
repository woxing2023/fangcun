# fangcun-server

Rust 版方寸服务端，保留现有网页 API 的路径和 JSON 格式，使用同一目录下的 SQLite 数据库。网页端仍由同一服务提供，Android 客户端继续使用同源 HTTP API。

```bash
FANGCUN_ROOT="$PWD" cargo run --manifest-path rust-server/Cargo.toml
```

默认监听 `127.0.0.1:4173`，可用 `HOST`、`PORT`、`DATA_DIR` 覆盖。

当前已迁移：静态资源与隐私页占位符替换、旧版单用户数据迁移、健康检查、初始化/注册/登录/注销、scrypt 密码、网页 Cookie Session、Flutter `Authorization: Session`、数据版本冲突保护、管理员用户管理与 owner→member 数据迁移、日历订阅、Outlook/Google OAuth 及双向同步、Agent API（令牌、审计、限流、能力发现、完整数据写入、任务/项目写入）。Agent 以 `/api/agent/*` 及 `/api/v1/agent/*` 提供，外部 OAuth 需要先按 `.env.example` 配置凭据后再做真实账号联通验收。

生产部署脚本会编译并运行 `fangcun-server`，Node 仅保留给离线密码重置工具和前端检查脚本，不再作为线上 API 服务。