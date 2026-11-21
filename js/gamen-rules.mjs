/* gamen-rules.mjs — ★ルール設定の画面★（絵 mahjong_home_v154 ③）
 * =============================================================================
 * mountRules(el, { rules, readOnly }) → { read() }
 *   部屋を作る時（打てる）と、対局の右上［ルール］から見る時（readOnly＝見るだけ）の両方で使う。
 *   並び＝人数とレート（人数 4人/3人・1pt＝[ ]点・なし/50/100/200/500）→ 点（持ち点／返し・ウマ・オカ・飛び賞＝行の右に値 ›）
 *        → チップ・祝儀（1枚＝[ ]pt＋入切）→ 詳しいルール ›
 *   対局にリーグ戦の入切は置かない（司さん 11-20「ごちゃごちゃになる」）。
 */
import { defaultRules } from '../lib/rules.mjs';
import { esc } from './gamen-core.mjs';

const RATES = [null, 50, 100, 200, 500];
const DETAIL = [
  { key: 'round', label: '端数', vals: [['gosha', '五捨六入'], ['shisha', '四捨五入'], ['kirisute', '切り捨て'], ['none', '丸めない']] },
  { key: 'tie', label: '同じ点', vals: [['kamicha', '上家取り'], ['split', '分ける']] },
  { key: 'tobi_zero', label: '0点ちょうど', vals: [[true, '飛び'], [false, '飛びでない']] },
  { key: 'tobi_from', label: '飛び賞を払う先', vals: [['busted', '飛ばした人'], ['all', '全員']] },
  { key: 'hakoshita', label: '箱下', vals: [[true, 'あり'], [false, 'なし']] },
  { key: 'kyotaku_end', label: '終局の供託', vals: [['top', 'トップ'], ['kieru', '消える']] },
];
const toInt = (s) => { const t = String(s).replace(/[,，\s]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/^[−ー－]/, '-'); return /^-?\d+$/.test(t) ? Number(t) : NaN; };
const toPt10 = (s) => { const t = String(s).trim().replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0))); if (!/^\d+(\.\d)?$/.test(t)) return NaN; return Math.round(Number(t) * 10); };
const n0 = (v) => (typeof v === 'number' ? v.toLocaleString('ja-JP') : '');
const pt1 = (pt10) => (pt10 / 10).toFixed(1);

export function umaText(uma) {
  if (uma.length === 4 && uma[0] === -uma[3] && uma[1] === -uma[2]) return uma[1] + ' − ' + uma[0];
  return uma.join('／');
}

