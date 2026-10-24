# P5-C 交接文档（unitypackage 读取与模板附件）

> 写于 **2026-10-22 18:50**。读者：P5-D（启动 Unity / 工程与模板 UI）的接手人。
>
> 状态：**完成**。缺口只有"真 Unity 看一眼导入结果"（需要 GUI，P5-D 一并做）。

---

## 0. 一页结论

| 项 | 状态 |
|---|---|
| unitypackage（tar.gz）解析：pathname / asset / asset.meta / preview | ✅ |
| 路径安全（逃逸 / 绝对路径 / 盘符 / `..` / 保留名 / 260） | ✅ |
| 只搬 `asset` + `asset.meta`，**绝不生成/补写 `.meta`** | ✅（有源码守卫测试） |
| 缺 meta → 只复制 asset + 警告 | ✅ |
| 冲突策略（reject / skip） | ✅ |
| 两段式落盘（失败不留半套） | ✅ |
| 条目/字节限额 | ✅ |
| 模板附件端口接进 P5-B 建工程 | ✅ |
| 真 Unity 识别导入资源 | ❌ 需要 GUI（P5-D） |

---

## 1. 契约变化

| 变化 | 说明 |
|---|---|
| `shared/vpm/domain/unitypackage.ts` | **新增**：`normalizeUnityPathname` / `planUnityPackage` / `isValidGuid` |
| `main/vpm/unity/unitypackage.ts` | **新增**：`extractUnityPackage` / `createTemplateAttachmentPort` |
| 新错误码 | `vpmUnityPackageInvalid` / `Unsafe` / `Conflict` / `TooLarge` / `Failed`（三语） |
| `initVpm` | 自动把附件端口注入 `ProjectCreateService`（带附件的模板现在能直接建工程） |

---

## 2. 格式与规则

```text
<guid>/pathname      → Assets/...（目标路径）
<guid>/asset         → 文件内容
<guid>/asset.meta    → Unity 的 meta（原样搬运）
<guid>/preview.png   → 忽略
```

- 只接受 `<32 位 hex guid>/<白名单文件名>`；白名单就这四个。其他条目直接跳过。
- `pathname` 必须在 `Assets/` 下：
  - 拒绝：绝对路径、盘符、`..`、反斜杠、空段、控制字符、Windows 保留名
    （CON/PRN/AUX/NUL/COM1-9/LPT1-9）、结尾点或空格、长度 ≥260；
  - `assets/` 会被归一成 `Assets/`；`Packages/...` 之类一律拒绝。
- 同一目标（大小写不敏感）只保留第一条，其余标 `duplicatePath`。
- 缺 `asset.meta`：只复制 asset，返回 `missingMeta` 警告，**不补写 meta**。

---

## 3. 落盘模型（为什么失败不会留半套）

```text
tar.x → <project>/Temp/atrium-unitypackage-<rand>/
  ↓ 读 pathname，生成计划（planUnityPackage）
  ↓ 全部目标做冲突检查（存在即 reject 整体中止 / skip 单个）
  ↓ 才开始 rename 进 Assets/（同卷，原子）
  ↓ 任何 IO 失败：删掉本次搬的文件 + 本次建的空目录
  ↓ finally：删临时目录
```

- 冲突、逃逸、超限都发生在"搬入"之前，所以工程里**一个字节都没动**。
- 超限不会在 tar 的 `filter` 里抛错（那样 promise 会悬着），而是标记后继续跳过，
  解完再抛 `vpmUnityPackageTooLarge`。
- 目标已存在**从不覆盖**：`reject` 是默认，`skip` 只跳过那一个。

---

## 4. 模板附件

```ts
const port = createTemplateAttachmentPort({ templates })
await port.apply({ projectPath, templateId, attachments })
```

- 逐个解模板 `files/` 下的 unitypackage 到 `projectPath/Assets/`。
- 附件路径先做 `inside(filesDir, absolute)` 检查（防 `files/../x`），再解包。
- 任何一个失败都抛错 → P5-B 会把整个临时工程归档到 `create-failed/`，不留半套。

---

## 5. 证据

```
npm run typecheck                                     → exit 0
npx vitest run tests/vpm/domain/unitypackage.spec.ts  → 7 passed
npx vitest run tests/vpm/unity/unitypackage.spec.ts   → 10 passed
```

覆盖：

- 路径归一：14 种输入（含 `assets/` 归一、行尾换行、13 种拒绝）。
- 计划：排序、缺 meta、无效 guid、无 pathname、无 asset、逃逸 detail、大小写重复。
- 真实 tar.gz（`tar.c` 现造，不用任何第三方 unitypackage 资产）：
  - asset/meta **字节级一致**（含二进制 `0x00/0xff`）、preview 不落盘、嵌套目录创建；
  - 缺 meta 不生成 `.meta`；
  - 冲突整体拒绝（同包的另一个文件也没写）、`skip` 只跳一个、原文件未改；
  - `../evil` 与 `/abs/evil` 被拒且没落到工程外；
  - 非 tar 文件 → `vpmUnityPackageInvalid`；`maxEntries: 1` → `vpmUnityPackageTooLarge`；
  - 源码守卫：`unitypackage.ts` / `create.ts` 里没有 `writeFile*(...'.meta')`。
- 附件端口：正常解包、`files/../` 逃逸被拒。

---

## 6. 未验证

1. **真 Unity 识别导入的资源**：本工作站不启动 GUI。要确认的就是"搬进去的 `.meta` 被 Unity
   当作同一份资产"——理论上必然（字节原样），但没有真机证据。
2. **符号链接条目**：只在 `filter` 层按 `entry.type` 拒绝，没有构造真实的符号链接包
   （Windows 建链接需要权限/开发者模式）。
3. **超大包**：限额逻辑有测试（小包 + 极小限额），但没有用 2 GiB 真实包压过。
4. **跨卷**：临时目录放在工程内（同卷），所以 `rename` 不会跨设备；没测过工程在
   网络盘/可移动盘上的行为。

---

## 7. 给 P5-D

- 启动 Unity 前记得拿 P4-F 的维护租约（`acquireMaintenance(path,'unity-version')` 或
  `'create-project'`，按动作选）。
- `extractUnityPackage` 可以直接用于"把 unitypackage 导进已有工程"（不只是建工程时）：
  传 `onConflict: 'skip'` 就能做"有就跳过"的导入。
- 真机验证时重点看两件事：
  1. 带附件的模板建出来的工程，Unity 打开后资源在 `Assets/` 下且没有重复导入；
  2. `ProjectSettings/ProjectVersion.txt` 的版本与 Hub 里选的一致。

---

## 8. 环境与坑

| 坑 | 说明 |
|---|---|
| `better-sqlite3` ABI | 构建过 Electron 后跑测试要先 `npm run native:node` |
| tar 的 `filter` 不能抛错 | 抛了 promise 会悬着（测试超时 30s 才发现），要标记后继续跳过 |
| `entry.type` 在类型上是 number | 用 `String(entry.type)` 再比 `'File'`/`'Directory'` |
| 全量测试约 3.3 分钟 | `tests/perf/scale.spec.ts` 占 160s；`classify/unitypackage` 的 perf 用例偶发红，单独跑必过 |
