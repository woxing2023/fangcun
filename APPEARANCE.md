# 方寸外观维护

构建 `20260911-calendar-v3`，发布包 `2.7.0-calendar3`。两种皮肤共用页面、业务代码和响应式布局：`classic` 为宣纸，`liquid` 为流光玻璃。手机保留纸纹、玻璃立体感与随触点变化的光效。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `styles.css`、`v22-layout.css` | 业务组件与基础响应式布局 |
| `calendar-surface.css` | 全设备共享的纸面、日期轨道、课程色彩与焦点层 |
| `mobile-ui.css` | 手机卡片、导航、字体、选择栏及 CSS 层顺序 |
| `mobile-calendar.css` | 全表、清单、横竖屏课程表的几何布局 |
| `appearance.css`、`xuan.css`、`liquid.css` | 共享控件与两种皮肤的基础材质 |
| `mobile-material.css` | 手机纸纹、玻璃边缘、浅投影和语义色 |
| `xuan-fibers.svg`、`xuan-fibers-mobile.png` | 原始纸纹及其 720 × 720 像素烘焙图，全设备按 360 × 360 CSS 像素平铺 |
| `appearance.js`、`appearance-controls.js` | 外观偏好、并排浅深色选择与渲染生命周期 |
| `touch-material.js` | 手机及桌面日历共享触摸层、触点采样、裁切与清理 |
| `liquid-renderer.js` | 直接 WebGL 绘制高光、暗边、波纹和纸面光晕 |
| `material-light.js` | 桌面经典外观的按需装饰光泽 |
| `liquid-select.js` | 原生 select 的渐进增强、键盘操作和按变化同步 |

`calendar-surface.css` 先声明 `calendar-surface, mobile-ui, mobile-material, mobile-calendar, xuan-material, liquid-material` 层顺序。新增规则应进入对应职责层，避免继续累加互相覆盖的全局按钮规则。

## 新组件

内容复用 `--bg`、`--surface`、`--card`、`--ink`、`--muted`、`--line`；操作使用 `--accent`、`--accent-soft`、`--action-fill`、`--action-ink`。课程、优先级、错误等颜色保留各自含义，不把它们统一改成灰色。

表单复用 `.field`、`.form-grid`、`.switch-label`、`.smart-field`；按钮复用现有操作类。非交互面板可用 `.xuan-paper` 或 `data-material="xuan"`，交互控件保留正确的 HTML 语义与键盘行为。日历格共用纸面背景，彩色课程保留亮边和浅投影。

手机的触摸层作用于当前控件或面板，不给每个格子建立独立画布。`data-material="none"` 可明确排除装饰。任何装饰都必须不可点击、对辅助技术隐藏，不变形文字，也不能依赖画布呈现业务内容。

## 渲染与运行成本

当前共享渲染器直接使用 WebGL，不加载 Three.js 运行层。触摸开始时读取几何，移动时合并触点采样并更新参数；相同尺寸复用画布。结束交互后停止绘制，滚动、取消手势、隐藏页面和外观变化时清理。光泽和波纹属于装饰模拟，不采样底层 DOM 进行物理折射。

系统减少动态效果和强制颜色偏好继续生效。WebGL 不可用时保留 CSS 触摸反馈；缺少背景模糊支持时仍有可读的表面和焦点。具体生命周期与验收见 [触摸材质](docs/touch-material.md)。

`app.js` 只构建活动页面，进入其他页面时刷新；保留节点复用监听器，日期缓存限定在本次渲染。选择器按变更同步，属性赋值的兼容采样不在静止状态反复读取布局或克隆标签。优化代码时保留数据更新、同步冲突、表单值和课程完整显示的语义。

## 日历结构

周历与节次课表各绘制一张纸面和七条日期轨道。轨道用重复渐变画网格线，点击坐标映射到时段，键盘可跨日期选择、创建；实际课程节点承载详情和拖放。空时段不再创建数百个独立玻璃控件。保存的课程颜色不改写，显示时提取色相并调整饱和度；顶部用实际日期显示正在进行或下一节课程。

同一日历有效输入使用渲染签名复用已有节点；课程、任务、节次、例外和校历变化使缓存失效。尺寸读取集中在写入之前，同值样式和文本不重复赋值。触摸仍有高光和波纹，全设备日历只使用一个共享光效画布。

## 资源、验证与交付

外观偏好 `fangcun-skin`、`fangcun-theme` 只保存在当前设备。字体离线提供，来源和许可证见 `FONT-LICENSE.txt`。纸纹与字体接入见 [宣纸说明](docs/xuan-material.md)。

当前缓存名为 `fangcun-v270-20260911-calendar-v3`。新增或更新脚本、纹理后，同步维护页面 URL、服务端静态白名单、service worker 预缓存与安装包清单；业务版本和构建标识分别管理。APK 仍加载站点，本次没有修改 Android WebView 宿主。

执行 `npm run check`，再运行 [手机说明](docs/mobile-repair.md) 中的真实浏览器套件。重点查看按住滑动、材质收尾、长标题、课表全表/清单、安全区及原有表单和同步操作。软件 GPU 测试只能证明着色与生命周期行为，不能证明 Android 真机 FPS；视觉效果仍需要用户确认。

部署与回滚见 [Workbench 流程](docs/workbench-xuan.md)。更新时保留浏览器和 APK 中尚未同步的本地数据。
