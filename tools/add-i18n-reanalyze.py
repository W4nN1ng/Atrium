"""补「重新分析」面板要的 i18n key。和 add-i18n-keys.py 同一个套路：幂等、不动已有 key。"""
import io
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
I18N = os.path.join(ROOT, 'src', 'renderer', 'i18n')

ADD = {
    'zh-CN': {
        'reanalyzeTitle': '重新分析已入库的数据',
        'reanalyzeWhy': '改了命名 / 版本号 / 方括号归并规则之后，库里那些按旧规则算出来的名字要重算一遍。这一步**只改库里的列，一个文件都不移动**；按下之前先告诉你会影响多少条，之后还能整批 Ctrl+Z 退回。',
        'reanalyzeScan': '先看看会影响多少条',
        'reanalyzeScanning': '扫描中…',
        'reanalyzeAffected': '共 {{scanned}} 条记录，其中 {{affected}} 条会被改',
        'reanalyzeRenamed': '{{count}} 条会改名',
        'reanalyzeUuid': '{{count}} 条名字里还挂着 UUID',
        'reanalyzeJunk': '{{count}} 条是垃圾文件，建议请出库',
        'reanalyzeClean': '全部 {{scanned}} 条都符合新规则，不用重算',
        'reanalyzeApply': '重新分析这 {{count}} 条',
        'reanalyzeDropJunk': '请出这 {{count}} 条垃圾记录',
        'reanalyzeDone': '已重算 {{count}} 条（磁盘文件未动）',
        'reanalyzeJunkDone': '已移除 {{count}} 条记录，磁盘上的文件还在原地',
        'reanalyzeColName': '展示名',
        'reanalyzeColVersion': '版本',
        'reanalyzeColFields': '改的列',
        'reanalyzeNone': '没有需要重算的记录'
    },
    'en': {
        'reanalyzeTitle': 'Re-analyze already-registered assets',
        'reanalyzeWhy': 'After changing the naming / version / bracket-merge rules, names computed under the old rules need recomputing. This step **only updates database columns and moves no files**; it tells you how many rows are affected before you press it, and the whole batch can be undone with Ctrl+Z.',
        'reanalyzeScan': 'Preview impact first',
        'reanalyzeScanning': 'Scanning…',
        'reanalyzeAffected': '{{scanned}} records in the library, {{affected}} would change',
        'reanalyzeRenamed': '{{count}} would be renamed',
        'reanalyzeUuid': '{{count}} still carry a UUID in the name',
        'reanalyzeJunk': '{{count}} are junk files — suggest removing from the library',
        'reanalyzeClean': 'All {{scanned}} records already match the new rules',
        'reanalyzeApply': 'Re-analyze these {{count}}',
        'reanalyzeDropJunk': 'Remove these {{count}} junk records',
        'reanalyzeDone': 'Recomputed {{count}} records (no files moved)',
        'reanalyzeJunkDone': 'Removed {{count}} records; the files on disk stay where they are',
        'reanalyzeColName': 'Display name',
        'reanalyzeColVersion': 'Version',
        'reanalyzeColFields': 'Columns',
        'reanalyzeNone': 'Nothing to recompute'
    },
    'ja': {
        'reanalyzeTitle': '登録済み素材を再分析',
        'reanalyzeWhy': '命名 / バージョン / 角括弧の統合影規則を変えた後、旧規則で出した名前を作り直す必要があります。この操作は**データベースの列だけ書き換え、ファイルは一切動かしません**。押す前に何件影響するかを表示し、後で Ctrl+Z で一括戻せます。',
        'reanalyzeScan': 'まず影響件数を確認',
        'reanalyzeScanning': '走査中…',
        'reanalyzeAffected': 'ライブラリ {{scanned}} 件うち {{affected}} 件が変更対象',
        'reanalyzeRenamed': '{{count}} 件は名前が変わります',
        'reanalyzeUuid': '{{count}} 件の名前仍に UUID が残っています',
        'reanalyzeJunk': '{{count}} 件はゴミファイル。ライブラリから外すことを推奨',
        'reanalyzeClean': '{{scanned}} 件すべて新規則に適合、再計算不要です',
        'reanalyzeApply': 'この {{count}} 件を再分析',
        'reanalyzeDropJunk': 'この {{count}} 件のゴミ記録を外す',
        'reanalyzeDone': '{{count}} 件を作り直しました（ファイルは動いていません）',
        'reanalyzeJunkDone': '{{count}} 件の記録を外しました。ディスク上のファイルはそのままです',
        'reanalyzeColName': '表示名',
        'reanalyzeColVersion': 'バージョン',
        'reanalyzeColFields': '変更列',
        'reanalyzeNone': '再計算が必要なレコードはありません'
    }
}


def main() -> None:
    for lang, keys in ADD.items():
        p = os.path.join(I18N, lang + '.json')
        with io.open(p, encoding='utf-8') as f:
            data = json.load(f)
        node = data.setdefault('settings', {})
        added = 0
        for k, v in keys.items():
            if k not in node:
                node[k] = v
                added += 1
        with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print('%s: +%d keys' % (lang, added))


if __name__ == '__main__':
    main()
