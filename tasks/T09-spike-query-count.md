---
id: T09
title: "スパイク: 画像の解決にかかるクエリ数を測る"
type: スパイク
status: done
wave: 2
depends_on:
  - "[[T02-playground]]"
soft_depends_on: []
blocks: []
files:
  - "spikes/query-count/**(使い捨て)"
  - "このノートの「結果」"
spec:
  - "[[base64-image-plugin-spec#12. サイト側の描画]]"
  - "[[base64-image-plugin-spec#16. 実装前の検証(スパイク)]]"
tags:
  - task
  - spike
created: 2026-09-23
---

# T09 スパイク: 画像の解決にかかるクエリ数を測る

> [!info] 概要
> - 種別: スパイク / ウェーブ: 2
> - 着手の条件(依存): [[T02-playground|T02]]
> - このタスクを待つもの: なし
> - 仕様: [[base64-image-plugin-spec#12. サイト側の描画|仕様書 12章]]、[[base64-image-plugin-spec#16. 実装前の検証(スパイク)|仕様書 16章]]

## 目的

仕様書 16 章の3つ目。`getEmDashCollection("b64_images", { where: { id: [...] } })` が実際に何クエリかかるかを測る。

## 作業内容

- [x] playground に画像エントリを 10〜50 件作る(プラグイン経由と seed 経由の両方。authorId の有無で差が出るかを見る)
  - playground そのものではなく、playground の設定を複製した使い捨てのサイト(`spikes/query-count/site/`)に作った(リーダーの指定)。seed・標準の REST API・spike 用のプラグインのルートで、それぞれ 60 件(多言語の構成では en・ja 各 30 件)。
- [x] Kysely のクエリログなどで、ID 10件 / 50件 / 51件のときのクエリ数を数える
- [x] locale を明示したときとしないときの挙動を確認する

## 完了条件

- [x] 結果を記録し、[[T15-site-resolve|T15]] の分割単位とクエリ数を確定した

## 変更してよいファイル

- `spikes/query-count/**`(使い捨て)
- このノートの「結果」

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!summary] 結論(2026-09-24)
> - [[T15-site-resolve|T15]] の分割単位は **50 件**(仕様どおり)。
> - 1 ページあたりのクエリ数は、ロケールごとに `ceil(件数 / 50)` 回の呼び出しで、1 回につき本体の 1 クエリ。これにバイラインの補完が加わる。このプラグインで作った画像(authorId なし)なら、1 ロケール・50 件までのページで 1〜3 クエリ。
> - 仕様書 12 章の「1〜3クエリの見込み(推測のみ)」を実測値に直した。16 章のチェックリストはリーダーが更新する。
> - 測定の手順・SQL・全データ・再現のコードは [[emdash-query-count-b64-images]]。

### 測り方

- playground の設定を複製した使い捨てのサイト(`spikes/query-count/site/`、Node + SQLite、`astro dev --port 4409`)で、`/qc` エンドポイントから `getEmDashCollection("b64_images", { where: { id }, locale })` を 50 件ずつに分けて呼んだ。
- 数え方は、応答の `Server-Timing` の `db.count` と、`EMDASH_QUERY_LOG=1` の Kysely のログ(SQL・パラメータ付き)の両方。すべての場合で一致した。匿名の GET で、1 回の暖機のあと 3 回測り、3 回とも同じ値だった。
- 画像エントリは、T03 の `base64ImageEntrySchema` の形(`tests/fixtures/webp/lossy.webp` の data URL)で、seed(authorId なし)・標準の REST API(ログインした管理者。authorId あり)・spike 用のプラグインのルート(`ctx.content.create` → `getVersioned` → `publish`、capability は `content:write` / `content:publish`。authorId なし)の 3 通りで作った。全件がスキーマを通った。
- サイトの状態を A バイラインなし → B ゲストのバイラインあり → C 作者(管理者)のバイラインあり → D バイラインのカスタムフィールドあり、と変えて同じ組み合わせを測った。

### クエリ数(1 リクエスト。51 件は 50+1 の 2 回の呼び出し)

根拠: **実測+公式ドキュメント**(`references/emdash/packages/core/src/query.ts:1085-1197`、`references/emdash/packages/core/src/loader.ts:1357-1431`)

| サイトの状態 | 画像の作り方(authorId) | 10 件 | 50 件 | 51 件 |
|---|---|---|---|---|
| A バイラインなし | seed・REST・プラグイン | 1 | 1 | 2 |
| B ゲストのバイラインあり | seed・プラグイン(なし) | 2 | 2 | 3 |
| B | REST(あり) | 3 | 3 | 6 |
| C 作者のバイラインあり | seed・プラグイン(なし) | 2 | 2 | 3 |
| C | REST(あり) | 4 | 4 | 7 |
| D カスタムフィールドあり | seed・プラグイン(なし) | 3 | 3 | 5 |
| D | REST(あり) | 6 | 6 | 10 |

- **本体は 1 回の呼び出しにつき 1 クエリ。** タクソノミーとバイラインのクレジットは、本体の SQL に相関サブクエリとして畳み込まれている。locale を指定してもしなくても数は同じ。
- **authorId の有無でクエリ数が変わるのは、サイトにバイラインがあるときだけ。** バイラインが無いサイト(A)では、作り方によらず同じだった。バイラインがあると、authorId のある画像は作者のバイラインの補完(`_emdash_content_bylines` と `_emdash_bylines`)で呼び出しごとに +2 になる。authorId の無い画像は、カスタムフィールドの有無の確認(`options`)でリクエストあたり +1。
- このプラグインのアップロード(`ctx.content.create`)は authorId を付けない(実測で `authorId: null`)。標準の REST API と管理画面で作ると付く。
- ほかに、isolate に 1 回だけのクエリがある: `_emdash_taxonomy_defs`(`where` を使う最初の呼び出し)と `_emdash_byline_fields`(バイラインがあるサイト)。起動直後の最初のリクエストは 3 増えた(残りの 1 つは、画像と関係の無い 30 秒ごとの `_emdash_redirects`)。根拠: **実測+公式ドキュメント**

### 1 回の IN 句に入れられる ID の数

根拠: **実測+公式ドキュメント**(D1 そのものでは未実測。node:sqlite の `limits.variableNumber` を 100 にした dialect で模擬した。上限 100 は Cloudflare D1 Limits)

- 本体のクエリのバインド変数は、**ID の数 + 7(locale あり)/ + 6(locale なし)**。多言語サイトでは locale を省いても既定のロケールで `locale = ?` が付くので + 7 になる。
- 上限 100 の模擬で、locale ありは 93 件まで、なしは 94 件まで通った。1 件でも超えると失敗した。
- 失敗しても例外にならない。`getEmDashCollection` は `{ entries: [], error }`(`error.message` は `Failed to load collection: too many SQL variables`)を返し、ページは HTTP 200 のまま、サーバーのログにも何も出なかった。

### locale を指定したとき・しないとき

根拠: **実測+公式ドキュメント**(`references/emdash/packages/core/src/query.ts:769-774`、`references/emdash/packages/core/src/astro/middleware/request-context.ts:200-212`)

- 単一ロケールのサイト(playground と同じ)で locale を省くと、ロケールで絞り込まない。`locale: "ja"` を指定すると en の画像は 0 件になる。
- 多言語のサイト(en・ja、既定は en)で locale を省くと、**匿名の訪問者は `/ja/` のページでも既定の en に絞り込まれ**、ja の画像は 0 件だった。**編集モードの編集者はページのロケールに絞り込まれ**、`/ja/` では en の画像が 0 件だった。リクエストのロケールが使われるのは、編集モードかプレビューのときだけだった。
- locale を明示すると、見ている人やページによらず、指定したロケールの画像だけが返った。参照をロケールでまとめて明示すると、ロケールの数だけ呼び出しが増える(en 5 + ja 5 は 2 クエリで 10 件)。

### T15 への申し送り

1. 分割単位は 50 件。locale ありで 57 個になり、上限 100 まで 43 の余裕がある。EmDash 自身も IN 句を 50 件ずつに分けている(`references/emdash/packages/core/src/utils/chunks.ts:17`)。93 件まで入るが、余裕が無く、EmDash の SQL にバインド変数が 1 つ増えるだけで黙って失敗するので採らない。
2. 参照の `locale` でまとめ、`locale` を必ず渡す(省いたときの結果は、見ている人とページのロケールで変わる)。
3. 戻り値の `error` を確かめる。例外にならないので、見ないと画像が黙って消える。`error` があれば、その呼び出しの ID をすべて「見つからない」として警告ログを出す。
4. 結果は `entry.data.id` で引く。多言語サイトでは、既定以外のロケールの `entry.id` が `ja/01M37…` のようになる(実測+公式ドキュメント。`references/emdash/packages/core/src/loader.ts:1443-1449`)。
5. 返る順番は `created_at DESC, id DESC` で、要求した順ではない。ID をキーにした Map にする(公式ドキュメントのみ。`references/emdash/packages/core/src/loader.ts:686-690`)。
6. (任意)同じリクエストの中で、フィルターがまったく同じ呼び出しは 1 回にまとまる。ID の順番が違うとまとまらなかったので、並べ替えてから呼ぶとよい(実測+公式ドキュメント。`references/emdash/packages/core/src/query.ts:468`)。

### 未確認

- Cloudflare(wrangler dev・D1)での数。SQL は同じなので画像の解決のクエリ数は同じ見込み(推測のみ)。D1 では、匿名の HTML のリクエストで EmDash がレイアウト用のデータを先読みするので、リクエスト全体の数は増える(公式ドキュメントのみ)。[[T32-cloudflare-check|T32]] で確かめる。
- `Server-Timing` の `db.count` は、ストリーミング中に描画されるコンポーネントのクエリを含まない(公式ドキュメントのみ)。今回はエンドポイントとページの frontmatter で呼んだので、影響は無い。
