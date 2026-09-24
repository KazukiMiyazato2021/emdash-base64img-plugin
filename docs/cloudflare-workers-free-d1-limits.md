---
title: Workers Free で D1 に送れるクエリ数と、1 日の上限
aliases:
  - D1 のクエリ数の上限
  - Workers Free subrequests
tags:
  - docs
  - cloudflare
  - d1
  - limits
source_task: "[[T10-1-spec-d1-limits]]"
created: 2026-09-24
updated: 2026-09-24
---

# Workers Free で D1 に送れるクエリ数と、1 日の上限

> [!summary] 要点
> - Workers Free のサブリクエストの上限は 2 種類ある。外部(`fetch`)への 50 / 呼び出しと、Cloudflare のサービス(D1・KV・R2 など)への 1,000 / 呼び出し。D1 のクエリは後者に入る。根拠: **公式ドキュメントのみ**
> - D1 の limits のページには「Free は 1 呼び出し 50 クエリ」という記述が残っていて、Workers のページと食い違う([[T10-spike-after-save|T10]] の報告)。EmDash 本体の保存も SQLite で 55〜62 クエリ使うので、1,000 と読むのが妥当。根拠: **推測のみ**。[[T32-cloudflare-check|T32]] は `wrangler dev` のローカルの D1 でクエリ数を測った(アップロード 1 回 71、画像管理の一覧の最も重いページで 92。[[workerd-d1-plugin-behavior]])。本番の上限は、デプロイが要るので確かめていない(2026-09-25 の利用者の判断で、今は測らない)。
> - D1 Free には 1 日の上限(読み 500 万行、書き 10 万行)がある。2026-09-01 からは、超えると UTC の 0 時までクエリが失敗する。根拠: **公式ドキュメントのみ**
> - 関連: [[base64-image-plugin-spec#2.2 プラットフォームの上限|仕様書 2.2]]、[[emdash-plugin-content-query-counts]]、[[emdash-query-count-b64-images]]

## 1 呼び出しあたりのサブリクエスト

Workers の limits のページ(Subrequests の節)の表。

| 上限 | Workers Free | Workers Paid |
|---|---|---|
| Subrequests per invocation | 50 | 10,000(最大 1,000 万) |
| Subrequests to internal services | 1,000 | 設定した上限と同じ(既定 10,000) |

- 「A subrequest is any request a Worker makes using the Fetch API or to Cloudflare services like R2, KV, or D1.」
- 2026-02-11 の changelog「Workers are no longer limited to 1000 subrequests」: 「Workers on the free plan remain limited to 50 external subrequests and 1000 subrequests to Cloudflare services per invocation.」
- 出典:
  - https://developers.cloudflare.com/workers/platform/limits/#subrequests
  - https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/

## D1 の 1 日の上限(Free)

| 項目 | Workers Free |
|---|---|
| 読んだ行 | 500 万行 / 日 |
| 書いた行 | 10 万行 / 日 |
| 保存容量 | 合計 5 GB |

- 2026-09-01 の changelog「D1 enforces free tier daily query limits」: 上限を超えると、Workers のバインディングと REST API のクエリが、UTC の 0 時にリセットされるまで失敗する。保存しているデータには影響しない。
- エラーの文: `Your account has exceeded D1's free tier daily row read limit. …` / `… row write limit. …`
- インデックスのある列を書くと、インデックスの分も 1 行と数える。
- 出典:
  - https://developers.cloudflare.com/workers/platform/pricing/#d1
  - https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/

## このプラグインへの影響

| 処理 | クエリ数 | 上限(1,000)との関係 |
|---|---|---|
| アップロード 1 回(作成 → 取得 → 公開) | 72(SQLite での実測。[[T10-spike-after-save\|T10]]) | 収まる |
| サイトの画像の解決(1 ロケール・50 件まで) | 1〜3(実測。[[T09-spike-query-count\|T09]]) | 収まる |
| 画像管理ページの判定 | 件数に比例する(1 件あたり参照元 1〜6、画像の状態 2〜5) | 予算を決めて区切る([[T21-orphan-routes\|T21]]) |

- 1 日の上限: アップロード 1 回で、D1 は 93 行を書き、761 行を読む(読む行のうち 632 行は、EmDash が書き込みの前に `sqlite_master` を全件読む分)。書き 10 万行 / 日は、アップロードだけなら約 1,000 回 / 日にあたる。普段の編集では問題にならないが、一括の取り込みなどでは注意する。根拠: **実測+公式ドキュメント**(`wrangler dev` のローカルの D1。[[workerd-d1-plugin-behavior]])
- 確かめられていないこと: 本番の D1 でのクエリ数・行数と、上限を超えたときのエラーの形。[[T32-cloudflare-check|T32]] は `wrangler dev` のローカルの D1 で測った。利用者の了承を得て Workers Free にデプロイして測るのは、T32 の任意の作業で、2026-09-25 の利用者の判断で今は行わない([[T32-cloudflare-check#デプロイして測る(任意・利用者の了承待ち)]])。

> [!info] 調べた日
> 2026-09-24 に、Cloudflare のドキュメントを検索して確認した(Cloudflare docs の MCP の検索)。
