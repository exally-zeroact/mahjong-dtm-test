# 麻雀〜do the math〜（mahjong-dtm）— このrepoの決まり

点数・待ち・成績・精算を1本で回す麻雀の計算アプリ。素の HTML＋JS（ビルドなし）・ブラウザだけ・全員アドレスでログイン（共有の Supabase Auth・人ごと管理＝v18）。
計算は `lib/` の画面から切り離した純関数（画面と node 試験が同じ物を使う）。

---

## ★このrepoはどっちか★

**フォルダ名を環境の証拠にしない。`remote` と `js/supa-config.js` の `env` を見る。**

| repo | 倉庫 | `env` | 配信 |
|---|---|---|---|
| `mahjong-dtm-test` | DB-test（他アプリと共有のテスト倉庫）の `mahjong` 部屋 | `test` | Vercel → https://mahjong-dtm-test.vercel.app |
| `mahjong-dtm` | 本番倉庫の `mahjong` 部屋 | `prod` | Vercel → https://mahjong-dtm.vercel.app |

- 配信は Vercel。GitHub Pages は使わない。
- **`js/supa-config.js` をもう片方の repo にコピーしない。** これ1本が環境の分かれ目（テストの帯 `js/env-badge.js` もこれだけで決まる）。
- 本番へは運ぶ道具（NEVER_SHIP 付き）で写す。`git archive | tar` 禁止・本番を手で直さない。
- 倉庫の向き先（URL・鍵）を書いてよいのは `js/supa-config.js` だけ（`tests/no-hardcoded-supa.test.mjs` が赤にする）。
- 表は部屋 `mahjong`・外から呼べるのは `public.mj_*` の RPC だけ。他の部屋（schema）に触らない。

---

## ★テスト — 全アプリ共通の2層検証（global-rules §11・このアプリも必ず）★

片方だけで「動く/直った」と言わない。**次の2層を永久（CI/回帰）で持つ。**

### ① 全機能を実データで確かめる（計算・ロジック層）
- **本物のエンジン（`lib/`）**に**全パターン**を流し、**期待値（正解表）と assert で突き合わせる**。
- 網羅・invariant（半荘の pt の合計0・チップ祝儀の合計0・精算の受け渡しの合計0・NaN/矛盾ゼロ）。**中間値でなく客に見える出力**（点・pt・順位・精算）で判定。
- 点数計算・待ち・シャンテンは公開の正解表と突き合わせる（計算の誤りがこのアプリの売りの裏返し）。

### ② Claude Code が実 UI で全ボタン・全パターンを操作する
- 実アプリを Playwright で動かし、**全画面・全ボタン・全入力**を実際に押す/打ち込む。
- 確認：**JS エラー 0**・各画面が描画・入力で正しく再計算・**出力（精算・書き出し・リアルタイムの反映）の実生成**まで（＝配線が本当に生きてるか）。

### なぜ両方要るか
計算 lib 緑＝「ボタンが押せる/画面が動く/出力が出る/配線されてる」は**保証しない**（「lib 有るのに未配線」の型）。

---

## ★押す前の門★

- `git config --local core.hooksPath .githooks`（husky は使わない＝`npx husky` を回さない）。
- `.githooks/`＝メールを公開 repo に出さない・押す中身に実在の字・commit の文に実在の字。押した時の出しに門の行が出ているかを毎回見る。
- 禁止の字の一覧は repo の外。開いて字を写さない・repo に入れない。
- `user.email` は `--local` で noreply。

## ★試験の登録★

- 足した試験は `.github/workflows/ci.yml` に `node <path>` で1本ずつ並べるまで走らない（`scripts/tests-registered.mjs` が赤にする）。`--self-test` も並べる。
- CI は20分以下。`[skip ci]` を書かない。

## ★見た目★

- 色は `css/app.css` の `:root` の変数にだけ書く。禁止色は使わない。
- ボタンの高さは字に合わせる（16px→44・14px→36・押せる広さは見えない ::after）。
- 牌の絵は自前の SVG（他社の絵・配色・名前は写さない）。
