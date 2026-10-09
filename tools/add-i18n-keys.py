"""
往三份语言文件里补 §B5/§B6/§B4 需要的新 key。
用脚本而不是手改：CJK 内容经过 shell heredoc 会被改坏（踩过好几次），
json.dump(ensure_ascii=False, indent=2) 出来的格式和现有文件一致。
幂等：已存在的 key 不覆盖。
"""
import io
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
I18N = os.path.join(ROOT, 'src', 'renderer', 'i18n')

ADD = {
    'library': {
        'zh-CN': {
            'containerMerged': '{{count}} 个模型变体',
            'containerCollection': '合集 · 含 {{count}} 项',
            'containerCrumbAll': '全部素材',
            'containerFilterAll': '全部 ({{count}})',
            'containerFilterModel': '按模型',
            'containerFilterVersion': '按版本',
            'containerSearchPh': '在这个容器里搜索…',
            'containerKeys': 'Esc 返回上一级 · Ctrl+A 全选 · Enter 导入选中项',
            'containerAttachments': '附属资源（不进库列表，导入时默认不勾）',
            'attImage': '图库',
            'attVideo': '媒体',
            'attDoc': '说明',
            'attLink': '链接',
            'attSource': '源文件',
            'attAudio': '音频',
            'mergeSuggest': '「{{name}}」有 {{count}} 个同系列素材，要合并成一张卡吗？',
            'mergeDo': '合并并进入',
            'mergeView': '查看这 {{count}} 个',
            'mergeNever': '不再提示',
            'mergeDone': '已合并 {{count}} 个素材成一张容器卡',
            'containerModelBadge': '模型',
            'dblclickHint': '双击容器卡进入内部；双击普通素材卡导入 Unity'
        },
        'en': {
            'containerMerged': '{{count}} model variants',
            'containerCollection': 'Collection · {{count}} items',
            'containerCrumbAll': 'All assets',
            'containerFilterAll': 'All ({{count}})',
            'containerFilterModel': 'By model',
            'containerFilterVersion': 'By version',
            'containerSearchPh': 'Search inside this container…',
            'containerKeys': 'Esc back · Ctrl+A select all · Enter import selection',
            'containerAttachments': 'Attachments (not listed in the library, unchecked by default on import)',
            'attImage': 'Images',
            'attVideo': 'Media',
            'attDoc': 'Docs',
            'attLink': 'Links',
            'attSource': 'Sources',
            'attAudio': 'Audio',
            'mergeSuggest': '"{{name}}" has {{count}} assets from the same series. Merge them into one card?',
            'mergeDo': 'Merge and open',
            'mergeView': 'Show these {{count}}',
            'mergeNever': "Don't ask again",
            'mergeDone': 'Merged {{count}} assets into one container card',
            'containerModelBadge': 'model',
            'dblclickHint': 'Double-click a container card to open it; double-click an asset card to import into Unity'
        },
        'ja': {
            'containerMerged': '{{count}} 個のモデル違い',
            'containerCollection': 'まとめ · {{count}} 点',
            'containerCrumbAll': 'すべての素材',
            'containerFilterAll': 'すべて ({{count}})',
            'containerFilterModel': 'モデル別',
            'containerFilterVersion': 'バージョン別',
            'containerSearchPh': 'この容器内を検索…',
            'containerKeys': 'Esc で戻る · Ctrl+A ですべて選択 · Enter で選択をインポート',
            'containerAttachments': '付属ファイル（一覧には出ません。インポート時は既定で未選択）',
            'attImage': '画像',
            'attVideo': '動画',
            'attDoc': '説明',
            'attLink': 'リンク',
            'attSource': 'ソース',
            'attAudio': '音声',
            'mergeSuggest': '「{{name}}」に同シリーズの素材が {{count}} 点あります。1 枚のカードにまとめますか？',
            'mergeDo': 'まとめて開く',
            'mergeView': 'この {{count}} 点を表示',
            'mergeNever': '今後表示しない',
            'mergeDone': '{{count}} 点を 1 枚の容器カードにまとめました',
            'containerModelBadge': 'モデル',
            'dblclickHint': '容器カードはダブルクリックで中へ、素材カードはダブルクリックで Unity へインポート'
        }
    },
    'settings': {
        'zh-CN': {
            'learnTitle': '从库中学习模型名',
            'learnWhy': '扫描库里 <模型>_<系列> 形式的文件名，把反复出现、但词典还不认识的名字列出来。加进词典之后，同类素材就能自动归并、详情页也能显示模型徽章。',
            'learnScan': '扫描库',
            'learnScanning': '扫描中…',
            'learnFound': '发现 {{count}} 个疑似模型名',
            'learnNone': '没有发现新的疑似模型名，词典已经够用了',
            'learnAdd': '加入词典',
            'learnAdded': '已加入 {{count}} 个词条',
            'learnSeries': '系列',
            'learnFreq': '出现',
            'learnThresholdNote': '只列同一系列下出现 ≥2 次的名字；单个系列里 20 个不同模型各出现 1 次时，按系列整组列出（真库的 ATTITUDE The Royal Bunny 就是这样）'
        },
        'en': {
            'learnTitle': 'Learn model names from the library',
            'learnWhy': 'Scans file names of the form <model>_<series> and lists recurring names the lexicon does not know yet. Once added, similar assets merge automatically and detail pages can show model badges.',
            'learnScan': 'Scan library',
            'learnScanning': 'Scanning…',
            'learnFound': 'Found {{count}} likely model names',
            'learnNone': 'No new likely model names — the lexicon already covers this library',
            'learnAdd': 'Add to lexicon',
            'learnAdded': 'Added {{count}} entries',
            'learnSeries': 'Series',
            'learnFreq': 'Hits',
            'learnThresholdNote': 'Only names seen ≥2 times within one series are listed; when a single series has 20 different models once each, the whole series group is listed (this is exactly the ATTITUDE The Royal Bunny case in the real library)'
        },
        'ja': {
            'learnTitle': 'ライブラリからモデル名を学習',
            'learnWhy': '<モデル>_<シリーズ> 形式のファイル名を走査し、繰り返し出るのに辞書が知らない名前を一覧します。追加すると同種素材が自動的にまとまり、詳細ページにモデルバッジも出ます。',
            'learnScan': 'ライブラリを走査',
            'learnScanning': '走査中…',
            'learnFound': 'モデル名らしきものを {{count}} 件発見',
            'learnNone': '新しいモデル名は見つかりませんでした。辞書は足りています',
            'learnAdd': '辞書に追加',
            'learnAdded': '{{count}} 件を追加しました',
            'learnSeries': 'シリーズ',
            'learnFreq': '出現',
            'learnThresholdNote': '同一シリーズ内で 2 回以上出た名前だけ一覧します。1 シリーズに 20 種のモデルが各 1 回ずつの場合はシリーズ単位でまとめて一覧します（実ライブラリの ATTITUDE The Royal Bunny がまさにこれ）'
        }
    }
}


def main() -> None:
    for section, per_lang in ADD.items():
        for lang, keys in per_lang.items():
            p = os.path.join(I18N, lang + '.json')
            with io.open(p, encoding='utf-8') as f:
                data = json.load(f)
            node = data.setdefault(section, {})
            added = 0
            for k, v in keys.items():
                if k not in node:
                    node[k] = v
                    added += 1
            with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write('\n')
            print('%s %s: +%d keys' % (lang, section, added))


if __name__ == '__main__':
    main()
