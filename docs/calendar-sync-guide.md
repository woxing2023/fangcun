# 方寸 v2.7 全平台日历双向同步与提醒

## 1. 最终数据流

方寸现在有三条可编辑通道和一条兼容通道：

- **Outlook / Microsoft 365 双向同步**：服务端为每个用户创建独立的“方寸”日历，支持新增、改期、改地点、改提醒和删除。
- **Google 日历双向同步**：服务端为每个用户创建独立的“方寸”日历，首次全量对齐，之后使用 Google `syncToken` 增量同步。
- **Android 系统日历双向同步**：APK 通过 Android Calendar Provider 创建账号专属本地日历，小米日历可直接编辑。
- **ICS 私密订阅**：只读兼容方式，不参与反向修改，不要和上面三条通道重复启用同一份日历。

```text
小米系统日历 ←→ 方寸 APK ←→ 方寸云端 ←→ Microsoft Graph ←→ Outlook
                            ↕
                    Google Calendar API
                            ↕
                 Google 日历（网页/手机/iOS）
```

连接 Outlook 和 Google 后，方寸是唯一中枢：方寸中的同一事项会映射到两个平台各自的“方寸”日历。Outlook 中的修改先回到方寸，再进入 Google；Google 的修改也按相反方向传播。服务端约每 5 分钟轮询，也可以在“日历 → 同步与导入”中手动立即同步。

小米系统日历由 APK 合并：开启同步、打开或返回 App、以及方寸内修改后触发。当前不是每秒实时协同编辑；正常传播时间是服务器通道 0–5 分钟，再加一次 APK 打开/返回。

## 2. 本次发布与 Workbench 升级

本次服务器包为 `fangcun-release-2.7.0-calendar3.tar.gz`，构建为 `20260911-calendar-v3`。本地只负责检查、打包和交付；Hermes 负责上传 GitHub Release，并在 Workbench 下载、校验和升级。

暂存目录使用随机临时目录或当前账户的 `$HOME`，不写死登录账户路径。完整 tag、校验文件、升级与回滚命令见 [Workbench 交接说明](workbench-xuan.md)。

服务仍只监听 `127.0.0.1:18443`，沿用现有 Cloudflare Tunnel。不修改 nginx、hysteria2、Tunnel 配置或公网端口。

下文的 `https://calendar.example.invalid` 是文档占位地址。实际回调地址由部署负责人在现有授权环境中填写，不能直接使用占位值。

## 3. 配置 Outlook / Microsoft 365

### 3.1 Microsoft Entra

1. 在 Microsoft Entra 管理中心打开“应用注册 → 新注册”。
2. 名称填“方寸日历同步”。如需个人 Outlook 与学校 Microsoft 365 一起使用，选择“任何组织目录中的账户和个人 Microsoft 账户”。
3. 添加 **Web** 重定向 URI：

```text
https://calendar.example.invalid/api/integrations/outlook/callback
```

4. 添加 Microsoft Graph 委托权限：`User.Read`、`Calendars.ReadWrite`。
5. 新建客户端密码，保存“值”，不是 Secret ID。

### 3.2 服务器变量

在 Workbench 运行：

```bash
sudoedit /etc/fangcun.env
```

加入并替换实际值：

```dotenv
MICROSOFT_CLIENT_ID=应用程序客户端ID
MICROSOFT_CLIENT_SECRET=客户端密码的值
MICROSOFT_TENANT=common
MICROSOFT_REDIRECT_URI=https://calendar.example.invalid/api/integrations/outlook/callback
```

## 4. 配置 Google 日历

### 4.1 Google Cloud

1. 在 Google Cloud Console 新建或选择项目。
2. 在“API 和服务 → 库”启用 **Google Calendar API**。
3. 配置 OAuth 同意屏幕。个人试用可先选择 External/外部并保持 Testing/测试，添加实际使用者为测试用户；公开注册前再完成应用信息、隐私政策和 Google 验证。
4. 在“凭据 → 创建凭据 → OAuth 客户端 ID”选择 **Web application**。
5. 添加已获授权的重定向 URI，必须逐字一致：

