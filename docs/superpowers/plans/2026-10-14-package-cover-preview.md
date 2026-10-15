# Package Cover Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Generate and explicitly save real model covers from unimported ZIP / unitypackage sources.

**Architecture:** A bounded source preparer copies render resources into an owned preview project. A single owned Unity worker uses the existing bridge and renderer. CoverService retains staging/save protection and adds durable package associations; UI reuses candidate selection.

**Tech Stack:** Electron 33, TypeScript, SQLite, yauzl/tar, Unity 2022.3 Built-in, existing bridge 1.2.0.

**Spec:** `docs/superpowers/specs/2026-10-14-package-cover-preview-design.md`

## Global Constraints

- Only `codex/package-cover-preview`; main receives the completely verified feature through PR.
- User source archives / projects read-only; no source-avatar edits, imports, build or upload.
- Input 512 MiB, expanded 2 GiB, 32 packages, 20,000 entries, 10,000 GUIDs, paths 4 KiB, depth 8; read cutoff 45 seconds.
- No supplied C#, DLL, native plugins, asmdef/asmref or executables. No dependency downloads; copy only rendering resources from a registered lilToon package.
- At most one owned Unity editor, startup cutoff 120 seconds; cancellation and shutdown must not terminate user editors.
- No PR before full tests, typecheck, build, worker checks, real independent Unity rendering and real isolated Electron flow pass.

## Review Focus

- Sibling packages with identical names/GUIDs must not leak unrelated candidates or override dependencies.
- Cancel during preparation/start/load must release owned handles and ignore late results.
- Internal preview projects must never enter user project lists or trigger collection switching.
- Restart and batch update must rebuild a stable package association, with manual-image protection.
- Missing shaders must report actionable failure, preserving the previous cover and original image.

## Task 1: Read-only package resource preparation

**Files:** Create `src/main/covers/packageSource.ts`, `tests/covers/package-source.spec.ts`.

**Interfaces:** Export `preparePackageSources(db: Db, assetId: string, destination: string, signal?: AbortSignal, progress?: (done:number,total:number)=>void): Promise<{guids:string[], memberPaths:Record<string,string[]>, warnings:string[], fingerprint:string}>`. Destination is a fresh caller-owned project Assets directory. Read inventory ownership from `collectCoverSources`; never modify inventory semantics or user files.

- [x] Write RED fixtures asserting script/plugin exclusion, actual texture/material/FBX/meta bytes and GUID preservation, exact child ownership, no symlink/path traversal, duplicate content conflict, cancel cleanup and size bounds.
- [x] Run `npx vitest run tests/covers/package-source.spec.ts`; observe absent API failure.
- [x] Implement streaming original-package resource copy, typed allowlist, package context filtering, deterministic fingerprint and provenance.
- [x] Run the focused file to GREEN; return evidence paths and all boundary decisions.

## Task 2: Owned Unity worker

**Files:** Create `src/main/covers/packageWorker.ts`, `resources/unity-bridge/com.avca.bridge/Editor/AVCAPackageWorker.cs`, `tests/covers/package-worker.spec.ts`; modify only internal-project filtering in `src/main/project/api.ts` if required, with test.

**Interfaces:** Export `PackagePreviewWorker` accepting `{manager: Pick<BridgeManager,'execute'>, editorPath:()=>string, dependencyProject:()=>string|null}`. `start(projectPath:string, signal:AbortSignal, progress:(stage:'starting'|'loading')=>void): Promise<void>` initializes the trusted minimal project and rendering-only lilToon dependency; `execute(projectPath:string,type:BridgeCommandType,payload:unknown,signal:AbortSignal):Promise<BridgeExecResult>` uses the manager; `stop():Promise<void>` shuts down only its child; `dispose():void`. Export `findUnityEditor(configured?:string):{path:string|null,version:string|null}` for status / settings. Existing resource packaging includes the new trusted Editor script.

- [x] Write RED tests for missing editor, owned path/marker checks, runtime script filtering, startup exit/timeout/cancel, process switching/shutdown and internal-project exclusion.
- [x] Observe RED before runtime implementation.
- [x] Implement direct spawn with argument arrays, owned marker, bridge heartbeat readiness, shutdown marker and bounded lifecycle. Never edit user projects / install external dependencies.
- [x] Run focused tests and actual bridge C# compilation to GREEN.

## Task 3: Cover API, durability and batch integration

**Files:** Modify `src/shared/covers.ts`, `src/shared/api.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/covers/service.ts`, `src/main/covers/ipc.ts`, `src/main/db/schema.ts`, `src/main/db/repos/covers.ts`; create `src/main/covers/packageProvider.ts`, `tests/covers/package-service.spec.ts`.

**Interfaces:** `CoverRequest.provider?:'project'|'package'`; record `source:'unity'|'image'|'package'`. API `packageStatus(): Promise<{available:boolean,editorPath:string|null,version:string|null}>`, `discoverPackage(assetId:string,requestId:string,dependencyProjectId?:string):Promise<CoverDiscovery>`, `packageProgress(requestId:string):Promise<{stage:string,done?:number,total?:number}|null>`. Existing `preview/save/discard/batch` accept package requests with projectId empty. Stable package target ID is `package:<32-hex-guid>`; sourceGuid is the same GUID. Temporary engine IDs remain private to provider.

- [x] Add RED migration/data-preservation, stable association, restart reprepare, manual-image race, cancel and batch tests.
- [x] Implement provider using Task 1/2 interfaces, bounded owned job directories and GUID mapping.
- [x] Route package preview through existing image validation/staging/save logic. Preserve project flow and original backups.
- [x] Run all covers and migration tests to GREEN.

## Task 4: Existing editor UI extension

**Files:** Modify `src/renderer/components/CoverEditor.tsx`, locale `en/ja/zh-CN.json`; extend/create isolated Electron verification tool.

**Interfaces:** Consume Task 3 API. Provider selector labels 「从素材包预览」 / 「从 Unity 工程预览」; current recorded source retains its mode. Package mode offers optional shader dependency project, editor picker if absent, progress, candidate thumbnails, direction/background, explicit Save. Scene direction stays project-only. Persist chosen Unity executable through existing `settings.unityExePath` setting.

- [x] Add RED real-renderer checks for missing editor, mode switch during active work, progress, no default selection/save, late results, package replay and manual protection.
- [x] Implement within existing session lifecycle with unique request IDs and generation guards.
- [x] Run the compiled Electron checks once root coordinates Electron ABI, preserving user app/data.

## Task 5: Integration acceptance and delivery

**Files:** User/developer docs and `tools/verify-cover-ui.cjs` or a dedicated package verification script.

- [x] Begin with an empty owned Unity project; stage actual licensed chocolate and Pocky ZIPs, rendering-only lilToon resources and bridge.
- [x] Verify actual images, selection/save/card refresh, no imports to user projects or records, source invariants, cancellation, restore, batch and restart.
- [x] Run full `npm test`, typecheck, Electron build, worker dependency check; inspect every result. Record conditional skips honestly.
- [x] Independent whole-branch review; fix material findings with regression tests.
- [ ] Commit/push only completed feature, create/attach PR, verify exact head/base/checks, self-merge and fast-forward clean local main. Preserve user shortcut and launch verified app.
