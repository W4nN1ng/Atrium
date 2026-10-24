# tools/preview

给 VPM 面板做**离屏截图**的临时预览页（不参与构建、不打包）。

```bash
# 1) 打包预览（只依赖仓库里已有的 esbuild）
npx esbuild tools/preview/preview.tsx --bundle --format=iife --platform=browser \
  --jsx=automatic --loader:.json=json \
  --define:process.env.NODE_ENV='"production"' --outfile=tools/preview/preview.js
# 2) 复用最近一次构建的 CSS（tailwind 产物）
cp "$(ls -t out/renderer/assets/index-*.css | head -1)" tools/preview/app.css
# 3) 用 Electron 离屏截图
env -u ELECTRON_RUN_AS_NODE npx electron tools/preview/shot.cjs
```

产物 `ui.png` 只是本地调试用，不要提交。

## 自验（不点界面也能验）

`verify.tsx` 挂真实的 `VpmProjectsSection`，只把 `window.a.vpm` 换成内存实现；
`verify.cjs` 用 Electron 离屏窗口 + `executeJavaScript` 模拟点击，断言并截图。

```bash
npx esbuild tools/preview/verify.tsx --bundle --format=iife --platform=browser \
  --jsx=automatic --loader:.json=json \
  --define:process.env.NODE_ENV='"production"' --outfile=tools/preview/verify.js
cp "$(ls -t out/renderer/assets/index-*.css | head -1)" tools/preview/app.css
env -u ELECTRON_RUN_AS_NODE npx electron tools/preview/verify.cjs
```

2026-10-23 用它验过：列表显示 3 个工程（含 hasLedger=false 的老工程）、
⋯ 菜单在 body 里（portal 生效）、删除弹窗无勾选框、点确认走 `trash` 而不是 `remove`。
