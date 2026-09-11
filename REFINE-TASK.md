# 方寸「高级灰柔和重塑」第二轮精修任务书

## 背景
- 仓库 /data/xuetianren/fangcun-styling 是方寸 v2.7.0 的完整代码（classic 冷调高级灰已上线：--bg #d6d6d7、卡片下陷 neumorphic、按钮全灰阶、顶栏专注中/空闲实时时钟）。
- 本轮 = 对照新的目标效果图（target-refined.png，1536x1024）做**像素级精修**，把现有实现推向与效果图一致。current-render.png 是当前实现的实际渲染（同视口 1536x1024）。
- 目标效果图的规格（已逐区域采样确认）：
  1. **页面背景是垂直渐变**：顶部 #e6e2dd（暖灰米），向右下加深至 #acabaa（中灰）——不是现在的平铺 #d6d6d7。渐变要柔和、无 banding。
  2. **顶栏（header bar）是浅色卡片调**（#e4dfdc 级别，与侧栏同调），不再与页面背景同色；保持现有圆角与阴影语言。
  3. 侧栏面板 #e4e0dc、内容卡片 #e5e2e0 级别（当前已接近，微调即可）。
  4. 保留：低饱和高级灰 token、neumorphic 双影（亮上暗下）、按钮全灰阶无绿、顶栏专注中/空闲时钟、圆角语言。
- 不改动：liquid 皮肤（liquid.css/liquid-renderer.js）、业务逻辑、service-worker 缓存名可不动。

## 铁律
- 只改 classic 皮肤相关的样式文件（styles.css / appearance.css / v22-layout.css 中的 classic 部分），必要时 app.js 里的纯样式逻辑。
- **不要 commit**，改完跑 `npm run check`，全绿即算完成。
- 完成后输出一段总结：改了哪些文件、关键值（渐变端点色、header 底色）。
