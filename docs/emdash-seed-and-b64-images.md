---
title: EmDash の seed の適用と b64_images の最小構成
aliases:
  - seed の適用のされ方
  - b64_images の seed
  - dev-bypass
  - widget が無いフィールドの表示
tags:
  - docs
  - emdash
  - seed
  - admin
source_task: "[[T02-playground]]"
created: 2026-09-24
updated: 2026-09-24
---

# EmDash の seed の適用と b64_images の最小構成

> [!summary] 要点
> - seed は `seed/seed.json` などから読まれ、仮想モジュールに埋め込まれる。**動いている開発サーバーは、seed の変更を読み直さない。**
> - seed が適用されるのは、(1) コレクションが 0 件でセットアップ前の最初のリクエスト(サンプルの内容は除く)と、(2) dev-bypass / セットアップの画面(サンプルの内容も)。どちらも既存のコレクションは飛ばす。**seed を変えたら、サーバーを止めてデータベースを消す。**
> - `b64_images` の最小構成は `hidden: true` / `routable: false` / `supports: []` / フィールド `image`(json、必須)だけ。**タイトル用のフィールドは要らない。`routable: false` は必須**(slug の無いエントリを公開するため)。
> - `supports: []` でも、公開すると画像データをまるごと複製したリビジョンが 1 件できる。画像 1 枚が DB を約 2 倍使う。
> - widget が見つからないフィールドは、JSON の入力欄(textarea)で表示される。プラグインの widget ができるまでは、参照を JSON で直接入力できる。
> - 関連: [[T02-playground]]、[[base64-image-plugin-spec#13.1 seed|仕様書 13.1]]、[[base64-image-plugin-spec#17. 実装時に再確認する事項|仕様書 17 章]]、[[emdash-playground-site-config]]、[[playground/README|playground の README]]

## seed の探し方と読み込み

- 探す順番: `.emdash/seed.json` → `package.json` の `emdash.seed` → `seed/seed.json`(`references/emdash/packages/core/src/astro/integration/virtual-modules.ts:580-638`)。どれも無ければ、組み込みの既定の seed(posts / pages と分類)になり、開発サーバーでは警告が出る。playground は `playground/seed/seed.json` に置いた。根拠: **公式ドキュメントのみ**
- 見つかった seed は `virtual:emdash/seed` に埋め込まれる。このモジュールは seed のファイルを監視対象に加えない(`references/emdash/packages/core/src/astro/integration/vite-config.ts:320-323` に `addWatchFile` が無い)。`seed.json` を変更しても、開発サーバーは再読み込みも再起動もしなかった。根拠: **実測+公式ドキュメント**
- 検証(`references/emdash/packages/core/src/seed/validate.ts`)に通らない seed は、dev-bypass と自動適用のどちらでも**黙って**飛ばされる(`references/emdash/packages/core/src/astro/routes/api/setup/dev-bypass.ts:65` の `if (validation.valid)` に else が無い)。コレクションが増えないときは、seed の検証エラーを疑う。根拠: **公式ドキュメントのみ**

## 適用のタイミング

| きっかけ | 適用する内容 | 既存のコレクション | 根拠 |
|---|---|---|---|
| コレクションが 0 件で、セットアップ前の最初のリクエスト | コレクション・フィールド・設定・メニューなど。サンプルの内容・バイライン・分類の語は入れない(`includeContent` の既定は `false`) | 飛ばす | `references/emdash/packages/core/src/emdash-runtime.ts:1648-1695`、`references/emdash/packages/core/src/seed/apply.ts:128-131` |
| `GET /_emdash/api/setup/dev-bypass` | 上に加えて、サンプルの内容も入れる(`?content=0` で入れない) | 飛ばす | `dev-bypass.ts:59-84` |

- 開発サーバーは起動直後に `POST /_emdash/api/typegen` を自分に送る。このリクエストでマイグレーションと自動適用が走り、`Auto-seeded default collections` とログに出た(文言は既定の seed でなくても同じ)。そのあと dev-bypass を開くと `Seed applied: 0 collections, 0 fields` になった。根拠: **実測+公式ドキュメント**
- 既存のコレクションは、フィールドも含めて何も変えない(`onConflict: "skip"`。`references/emdash/packages/core/src/seed/apply.ts:217-285`)。seed のフィールドを変えたら、データベースを消して最初から適用する。根拠: **公式ドキュメントのみ**
- `supports` に `search` があっても、`searchable: true` のフィールドが無いと検索は有効にならない(`references/emdash/packages/core/src/seed/apply.ts:935-951`)。仕様書 13.1 の `posts` の例はこれに当たり、playground の `posts` は `search_config` が `null` のままだった。根拠: **実測+公式ドキュメント**
- マイグレーションが一度も走っていないデータベースでは、ログインしていない公開ページへのリクエストが `/_emdash/admin/setup` に 302 で転送される(`references/emdash/packages/core/src/astro/middleware.ts:721-733`)。開発サーバーの起動直後に `/` を開くと、typegen のリクエストより先に着いて 302 になることがあった。根拠: **実測+公式ドキュメント**

## 開発用ログイン(dev-bypass)

- `GET /_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` は、seed の適用、管理者 `dev@emdash.local`(role 50)の作成、`emdash:setup_complete` の設定、セッションの作成をまとめて行う(`dev-bypass.ts:45-212`)。`import.meta.env.DEV` のときだけ動き、`astro preview` では 403 だった。根拠: **実測+公式ドキュメント**
- 応答は `meta refresh` の HTML で、Cookie `astro-session`(HttpOnly、SameSite=Lax)が付く。`curl -c` で保存した Cookie と `X-EmDash-Request: 1` ヘッダーで、REST API を呼べた。根拠: **実測のみ**
- セッションは `playground/node_modules/.astro/sessions` に保存される。このディレクトリやデータベースを消したら、dev-bypass を開き直す。根拠: **実測のみ**
- 初めてログインしたときは「Welcome to EmDash, Dev!」のダイアログが出て、画面の操作を塞ぐ。Playwright では「Get Started」を押してから操作した。根拠: **実測のみ**
- 応答の `Server-Timing` ヘッダーに `db.count`(クエリ数)が出る。[[T09-spike-query-count|T09]] の計測に使える見込み。根拠: **実測のみ**(値の正しさは未確認)

## b64_images の最小構成

仕様書 13.1 の seed(`hidden: true` / `routable: false` / `supports: []` / `image` は json・必須)を適用し、標準の REST API と管理画面で確かめた。

| 確かめたこと | 結果 | 根拠 |
|---|---|---|
| seed の反映 | `hidden` / `routable` / `supports` / `widget` / `options` がそのまま保存された。テーブルの列は `"image" json default 'null' not null` | 実測のみ |
| タイトルなしで作成(`{ data: { image } }`) | 201。`slug` は `null`、状態は `draft`、ロケールは `en` | 実測のみ |
| `image` を省略 | 400 `VALIDATION_ERROR`(`image: … received undefined`) | 実測のみ |
| `image` に `null` | **500 `CONTENT_CREATE_ERROR`**(列の NOT NULL に違反) | 実測のみ |
| `image` に文字列 | 201(json の中身は検証されない) | 実測のみ |
| slug なしで公開(`routable: false`) | 200。`published` になる | 実測のみ |
| slug なしで公開(`routable` を省略 = true、ほかは同じ) | **400 `Cannot publish routable content without a slug`** | 実測+公式ドキュメント(`references/emdash/packages/core/src/database/repositories/content.ts:2304-2306`) |
| 公開したときのリビジョン | `live_revision_id` が作られ、`revisions` の行に `data` がまるごと入る | 実測+公式ドキュメント(`content.ts:2308-2321`) |
| 管理画面の一覧(`/_emdash/admin/content/b64_images` を直接開く) | タイトル列に ID が出る。空のときは「No base64 images yet」 | 実測のみ |
| 管理画面のサイドバー | 出ない | 実測のみ |
| ダッシュボード | 「Content」の件数と「Recent Activity」には出る(タイトルは ID)。読むのは `id` や `COALESCE(slug, id)` などで、画像本体は読まない | 実測+公式ドキュメント(`references/emdash/packages/core/src/api/handlers/dashboard.ts:168-217`) |

- **タイトル用のフィールドは不要。** 無くても作成・公開・取得・一覧ができ、一覧とダッシュボードでは ID が表示される。
- **`routable: false` は必須。** プラグインが作るエントリには slug もタイトルも無いため、routable のままでは公開できない。
- `hidden: true` は、サイドバーとダッシュボードのクイックアクションから外すだけ(`references/emdash/packages/core/src/seed/types.ts:80-85`)。URL を直接開けば標準の一覧・編集画面を使える。
- `image` の `required: true` は「省略」だけを拒否し、`null` は DB の制約で 500 になる。`null` や不正な値は、プラグインの保存 hook([[T19-image-entry-hook|T19]])で先に拒否する。

### 公開でリビジョンが 1 件できる

- `supports` に `revisions` が無いコレクションでも、`repo.publish()` は `live_revision_id` が無ければ `existing.data` からリビジョンを作る(`content.ts:2308-2321`)。実測で、公開した `b64_images` のエントリの `GET …/revisions` は、画像の data URL を含む 1 件を返した。根拠: **実測+公式ドキュメント**
- プラグインの `ctx.content.publish` も同じ `handleContentPublish` を通る(`references/emdash/packages/core/src/emdash-runtime.ts:3894-3915`)。プラグインの `ctx.content.create` には状態を指定する引数が無い(`references/emdash/packages/core/src/plugins/types.ts:475-480`)ので、公開は避けられない。根拠: **公式ドキュメントのみ**
- 完全削除では、リビジョンも消える(`references/emdash/packages/core/src/api/handlers/content.ts:1472`)。根拠: **公式ドキュメントのみ**

> [!warning] 容量の見積もりへの影響
> 画像 1 枚が「エントリの行」と「リビジョン」の 2 か所に入るので、仕様書 5.4 の「D1 の 500MB で約 5,000 枚」は約 2,500 枚になる見込み(推測のみ。実際の行の大きさは未計測)。5.1 の「`supports: []`(リビジョン・下書き・検索なし)」も、公開時に 1 件だけできることを補う必要がある。

## widget が見つからないフィールドの表示

- 管理画面は、`widget: "pluginId:name"` のフィールドを次の順に探す(`references/emdash/packages/admin/src/components/ContentEditor.tsx:1806-1864`): (1) プラグインの管理画面モジュールの `fields[name]`(React)、(2) sandboxed プラグインのマニフェストの `fieldWidgets`(Block Kit)、(3) どちらも無ければ、フィールドの型の既定の入力欄。根拠: **公式ドキュメントのみ**
- 今の `src/admin.tsx` は `export const fields = {}` なので、`posts` の `cover`(`base64-image:image`)と `gallery`(`base64-image:gallery`)は、json の既定の入力欄になった。textarea(8 行、等幅、placeholder は `{}`)で、ラベルは「Cover (optional)」。根拠: **実測+公式ドキュメント**(`ContentEditor.tsx:2120-2132`、`:2323-2383`)
- フォーカスを外したときに `JSON.parse` する。不正な JSON は「Invalid JSON」と表示され、値は変わらない。正しい JSON は、オブジェクトや配列のまま保存された(`cover` は参照のオブジェクト、`gallery` は参照の配列)。根拠: **実測のみ**
- コンソールには警告もエラーも出なかった(区切りの `:` が無いときだけ `console.warn` が出る)。根拠: **実測のみ**
- `posts` の保存は 55〜94ms で、状態は `draft`、slug はタイトルから作られた。同じタイトルでもう一度作ると、slug が重なって 409 になった。根拠: **実測のみ**

> [!info] 計測環境
> macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、emdash 0.39.1、Astro 7.3.3、Playwright 1.63.0(Chromium 153.0.8010.12、headless)。開発サーバーは `npm run dev -w playground -- --port 4402`。確認のスクリプトは `spikes/t02-playground/`(コミットしない)。2026-09-24 に計測。
