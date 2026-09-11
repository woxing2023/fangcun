# 方寸「高级灰柔和重塑」任务书（同学未完成的风格化迭代）

你在一个已初始化 git 的完整项目里工作（/data/xuetianren/fangcun-styling，内含 AGENTS.md 工程约定，先读它）。
基线提交为 baseline。基线 `npm run check` 已全绿。你只改代码 + 跑 check，**不要 commit**（由外部收尾）。

## 背景

方寸 = 本地优先的个人行动中枢。视觉系统：classic 纸感默认皮肤 + liquid 流光玻璃可选皮肤（html[data-skin="liquid"]），共享 index.html/app.js/styles.css/v22-layout.css/appearance.css/liquid.css，皮肤与深浅模式（body.dark）相互独立。架构细节读 APPEARANCE.md。
同学做了一版「高级灰柔和重塑」效果图，**做到一半 token 耗尽，你要把它完整实现**。

## 目标视觉（同学效果图实测数据，1536×1024 采样）

当前版本是暖奶油色纸感（--bg:#f4f2ed，浮起卡片 #fbfaf7）。效果图整体转为**冷调高级灰**：
- 外层背景 ≈ #d6d6d7（冷灰，比现在暗一档）
- 侧栏面板 ≈ #e4e0dc（带一丝暖灰的浅灰，非纯白浮起）
- 主区背景 ≈ #e1ddda
- 卡片面 ≈ #e6e2de（下陷感而非浮起，neumorphic 按压）
- 选中态（侧栏「今天」pill）≈ #d8d7d7 **下陷深灰**（inset shadow 按压感，不是现在的浮起白）
- 输入栏 ≈ #e7e6e6；智能识别按钮激活态 ≈ #adacab（灰，不再深色实心）
- 主按钮/强调按钮 ≈ #afaead（去饱和灰），**无任何绿色强调**
- 实时同色系：同一 UI 里卡片、按钮、背景全部属于一个低对比灰阶体系，层次靠明度差和内阴影，不靠色相

## 具体改动要求

1. **Token 重塑（styles.css）**：把 classic（非 dark）的 --bg/--surface/--card/--ink/--muted/--line/--accent/--shadow 系统性调整为上述冷调高级灰。accent 从深绿 #344f42 改为低饱和灰（如 #6b6f6d 系），q1-q4 语义色全部降饱和至与整体协调（不能荧光、不能高饱和实心块）。body.dark 同步降饱和保持同族（不要亮荧光色）。
2. **Neumorphic 按压体系**：卡片从"浮起投影"改为"柔和下陷/极浅浮起"混合：外层大面板浮起、内部卡片微下陷；选中 pill、分段控件激活态用 inset 阴影。阴影全部低浓度（rgba 黑 ≤0.12），禁止重阴影。
3. **顶栏实时时钟改造（index.html + app.js）**：#liveClock 现在显示 "--:--" + "同步当前时间"（updateLiveClock 函数，app.js 3792 行附近）。改为：strong 部分保持 HH:MM:SS 实时秒表，span 部分改为「专注中」（当存在未完成且 focusPinned 或今日 DDL 焦点时）/「空闲」（否则），每分钟随 updateLiveClock 一起刷新；样式做成效果图那种柔和药丸（live-clock-pill 实测 ≈ #b4b2b0 底、低对比）。
4. **按钮全去饱和**：primary-button、secondary-button、icon-button、smart-submit、complete-btn 完成态（现在是绿色 var(--q2) 系）全部纳入灰阶体系；完成态可用灰绿或中灰勾选，禁止亮绿。
5. **保持不动**：liquid.css 流光玻璃皮肤的一切（它独立工作，别碰）；布局结构、DOM 层级、四象限/日历/项目功能逻辑（除 updateLiveClock 的 span 文案逻辑外不许改 app.js 业务代码）；mobile 端布局；无障碍属性。
6. **架构铁律（AGENTS.md 全文有效）**：不引入新依赖、不加新颜色体系文件；改完 `npm run check` 必须全绿（禁止删断言）；git diff 干净可读不夹带格式重排。
7. CRLF 注意：仓库文件多为 CRLF 行尾，编辑时保持原行尾，不要整文件重写成 LF。

## 完成标准

1. `npm run check` 全绿（12 套件，输出里 12 个「检查通过」）。
2. `git diff --stat` 只含 styles.css、index.html、app.js（若需要最多加 appearance.css），无其他文件。
3. 最后输出：改动摘要（每个文件改了什么、token 新值列表）。
