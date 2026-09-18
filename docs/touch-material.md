# 触摸材质维护

构建 `20260911-calendar-v3`。手机保留可触摸的玻璃与宣纸；当前手势共用一个直接 WebGL 渲染器，不为每个控件建立画布或加载 Three.js 运行层。

## 工作方式

`touch-material.js` 在手势开始时读取当前控件及裁切区域，后续触点采样合并到动画帧，只更新着色器参数。一个对辅助技术隐藏、不可点击的装饰层承载画布，不移动正文、按钮或命中区域，也不接管正常滚动与双指课表缩放。

`liquid-renderer.js` 绘制高光、暗边和最多六个波源，纸面采用较柔和的光晕。相同尺寸不重建画布；内部像素数量有上限。手势结束后光效收尾并停止绘制，滚动或取消手势会清理覆盖层，页面隐藏时停止并释放相关资源。

这是模拟光泽与波传播的装饰着色，不采样底层 DOM，也不声称实现物理背景折射。静态玻璃厚度、纸纹、课程颜色和浅投影由 CSS 保留。

## 降级与诊断

减少动态效果、强制颜色遵循系统偏好。WebGL 不可用或创建失败时保留 CSS 触摸光晕与波纹反馈，业务内容仍由 DOM 呈现。发生上下文丢失时切换到动态光晕与波纹，恢复后重新接入 GPU。控件重绘被移除或所属对话框关闭时，立即清理光层。

`gpu-renderer-smoke.js` 检查画布像素、同尺寸复用、停止绘制、上下文丢失/恢复及释放。现有 `release/qa/touch-shader-report.json` 的后端是 Chromium SwiftShader 软件 GPU；空闲两次采样的 drawCount 相同，说明该次检查已停止继续绘制，计数本身不是性能目标。

`touch-material-smoke.js` 检查实际页面中的触点变化、覆盖范围及正常操作。`touch-lifecycle-smoke.js` 验证连续移动超过两秒、实际 GPU 丢失与恢复、目标移除、滚动、多指取消，以及没有 WebGL 时仍有动态后备反馈。截图、录像与软件 GPU 输出用于功能和视觉复核，不能推导手机 FPS、耗电量或所有机型的流畅度。

## 手机验收

在浅色和深色外观下，按住玻璃按钮并小幅移动手指，查看光泽跟随和松手后的收尾；再在宣纸面板上查看较柔和的光晕。随后正常滚动列表，确认装饰不会残留或挡住内容。

打开课程表，检查彩色课程与宣纸底板，再用“全表”“清单”及横竖屏查看全部安排。切到后台再返回，确认交互仍可继续。验收不需要清除站点数据或卸载 APK。
# Material specification: 2026-09-15-lab-align-v1

This document is the human-readable contract for the shared optical renderer. It is a visual approximation of the lab reference, not a claim of per-pixel physical equivalence.

## Frozen motion and profile contract

The renderer owns the only runtime copy of these seven motion values:

| value | frozen value |
| --- | ---: |
| `rippleStrength` | `0.74` |
| `trailStrength` | `0.10` |
| `trailDecay` | `0.76` |
| `edgeStrength` | `2` |
| `edgeSizeInfluence` | `0.89` |
| `edgeSpread` | `0.17` |
| `edgeSpeedResponse` | `1.5` |

For `shortEdge = min(width, height)`, `t = clamp((shortEdge - 32) / 148, 0, 1)`, and `blend = t*t*(3-2*t)`:

- `amplitude = 0.14 + 0.86*blend`
- `radius = clamp(shortEdge*0.12, 4, 10)`
- `damping = 0.976 + 0.011*blend`
- `edgeAbsorption = 0.48 - 0.26*blend`

The required profile samples are 32px: `0.14 / 4 / 0.976 / 0.48`, 44px: `0.15604445936074865 / 5.28 / 0.9762052198290329 / 0.4751493494955876`, 80px: `0.3527036898110675 / 9.6 / 0.9787206285906066 / 0.4156942333129331`, and 180px: `1 / 10 / 0.987 / 0.22`.

`LIQUID_ENERGY_EPSILON` is `0.00001`. One shared canvas/context serves the active surface, with at most six wave sources and an internal pixel budget of `1,400,000`. Desktop Liquid uses one lens/canvas host; schedule touch uses one touch layer/canvas. The canvas is decorative and never owns application content or hit testing.

When WebGL is unavailable, CSS feedback remains the fallback: glass glow opacity `.28`, paper glow opacity `.12`, and a 160ms ring from scale `.85` to `1.35` followed by opacity `0`. GPU success cancels and hides the fallback. Reduced motion, forced colors, hidden pages, scroll, cancellation, and context loss release the renderer/layer; these checks prove lifecycle behavior, not Android FPS.
