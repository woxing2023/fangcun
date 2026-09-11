# 宣纸材质

构建 `20260911-calendar-v3`，发布包版本 `2.7.0-calendar3`。

「宣纸」外观以暖白纤维、墨色文字和玻璃控件组成；「流光玻璃」保留冷色玻璃与宣纸内容面板。手机也保留纸纹、厚度与触摸动态，深色模式使用低亮度纸纹。课程以自身颜色区分，当前选项与主要操作保持清楚的焦点。

## 接入

```html
<section class="xuan-paper">
  <h2>内容标题</h2>
  <p>这里放说明或内容。</p>
  <button type="button" class="secondary-button">查看详情</button>
</section>
```

也可标记 `data-material="xuan"`。宣纸用于非交互内容面板，按钮保持独立的玻璃材质。不要把宣纸标记直接放在按钮、链接或可编辑元素上。光效是不可交互的装饰，不增加焦点，也不改变文字和点击区域。

`xuan.css` 定义面板范围和基础纸面；`mobile-material.css` 定义手机纸纹和玻璃边缘；`calendar-surface.css` 统一承接日历底板、课程颜色与浅投影。日历共享一层底板，空白网格本身不重复铺纹理或厚玻璃。新增内容优先复用现有组件和语义色。

## 纹理与字体

`xuan-fibers.svg` 是现有固定种子的原创纤维纹理。桌面和手机共用由它烘焙的 `xuan-fibers-mobile.png`：720 × 720 像素，按 360 × 360 CSS 像素平铺。保留同一份纤维细节，同时避免滚动时重复计算 SVG 纹理滤镜。两者均是本地资源，可离线使用。

主要变量为 `--xuan-base`、`--xuan-image`、`--xuan-size`、`--xuan-edge` 和 `--xuan-shadow`。手机额外使用 `--mobile-paper-image`。背景与阴影由 CSS 承担，手指移动时的柔和光晕由共享触摸渲染器承担。

正文使用离线 Fangcun UI，日期和品牌使用 Fangcun Display；罕见字回退到系统字体。保留 400/450/550 的文字层次。字体来源与 SIL OFL 许可见 `FONT-LICENSE.txt`。

## 触摸与资源生命周期

`touch-material.js` 将当前触摸表面交给 `liquid-renderer.js`，同一画布在玻璃控件和纸面之间复用。玻璃呈现高光、暗边和波纹，纸面呈现较柔和的光晕。结束交互后停止绘制；滚动、取消手势、页面隐藏或外观变化时清理覆盖层。底板和业务内容始终由正常 DOM/CSS 显示。

减少动态效果和强制颜色设置按用户偏好降级。WebGL 不可用时使用 CSS 触摸反馈，表单和日历仍可操作。具体边界见 [触摸材质](touch-material.md)，全表与清单见 [手机说明](mobile-repair.md)。

## 维护与验证

CSS 层顺序由 `mobile-ui.css` 首先声明，之后依次加载 `mobile-material.css`、`mobile-calendar.css` 及已有样式；层优先级负责新旧材质协调。新增纹理或脚本须同步进入服务端白名单、PWA 缓存和安装包清单。

执行 `npm run check`，再按 [手机说明](mobile-repair.md) 运行浏览器测试。纹理尺寸、图片解码、布局和触摸生命周期检查不替代视觉验收，也不证明 Android 真机帧率。
