# src/main/vpm/unity

## 职责（一句话）

只读发现 Unity 编辑器安装（`editors.ts`）、**新建工程**（`create.ts`，P5-B）、
**unitypackage 解包与模板附件**（`unitypackage.ts`，P5-C）。

## 不负责什么

- 不启动 Unity、不安装 Unity、不调用 Hub 无头进程。
- 不写 Hub/Unity 配置。
- `create.ts` 只写**最小骨架**（`Assets/`、`Packages/`、`ProjectSettings/ProjectVersion.txt`、
  初始 `vpm-manifest.json`），不写 `ProjectSettings.asset`、不写任何 `.meta`、不生成场景/材质/脚本。
- 不做工程版本匹配/启动（P5-D）和版本迁移（P6-C）。
- 不把原始 JSON、数据库行或绝对路径以外的信息交给渲染层。

## 公开 API

只从 `index.ts` 导出：

- `discoverUnityEditors(options?)`：同步只读发现，返回 `{ installs, warnings }`。
- `parseHubEditorRecords(value)` / `parseInstallRoots(value)`：Hub JSON 的防御式纯解析。
- `parseUnityVersion(value)` / `parseUnityArch(value)`：版本/架构归一。
- `UnityInstallStore`：`vpm_unity_install` 的唯一 SQL 入口；`list/getByPath/merge/addManual`。
- `UnityEditorService`：`list/refresh/addManual`，把发现结果合并进仓储。
- `listUnityInstalls(db)`：只读便捷函数。
- `ProjectCreateService`（`create.ts`）：`validate(input)` 只读校验 + `create(input)` 建工程。
- 类型：`UnityInstall`、`UnityDiscoveryOptions`、`UnityManualInput` 等。

## 发现来源与优先级

1. `%APPDATA%\UnityHub\editors-v2.json`、`editors.json`（Hub 记录，`source=hub`）。
2. `secondaryInstallPath.json`、`settings.json` 里的自定义安装根（只取绝对路径）。
3. 默认根：`%ProgramFiles%\Unity\Hub\Editor`、`%ProgramFiles(x86)%\Unity\Hub\Editor`、
   `%LOCALAPPDATA%\Unity\Hub\Editor`（目录扫描，`source=scan`）。
4. 手动添加（`source=manual`，优先保留用户版本/架构覆盖）。

同一路径按 Windows 规则（大小写不敏感、realpath 可用时用 realpath）去重。同一版本装在不同
路径是两条独立记录；同一 exe 不会产生两条。未在本轮发现中的记录只标 `missing=1`，不删除。

## 版本 / 架构

- 版本优先 Hub 记录，其次路径中的 `YYYY.MINOR.PATCH[abfp]N[cN]`。
- 不能识别时保留 `version=null`，DTO `versionUnknown=true`；手动添加默认要求填写版本，
  否则返回 `vpmUnityVersionUnknown`。
- 架构来自 Hub 记录或路径；未知时数据库存 null，DTO 按 `x86_64` 显示并标记
  `archInferred=true`。绝不启动 Unity 询问。

## 失败模式

- 路径不存在 → `vpmUnityNotFound`（发现时只记 warning + missing）。
- 不是 `Unity.exe`/不是普通文件/符号链接 → `vpmUnityInvalid`。
- 无权限 → `vpmUnityAccessDenied`。
- 手动添加无法确定版本 → `vpmUnityVersionUnknown`。
- 坏 Hub JSON/超限 JSON → warning，不中断其他来源；单个文件坏不会让整个发现失败。

## 数据

- `vpm_unity_install`：路径、版本、版本+revision、source、arch、last_seen、missing。
- v2 迁移同时建立 P2-C 使用的 `vpm_project` / `vpm_project_package` 缓存表；
  本模块不写工程表。

## 测试入口

- `tests/vpm/unity/editors.spec.ts`（Hub 解析、扫描、去重、缺失、手动、v2 迁移）
- `tests/vpm/db/migrate.spec.ts`（v1→v2 备份/幂等/必需表）
- 运行：`npm test`（先切 Node ABI）

## 谁依赖我 / 我依赖谁

- 被 VPM 组合根（`src/main/vpm/index.ts`）组装；P2-C/P5-D 通过公开 API 使用。
- 依赖：`node:fs`、`node:path`、`node:crypto`、`shared/vpm/domain/version`、`db`、`VpmError`。
- 不依赖渲染层、Electron、网络。

## 新建工程（`create.ts`，P5-B）

```ts
const validation = runtime.create.validate({ parentDir, name, unityVersion, templateId })
// ok=false 时 issues 里是机器码：parentMissing / nameIllegal / targetExists / longPath / noSpace …
await runtime.create.create({ parentDir, name, unityVersion, templateId })
```

流程：

1. **只读校验**：父目录存在/是目录/非符号链接/可写、不在已有 Unity 工程内、不在禁用根里
   （数据根、应用目录）；名称按 Windows 规则（非法字符、保留名、结尾点/空格、≤80）；
   最终路径必须不存在（**空目录也算存在**）、长度 <260；空间 ≥ 估算×1.2 + 512 MiB；
   Unity 版本必须在已安装列表里（没探测到编辑器时只警告"未验证"）。
2. 在父目录建隐藏临时目录 `.atrium-create-<op>`，写骨架与初始 manifest。
3. 同卷 `rename` 成最终目录（目标已存在则失败）。
4. `projects.addExisting()` 入核心表 + VPM 台账；`templates.markUsed` + `recordLocation(父目录)`。
5. 用 P3/P4 正常计划 + 事务装模板依赖；**失败保留工程**（骨架 + manifest），返回
   `dependencyStatus='failed'`，可在列表里重试。
6. 第 5 步之前失败：临时目录移到回滚仓 `create-failed/`；回滚仓不可用时退到父目录旁的
   `.atrium-create-failed-<op>`。**任何情况下都不永久删除。**

模板附件（`unitypackages`）在 P5-C 之前没有实现：没有注入 `TemplateAttachmentPort` 时，
带附件的模板会在校验阶段被拒（`attachmentsUnsupported`）。

## unitypackage 解包（`unitypackage.ts`，P5-C）

```ts
await extractUnityPackage({ packagePath, projectPath, onConflict: 'reject' })
```

- `.unitypackage` 是 **tar.gz**，每条记录是一个 GUID 目录：`pathname` / `asset` /
  `asset.meta` / `preview.png`。
- 只接受 `<32位guid>/<白名单文件名>`，白名单就是上面四个；符号链接/硬链接/设备文件一律跳过。
- **只搬 `asset` 与 `asset.meta`，绝不生成/补写 `.meta`**：包内没有 `asset.meta` 时只复制
  asset 并给 `missingMeta` 警告（让 Unity 自己生成）。
- 两段式：先解到 `<project>/Temp/atrium-unitypackage-*` → 校验全部路径与冲突 →
  再搬进 `Assets/`。所以**冲突/逃逸/超限时工程里一个字节都没动**。
- 冲突策略：`reject`（默认，整体中止）/ `skip`（跳过该文件）。
- 限额：条目数 100k、总字节 2 GiB（超限不写盘，解完再报 `vpmUnityPackageTooLarge`）。
- 中途 IO 失败：回滚本次已搬的文件与本次建的空目录，抛 `vpmUnityPackageFailed`。

`createTemplateAttachmentPort({ templates })` 是给 P5-B 的 `TemplateAttachmentPort` 实现：
逐个解模板 `files/` 下的附件，任何一个失败都抛错（P5-B 会归档整个临时工程）。

纯解析（路径归一/去重/计划）在 `src/shared/vpm/domain/unitypackage.ts`。
