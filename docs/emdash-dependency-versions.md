---
title: EmDash に合わせた依存パッケージの版
aliases:
  - 依存パッケージの版の選び方
  - dependency versions
tags:
  - docs
  - dependencies
  - emdash
  - npm
source_task: "[[T01-scaffold]]"
related_tasks:
  - "[[T01-2-emdash-0-39]]"
created: 2026-09-23
updated: 2026-09-24
---

# EmDash に合わせた依存パッケージの版

> [!summary] 要点
> - `emdash` と `@emdash-cms/admin` は devDependencies で `0.39.1` に固定し、peer は `^0.39.0`(`>=0.39.0 <0.40.0`)にした。
> - 最初は 0.38.0 にしていた([[T01-scaffold|T01]]、2026-09-23)。npm の 0.38.0 には仕様書が使う capability が無いと分かり、2026-09-24 に 0.39.1 に上げた([[T01-2-emdash-0-39|T01-2]]、[[#0.38.0 から 0.39.1 に上げた経緯]])。
> - `@cloudflare/kumo` は、`@emdash-cms/admin` 0.39.1 が依存している `2.6.0` に固定した(peer も `2.6.0`)。
> - react / react-dom / `@types/*` / TypeScript / vitest / astro は、EmDash の開発環境(pnpm の catalog)と同じ版か、その範囲に合わせた。
> - 利用者の `~/.npmrc` に `min-release-age=3` があり、公開から 3 日たっていない版は入らない。`ignore-scripts=true` もある。0.39.1 は、利用者の了承を得て例外として入れた([[#min-release-age の例外(2026-09-24)]])。
> - 関連: [[T01-scaffold]]、[[T01-2-emdash-0-39]]、[[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14 章]]

## 決めた版

| パッケージ | `package.json` の指定 | ロックの版 | 置き場所 | 理由 |
|---|---|---|---|---|
| `emdash` | `0.39.1` | 0.39.1 | devDependencies(peer は `^0.39.0`) | 対象バージョン。playground も同じ |
| `@emdash-cms/admin` | `0.39.1` | 0.39.1 | devDependencies(peer は `^0.39.0`) | 同上 |
| `@cloudflare/kumo` | `2.6.0` | 2.6.0 | devDependencies(peer も `2.6.0`) | admin 0.39.1 の依存と同じ版([[#Kumo を 2.6.0 に固定する理由]]) |
| `react` / `react-dom` | `19.2.4` | 19.2.4 | devDependencies(peer は `react: ^18.0.0 \|\| ^19.0.0`) | EmDash の catalog と同じ。peer の範囲は admin 0.39.1 と同じ |
| `@types/react` / `@types/react-dom` | `19.2.14` / `19.2.3` | 同じ | devDependencies | EmDash の catalog と同じ |
| `zod` | `^4.5.4` | 4.5.4 | dependencies | サーバー・管理画面の両方で実行時に使う([[#zod を 1 つにまとめる]]) |
| `astro` | `^7.3.2` | 7.3.3 | devDependencies と playground | `emdash` の peer(省略不可)。EmDash の catalog と同じ範囲 |
| `@astrojs/react` | `^6.0.5` | 6.0.6 | devDependencies と playground | 同上。7.0.0 は選ばない([[#astro と @astrojs/react を明示する理由]]) |
| `@astrojs/node` | `^11.1.5` | 11.1.6 | playground | EmDash の catalog と同じ範囲 |
| `typescript` | `^6.0.3` | 6.0.3 | devDependencies | EmDash の catalog と同じ。latest は 7.0.2 |
| `vitest` | `^4.1.11` | 4.1.11 | devDependencies | EmDash の catalog(`^4.1.5`)と同じメジャー。latest は 5.0.1 |
| `jsdom` | `^30.1.0` | 30.1.0 | devDependencies | 入れられる最新(30.1.1 は公開から 3 日未満) |
| `@testing-library/react` / `dom` / `jest-dom` / `user-event` | `^16.3.3` / `^10.4.2` / `^7.0.1` / `^14.6.7` | 同じ | devDependencies | 入れられる最新 |
| `@playwright/test` | `1.63.0` | 1.63.0 | devDependencies | ブラウザを 1 回だけ導入するので固定した([[#Playwright を固定する理由]]) |
| `oxlint` / `prettier` | `^1.83.0` / `^3.9.8` | 同じ | devDependencies | 入れられる最新(1.85.0 / 3.9.9 は公開から 3 日未満) |
| `@types/node` | `^26.6.2` | 26.6.2 | devDependencies | 開発に使う Node 26.10.0 に合わせた |

- すべて、ルートの `node_modules` に 1 つずつだけ入った(`npm ls` で `deduped`)。根拠: **実測のみ**
- EmDash の catalog の値は `references/emdash/pnpm-workspace.yaml:75`(`@astrojs/node`)〜`:176`(`zod`)。根拠: **公式ドキュメントのみ**

## peer の範囲(`^0.39.0`)

| 版 | `^0.39.0` | `>=0.39.0` |
|---|---|---|
| 0.38.0 | 含まない | 含まない |
| 0.39.0 / 0.39.1(2026-09-23 公開) | 含む | 含む |
| 0.40.x 以降 | **含まない** | 含む |
| 1.0.0(2026-04-27 公開、deprecated) | **含まない** | 含む |

- 0.x の `^` は、マイナーバージョンを固定する(`^0.39.0` は `>=0.39.0 <0.40.0`)。T01 のときに `^0.38.0` で npm の `semver.satisfies` を使って確かめた。根拠: **実測のみ**
- 0.39.0 と 0.39.1 のどちらにも、このプラグインが使う capability(`schema:read` / `content:publish` / `content:revisions:read`)がある(npm の tarball を読んで確認。根拠: **公式ドキュメントのみ**)。そのため、peer の下限は 0.39.0 にした。開発と動作確認は 0.39.1 で行う。
- npm には、0.8.0 より前に公開された `emdash@1.0.0` があり、`Please install the latest version.` で deprecated になっている。**peer に `>=0.39.0` のような下限だけの範囲を書くと、この 1.0.0 も受け入れてしまう。** 根拠: **実測のみ**(`npm view emdash@1.0.0 deprecated`)
- EmDash のマイナーバージョンが上がったら、動作を確かめてから範囲を広げる(仕様書 14 章の方針)。

## 0.38.0 から 0.39.1 に上げた経緯

- 2026-09-23、[[T01-scaffold|T01]] で `references/emdash` の `package.json` に合わせて 0.38.0 を選んだ。
- 2026-09-24、[[T06-decision-trash-permission|T06]] で、`references/emdash` が 0.38.0 のタグから 126 コミット進んだ未リリースの開発版(`git describe` は `@emdash-cms/admin@0.38.0-126-gea275faf`)だと分かった([[emdash-reference-vs-npm-0-38]])。
- npm の `emdash@0.38.0` の `definePlugin` は、capability の許可リストに `schema:read` / `content:publish` / `content:revisions:read` / `content:restore` を持たない(`node_modules/emdash/dist/menus-D8mC4eaN.mjs:1465-1489`。0.38.0 のとき)。仕様書 7・8・9 章の前提が成り立たない。根拠: **実測+公式ドキュメント**
- npm の 0.39.0 / 0.39.1 は、許可リストが `PLUGIN_CAPABILITIES` に変わり、上の 4 つを含む。`ctx.content` の `getVersioned` / `publish`、`getRevision`、`ctx.schema` もある。根拠: **公式ドキュメントのみ**(tarball の `dist/manifest-schema-*.mjs`、`dist/context-*.mjs`)
- `references/emdash` は、タグ `emdash@0.39.1`(`ae32cf1e`)に切り替えた(detached HEAD。元は `main` の `ea275faf`)。`ea275faf` との差は、ソースで 22 ファイル(管理画面の見た目の調整と、マイグレーション 081 の修正)と翻訳ファイルだけ。仕様書が引用している箇所で行がずれたのは `ContentEditor.tsx` だけだった(`:1800` → `:1806`、`:1827` → `:1833`)。根拠: **実測のみ**(`git diff --stat`)

## min-release-age の例外(2026-09-24)

- 利用者の了承: `emdash` と `@emdash-cms/*` の 0.39.1 系だけを、`min-release-age` の例外として入れる。`~/.npmrc` は変更しない。
- 手順:
  1. `package.json` と `playground/package.json` の版を書き換える。
  2. そのコマンドだけ `npm install --min-release-age=0` で実行する。
  3. ロックファイルの差分を調べ、公開から 3 日未満の版が EmDash の外に入っていないかを確かめる(`npm view <名前>@<版> time --json`)。
- 結果: 版が変わったのは 10 個。うち 9 個は EmDash のもの(`emdash`、`@emdash-cms/admin` / `auth` / `blocks` / `gutenberg-to-portable-text` / `plugin-types` / `registry-client` / `registry-lexicons` / `registry-verification`)。根拠: **実測のみ**
- 例外の外に 1 つ入った: `@wordpress/block-serialization-default-parser` が 5.55.0 → 5.56.0(2026-09-23 12:33 UTC 公開)。`@emdash-cms/gutenberg-to-portable-text` の依存 `^5.13.0` を満たす範囲で最新が選ばれたため。ロックファイルのこの項目だけを、元の 5.55.0 に戻した。根拠: **実測のみ**
- ロックファイルにある版は、`min-release-age=3` のままの `npm ci` でも入った。この設定は、範囲から版を選ぶときにだけ働き、ロックファイルの版を入れるときには働かない。そのため、ほかの worktree は、いつもどおり `npm ci` でよい。根拠: **実測のみ**
- 2026-09-26 19:20(日本時間)ごろ以降は、0.39.1 も通常の設定で選ばれる。

## Kumo を 2.6.0 に固定する理由

- `@emdash-cms/admin@0.39.1` は `@cloudflare/kumo` に `2.6.0`(範囲なし)で依存している。0.37.0 / 0.38.0 / 0.39.0 も同じ `2.6.0`。根拠: **実測のみ**(`npm view @emdash-cms/admin@<版> dependencies`)
- EmDash は、管理画面の `styles.css` を Kumo の dist から作ってから配布している。Kumo の版がずれると、部品のクラスが CSS に無く、表示されなくなる。そのため catalog で完全一致に固定している(`references/emdash/pnpm-workspace.yaml:97-102` のコメント)。根拠: **公式ドキュメントのみ**
- `@emdash-cms/cloudflare@0.38.0` の peer も `@cloudflare/kumo: 2.6.0`(完全一致)。根拠: **実測のみ**(`npm view`)
- このプラグインの widget も管理画面の中で Kumo の部品を描画するので、同じ版に揃える。範囲にすると、利用者の環境で別の版が入ったときに、表示が崩れても気付きにくい。完全一致なら、npm が peer の不一致(ERESOLVE)として止める。根拠: **推測のみ**
- Kumo 2.6.0 の peer `@phosphor-icons/react`(省略不可)は、npm が自動で入れた(2.1.10)。`zod` と `echarts` は optional。根拠: **実測のみ**

## zod を 1 つにまとめる

- `emdash@0.38.0` と `emdash@0.39.1` は、どちらも `zod` に `4.5.4`(範囲なし)で依存している。`astro@7.3.x` は `^4.5.4`。根拠: **実測のみ**(`npm view`)
- latest の zod は 4.6.5。プラグイン側を `^4.5.4` にしてロックファイルが無い状態から入れると、ルートに 4.6.5 が入り、`emdash` の下に 4.5.4 がもう 1 つ入る見込み。根拠: **推測のみ**
- 手順: 最初に `"zod": "4.5.4"` で `npm install` し、あとで `^4.5.4` に変えてもう一度 `npm install` した。ロックは 4.5.4 のまま残り、`node_modules/zod` は 1 つだけになった。根拠: **実測のみ**
- `package.json` の範囲を `^4.5.4` にしたのは、ライブラリとして利用者側の重複排除を妨げないため。

## astro と @astrojs/react を明示する理由

- `emdash` の peer は、0.38.0 も 0.39.1 も `astro >=6.0.0-beta.0`、`@astrojs/react >=5.0.0-beta.0`、`react >=18.0.0`、`react-dom >=18.0.0`(いずれも省略不可)。npm 7 以降は、省略不可の peer を自動で入れる。根拠: **実測のみ**(`npm view emdash@<版> peerDependencies`)
- 指定しないと、npm はそれぞれの最新を入れる。`@astrojs/react@7.0.0` には、6.x に無い peer `oxc-transform-react ^0.145.0` が増えている。EmDash の catalog は `^6.0.5`。根拠: **実測のみ**(`npm view`)
- そのため、ルートの devDependencies と playground の dependencies の両方に、catalog と同じ範囲で書いた。

## TypeScript 6 と vitest 4 を選んだ理由

- TypeScript: latest は 7.0.2(2026-07-08 公開)。EmDash は `typescript ^6.0.3` で、型チェックだけ `tsgo`(TypeScript 7 のネイティブ版)を使っている(`references/emdash/packages/core/package.json` の `typecheck`)。TypeScript の JS API を使う周辺ツール(`@astrojs/check` など)との相性を考えて、6.0.3 にした。根拠: **推測のみ**
- vitest: latest は 5.0.1(2026-09-15 公開)。EmDash は `^4.1.5`。EmDash の管理画面のテスト(vitest + jsdom + Testing Library)と同じメジャーにした。根拠: **推測のみ**
- どちらも、上げるときは単独の小さな変更にする([[tasks/00-index|タスク一覧]] の進め方のルール)。

## Playwright を固定する理由

- ブラウザの版は `@playwright/test`(`playwright-core`)の版で決まる。1.63.0 では Chromium 153.0.8010.12(`chromium-1243`)と Firefox 155.0(`firefox-1543`)。根拠: **実測のみ**(`playwright install --dry-run`)
- ブラウザは T01 で 1 回だけ `~/Library/Caches/ms-playwright` に入れ、後続のタスクはそれを使う。`^` のままロックファイルが更新されると、入れたブラウザと合わなくなるので、完全一致にした。

## EmDash を上げるときに先に確かめること

このプラグインのテストの一部は、EmDash 0.39.1 の内部の形や管理画面の辞書に頼っている。EmDash を上げたら、まず次のテストと前提を確かめる。

| 頼っているもの | 確かめる場所 | 元のタスク |
|---|---|---|
| `HookPipeline` の private の `getContext` を差し替えて、hook を本物の pipeline で動かしている | `tests/server/plugin.test.ts`、`tests/server/owners.test.ts`、`tests/server/orphans.test.ts` | [[T20-owner-tracking\|T20]]、[[T21-orphan-routes\|T21]]、[[T29-plugin-definition\|T29]]([[emdash-plugin-definition-registration]]) |
| 管理画面の辞書のメッセージ ID(一覧の列の見出し「Image」の `hG89Ed`、画像管理ページのラベル「Images」の `an5hVd`)。辞書から消えると、画面に ID がそのまま出る | `tests/admin/ThumbnailColumn.test.tsx`、`tests/admin/ImagesPage.test.tsx` | [[T24-list-column\|T24]]、[[T25-images-page\|T25]] |
| 一覧の列の `collections` が同期関数で、コレクション・ロール・プラグインの状態が変わったときだけ呼ばれること。管理画面の `fetchManifest` が Lingui の有効化の前に失敗すること(このプラグインが自前でマニフェストを取得する理由) | `tests/admin/ThumbnailColumn.test.tsx`、[[emdash-admin-content-list-columns]] | [[T24-list-column\|T24]] |
| `ctx.content.create` の中の保存 hook の拒否が、`code: "SAVE_REJECTED"` の通常の `Error` で届くこと | `tests/server/upload.test.ts` | [[T18-upload-route\|T18]] |
| プラグインストレージの `getMany` が ID を分けずに 1 つのクエリに入れること(ID を D1 のバインド変数の上限に収まるよう分けて渡している理由) | `tests/server/image-refs.test.ts`、`tests/server/admin-data.test.ts` | [[T16-2-image-refs-batches\|T16-2]]、[[T17-admin-data-routes\|T17]] |
| テストが直接読む推移的な依存(`@tanstack/react-query`・`@lingui/core`・`@emdash-cms/blocks/server`)が、ルートの `node_modules` に巻き上げられていること | `tests/admin/ImagesPage.test.tsx`、[[test-lint-setup#vitest(4.1.11)]] | [[T25-1-handoff-images-page\|T25-1]] |
| config で登録した native プラグインで、起動時に lifecycle hook が呼ばれないこと(`b64_images` の確認の方式の前提) | [[emdash-native-plugin-lifecycle-hooks]] | [[T29-plugin-definition\|T29]] |
| 編集ロックが、フィールドを包む `<fieldset disabled={readOnly}>` で widget に伝わること(plugin widget に `readOnly` は渡らない。`ContentEditor.tsx:1336`) | 実際の管理画面(単体テストは包みの fieldset を自分で作るので、EmDash の変更では失敗しない)、[[emdash-plugin-field-widget]] | [[T27-image-widget\|T27]] |
| 管理画面の入口の型 `PluginAdminModule["fields"]` が props 無しの `Record<string, React.ComponentType>` であること(`fields` に型の注釈を付けない理由)。EmDash が型を直すと、使われない `@ts-expect-error` で型チェックが失敗する | `tests/admin/ImageField.test.tsx` | [[T27-image-widget\|T27]] |
| 編集画面が、手動の保存の応答でフォームの値を置き換えること(処理中の保存で画像が外れる理由。仕様書 18 章の「処理中の保存」)。EmDash が自動保存と同じく置き換えないようにしたら、その行と対策を見直す | 実際の管理画面(`references/emdash/packages/admin/src/components/ContentEditor.tsx:509-533`)、[[gallery-widget-reorder-focus#4. 処理中に「Save」を押したとき(EmDash の挙動)]] | [[T28-gallery-widget\|T28]] |

## 利用者の npm 設定(`~/.npmrc`)

```ini
ignore-scripts=true
min-release-age=3
```

- `min-release-age=3`: 公開から 3 日たっていない版は、範囲に合っていても選ばれない。指定した版が新しすぎると、次のエラーで止まる。根拠: **実測のみ**

```text
npm error code ETARGET
npm error notarget No matching version found for jsdom@^30.1.1 with a date before 9/20/2026, 11:38:12 PM.
```

- 2026-09-23 時点では、jsdom 30.1.1、oxlint 1.84.0 / 1.85.0、prettier 3.9.9、astro 7.3.4、emdash 0.39.x がこれに当たった(emdash 0.39.1 は、次の節の例外で入れた)。依存を追加するときは、公開日を確かめてから版を決める(`npm view <名前> time --json`)。
- `^7.3.2` のような範囲の指定では、エラーにならず、条件を満たす中で最新の版が選ばれる(astro は 7.3.4 ではなく 7.3.3)。根拠: **実測のみ**
- 他の worktree は `npm ci` でロックファイルの版を入れる。ロックファイルの版は、例外として入れた EmDash の 0.39.1 系を除き、すべて公開から 3 日以上たったもの。
- `ignore-scripts=true`: インストール時のスクリプト(`postinstall` など)は実行されない。このリポジトリでスクリプトを持つのは `esbuild` 0.28.2 と `fsevents` 2.3.3(optional)だけで、どちらもスクリプトなしで動いた(`esbuild.transformSync` と `require("fsevents")` で確認)。根拠: **実測のみ**
- `emdash` の依存(`@oslojs/*`、`arctic` など)に deprecated の警告が出るが、EmDash 側の問題なので対応しない。

> [!info] 計測環境
> macOS(Darwin 25.4.0、arm64)、Node 26.10.0、npm 12.0.2(mise)。2026-09-23 に計測し、2026-09-24 に 0.39.1 への変更を追記した。
