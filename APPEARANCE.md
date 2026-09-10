# 方寸外观维护

所有皮肤共用 `index.html`、`app.js` 和响应式布局。默认 `classic`；`liquid` 为项目 Liquid Glass 风格。不要复制页面、添加按皮肤分支的业务逻辑或搬入另一套 React 应用。

## 文件职责

- `styles.css` / `v22-layout.css`：业务组件和响应式布局。
- `appearance.css`：最后加载的共享控件契约、皮肤 token、材质和无障碍降级，不改变页面结构。
- `appearance.js`：首屏偏好读取、外观设置、装饰交互与渲染器生命周期。`fangcun-skin` 和原有 `fangcun-theme` 仅存当前浏览器，不写入同步数据。
- `liquid-renderer.js`：按需加载的 Three.js ShaderMaterial 水纹层，单个共享 WebGL2 上下文，最多八个波源，像素比上限 1.5，交互结束停止绘制。
- `three.module.min.js` / `three.core.min.js`：从本项目现有依赖复制的 Three.js 0.185.1；许可证 `THREE-LICENSE.txt`。无 CDN、无需 React，也不修改 liquid-glass 中已有工作。

## 新功能如何自动适配

1. 内容使用 `--bg`、`--surface`、`--card`、`--ink`、`--muted`、`--line`；操作使用 `--accent`、`--accent-soft`，实色主按钮使用 `--action-fill` / `--action-ink`。错误、警告、信息使用 `--q1` 等语义颜色；不要将业务颜色重新解释为皮肤颜色。
2. 表单复用 `.field`、`.form-grid`、`.switch-label`；操作复用 `.primary-button`、`.secondary-button`；密集内容保持纸感。新功能无需分别实现皮肤。
3. 标准操作按钮、summary、表单包装层和 `.skin-option` 自动接入液态交互。日历网格、课程内容、小日期格与完成圆钮使用纸感反馈，不创建水纹层，不改变控件圆角。自定义 DOM、框架挂载节点可标记 `data-material="glass"`；`data-material="paper"` 或 `"none"` 阻止后代创建动效层。为非按钮交互控件自行提供正确的语义和键盘操作。
4. 材质效果只叠加不可交互、对辅助技术隐藏的图层。不要对文字应用 WebGL 变形，不依赖 canvas 呈现业务内容。
5. 新增组件类别若需要新的视觉角色，先在共享层定义 token 和样式，再补齐各皮肤 token。所谓自动同步不意味着允许任意硬编码颜色也能自动适配。

## 接入 Three.js 或其他渲染器

默认已使用 Three.js 绘制水纹、高光与波传播，CSS 提供透明材质与水痕。动效在装饰层内进行，不改动实际控件的圆角与几何。它是装饰性水面着色，不是对底层 DOM 的真实光学折射。

在 DOMContentLoaded 后，可以注册其他材质渲染器：

```js
window.FangcunAppearance.registerRenderer(() => ({
  mount(container, rect) { /* 将装饰 canvas 放入 container，按 rect 定尺寸 */ },
  move(x, y) { /* 指针位置，0..1 */ },
  pulse(x, y, strength) { /* 涟漪/水痕 */ },
  unmount() { /* 停止帧循环，移除 canvas，保留可复用资源 */ },
  dispose() { /* 幂等释放几何体、材质、纹理及 GPU 上下文 */ }
}));
```

只保留一个活跃表面；切换控件时复用 renderer。切换皮肤、减少动态效果、页面隐藏或离开时释放 GPU 资源。WebGL2 不可用或加载失败仍保留 CSS 反馈。减少动态效果时不创建动效图层；不支持背景模糊时使用不透明表面；强制颜色模式保留原生选择器和焦点。

## 验证与交付

`npm run check` 为已有回归。真实浏览器验证：

```sh
FANGCUN_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node appearance-browser-smoke.js
```

可用 `FANGCUN_SCREENSHOT_DIR=/absolute/output/path` 保存各模式的页面和弹窗截图。覆盖两种皮肤 × 两种深浅模式 × 桌面/手机、刷新持久化、日历选中状态、任务/项目/学期/校历/提醒弹窗、数据中心页签、表单几何、减少动态和 GPU 清理。Android WebView 仍需真机确认 GPU 性能与原生选择器行为。

## 共享材质覆盖

- 玻璃操作层：导航、日历工具栏及缩放、分段控件、日期条、快捷操作、创建面板、后台操作按钮和文件选择按钮，使用 `--chrome`、`--material-blur`、`--material-shadow`。
- 纸感内容层：今日面板、任务/课程/项目卡片、提醒、导入预览、月历及后台，使用内容 tokens 和 `--paper-shadow`。手机密集内容取消额外阴影。
- 所有深色实心选中状态统一 `--action-fill` / `--action-ink`；象限选项用语义边线表达选择。项目和课程的标识颜色用于色条，文字保持 `--ink`，避免任意分类色造成不可读文字。
- `.smart-field`、`.time-slot-row`、订阅地址和文件控件也属于共享表单契约；不要只适配 `.field`。
- 隐私页复用配色但保持文档滚动，不继承移动应用的固定视口布局。

外观资源当前使用 `?v=2`。更新时同步修改 index、privacy 和 service worker 的 URL，并递增缓存名称；缓存版本和应用业务版本分别管理。

增加资源后同步维护服务器静态白名单、service worker 预缓存、Linux 安装脚本和 PowerShell 打包列表。Android 壳加载网站，无需复制业务界面。发布必须另行获得授权。
