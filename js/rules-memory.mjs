/* rules-memory.mjs — A14g（tataki/a14g_sadame_v1.md）覚えたルール（倉庫 mj_my_rules の rules["3"|"4"]）を新しい対局に出す形へ取り込む
 * fromMemory(obj, n)：null／undefined→null（覚え無し）／object でない・players 違い・rulesOk を通らない→'bad'（画面は既定＋帯＝黙らない）
 *   通れば rulesOk で埋めた形に、隠した鍵（HIDDEN）を defaultRules(n) の値で上書きする（新しい対局は新しいルール＝古い覚えの gosha 等を隠れたまま持ち越さない）
 * pickStart(res)：mj_my_rules の返し → { memory:{3,4}, players, bad:[n…], unread }（unread＝倉庫が読めない・返しが崩れている）
 */
import { rulesOk, defaultRules } from '../lib/rules.mjs';

export const HIDDEN = ['round', 'tie', 'tobi_from', 'kyotaku_end']; // gamen-rules.mjs DETAIL の hide:true と同じ（A9・A13・B2）

export function fromMemory(obj, n) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object' || Array.isArray(obj) || obj.players !== n) return 'bad';
  const chk = rulesOk(obj);
  if (!chk.ok) return 'bad';
  const d = defaultRules(n);
  const r = { ...chk.rules };
  for (const k of HIDDEN) r[k] = d[k];
  return r;
}

export function pickStart(res) {
  const memory = { 3: null, 4: null };
  const bad = [];
  if (!res || res.ok !== true || !res.rules || typeof res.rules !== 'object') return { memory, players: 4, bad, unread: true };
  for (const n of [3, 4]) {
    const m = fromMemory(res.rules[String(n)], n);
    if (m === 'bad') bad.push(n); else memory[n] = m;
  }
  const last = res.last === 3 || res.last === 4 ? res.last : null;
  const players = last && (memory[last] || bad.includes(last)) ? last : (memory[4] || bad.includes(4) ? 4 : memory[3] ? 3 : 4);
  return { memory, players, bad, unread: false };
}
