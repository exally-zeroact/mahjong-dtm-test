"""score-gaibu.py — 件4b：外の公開の点数計算器（PyPI mahjong・版と hash は tests/score-gaibu.req.txt で固定）の窓口。
tests/score-gaibu.test.mjs から呼ぶ（試験の時だけ・アプリには入れない）。
入り（標準入力・JSON）：[{tiles:[136の番号…], win, melds:[{type:'chi'|'pon'|'kan', tiles:[…], opened}], dora:[…], ura:[…],
        tsumo, riichi(0|1|2), ippatsu, rinshan, haitei, houtei, tenhou, chiihou, pw, rw, aka}]
出（標準出力・JSON）：1行目に {version, license}、2行目に 各手の {err} か {han, fu, main, additional, level, ym（役の役満が在るか＝数え役満は偽）, yaku}。
"""
import json
import sys
import importlib.metadata as md

from mahjong.hand_calculating.hand import HandCalculator
from mahjong.hand_calculating.hand_config import HandConfig, OptionalRules
from mahjong.meld import Meld

meta = md.metadata('mahjong')
print(json.dumps({'version': meta['Version'], 'license': meta.get('License-Expression') or meta.get('License')}))

KIND = {'chi': Meld.CHI, 'pon': Meld.PON, 'kan': Meld.KAN}
out = []
for h in json.load(sys.stdin):
    melds = [Meld(meld_type=KIND[m['type']], tiles=m['tiles'], opened=m['opened']) for m in h['melds']]
    opts = OptionalRules(has_open_tanyao=True, has_aka_dora=h['aka'], has_double_yakuman=True,
                         kazoe_limit=HandConfig.KAZOE_LIMITED, kiriage=False,
                         fu_for_open_pinfu=True, fu_for_pinfu_tsumo=False)
    cfg = HandConfig(is_tsumo=h['tsumo'], is_riichi=h['riichi'] >= 1, is_daburu_riichi=h['riichi'] == 2,
                     is_ippatsu=h['ippatsu'], is_rinshan=h['rinshan'], is_haitei=h['haitei'], is_houtei=h['houtei'],
                     is_tenhou=h['tenhou'], is_chiihou=h['chiihou'],
                     player_wind=h['pw'], round_wind=h['rw'], options=opts)
    r = HandCalculator.estimate_hand_value(h['tiles'], h['win'], melds=melds, dora_indicators=h['dora'],
                                           ura_dora_indicators=h['ura'] or None, config=cfg)
    if r.error:
        out.append({'err': r.error})
    else:
        out.append({'han': r.han, 'fu': r.fu, 'main': r.cost['main'], 'additional': r.cost['additional'],
                    'level': r.cost.get('yaku_level', ''), 'ym': any(y.is_yakuman for y in r.yaku),
                    'yaku': [str(y) for y in r.yaku]})
print(json.dumps(out, ensure_ascii=False))
