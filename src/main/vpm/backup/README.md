# src/main/vpm/backup

## 职责

- **文件树收集**（P6-A，`collector.ts`）：只读遍历、排除规则、取消、稳定排序。
- **ZIP 写入/校验/解压**（P6-B，`zip.ts`）：store/fast/normal 三档真压缩、`.part` 原子写、
  yauzl 读回校验、解压路径安全。
- **备份服务**（P6-B，`service.ts`）：拿维护租约 → 收集 → 写 zip → sha256 → 读回验证 →
  写 `vpm_backup`；从备份新建（目标必须不存在）。

- **复制工程**（P6-C，`copy.ts`）：复用收集器，先复制到 `.atrium-copy-<op>` 再 rename。

迁移、UI（P6-D）不在这里。

## 不负责什么

- 不压缩、不复制、不写工程、不删任何文件。
- 不读文件内容（压缩时才流式读）。
- 不判断"哪些包该装"（那是解析器的事）。

## 公开 API

```ts
collectProjectFiles({ root, mode, excludeVpmPackages?, maxFiles?, maxBytes?, maxDepth?,
                      signal?, onProgress? }): Promise<CollectResult>
isExcluded(relativePath, depth, managedPackages): boolean   // 纯函数，单测直接用
readManagedPackages(root): Promise<Set<string>>             // 读 Packages/vpm-manifest.json
```

`CollectResult`：`files`（相对/绝对路径 + 大小）、`directories`、`fileCount`、`byteCount`、
`warnings`、`truncated`、`elapsedMs`。

## 排除规则（`docs/prompts/VPM-P6.md` §5）

| 规则 | 说明 |
|---|---|
| 根目录 `Logs` / `obj` / `Temp` / `.git` / `.atrium-tx` | 大小写不敏感，**只在工程根**生效 |
| 任意层级 `.git` | 任何位置都排除 |
| `Library*` | 整棵排除（`Library`、`Library2022`…），**只保留** `Library/LastSceneManagerSetup.txt` |
| VPM 受管包 | `excludeVpmPackages: true` 时排除 `Packages/<id>`，id 来自 `vpm-manifest.json` 的 `dependencies` + `locked`；**未知/本地包保留** |
| 必须保留 | `Packages/manifest.json`、`Packages/vpm-manifest.json`、`ProjectSettings/ProjectVersion.txt`（任何规则都不能排除） |
| 隐藏文件 | 保留（`.git` 除外） |

## 安全与限制

- **不跟随符号链接/junction/reparse point**：`lstat` 判定后记 `symlink` warning 并跳过。
- **取消**：`signal.aborted` → 立刻抛 `vpmCollectCancelled`，不再遍历。
- **上限**：文件数 200k、总字节 64 GiB、深度 32、单路径 260。命中即 `truncated: true`
  并停止——**调用方必须当失败/需要用户确认**，不能当成"收集成功但少几个文件"。
- **权限**：读不到记 `permission` warning 继续（备份不该因为一个文件就全失败）；
  调用方可以按模式决定是否升级为错误。
- **排序**：`files` / `directories` 都按相对路径排序，同样输入必然同样输出
  （压缩包内容可复现、测试可断言）。
- **只读**：收集过程不修改任何源文件。

## 测试

`tests/vpm/backup/collector.spec.ts`（14 条）：排除表（根级/任意层级/Library 前缀与例外/
受管包/必须保留）、真实目录收集、受管包排除、坏 manifest、junction 不跟随、
取消、稳定排序、截断、进度、缺根拒绝。

## 谁依赖我

- P6-B（压缩）、P6-C（复制/迁移）会调用 `collectProjectFiles`；
- 渲染层不直接用它。

## 备份（`service.ts`，P6-B）

```ts
const record = await runtime.backup.create({ projectKey, compression: 'normal', excludeVpmPackages? })
await runtime.backup.restore({ backupId: record.id, targetDir, installPackages? })
runtime.backup.list(projectKey?)
runtime.backup.reveal(record.id)
```

- **先拿 P4-F 维护租约**（`kind='backup'`）：素材导入/装包进行中直接拒绝，避免备份到半成品。
- Unity 运行中默认拒绝；调用方确认后传 `allowUnityRunning: true`。
- 默认目标 `<dataRoot>/backups/<projectSlug>/<工程名>-<yyyyMMdd-HHmmss>.zip`（冲突加 `-2`）。
- 写 `<target>.part` → 成功才 rename；取消/失败删 `.part`，**不留半成品**。
- 写完 `hashFile`（sha256）+ `readZipEntries` 读一遍，读不了算失败。
- 记录写 `vpm_backup`（vpm.db **v5**）：状态 `running/ok/failed/cancelled` + `error_code`。
- 从备份新建：目标目录**必须不存在**（`vpmBackupConflict`）；解压拒绝路径逃逸/符号链接；
  可选 `installPackages` 走同一条计划 + 事务补装依赖。

## ZIP（`zip.ts`）

- `store` = 不压缩、`fast` = zlib 1、`normal` = zlib 6（yazl 的 `compressionLevel`，**真三档**）。
- 条目路径必须 `/` 分隔、相对工程根；保留空 `Assets/` 目录。
- `safeZipPath()`：拒绝绝对路径/盘符/`..`/反斜杠/控制字符/超长。

## 复制工程（`copy.ts`，P6-C）

- 目标必须不存在；目标不能在源工程内（防递归）；Unity 运行中拒绝。
- 拿 `copy` 维护租约；复用 `collectProjectFiles`（同一套排除规则）。
- 先复制到 `<parent>/.atrium-copy-<op>`，成功才 rename；失败改名成
  `.atrium-copy-failed-<op>` **保留现场**，不永久删。
- 取消：`vpmCollectCancelled`，目标目录不会出现。
