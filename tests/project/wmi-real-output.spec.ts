import { describe, it, expect } from 'vitest'
import { parseWmiOutput, parseProjectPathFromCommandLine } from '../../src/main/project/wmi'

/**
 * 真机活体（§8-2）抓到的原始 stdout：Unity Hub 自己也是 `unity.exe`（`E:\unity hub\resources\unity.exe serve`），
 * 它的命令行里**没有** `-projectPath`。而 A 在真 Unity 关掉之后仍然报
 * `running:true / detectedBy:['wmi']` —— 这一份就是用来判"到底是谁命中了"。
 */
const HUB_ONLY =
  '#< CLIXML\r\n' +
  '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T><T>System.Object</T></TN><MS><I64 N="SourceId">1</I64><PR N="Record"><AV>Preparing</AV></PR></MS></Obj></Objs>\r\n' +
  '13904|"E:\\unity hub\\resources\\unity.exe" serve\r\n'

const WITH_EDITOR =
  '13904|"E:\\unity hub\\resources\\unity.exe" serve\r\n' +
  '35556|"E:\\unity\\2022.3.22f1\\Editor\\Unity.exe" -projectPath "D:\\avca-r4-live\\projects\\Shinano-R4LiveTest" -logFile "D:\\avca-r4-live\\unity-s8.log"\r\n'

describe('WMI 输出解析 · 真机抓到的形状', () => {
  it('Hub 的 unity.exe serve（没有 -projectPath）不许算成"工程在运行"', () => {
    expect(parseProjectPathFromCommandLine('"E:\\unity hub\\resources\\unity.exe" serve')).toBeNull()
    expect(parseWmiOutput(HUB_ONLY)).toEqual([])
  })

  it('真编辑器的 -projectPath 才认，且斜杠统一成反斜杠', () => {
    const r = parseWmiOutput(WITH_EDITOR)
    expect(r).toHaveLength(1)
    expect(r[0].pid).toBe(35556)
    expect(r[0].projectPath).toBe('D:\\avca-r4-live\\projects\\Shinano-R4LiveTest')
  })

  it('CLIXML 那一大行不许被当成一条进程记录（里面有 | 也没用）', () => {
    const noisy = HUB_ONLY + 'abc|def\r\n' + '<Obj>|x</Obj>\r\n'
    expect(parseWmiOutput(noisy)).toEqual([])
  })
})
