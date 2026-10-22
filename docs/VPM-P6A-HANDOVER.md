# P6-A 交接文档（文件收集器、排除规则与取消）

> 写于 **2026-10-22 19:35**。读者：P6-B（备份格式与压缩）的接手人。
>
> 状态：**完成**。

---

## 0. 一页结论

| 项 | 状态 |
|---|---|
| 收集器 API（root / 排除 / 例外 / 进度 / 取消） | ✅ |
| 排除表（Logs/obj/Temp/.git/.atrium-tx/Library） | ✅ |
| `Library/LastSceneManagerSetup.txt` 例外 | ✅ |
| 可选排除 VPM 受管包（保留本地包与两个 manifest） | ✅ |
| 符号链接/junction 不跟随 + warning | ✅ |
| 稳定排序（同输入同输出） | ✅ |
| 上限与截断标记 | ✅ |
| typecheck / 定向测试 | ✅ 14 条 |
| 超大工程压测 / 真 260+ 路径 | ❌ 见 §4 |

---

## 1. 契约

```ts
const result = await collectProjectFiles({
  root,                    // 工程根（绝对路径）
  mode: 'backup' | 'copy',
  excludeVpmPackages?,     // true 时排除 vpm-manifest 受管的 Packages/<id>
  maxFiles?, maxBytes?, maxDepth?,
  signal?,                 // 取消：立刻抛 vpmCollectCancelled
  onProgress?              // { files, bytes, current }
})
```

返回：`files`（`relativePath` 用 POSIX 分隔符、`absolutePath`、`size`）、`directories`、
`fileCount`、`byteCount`、`warnings`、`truncated`、`elapsedMs`。

新错误码：`vpmCollectCancelled`（三语）。

---

## 2. 排除表（完整版在 `src/main/vpm/backup/README.md`）

| 规则 | 范围 |
|---|---|
| `Logs` `obj` `Temp` `.git` `.atrium-tx` | **只在工程根**，大小写不敏感 |
| `.git` | 任意层级 |
| `Library*` | 整棵排除；**只保留** `Library/LastSceneManagerSetup.txt` |
| VPM 受管包 | 可选；`Packages/<id>`，id 来自 `vpm-manifest.json` 的 `dependencies`+`locked` |
| 必须保留 | `Packages/manifest.json`、`Packages/vpm-manifest.json`、`ProjectSettings/ProjectVersion.txt` |
| 隐藏文件 | 保留（`.git` 除外） |

实现细节：`isExcluded()` 是**纯函数**（相对路径 + 父目录深度 + 受管包集合），
单测直接覆盖；`Library` 的例外靠"只放行精确的 `library` 目录 + 它下面那一个文件"实现，
不依赖遍历深度。

---

## 3. 安全与上限

- `lstat` 判定，符号链接/junction/reparse point **不跟随**，记 `symlink` warning。
- 取消在每个目录前检查一次 `signal.aborted`。
- 上限：200k 文件 / 64 GiB / 深度 32 / 路径 260；命中即 `truncated: true` 并停止。
- 权限不足（`EACCES`/`EPERM`）记 `permission` warning 继续——备份不该因为一个文件全失败。
- 排序：`files`/`directories` 都按相对路径升序；压缩包内容因此可复现。

---

## 4. 未验证

1. **超大工程**：没有在 10 万文件级别的真实工程上跑过；上限逻辑只用 `maxFiles: 2` 测过。
2. **长路径**：只做了字符串策略（≥260 记 `longPath`），没有真造 260+ 的路径
   （Windows 需要长路径开关）。
3. **其他 reparse point**：只测了 junction，没测 mount point / OneDrive 占位文件。
4. **性能**：每个条目一次 `lstat`，10 万文件预计几秒；没有实测数字。

---

## 5. 给 P6-B（备份格式与压缩）

- 直接用 `result.files` 的顺序写 zip，**不要再自己遍历**（顺序已稳定）。
- `truncated === true` 必须当失败处理：不能压一个残缺包然后告诉用户"备份好了"。
- 写 zip 时按 `relativePath` 建条目（POSIX 分隔符），不要用绝对路径。
- `warnings` 里 `permission`/`symlink` 建议写进备份清单的 `skipped` 字段，
  让用户知道"这个包少了哪些东西"。
- 压缩过程要支持 `signal`：P6-B 的取消应该同时停收集和压缩。

---

## 6. 环境与坑

| 坑 | 说明 |
|---|---|
| `better-sqlite3` ABI | 构建过 Electron 后跑测试要先 `npm run native:node` |
| junction 测试 | `fs.symlinkSync(target, link, 'junction')` 在 Windows 上不需要管理员权限 |
| 全量测试约 3 分钟 | `tests/perf/scale.spec.ts` 占大头 |