```text
https://calendar.example.invalid/api/integrations/google/callback
```

6. 保存客户端 ID 和客户端密钥。不要把密钥放进网页、APK、聊天记录或代码仓库。

方寸授权时请求 `openid email profile`、`calendar.app.created` 和 `calendar.calendarlist.readonly`，只管理由方寸创建的次级日历并读取日历列表，不申请读写用户全部日历；同时请求离线访问，以便云服务器在用户不打开网页时继续同步。

### 4.2 服务器变量

继续编辑同一个文件：

```bash
sudoedit /etc/fangcun.env
```

加入：

```dotenv
GOOGLE_CLIENT_ID=Google网页客户端ID
GOOGLE_CLIENT_SECRET=Google网页客户端密钥
GOOGLE_REDIRECT_URI=https://calendar.example.invalid/api/integrations/google/callback
```

Outlook 和 Google 令牌共同使用以下服务端加密密钥。`deploy/install.sh` 在缺少时会自动生成；已有值绝不能更换，否则保存的令牌将无法解密：

```dotenv
FANGCUN_INTEGRATION_KEY=至少32字节的独立随机密钥
```

限制环境文件权限并重启：

```bash
sudo chown root:fangcun /etc/fangcun.env
sudo chmod 640 /etc/fangcun.env
sudo systemctl restart fangcun
curl http://127.0.0.1:18443/api/health
sudo journalctl -u fangcun -n 100 --no-pager
```

网页显示“服务器尚未配置”时，先检查变量名和回调 URL，再确认安装目录中存在 `/opt/fangcun/google-sync.js` 与 `/opt/fangcun/outlook-sync.js`。

## 5. 每位用户连接账号

1. 在方寸网页或 APK 登录自己的方寸账号。
2. 打开“日历 → 同步与导入”。
3. 分别点击“连接 Outlook”和“连接 Google”，在官方授权页选择自己的账号并同意。
4. 首次授权返回方寸后会自动执行一次双向同步。
5. 分别在 Outlook 和 Google 的日历列表确认出现“方寸”。以后只编辑这两个专用日历。

APK 会用系统浏览器完成授权，并通过 `fangcun://outlook-connected` 或 `fangcun://google-connected` 自动返回 App。首次授权必须由账号本人完成，管理员不能替用户绕过 OAuth 确认。

断开连接只会删除方寸服务器上的加密令牌和映射，不会删除远端“方寸”日历。若准备换账号，建议先断开，再在 Microsoft/Google 账号的安全设置中撤销旧授权。

## 6. Android / HyperOS 系统日历

1. 安装 `fangcun-v2.7.0-debug.apk`，或使用同一正式签名生成的 release APK。
2. 登录方寸，打开“日历 → 同步与导入 → 小米 / Android 系统日历”。
3. 点“开启双向同步”，允许日历读写、通知和“闹钟与提醒”。
4. 在 HyperOS 应用设置中允许自启动，电池策略设为“不限制”。
5. 打开小米日历，在日历管理中显示以“方寸”开头的本地日历。

小米日历中的标题、地点、起止时间、提醒和删除会回写方寸。移动一节课程只生成该次调课例外；删除一节课程只生成该次停课，不会误删整门课程。

不要同时在小米日历中显示通过 Google/Outlook 系统账号同步进来的另外两份“方寸”日历，否则视觉上会出现三份相同事件。推荐：

- 小米端只显示 APK 创建的本地“方寸”日历；
- Outlook 端只编辑 Microsoft 的“方寸”日历；
- Google 端只编辑 Google 的“方寸”日历；
- 由方寸云端在三者间传递变更。

## 7. 新增、修改、删除和冲突

- 有日期的任务、日程、DDL 和每次课程会进入同步；无日期四象限任务不会污染日历。
- 在 Outlook 或 Google 的“方寸”日历新建普通事件，会作为任务导入方寸，再传播到另一平台和 APK。
- 删除普通事件会删除方寸对应任务；删除一节课程只生成单次停课。
- Google 使用稳定私有属性保存方寸键，Outlook 使用隐藏标记，Android 使用 Calendar Provider 的同步字段，避免每轮重复创建。
- Google 首次全量同步，之后使用 `syncToken` 拉取变化；令牌失效时自动回退一次全量同步。
- 同一事项两端都改过时，比较最后修改时间；统计中记录冲突。服务端不会读写 Outlook、Google 或小米中的其他日历。

