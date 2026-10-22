# src/main/vpm/backup

## 职责

备份/复制共用的**文件树收集**（P6-A）。只读目录，输出稳定有序的清单；
压缩（P6-B）、复制/迁移（P6-C）、UI（P6-D）都不在这里。

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
