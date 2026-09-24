---
id: T21
title: "未使用画像の判定と画像管理ルートを作る"
type: 実装
status: todo
wave: 3
depends_on:
  - "[[T03-shared-contracts]]"
  - "[[T06-decision-trash-permission]]"
  - "[[T10-spike-after-save]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/orphans.ts"
  - "src/server/routes/images-admin.ts"
  - "src/server/hooks/image-deleted.ts"
  - "tests/server/orphans.test.ts"
spec:
  - "[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出]]"
  - "[[base64-image-plugin-spec#10. 画像のライフサイクル]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T21 未使用画像の判定と画像管理ルートを作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T03-shared-contracts|T03]]、[[T06-decision-trash-permission|T06]]、[[T10-spike-after-save|T10]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出|仕様書 9章]]、[[base64-image-plugin-spec#10. 画像のライフサイクル|仕様書 10章]]

## 目的

仕様書 9 章の判定と、10 章の削除操作のサーバー側を作る。

## 作業内容

- [ ] 一覧ルート: `imageRefs` を `createdAt` 順に 10 件程度ずつ取得し、参照元ごとに公開版と下書き(`getRevision`)を確認して状態を判定する
- [ ] 状態: 使用中 / 参照元が削除された / 参照元から外された / 参照元なし
- [ ] ゴミ箱へ移動するルート([[T06-decision-trash-permission|T06]] で決めた権限)
- [ ] `content:afterDelete` で `b64_images` が完全削除されたら、`imageRefs` からも削除する
- [ ] 1 回に扱う件数は、固定にせずクエリ数の見積もりで決める([[T10-spike-after-save#結果|T10]]、仕様書 9 章)
  - 1 件あたりのクエリ数: 参照元は 1 / 3 / 6、画像の状態は 2 / 5 / 3
  - 同じ参照元はリクエストの中で 1 回だけ調べる
  - 予算(1 リクエストのクエリ数)の値を決める。上限は 1 呼び出し 1,000 だが、応答時間を抑えるため、十分小さくする
  - 参照元が多い画像(1 枚で予算を超えるもの)は、参照元をページ送りするか上限を設ける
- [ ] 画像の状態(ゴミ箱に入っていない / ゴミ箱 / 無い)は、`get` と `getTrashedVersioned` で判定する。`getTrashedVersioned` は `get` が `null` のときだけ呼ぶ。capability `content:restore` を宣言するかを決める(復元の権限も含むため。[[T03-shared-contracts#結果|T03]])
- [ ] `content:afterDelete` の `id` は URL に書いた値そのまま(slug のこともある)。`permanent === true` のときだけ `imageRefs` を消す([[T10-spike-after-save#結果|T10]])
- [ ] ゴミ箱に入った画像を `imageRefs` に記録するかを決める([[T17-admin-data-routes#結果|T17]] の未解決)
  - 今の `thumbnails` ルートは、ゴミ箱に入った画像を区別できない(`imageRefs` は完全削除まで残る)。そのため、一覧の列([[T24-list-column|T24]])はゴミ箱の画像にもサムネイルを出す
  - `content:afterDelete` の `permanent: false` で記録し、ゴミ箱から戻したときに消す必要がある。戻したときに呼ばれる hook が 0.39.1 にあるかを確かめる
  - 記録するなら、T03 の `imageRefsRecordSchema` を変える(サブタスクにする)

## 完了条件

- [ ] 単体テスト(偽の ctx で各状態を再現する)

## 変更してよいファイル

- `src/server/orphans.ts`
- `src/server/routes/images-admin.ts`
- `src/server/hooks/image-deleted.ts`
- `tests/server/orphans.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。
