/**
 * 用 **Unity 自带的 Roslyn 编译器**编译桥接 C#，验证它真的能编过。
 *
 * ## 为什么值得做
 *
 * 之前一直说"C# 桥接未经 Unity 编译验证，只能靠用户点一下"。
 * 其实不必：Unity 安装目录里就带着编译器与全部引用程序集
 * （`Editor/Data/DotNetSdkRoslyn/csc.dll`），用它们就能做一个**离线语法+API 检查**。
 *
 * 这**不等于**在 Unity 里真跑过 —— 它不验证运行时行为（心跳、导入、回调时序）。
 * 但它能抓住最常见也最致命的失败：**编译不过**。而"编译不过"意味着用户装了桥接
 * 之后 Unity Console 直接报错、桥接完全不工作。
 *
 * ## 用到的路径（本机实测，换机器要重新确认）
 *
 * ```
 * E:\unity\2022.3.22f1\Editor\Data\
 *   DotNetSdkRoslyn\csc.dll                       编译器
 *   NetCoreRuntime\dotnet.exe                     跑 csc.dll 的宿主
 *   MonoBleedingEdge\lib\mono\4.7.2-api\          mscorlib / System / System.Core
 *   MonoBleedingEdge\lib\mono\4.7.2-api\Facades\  netstandard
 *   Managed\UnityEngine.dll + UnityEngine\*.dll   引擎（分模块）
 *   Managed\UnityEditor.dll + UnityEngine\UnityEditor.*.dll
 * ```
 *
 * 用法：`node tools/check-bridge-compile.cjs [Unity根目录]`
 * 退出码 0 = 编过；1 = 编不过（会打印完整错误）。
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const UNITY_ROOT = process.argv[2] || process.env.AVCA_UNITY_ROOT || 'E:\\unity\\2022.3.22f1'
const DATA = path.join(UNITY_ROOT, 'Editor', 'Data')
const REPO = path.resolve(__dirname, '..')
const BRIDGE_SRC = path.join(REPO, 'resources', 'unity-bridge', 'com.avca.bridge', 'Editor', 'AVCABridge.cs')

/**
 * 这些是桥接真正用到的程序集。宁可少列也别列错 —— 多列一个不存在的就白失败一次。
 *
 * ⚠ **不要引用 `UnityEngine.dll` / `UnityEditor.dll` 这两个门面**。
 * 它们只是转发到 `*.CoreModule.dll`，两个都引用会让同一类型出现在两个程序集里，
 * 编译器直接报 `CS0433: 类型 InitializeOnLoadAttribute 同时存在于 …CoreModule 和 UnityEditor`。
 * 实测就是这么撞上的 —— 只引模块程序集才对。
 */
const REFS = [
  ['MonoBleedingEdge', 'lib', 'mono', '4.7.2-api', 'mscorlib.dll'],
  ['MonoBleedingEdge', 'lib', 'mono', '4.7.2-api', 'System.dll'],
  ['MonoBleedingEdge', 'lib', 'mono', '4.7.2-api', 'System.Core.dll'],
  ['MonoBleedingEdge', 'lib', 'mono', '4.7.2-api', 'Facades', 'netstandard.dll'],
  ['Managed', 'UnityEngine', 'UnityEngine.CoreModule.dll'],
  ['Managed', 'UnityEngine', 'UnityEngine.TextRenderingModule.dll'],
  ['Managed', 'UnityEngine', 'UnityEngine.IMGUIModule.dll'],
  ['Managed', 'UnityEngine', 'UnityEngine.JSONSerializeModule.dll'],
  ['Managed', 'UnityEngine', 'UnityEngine.ImageConversionModule.dll'],
  ['Managed', 'UnityEngine', 'UnityEditor.CoreModule.dll']
]

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

if (!fs.existsSync(BRIDGE_SRC)) fail('找不到桥接源码：' + BRIDGE_SRC)

const sdkCompiler = path.join(DATA, 'DotNetSdkRoslyn', 'csc.dll')
const dotnet = path.join(DATA, 'NetCoreRuntime', 'dotnet.exe')
const monoCompiler = path.join(DATA, 'MonoBleedingEdge', 'lib', 'mono', '4.5', 'csc.exe')
const mono = path.join(DATA, 'MonoBleedingEdge', 'bin', 'mono.exe')
let csc, host, language
if (fs.existsSync(sdkCompiler) && fs.existsSync(dotnet)) {
  csc = sdkCompiler; host = dotnet; language = '9.0'
} else if (fs.existsSync(monoCompiler) && fs.existsSync(mono)) {
  // Unity also ships Roslyn for Mono. Use that installed compiler when its
  // SDK compiler is unavailable; never modify or download editor files.
  csc = monoCompiler; host = mono; language = 'latest'
} else {
  console.error('找不到可运行的 Unity Roslyn 编译器（SDK / Mono）')
  process.exit(2)
}

const refArgs = []
const missing = []
for (const rel of REFS) {
  const p = path.join(DATA, ...rel)
  if (!fs.existsSync(p)) {
    missing.push(p)
    continue
  }
  refArgs.push('-r:' + p)
}
if (missing.length) {
  // 引用程序集缺失是环境问题，不是代码问题 —— 明确区分开
  console.error('缺少引用程序集（环境问题，不是代码问题）：')
  for (const m of missing) console.error('  ' + m)
  process.exit(2)
}

const outDir = path.join(REPO, 'out', 'bridge-compile-check')
fs.mkdirSync(outDir, { recursive: true })
const outDll = path.join(outDir, 'AVCA.Bridge.dll')

const args = [
  csc,
  '/nologo',
  '/target:library',
  '/langversion:' + language,
  '/nullable:disable',
  '/unsafe-',
  '/warn:4',
  '/define:UNITY_2022_3_OR_NEWER;UNITY_EDITOR',
  '/out:' + outDll,
  ...refArgs,
  ...fs.readdirSync(path.dirname(BRIDGE_SRC)).filter(f => f.endsWith('.cs')).map(f => path.join(path.dirname(BRIDGE_SRC), f))
]

console.log(`桥接源码：${path.relative(REPO, BRIDGE_SRC)}`)
console.log(`编译器：Unity 自带 Roslyn（${path.relative(UNITY_ROOT, csc)}）`)
console.log(`引用程序集：${refArgs.length} 个`)
console.log('---')

const r = spawnSync(host, args, { encoding: 'utf8', windowsHide: true })

const out = (r.stdout || '').trim()
const err = (r.stderr || '').trim()
if (out) console.log(out)
if (err) console.error(err)

if (r.status === 0 && fs.existsSync(outDll)) {
  const size = fs.statSync(outDll).size
  console.log('---')
  console.log(`✅ 编译通过（输出 ${(size / 1024).toFixed(1)} KB）`)
  console.log('   注意：这只证明「能编过」+「用到的 Unity API 都存在」。')
  console.log('   运行时行为（心跳、导入回调、Busy 时序）仍需在 Unity 里验。')
  process.exit(0)
}

console.log('---')
console.log('❌ 编译失败（上面是编译器的原始输出）')
process.exit(1)
