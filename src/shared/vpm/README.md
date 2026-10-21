# src/shared/vpm

## 职责

VPM 的纯类型、错误码、路径校验和（P1 起）纯领域逻辑。这里决定"业务规则是什么"，
不决定数据从哪来、往哪写。

## 不负责什么

- 不发网络、不读文件、不连数据库、不 import Electron。
- 不返回用户可见文案；错误码到文案的映射在渲染层 i18n。
- 不持有状态；解析器/校验器都是可重复调用的纯函数。

## 公开 API

当前（P0）：

- `types.ts`：设置文件、状态、IPC DTO、数据根校验上下文。
- `errors.ts`：`VpmError`、错误码/警告码清单、i18n key 生成。
- `dataRoot.ts`：`validateVpmDataRoot`、`normalizeVpmDataRoot`、`isSameOrInside`。
  **例外**：这个 P0 文件用 `node:path` 做 Windows 路径校验，只给主进程用；
  渲染进程不得静态引用它。

P1 起（见 `docs/VPM-ARCHITECTURE.md` §4）：

- `domain/version.ts`：P1-D 的最小 SemVer 比较（P3-A 会补严格解析/范围）。
- `domain/repo.ts`：仓库 JSON 解析/归一、包名/版本/URL/hash 防御、headers 剥离。
- 后续：`domain/range|unityVersion|packageId|manifest|project|template|plan|resolver|unitypackage`
- `dto/`：IPC 请求/响应形状，不包含数据库行。

## 数据 / 写入

不拥有任何持久化数据。纯函数只读输入、返回新对象；不修改调用方传入的对象。

## 失败模式

- 输入非法/超长/不支持的范围写法 → 返回明确错误码，不抛未捕获异常。
- manifest 未知字段必须保留；解析失败给 `vpmManifest*` 类错误码。
- 错误码新增时必须同步 `errors.ts` 和三份 i18n。

## 测试入口

- `tests/vpm/data-root.spec.ts`、`tests/vpm/errors-i18n.spec.ts`
- `tests/vpm/domain/repo.spec.ts`、`tests/vpm/domain/version.spec.ts`
- 运行：`npm test`（会先切到 Node ABI）

## 谁依赖我 / 我依赖谁

- 被 `src/main/vpm/**` 使用；渲染进程只允许引用 `types.ts` / `errors.ts`。
- 依赖：TypeScript 标准能力；`dataRoot.ts` 额外依赖 `node:path`（仅此例外）。
- 不依赖 `src/main/**`、`src/renderer/**`、Electron、SQLite。