export function mountRules(el, { rules, readOnly }) {
  const r = JSON.parse(JSON.stringify(rules || defaultRules(4)));
  const open = new Set(); // 開いている行（ps＝持ち点／返し・uma・tobi・detail）

  function li(label, right, opts = {}) {
    const tag = opts.key && !readOnly ? 'button type="button" data-open="' + opts.key + '"' : 'div';
    const end = opts.key && !readOnly ? '</button>' : '</div>';
    return '<' + tag + ' class="li' + (opts.sub ? ' li-sub' : '') + '"><span>' + label + '</span><span class="li-v">' + right + (opts.key && !readOnly ? '<span class="li-ya" aria-hidden="true">›</span>' : '') + '</span>' + end;
  }
  function mini(name, vals, cur) {
    if (readOnly) return esc((vals.find(([v]) => v === cur) || [, ''])[1]);
    return '<span class="mini">' + vals.map(([v, t]) => '<button type="button" data-' + name + '="' + esc(JSON.stringify(v)) + '" aria-pressed="' + (v === cur) + '">' + esc(t) + '</button>').join('') + '</span>';
  }
  function box(id, val, mode) {
    if (readOnly) return '<b>' + esc(val) + '</b>';
    return '<input class="box" id="' + id + '" inputmode="' + (mode || 'numeric') + '" value="' + esc(val) + '" autocomplete="off">';
  }
  function sw(id, on) {
    if (readOnly) return '';
    return '<button type="button" class="tg" role="switch" id="' + id + '" aria-checked="' + on + '" aria-label="入切"></button>';
  }

  function render() {
    const n = r.players;
    let h = '<h3 class="sec">人数とレート</h3><div class="list">';
    h += li('人数', mini('players', [[4, '4人'], [3, '3人']], n));
    h += li('レート', '1pt ＝ ' + (r.rate === null && readOnly ? '' : box('rRate', r.rate === null ? '' : String(r.rate))) + (r.rate === null && readOnly ? 'なし' : ' 点'));
    if (!readOnly) h += '<div class="li li-sub"><span class="mini">' + RATES.map((v) => '<button type="button" data-rate="' + (v === null ? '' : v) + '" aria-pressed="' + (r.rate === v) + '">' + (v === null ? 'なし' : v) + '</button>').join('') + '</span></div>';
    h += '</div><h3 class="sec">点</h3><div class="list">';
    h += li('持ち点／返し', n0(r.start_pts) + ' ／ ' + n0(r.return_pts), { key: 'ps' });
    if (open.has('ps')) h += '<div class="li li-sub"><span>持ち点</span>' + box('rStart', String(r.start_pts)) + '</div><div class="li li-sub"><span>返し</span>' + box('rReturn', String(r.return_pts)) + '</div>';
    h += li('ウマ', esc(umaText(r.uma)), { key: 'uma' });
    if (open.has('uma')) h += '<div class="li li-sub"><span class="uma-row">' + r.uma.map((u, i) => '<label><small>' + (i + 1) + '位</small><input class="box" data-uma="' + i + '" inputmode="numeric" value="' + u + '"></label>').join('') + '</span></div>';
    h += li('オカ', 'トップ取り');
    h += li('飛び賞', r.tobi_pt ? r.tobi_pt + 'pt' : 'なし', { key: 'tobi' });
    if (open.has('tobi')) h += '<div class="li li-sub"><span>飛び賞</span><span class="li-v">' + box('rTobi', String(r.tobi_pt)) + ' pt</span></div>';
    h += '</div><h3 class="sec">チップ・祝儀</h3><div class="list">';
    for (const [k, label, id] of [['chip_pt10', 'チップ', 'rChip'], ['shugi_pt10', '祝儀', 'rShugi']]) {
      const on = r[k] !== null;
      const v = on ? pt1(r[k]) : (k === 'chip_pt10' ? '2.0' : '1.0');
      if (readOnly) h += li(label, on ? '1枚 ＝ <b>' + v + '</b> pt' : 'なし');
      else h += '<div class="li"><span>' + label + '</span><span class="li-v">1枚 ＝ ' + box(id, v, 'decimal') + ' pt ' + sw(id + 'On', on) + '</span></div>';
    }
    // ③-2 やきとり（gamen_32b_sadame.md v1.1）＝チップと同じ ±・合計0・1枚＝yakitori_pt pt（整数）。true で pt 0 の部屋は「数えません」と見せる（黙って「あり」にしない）
    {
      const on = r.yakitori === true, p = r.yakitori_pt, okP = Number.isInteger(p) && p >= 1 && p <= 999;
      if (readOnly) h += li('やきとり', !on ? 'なし' : okP ? '1枚 ＝ <b>' + p + '</b> pt' : 'あり・1枚 0 pt＝数えません');
      else h += '<div class="li"><span>やきとり</span><span class="li-v">1枚 ＝ ' + box('rYaki', on || okP ? String(p) : '5', 'numeric') + ' pt ' + sw('rYakiOn', on) + '</span></div>';
    }
    h += '</div><div class="list list-gap">';
    h += li('詳しいルール', '', { key: 'detail' });
    if (open.has('detail') || readOnly) {
      for (const d of DETAIL) h += '<div class="li li-sub"><span>' + d.label + '</span><span class="li-v">' + mini('d-' + d.key, d.vals, r[d.key]) + '</span></div>';
    }
    h += '</div>';
    el.innerHTML = h;
    if (!readOnly) wire();
  }

  function readBoxes() {
    const v = (id) => { const x = el.querySelector('#' + id); return x ? x.value : null; };
    if (v('rRate') !== null) { const s = v('rRate').trim(); r.rate = s === '' ? null : toInt(s); }
    if (v('rStart') !== null) r.start_pts = toInt(v('rStart'));
    if (v('rReturn') !== null) r.return_pts = toInt(v('rReturn'));
    if (v('rTobi') !== null) r.tobi_pt = toInt(v('rTobi'));
    for (const x of el.querySelectorAll('[data-uma]')) r.uma[Number(x.dataset.uma)] = toInt(x.value);
    for (const [k, id] of [['chip_pt10', 'rChip'], ['shugi_pt10', 'rShugi']]) {
      const on = el.querySelector('#' + id + 'On');
      if (on) r[k] = on.getAttribute('aria-checked') === 'true' ? toPt10(v(id)) : null;
    }
    // やきとり：on＝打った字のまま（崩れは NaN＝作る時の門で止める）／off＝正しい数ならそれ・他は 0（NaN を残さない）
    const yOn = el.querySelector('#rYakiOn');
    if (yOn) {
      const p = toInt(v('rYaki'));
      r.yakitori = yOn.getAttribute('aria-checked') === 'true';
      r.yakitori_pt = r.yakitori ? p : (Number.isInteger(p) && p >= 1 && p <= 999 ? p : 0);
    }
  }
  function wire() {
    el.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      readBoxes();
      if (b.dataset.open) { open.has(b.dataset.open) ? open.delete(b.dataset.open) : open.add(b.dataset.open); }
      else if (b.dataset.players !== undefined) {
        const n = JSON.parse(b.dataset.players);
        if (n !== r.players) { const d = defaultRules(n); Object.assign(r, { players: n, start_pts: d.start_pts, return_pts: d.return_pts, uma: d.uma, tobi_pt: d.tobi_pt }); }
      } else if (b.dataset.rate !== undefined) r.rate = b.dataset.rate === '' ? null : Number(b.dataset.rate);
      else if (b.classList.contains('tg')) {
        const on = b.getAttribute('aria-checked') !== 'true';
        b.setAttribute('aria-checked', String(on));
        readBoxes();
      } else {
        for (const d of DETAIL) if (b.dataset['d-' + d.key] !== undefined || b.getAttribute('data-d-' + d.key) !== null) r[d.key] = JSON.parse(b.getAttribute('data-d-' + d.key));
      }
      render();
    };
  }
  render();
  return {
    read() {
      readBoxes();
      const out = { players: r.players, rate: r.rate, start_pts: r.start_pts, return_pts: r.return_pts, uma: r.uma.slice(), tobi_pt: r.tobi_pt, chip_pt10: r.chip_pt10, shugi_pt10: r.shugi_pt10,
        yakitori: r.yakitori === true, yakitori_pt: r.yakitori_pt === undefined ? 0 : r.yakitori_pt };
      for (const d of DETAIL) out[d.key] = r[d.key];
      return out;
    },
  };
}
