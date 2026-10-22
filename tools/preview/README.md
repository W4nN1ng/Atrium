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