不要让同一事项在多台离线设备上分别修改数天。恢复网络后先打开方寸，依次点 Outlook、Google“立即同步”，再回到 APK 触发系统日历同步。

## 8. 提醒如何跨平台到达

- **Android**：APK 使用 `AlarmManager` 发原生通知；小米“方寸”本地日历也可发系统日历通知。若收到双提醒，可关闭其中一种。
- **Windows / Outlook**：事件提醒由 Outlook/Windows 通知系统触发；确保 Windows 通知和 Outlook 日历提醒未被关闭。
- **Google / Android / iOS**：Google“方寸”日历中的事件提醒由 Google Calendar 客户端和系统通知触发。
- **方寸网页**：浏览器提醒仅作前台辅助，浏览器被冻结或关闭时不能作为唯一提醒来源。

提醒分钟数是同步字段：在任一双向端修改后会传播。各平台可能应用自己的免打扰、后台限制和通知权限，方寸无法绕过系统级禁用。

## 9. 验收双向互通

按顺序做一轮，避免把“还没到轮询时间”误判为故障：

1. 方寸新建“同步验收”，设明天 15:00–16:00、提前 30 分钟提醒。
2. 在方寸分别点 Outlook、Google“立即同步”，确认两边出现。
3. 在 Outlook 把标题改成“同步验收-Outlook”、时间改为 15:30；回方寸点 Outlook“立即同步”。
4. 再点 Google“立即同步”，确认 Google 收到 Outlook 的修改。
5. 在 Google 改地点和提醒；回方寸点 Google、再点 Outlook，确认 Outlook 收到。
6. 打开 APK 或点系统日历“立即同步”，确认小米日历收到最终版本。
7. 在小米日历再改一次地点，返回方寸 App；然后手动同步 Google、Outlook，确认两边一致。
8. 最后在任一端删除测试事件，完成同样的传播链，确认所有端消失。

## 10. 常见故障

### Google `redirect_uri_mismatch`

Google Cloud 中的 Web 重定向 URI 与 `GOOGLE_REDIRECT_URI` 必须完全相同，包括 HTTPS、域名和路径。

### Google 显示应用未验证或拒绝访问

测试阶段把账号加入 OAuth 测试用户；公开开放前完成同意屏幕、隐私政策和验证。不要让普通用户使用开发者账号的客户端密钥。

### Outlook / Google 修改暂时没回方寸

等待最多 5 分钟，或在方寸点对应通道的“立即同步”。如果另一平台也要马上收到，再点另一通道一次。

### APK 授权后没有返回

确认安装的是 v2.7.0 APK，并允许浏览器打开 `fangcun://` 链接。旧 APK 不包含本版的小米系统闹钟和日历同步返回处理。

### 小米日历没有“方寸”

到“设置 → 应用 → 方寸 → 权限”打开日历读写，回方寸点“立即同步”。若系统省电清理 App，改为“不限制”。

### 出现重复日程

关闭 ICS 订阅，并检查小米日历是否同时显示本地、Google 和 Outlook 三份“方寸”。每个平台只保留上文推荐的那一份可见日历。

## 11. 手工和自然语言录入

批量课表优先使用 Word DOCX、拾光 JSON 或 ICS，先预览再导入。单项直接说：

```text
明天下午3点到5点参加物理小组讨论，重要不紧急，提前30分钟提醒，地点B12-201
9月18日晚上8点交化学实验报告，重要紧急，提前1天提醒，关联化学原理I
每周二、周五第1-2节大学物理A（上），1-17周，示例校区B12-201，提前15分钟提醒
```

确认智能预览后一次写入。方寸云端保存后，Outlook、Google 和小米通道会按上述流程继续传播。
