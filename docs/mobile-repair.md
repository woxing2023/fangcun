# 手机界面与运行优化

构建 `20260911-calendar-v3`，发布包版本 `2.7.0-calendar3`，业务版本 `2.7.0`。

## 使用变化

手机保留宣纸纹理、玻璃亮边和厚度。按住控件并移动手指，光泽与波纹跟随触点；宣纸面板呈现更柔和的光晕。课程保留各自颜色，重点操作与当前选项有明确的视觉焦点。触摸光效由一个共享 WebGL 图层绘制，结束交互后停止，文字和点击区域保持稳定。

“全表”同时适应画布宽度、高度，横竖屏旋转、工具栏换行、安全区改变后自动重排。周历包含早于 07:00 和晚于 23:00 的事项。全表适合看整周分布；很短的事项或很长的名称在格内可能只显示一部分，“清单”逐项显示完整名称、时间、地点，并可打开详情。加减号和双指缩放进入可滚动的阅读状态，点“全表”恢复。

竖屏日历工具栏按日期、视图、全表/清单与操作分三行。长任务标题和标签按内容增高，列表可滚动到底。外观设置的浅色、深色并排选择，偏好仍保存在当前设备。

## 优化发生在哪里

纸纹由原 `xuan-fibers.svg` 烘焙为 `xuan-fibers-mobile.png`，720 × 720 像素按 360 × 360 CSS 像素平铺。大面板保留纸纹；日历格共用底板，课程使用彩色玻璃边缘和浅投影。模糊集中于少数界面容器，触摸动态复用一个渲染器，避免每个格子都创建独立效果。

业务代码只构建当前页面，进入其他页面时刷新。保留的节点复用监听器；年历日期结果只缓存到本次渲染结束，数据更新后重新计算。选择器按变化同步，静止时不再反复读取布局、克隆标签和重建菜单；相同缩放值不重复写入本地存储。

文件职责见 [外观维护](../APPEARANCE.md)，触摸光效及降级见 [触摸材质](touch-material.md)。

## APK 与重构范围

当前 APK 是 Android Java 宿主加 WebView，显示 HTML/CSS/JavaScript 页面。Java 桥接通知、系统日历和文件能力；网页本地数据与 Node.js/SQLite 服务端同步。

本次更新网页资源，Android 壳代码没有改动，也没有生成 Flutter 或 Rust 客户端。现有 APK 获取新页面后使用这些变化。将来改用 Flutter，需要重写移动 UI、状态和手势，并迁移 WebView 中尚未同步的数据；Rust 可另行评估是否承担共享计算逻辑。这轮交付没有实施架构迁移。

## 已确认的证据

真实 Chromium 使用虚构的 42 门课程、180 条任务测试。相同场景连续渲染 9 次的结构计数如下：

| 检查 | 优化前 | 优化后 |
| --- | ---: | ---: |
| 日历刷新时重建隐藏象限 | 9 | 0 |
| 周历新增事件监听 | 10,827 | 3,267 |
| 年历新增事件监听 | 15,363 | 4,590 |
| 相同全表尺寸更新 12 次写缩放存储 | 12 | 0 |

选择弹窗初始化完成后，连续 1.05 秒静止阶段的选择器布局读取、标签克隆均为 0。直接给原生 select 的 `.value` 赋值仍会更新显示。报告在 `release/qa/runtime-performance-baseline.json` 和 `runtime-performance-after.json`。计时同时受布局样式影响，仅供开发对照，不作为手机速度承诺。

日历浏览器回归覆盖 24 组横竖屏、周历/课表、亮暗外观组合，验证完整日期与时段、清单、详情、旋转、安全区和 06:30/23:59 边界事项。原有手机交互、选择器键盘操作及运行时检查也已通过。

共享着色器的 SwiftShader 软件 GPU 检查确认画布有实际像素输出、同尺寸复用、不活动时停止绘制、页面隐藏和上下文恢复等行为，证据为 `release/qa/touch-shader-report.json`。软件 GPU 无法代表 Android 真机 GPU，浏览器截图和结构计数也不能换算成实机 FPS。

## 复现与部署

```bash
npm run check
export FANGCUN_PLAYWRIGHT_MODULE=/absolute/path/to/playwright
node runtime-performance-smoke.js
node mobile-calendar-smoke.js
node mobile-interaction-smoke.js
node liquid-select-smoke.js
node gpu-renderer-smoke.js
node touch-material-smoke.js
node touch-lifecycle-smoke.js
```

这些浏览器测试使用独立服务、模拟 API 和虚构数据。上线后仍需在手机按住滑动、滚动列表、旋转课表，并确认原有数据可用。部署与回滚见 [Workbench 流程](workbench-xuan.md)。
