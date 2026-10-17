# Unity 自动连接验收记录

日期：2026-10-16。基线：`c606d0d`。实现分支：`codex/unity-auto-connect`，应用版本：v0.6.0。

## 完成范围

- 自动发现运行中的 Unity 2022.3 工程，包括未登记在 VCC 或扫描目录中的工程；仅为运行中的安全用户工程安装缺失插件。
- 已有插件直接复用，以真实心跳判定连接就绪；失败可重试，主动卸载的工程不会立即重装。
- 单工程自动确定导入目标；多工程沿用明确选择，否则在导入入口选择一次。打开工程本身不导入。
- 连接等待可取消，固定工程 ID 和路径；单包、成员及多卡后续批次保持原目标。关闭面板后，旧列表、计划及提交结果不会覆盖新任务；晚到的未提交计划会退回副本。
- 正常流程取消安装询问，向导展示连接状态，高级选项保留重试和停用。
- 保留导入确认、冲突、备份和撤回语义；封面服务、封面编辑器及 Unity 渲染资源没有改动。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| 最终 `npm run build` 中完整测试 | **1996 通过、31 条件跳过**；143 个文件通过、10 个文件条件跳过 |
| Electron Vite 构建与 worker 依赖检查 | 通过 |
| NSIS 安装版与便携版构建 | 通过 |
| `node tools/pkg-version.cjs` | v0.6.0、MIT 和依赖闭包与源码一致，产物不早于源码 |
| `node tools/verify-unity-connection-ui.cjs` | 8 项真实 React／Electron 受控界面场景通过 |
| `node tools/verify-unity-auto-connect.cjs` | 最终编译代码的首次运行及应用重启两轮真实 Unity 验收通过 |

完整构建使用 `VITEST_MAX_FORKS=2`、`VITEST_MIN_FORKS=1`，保留全部测试和原有阈值。安装工具经镜像取得，electron-builder 仍验证其固定 SHA-512。31 项跳过包括需要显式提供的真实素材／数据库与可选工具环境，不计为通过。

## 真实 Unity 证据

使用 Unity **2022.3.22f1**，创建独立空工程、独立应用目录和合成 unitypackage。进程探测执行真实 Windows CIM 查询，仅在验收工具的外部边界过滤为本次自建工程；没有将其他已打开工程送入自动安装。主进程、preload、React、SQLite、桥接安装、Unity 心跳和资源导入均使用真实实现。

两轮均验证：未在 VCC 清单中登记的运行工程被发现；取消准备不会导入；等待真实 Unity 就绪后确定原目标；关闭 Unity 后目标清除。首次通过真实界面按钮导入一个文本资源，Unity 落盘内容及数据库记录均核对成功。

首次运行和重启后，累计均为 **1 次桥接安装、1 次素材导入**。重启未重复安装或导入，桥接源码 SHA-256 在两轮保持相同。

复现入口：

```powershell
$env:ATRIUM_AUTO_CONNECT_EDITOR = '本机 Unity 2022.3 的 Unity.exe 完整路径'
node tools/verify-unity-auto-connect.cjs
node tools/verify-unity-connection-ui.cjs
```

详细输出保存在忽略目录 `tmp/unity-auto-connect/`，最终构建为 `build-delivery.log`，真实验收为 `live-delivery.log` 与 `live-result.json`，界面验收为 `ui-delivery.log`。截图及测试数据库也仅保存在隔离目录。

## 回归与限制

本轮回归先复现失败，再修复慢 WMI 轮询饥饿、设置变化复活旧数据库运行标志、界面工程元数据陈旧、PowerShell 中文路径乱码，以及关闭／重开面板后的晚到结果覆盖。成员规划时重载列表、列表加载时开始规划也已互斥。

多工程选择、Play／编译忙碌队列、超时、停用和跨目标取消等由控制器、IPC、FakeUnity 及受控 React 场景验证。本轮真实编辑器验收为单个空工程的首次／重启流程，没有同时打开两个真实编辑器，也没有以真实角色场景测试 Play。没有使用用户素材库作为验收数据。

## 本机交付

安装程序 `/S` 返回 0；`node tools/installed-version.cjs --expect=0.6.0` 返回 0，卸载注册表的 `DisplayVersion` 为 **0.6.0**。安装位置为当前用户的 `%LOCALAPPDATA%\Programs\Atrium`；已安装 `resources/app.asar` 与最终 `dist/win-unpacked/resources/app.asar` 的 SHA-256 相同。桌面 `Atrium` 快捷方式指向安装后的 `Atrium.exe`。

首次静默安装在旧版 electron-builder 24.13.3 的新用户目录探测阶段触发 `System.dll / 0xc0000005 / 0x1581`，与[上游问题 #8536](https://github.com/electron-userland/electron-builder/issues/8536)及[修复 #9564](https://github.com/electron-userland/electron-builder/pull/9564)的路径一致。本机预先配置该应用私有注册表键中的安装目录后，使用同一安装包成功安装；没有手工写入卸载版本或替换安装文件。本轮未升级打包依赖，因此其他机器首次安装遇到此打包器问题的可能性仍保留。安装过程和文件哈希记录在忽略目录的 `preinstall-path-workaround.json`、`installed-version.log` 与 `installation.json`。

PR、最终提交及合并状态以 GitHub 记录为准；本轮不创建新的 GitHub Release。
