---
id: T20
title: "参照元の記録(afterSave)を作る"
type: 実装
status: done
wave: 3
depends_on:
  - "[[T03-shared-contracts]]"
  - "[[T10-spike-after-save]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "src/server/hooks/owners.ts"
  - "tests/server/owners.test.ts"
spec:
  - "[[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出]]"
tags:
  - task
  - impl
  - server
created: 2026-09-23
---

# T20 参照元の記録(afterSave)を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T03-shared-contracts|T03]]、[[T10-spike-after-save|T10]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#9. 参照元の記録と未使用画像の検出|仕様書 9章]]

## 目的

仕様書 9 章の記録処理を作る。

## 作業内容

- [x] `content:afterSave` で、保存されたエントリの中の参照を取り出す
- [x] `imageRefs.getMany` → `owners` に追記 → `putMany`(1〜2クエリ)
  - 読むときは `getManyInBatches`(`src/server/image-refs.ts`)を使う。`getMany` は ID を分けずに IN 句に入れ、D1 では 99 件から例外になるので、50 件ずつに分ける([[T16-2-image-refs-batches|T16-2]])
  - このプラグインのフィールドは `getFieldWidgetKind`(`src/server/validate.ts`)で判定する(`json` 型で、かつ widget がこのプラグインのもの。[[T11-server-validation|T11]]・[[T16-reference-hook|T16]] と同じ規則)
  - 書き込みは `putMany` ではなく、`getVersioned` → `compareAndSet`(版が変わっていたら読み直す)にした。同時の保存で追記が消えるため([[#決めたこと]] の 2)
- [x] 追記だけを行い、削除はしない。同じ参照元は重複させない
- [x] afterSave は遅れて実行されるので、例外は外に出さずにログに出す
- [x] [[T10-spike-after-save#結果|T10]] の結果に合わせる(仕様書 9 章):
  - 参照は `event.content.data`(下書き)と `event.content.liveData`(列の値)の両方から集める
  - `content:afterPublish` でも同じ処理をする(一覧の一括公開では afterSave が呼ばれない)
  - hook に `errorPolicy: "continue"` を指定する
  - `b64_images` と、このプラグインの widget を持たないコレクションは読み飛ばす
- [x] (リーダーの追加の指定)afterSave / afterPublish の handler の本体を export する(登録は T29)。ctx は使う部分だけの型にする
- [x] (リーダーの追加の指定)`entryId` と `locale` を event のどこから取るかを、T10 の実測とソースで確かめる
- [x] (リーダーの追加の指定)同時の保存で追記が消える問題: 0.39.1 のプラグインストレージに条件付きの書き込み・トランザクションがあるかを確かめ、影響と対策を書く
- [x] (リーダーの追加の指定)`imageRefs` の記録がスキーマに合わない・記録が無いときの扱いを決める
- [x] (リーダーの追加の指定)使い捨てのプラグインとサイト(`spikes/owner-tracking/`)で、管理画面と REST の作成・下書きの保存・公開・一覧からの一括公開・同じ画像を 2 つの投稿で使う、の記録とクエリ数を確かめる
- [x] (リーダーの追加の指定)偽の ctx で単体テストを書き、わざと入れた不具合でテストが失敗することを確かめる
- [x] (リーダーの追加の指定)仕様書の 9 章と 5.3 を最小限に直す

## 完了条件

- [x] 単体テスト
- [x] [[T10-spike-after-save|T10]] の結果(渡される内容)に合った実装になっている

## 変更してよいファイル

- `src/server/hooks/owners.ts`
- `tests/server/owners.test.ts`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 概要(2026-09-24)
> - `src/server/hooks/owners.ts` に、`content:afterSave` / `content:afterPublish` の本体(`recordImageOwnersAfterSave` / `recordImageOwnersAfterPublish`)と、T29 がそのまま登録する設定 `imageOwnerHooks`(`priority: 50`、`errorPolicy: "continue"`)を作った。EmDash の `ContentHookEvent` / `ContentPublishStateChangeEvent` / `PluginContext` をそのまま渡せる(型のテストで確かめた)。
> - 書き込みは `putMany` ではなく、`getVersioned` → `compareAndSet`(版が変わっていたら読み直す)にした。0.39.1 のプラグインストレージには条件付きの書き込みがあり、トランザクションは無い。「`getMany` → 追記 → `putMany`」では、同時の保存で追記が消えることを実測で確かめた。
> - `tests/server/owners.test.ts` に 47 件のテストを書いた(偽の `imageRefs` は、EmDash と同じく書き込みのたびに版を変える)。実装を 23 通りに壊し、どれもテストが失敗することを確かめた。
> - 使い捨てのサイト(`spikes/owner-tracking/`、git 管理外)で、REST と管理画面(Chromium)の、作成・下書きの保存・自動保存・公開・一覧からの一括公開・同じ画像を 2 つの投稿で使う、の記録とクエリ数を確かめた。
> - 知見ノート: [[emdash-plugin-storage-conditional-writes]](条件付きの書き込みと、同時の追記で消える問題の実測)、[[image-owner-tracking-hooks]](操作ごとの記録とクエリ数、`errorPolicy` と優先度の実測)
> - 仕様書は 9 章と 5.3 を直した([[#仕様書・他のタスクへの影響]])。

### 主な export

| export | 内容 |
|---|---|
| `recordImageOwnersAfterSave(event, ctx)` / `recordImageOwnersAfterPublish(event, ctx)` | hook の本体。例外は投げない(失敗は `ctx.log` に出す)。戻り値は `undefined` |
| `imageOwnerHooks` | `{ "content:afterSave": { priority, errorPolicy, handler }, "content:afterPublish": {…} }`。T29 は `hooks: { ...imageOwnerHooks, … }` と書く |
| `trackImageOwners(event, ctx, hook)` | 本体。画像ごとの結果(`appended` / `unchanged` / `missing` / `broken` / `conflict` / `failed`)と、読み飛ばした理由を返す(テストと動作確認用) |
| `readReferencedImageIds(value, kind)` | フィールドの値から、参照の形に合う画像 ID を取り出す。T21 の判定(参照元のフィールドに画像がまだあるか)でも同じ規則で使える |
| `MAX_APPEND_ATTEMPTS`(8)、`OWNER_HOOK_PRIORITY`(50) | 1 枚に試す回数、hook の優先度 |
| 型 `OwnerHookEvent` / `OwnerHookContext` / `ImageRefsStore` / `OwnerHookLog` ほか | EmDash の型のうち、この hook が使う部分 |

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | 参照元は `{ collection: event.collection, entryId: event.content.id, locale: event.content.locale, field }`。afterSave と afterPublish で同じ。ID・ロケールが `imageOwnerSchema` に合わなければ記録せずに警告する(クエリなし) | どちらの event の `content` もエントリ全体で、`id` と `locale` を持つ(171 回の呼び出しで確かめた)。`locale` の型は `string \| null` | 実測+公式ドキュメント(`core/src/emdash-runtime.ts:545-547`、`core/src/database/repositories/types.ts:302`) |
| 2 | 書き込みは、`getMany`(50 件ずつ)で読み、足すものがある画像だけ `getVersioned` → `compareAndSet`。版が変わっていたら読み直す。`putMany` は使わない | 同時の保存で「`getMany` → `putMany`」は先の追記を消す(20ms の待ちを入れた実測で、同時作成 8 件中 6 件、並行公開 6 件中 4 件が消えた)。0.39.1 には `compareAndSet` があり、版はどの書き込みでも変わる。プラグインのトランザクションは無い | 実測+公式ドキュメント([[emdash-plugin-storage-conditional-writes]]) |
| 3 | 1 枚に試すのは 8 回まで。使い切ったら警告を出してあきらめる(エントリを次に保存・公開したときに記録される) | 管理画面の一括操作は同時に 5 件(`admin/src/lib/bulk.ts:13`)で、競合は最悪 4 回。実測の最大は、5 件の並行公開で 5 回、8 件の同時作成で 6 回。競合が無ければ 1 回で済む | 実測+公式ドキュメント(回数の選び方は推測のみ) |
| 4 | 記録が無い画像(seed の画像、完全削除された画像)には記録を作らない。`warn` を 1 回出す | 記録の `thumb` などはサーバーで作れず、部分的な記録は T17・T21 の読み出しを壊す。完全削除と競合したときに記録を生き返らせない(`getVersioned` が `null` なら書かない) | 実測+公式ドキュメント(seed の投稿の公開で確かめた。方針は設計判断) |
| 5 | 記録が `imageRefsRecordSchema` に合わなくても、`owners` が配列(か無い)なら追記する。ほかのキーと既存の `owners` の要素は、壊れていてもそのまま残し、`warn` を出す。記録がオブジェクトでない・`owners` が配列でないときは書かずに `error` を出す | 参照元を失うと、使われている画像が「参照元なし」に見える。追記は何も消さない。分からない値は上書きしない | 実測のみ(3 つの場合をスパイクで確かめた。方針は設計判断) |
| 6 | 参照として扱うのは、このプラグインの widget を使う `json` フィールド(`getFieldWidgetKind`)の値のうち、`isBase64ImageRef` に合うものだけ。ギャラリーは要素ごとに見る(形の合わない要素は飛ばす) | サイトの描画(T15)と同じ規則。beforeSave(T16)を通った値は必ず合う | 公式ドキュメントのみ(`src/site/resolve.ts`、`src/server/hooks/references.ts`) |
| 7 | `data` と `liveData` に参照の形の値が 1 つも無ければ、フィールド定義も記録も読まない(クエリ 0)。あれば `ctx.schema.getCollection` で widget のフィールドを確かめる | widget のフィールドが無いコレクションや、画像が空の保存で、2 クエリ増やさない(T16 の beforeSave は、同じ場合でも 2 クエリ使う) | 実測のみ(`pages` で 0 と 2) |
| 8 | `priority: 50`、`errorPolicy: "continue"`。hook は例外を投げない | 既定(100・`"abort"`)のほかのプラグインが例外を投げても、先に実行されて記録できた。`"continue"` の hook の例外は、EmDash はログに出さない(結果の配列に入れるだけ)ので、自分で `ctx.log` に出す | 実測+公式ドキュメント(`core/src/plugins/hooks.ts:390-420`、`:630-641`) |
| 9 | 画像ごとの書き込みは並行に行い、1 枚の失敗(例外)はほかの画像を止めない。ログは種類ごとに 1 回(画像 ID は 10 件まで) | 画像ごとの書き込みは互いに関係しない。保存のたびにログを大量に出さない | 設計判断 |

### 同時の保存(影響と対策)

- 0.39.1 のプラグインストレージ: `getVersioned` / `compareAndSet` / `compareAndDelete`(行ごとの版 `revision` による条件付きの書き込み)と、1 文の `updateIf`(`set` と整数の `delta`。配列への追記はできない)がある。版は `put` / `putMany` / `compareAndSet` が新しい UUID を書き、`updateIf` ではトリガーが変える(マイグレーション 077)。プラグインが使えるトランザクションは無い。`putMany` のトランザクションは自分の upsert だけを包み、D1 では包まない。根拠: 公式ドキュメントのみ(`core/src/database/repositories/plugin-storage.ts:174-237`、`:293-325`、`:494-533`、`core/src/database/transaction.ts`)
- 影響: 参照元が消えると、使われている画像が画像管理ページで「参照元なし」や「参照元から外された」に見え、ゴミ箱に移されると、サイトからその画像が消える。消えた側の hook は書き込みに成功しているので、ログにも出ない。根拠: 推測のみ(消えることと、消えた側が気付かないことは実測のみ)
- 起きる場面: 同じ画像を参照する複数のエントリ(複製したエントリ、同じ画像を選んだ別の投稿)を、同時に保存・公開したとき。管理画面の一括公開は 5 件ずつ並行に送る。「公開」ボタンの afterSave と afterPublish も同じ画像に続けて書く(同じ参照元なので、消えても害は無い)。
- 実測(ストレージの呼び出しに 20ms の待ちを入れた Node + SQLite、3 回ずつ): 「`getMany` → `putMany`」は、並行公開 6 件中 2 件、同時作成 8 件中 2 件しか残らなかった。版を確かめる方式は、すべて残った(読み直しは計 10 回・16 回)。待ちを入れないと、Node の開発サーバーでは hook が重ならず、どちらの方式でも消えなかった。根拠: 実測のみ
- 残る制約: (1) 8 回で書けなかったとき(警告を出す。次の保存・公開で記録される)。(2) ほかの処理が `imageRefs` を無条件の `put` / `putMany` で書き直すと守れない。記録を書き換える処理は `compareAndSet` を使う(仕様書 5.3 に書いた)。T18 の `put` は新しい画像 ID への作成だけなので問題ない。

### 実測(スパイク)

環境: macOS 26.4(arm64)、Node 26.10.0、emdash 0.39.1、Astro 7.3.3、SQLite、Playwright 1.63.0(Chromium 153.0.8010.12)。開発サーバーはポート 4420。詳しくは [[image-owner-tracking-hooks]]。hook のクエリは、hook の前後の `metrics.dbCount` の差(呼び出しの数からの見込みと一致)。根拠: どれも実測のみ。

| 操作 | REST: 呼ばれた hook / 結果 / hook のクエリ | 管理画面: 送られたリクエスト / 呼ばれた hook / hook のクエリ |
|---|---|---|
| 作成 | afterSave(`isNew: true`)/ 追記 / 5 | `POST`(+ `lock`)/ afterSave / 5 |
| 下書きの保存 | afterSave(`liveData` あり)/ 新しい 2 枚を追記 / 7 | `PUT`(全フィールド)/ afterSave / 5 |
| 自動保存 | afterSave / 記録済み / 3 | `PUT`(`skipRevision`)/ afterSave / 3 |
| 公開 | afterPublish(API だけ)/ 記録済み / 3 | `PUT` → `POST …/publish` / afterSave → afterPublish / 3 + 3 |
| 一覧からの一括公開 | 複製 5 件を並行に公開: afterPublish × 5 / 5 件とも追記 / 5 ずつ | 複製 2 件と元を選んで「Publish」: afterPublish × 3 / 複製 2 件を追記・元は記録済み / 5・5・3 |
| 同じ画像を 2 つの投稿で使う | 2 つ目の作成で追記(`owners` 2 件)/ 5 | 2 つ目の作成で追記(`owners` 2 件)/ 5 |
| 複製 | どの hook も呼ばれない | 一覧の「Duplicate」: hook なし |
| そのほか(REST) | 公開済みの下書きで差し替え: 新しい画像だけ追記(公開版の画像は記録済み)/ 5。SEO だけの更新: afterSave / 3。seed の画像: `missing`・警告 / 3。画像のフィールドの無い `pages`: 0 か 2 | — |

- 管理画面と REST のどちらでも、`entryId` は `event.content.id`、`locale` は `event.content.locale`(`en`)で、afterPublish にも入っていた。
- T29 と同じく `imageOwnerHooks` をそのまま登録した起動でも、作成と、複製したエントリの公開で記録された。
- 既定の設定のプラグイン(優先度 100)が afterSave で例外を投げたとき、この hook(優先度 50)は先に実行されて記録した。その後ろ(優先度 200)のプラグインは呼ばれなかった。この hook が例外を投げたとき(`"continue"`)は、後ろのプラグインは呼ばれ、EmDash のログには何も出なかった。

### T29 への引き継ぎ(登録のしかた)

```ts
// src/index.ts(T29)の抜粋
import { definePlugin } from "emdash";

import { imageOwnerHooks } from "./server/hooks/owners";
import { IMAGE_REFS_STORAGE } from "./shared/constants";

export function createPlugin() {
	return definePlugin({
		id: "base64-image",
		version: PLUGIN_VERSION,
		// content:read: afterSave / afterPublish の登録に必須(無いと警告だけ出して登録しない)
		// schema:read: ctx.schema(無いと、参照を含む保存・公開のたびにエラーのログが出て、記録されない)
		capabilities: ["schema:read", "content:read", "content:write", "content:publish", "content:revisions:read"],
		// ctx.storage.imageRefs(無いと同じくエラーのログが出て、記録されない)
		storage: { [IMAGE_REFS_STORAGE]: { indexes: ["createdAt"] } },
		hooks: {
			// content:afterSave / content:afterPublish。priority: 50、errorPolicy: "continue" を含む
			...imageOwnerHooks,
			// T16・T19 の beforeSave(errorPolicy は書かない。"continue" にすると拒否が捨てられる)
			"content:beforeSave": { handler: async (event, ctx) => { /* … */ } },
			// T21 の afterDelete
		},
	});
}
```

- `imageOwnerHooks` の `errorPolicy: "continue"` と `priority` を上書きしない。handler を包むときも例外を投げない。beforeSave の `errorPolicy` と混同しない(beforeSave は既定の `"abort"` のまま)。
- タイムアウトは既定の 5,000ms のまま。hook は、記録済みなら 3 クエリ、新しい画像 1 枚につき +2 で終わる(SQLite で 1〜3ms)。
- 登録の設定は、EmDash の `definePlugin` と `createHookPipeline` を通した単体テストで確かめてある(`tests/server/owners.test.ts` の「hook の登録(T29)」)。

### T21 への注意(記録を読むとき)

1. `owners` は増えるだけ。参照元が削除された・画像を外したエントリの要素も残る(判定で「参照元が削除された」「参照元から外された」になる)。4 つのキーが同じ要素は重複しない。同じエントリが別のフィールドで 2 回以上並ぶことがある(cover とギャラリー)ので、エントリごとに 1 回だけ調べる。
2. 記録は保存・公開の応答のあとで書かれる(`after()`)。保存の直後に一覧を開くと、まだ入っていないことがある。
3. 壊れた記録がありうる(`owners` の要素の形が壊れている、ほかのキーが無い)。T20 は直さない。記録全体を `imageRefsRecordSchema` で読むと、1 つの壊れた要素で読めなくなる。要素ごとに `imageOwnerSchema.safeParse` するなど、扱いを決める。
4. seed の画像など、`imageRefs` に記録の無い画像は、`imageRefs` の一覧に出てこない。
5. 参照元のフィールドに画像がまだあるかは、`readReferencedImageIds(value, kind)`(`src/server/hooks/owners.ts`)で読むと、記録と同じ規則になる(参照の形に合う値だけ。ギャラリーは要素ごと)。
6. `imageRefs` を書き換える処理(ゴミ箱の印を付けるなど。T21 の未決事項)は、`compareAndSet` で書く。`put` で書き直すと、その間に T20 が足した参照元が消える。完全削除の `delete` は問題ない(T20 は消えた記録を作り直さない)。
7. i18n の「翻訳しない」画像フィールドでは、EmDash がほかのロケールのエントリへ値を写すが、写された側は保存・公開するまで参照元に入らない(写した元は入る)。

### テスト

- `tests/server/owners.test.ts`: 47 件。
  - 読み飛ばし(クエリ 0): `b64_images`、参照の形の値が無い(空の画像・標準の画像フィールドの値・形の合わない値・`data` がオブジェクトでない)、エントリの ID・ロケールが不正。widget のフィールドに参照が無い(2 クエリ)、コレクションが無い
  - 追記: 作成(クエリ 2 + 1 + 2 × 枚数)、記録済み(クエリ 3・書かない)、既存の参照元を残して後ろに足す、ロケール違い、`data` と `liveData`、`liveData` だけ、cover とギャラリーの同じ画像、ギャラリーの不正な要素、ほかのキーを残す、afterPublish、120 枚で 50 件ずつの `getMany`
  - 記録が無い・壊れている: 作らない・警告 1 回、オブジェクトでない・配列・`owners` が配列でない(書かない・エラー)、`owners` が無い(作る)、スキーマに合わない(追記・警告)、壊れた要素の重複判定
  - 同時の書き込み: 8 つの hook が同時に同じ画像へ追記、版を読んでから書くまでの別の参照元・同じ参照元の書き込み、記録が消えた(作り直さない)、版が変わり続ける(8 回であきらめる・警告)
  - 失敗: `ctx.schema` / `imageRefs` が無い、フィールド定義・`getMany`・1 枚の `getVersioned` / `compareAndSet` の失敗(ほかの画像は記録)、hook の本体は resolve する
  - hook の登録: EmDash の `createHookPipeline` で、既定の設定の例外を投げるプラグインを先に登録しても記録される(afterSave・afterPublish)、記録に失敗しても例外を投げない、`definePlugin` が優先度と `errorPolicy` を解決した値
  - 型: EmDash の handler(`ContentHookEvent` / `ContentPublishStateChangeEvent` / `PluginContext`)と `PluginHooks` に代入できる。`StorageCollection` を `ImageRefsStore` として渡せる
- 実装を 23 通りに壊し、どれもテストが失敗することを確かめた: 優先度を 100 にする / `errorPolicy` を `"abort"` にする / 版が変わっても読み直さない / 書けなかったのに追記したことにする / 試す回数の上限を外す(無限に試して、テストのワーカーがメモリ不足で落ちた)/ 重複を確かめない / ロケールを比べない / `liveData` を読まない / 記録が無い画像を別扱いしない / `owners` が配列でなくても上書きする / ほかのキーを落とす / 消えた記録を作り直す / 例外を外に投げる / `b64_images` を読み飛ばさない / 参照の形の値が無くてもフィールド定義を読む / フィールドの型を見ない / 50 件ずつに分けない / ID・ロケールを確かめない / ギャラリーの最初の要素だけを読む / スキーマに合わない記録を報告しない / 1 枚の失敗で全体を失敗にする / 記録が無い画像を警告しない / afterPublish で何もしない。根拠: 実測のみ

### 仕様書・他のタスクへの影響

- 仕様書 9 章(記録): 参照元の値と対象の値、クエリ数(0 / 3 / 新しい画像 1 枚につき +2)、同時の保存と `compareAndSet`、記録が無い・壊れているときの扱い、`priority: 50` と `"continue"` の例外がログに出ないこと、i18n の「翻訳しない」フィールドの写しが記録から漏れること、を書いた。
- 仕様書 5.3: 同じ参照元は重複させないこと、afterSave / afterPublish は記録を作らないこと、既存の記録の書き換えは版を確かめて書くこと、を書いた。
- ほかの章への反映の候補(リーダーが判断する。変更していない):
  - 17 章または 18 章: D1(Workers)での同時の保存の競合の起きやすさと、hook のクエリ数は [[T32-cloudflare-check|T32]] で確かめる。
  - 付録 B: `packages/core/src/database/repositories/plugin-storage.ts:174`(条件付きの書き込み)、`packages/core/src/database/migrations/077_plugin_storage_revisions.ts`(版のトリガー)、`packages/core/src/plugins/hooks.ts:630`(`errorPolicy` と例外のログ)、`packages/core/src/database/instrumentation.ts:83`(クエリログの書き出し)。
- [[T29-plugin-definition|T29]]: 上の登録のしかた。
- [[T21-orphan-routes|T21]]: 上の注意。`imageRefs` を書き換えるなら `compareAndSet`。
- [[T18-upload-route|T18]]: 新しい画像 ID への `put` はそのままでよい。最初の参照元を記録するときの値を、T20 と同じ形(`{ collection, entryId, locale, field }`、`locale` はエントリのロケール)にすると、あとで T20 が同じ参照元を重複させない。
- [[T32-cloudflare-check|T32]]: D1 で、hook のクエリ数(3 / +2)と、並行公開・同時作成で参照元が消えないことを確かめる。
- [[T31-e2e|T31]]: 一括公開や複製の E2E で `owners` を確かめるときは、保存の応答のあと少し待つ(hook は応答のあとに実行される)。

### 未解決・サブタスクの候補

1. 保存 1 回で、`ctx.schema.getCollection`(2 クエリ)を beforeSave(T16)と afterSave(T20)が 1 回ずつ呼ぶ(参照の形の値があるとき)。リクエストの中で共有する手段がプラグインに無いので、そのままにした。上限(1 呼び出し 1,000)には十分収まる。
2. 8 回で書けなかった参照元は、エントリを次に保存・公開するまで記録されない。後から埋める処理は無い(警告だけ)。
3. i18n の「翻訳しない」画像フィールドの写しは記録から漏れる(写した元は記録されるので、画像が「参照元なし」にはならない)。実測はしていない。
4. 知見の索引(`docs/00-index.md`)への 2 つのノートの登録(リーダー)。

### 環境と手順

- macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、npm 12.0.2、emdash 0.39.1、Astro 7.3.3、SQLite(`node:sqlite`)、Playwright 1.63.0(Chromium 153.0.8010.12、headless)。開発サーバーはポート 4420。2026-09-24 に計測。
- スパイク: `spikes/owner-tracking/site/`(playground の複製。プラグイン 3 つ)、`spikes/owner-tracking/scripts/`(`rest-scenarios.mjs`、`admin-scenarios.mjs`、`race.mjs`、`exported-check.mjs`)。起動は `SPIKE_OWNERS_MODE=cas|naive|exported`、`SPIKE_STORAGE_DELAY_MS`、`EMDASH_QUERY_LOG=1` を付けて `astro dev --port 4420`。手順とコードは [[image-owner-tracking-hooks#再現手順]] と [[emdash-plugin-storage-conditional-writes#再現手順]]。
- Cloudflare Workers(workerd + D1)では確かめていない。
