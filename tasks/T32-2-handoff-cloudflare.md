---
id: T32-2
title: "T32 の結果(Cloudflare)を README と既存の知見ノートに反映する"
type: ドキュメント
status: done
wave: 6
parent: "[[T32-cloudflare-check]]"
depends_on:
  - "[[T32-cloudflare-check]]"
  - "[[T33-readme]]"
soft_depends_on: []
blocks: []
files:
  - "README.md(Cloudflare の例の注記・制約の表)"
  - "docs/cloudflare-workers-free-d1-limits.md(T32 で確かめると書いてあったところ)"
  - "docs/emdash-after-save-payload.md(同上)"
  - "tasks/T32-cloudflare-check.md(反映済みの注記だけ)"
  - "tasks/T32-2-handoff-cloudflare.md"
  - "tasks/00-index.md"
spec:
  - "[[base64-image-plugin-spec#2. 動作環境と制約]]"
  - "[[base64-image-plugin-spec#18. 既知の制約とリスク]]"
tags:
  - task
  - docs
  - subtask
created: 2026-09-24
---

# T32-2 T32 の結果(Cloudflare)を README と既存の知見ノートに反映する

> [!info] 概要
> - 種別: ドキュメント(予定外のサブタスク) / ウェーブ: 6 / ブランチ: `phase-6/t-32-2`
> - 親タスク: [[T32-cloudflare-check|T32]]
> - 着手の条件(依存): [[T32-cloudflare-check|T32]]、[[T33-readme|T33]](README)
> - このタスクを待つもの: なし

## 目的

T32 の結果を、README(利用者向け)と、「T32 で確かめる」と書いてあった既存の知見ノートに書く。

## 発生した理由

- T33 は T32 と並行して README を書いたので、Cloudflare の構成の確認と、D1 の行数の実測は README に入っていなかった([[T33-1-handoff-readme|T33-1]])。
- T32 は、変更してよいファイルの外にある既存の知見ノート 2 つ(`cloudflare-workers-free-d1-limits`・`emdash-after-save-payload`)の「T32 で確かめる」を更新できると報告した。

## 作業内容

- [x] README: Cloudflare の例が playground の設定で `wrangler dev` と D1 で動いたこと(本番のデプロイでは未確認)、R2 の無いサイトの標準のメディアのアップロードのエラーの形(500 `UPLOAD_ERROR`)、制約の表に D1 の 1 日の上限(アップロード 1 回で約 93 行を書く)
- [x] [[cloudflare-workers-free-d1-limits]]: ローカルの D1 で測ったクエリ数と行数。本番の D1 は利用者の了承待ち
- [x] [[emdash-after-save-payload]]: workerd + ローカルの D1 で、参照元の記録の hook が Node と同じだったこと

## 完了条件

- [x] `npm run verify` が通る
- [x] wikilink がすべて解決する

## 変更してよいファイル

frontmatter の `files` のとおり。同時に動いているタスク([[T31-e2e|T31]])は、これらのファイルを変更しない。

## 結果

- T32 の「影響・予定外の作業・未解決」は、次のように扱った。
  - [[T31-e2e|T31]] への影響(サンプルの投稿のスクリプトの `--token`、wrangler dev だけの 500): T31 のノートは T31 が作業中に書いているので変えず、作業中の T31 にメッセージで知らせた。
  - T33・T34: README に Cloudflare の確認の結果を足した(上の作業内容)。T34 への影響は無い。
  - `playground/src/worker.ts` を `npm run typecheck` の対象にする案: 行わない。EmDash のテンプレートと同じ 18 行で、型のためには Workers の型(`@cloudflare/workers-types`)を読む別の tsconfig が要る。ビルド(`npm run build:cloudflare -w playground`)で変換されることは T32 で確かめた。
  - デプロイしての測定(CPU 時間・起動時間・本番の D1): 利用者の了承待ちのまま([[T32-cloudflare-check#デプロイして測る(任意・利用者の了承待ち)]])。
  - 作業の環境への影響(T32 の報告): wrangler は `send_metrics: false` でも、利用者のグローバルの設定ディレクトリ(`~/Library/Preferences/.wrangler/`)にログを書き、`metrics.json` の `bannerLastShown` を書き換えた。T32 とは別の workerd の処理(`pnpm dlx` の wrangler から起動されたもの)が 3 つ残っていたが、このチームのものではないので止めていない。どちらも利用者に伝える。根拠: 実測のみ(T32 の報告)
  - 仕様書: T32 が 2.2・2.3・15 章・18 章を直した(T32 のマージのとき)。この作業では変えていない。
