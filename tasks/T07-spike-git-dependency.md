---
id: T07
title: "スパイク: git 依存 + TS ソースで読み込めるか確かめる"
type: スパイク
status: done
wave: 2
depends_on:
  - "[[T02-playground]]"
soft_depends_on: []
blocks:
  - "[[T29-plugin-definition]]"
files:
  - "spikes/git-dependency/**(使い捨て)"
  - "このノートの「結果」"
spec:
  - "[[base64-image-plugin-spec#14. 配布とバージョン]]"
  - "[[base64-image-plugin-spec#16. 実装前の検証(スパイク)]]"
tags:
  - task
  - spike
created: 2026-09-23
---

# T07 スパイク: git 依存 + TS ソースで読み込めるか確かめる

> [!info] 概要
> - 種別: スパイク / ウェーブ: 2
> - 着手の条件(依存): [[T02-playground|T02]]
> - このタスクを待つもの: [[T29-plugin-definition|T29]]
> - 仕様: [[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14章]]、[[base64-image-plugin-spec#16. 実装前の検証(スパイク)|仕様書 16章]]

## 目的

仕様書 16 章の1つ目。TS ソースのままのプラグインを git 依存で入れたとき、Vite(Node と workerd)が読み込めるかを確かめる。

## 作業内容

- [x] 雛形([[T01-scaffold|T01]])のプラグインを `git+file://` などで git 依存としてインストールした、使い捨てのサイトを作る(playground の複製でよい)
- [x] Node アダプターで `astro dev` と `astro build` を実行し、起動を確認する
- [x] Cloudflare アダプターで `astro build` を実行し、`wrangler dev` で起動を確認する
- [x] 管理画面側の入口(`./admin` の `.tsx`)が、管理画面のバンドルに含まれることを確認する
- [x] `files: ["src"]` で、playground などが配布物から除かれることを確認する

## 完了条件

- [x] 結果をこのノートに根拠レベル付きで記録した
- [x] 読み込めない場合は、ビルド(tsdown など)を入れる方針を決め、仕様書 14 章と [[T29-plugin-definition|T29]] / [[T33-readme|T33]] / [[T34-release|T34]] を更新した(条件に当たらない: すべての経路で読み込めたので、ビルドは入れない方針のまま。仕様書と T29 / T33 / T34 は変更していない。別の理由で反映が必要な点は [[#仕様書と他のタスクへの影響]] に書き、リーダーに報告した)

## 変更してよいファイル

- `spikes/git-dependency/**`(使い捨て)
- このノートの「結果」

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 結論(2026-09-24)
> TS ソースのまま(`files: ["src"]`、ビルドなし)のプラグインを git 依存で入れたサイトで、Node アダプターと Cloudflare アダプターのすべての経路で、サーバー側・サイト側・管理画面の入口を読み込めた。**ビルドは入れない(仕様書 14 章の方針のまま)。** 根拠: **実測+公式ドキュメント**
> ただし、配布と利用者の環境について、仕様書と README に反映が必要な点が見つかった(npm 12 の `allow-git` など)。詳細と再現の手順は [[git-dependency-ts-source]] と [[npm12-git-dependency-policy]]。

### 確かめた構成

- 使い捨てのサイト `spikes/git-dependency/site/`(playground の設定と seed を複製。ルートの workspaces に入れず、その中で `npm install`)。Node 用と Cloudflare 用(仕様書 13.3 の形)の設定を並べた。
- プラグインは 2 つを入れて確かめた。
  1. 実際のコミット `git+file:///Users/home/sandbox/emdash-base64img-plugin#2779d00`(`phase/2`)
  2. フィクスチャー: 上のコミットのコピーに、JSX の widget・拡張子なしの相対 import・T03 の zod スキーマを入力にした公開ルート・サイト側の関数を足した、使い捨ての git リポジトリ(`spikes/git-dependency/fixture-plugin`)。後のタスク([[T29-plugin-definition|T29]]・[[T30-admin-entry|T30]])で入る形を先に確かめるため。

### 読み込み

| 経路 | 結果 | 根拠 |
|---|---|---|
| Node `astro dev` | ページ・マニフェスト(`base64-image`、`adminMode: "react"`)・公開ルート・入力検証・widget の描画(Chromium・Firefox) | 実測+公式ドキュメント |
| Node `astro build` / `astro preview` | 成功。サーバーのバンドルにプラグインのソースが入り、外部の import は残らない。preview でもルート・ページ・widget が動いた | 実測のみ |
| Cloudflare `astro build` / `wrangler dev`(`--port 8707 --inspector-port 9307`) | 成功・起動。ページ・公開ルート・入力検証が workerd で動き、管理画面のチャンクにプラグインの入口と widget が入った | 実測のみ |
| Cloudflare `astro dev`(追加) | 動く。ただし最初のリクエストで、プラグインが依存の最適化に加わり、1 回だけ再読み込みが起きる。サイトの `vite.ssr.optimizeDeps.include` に入れると起きない | 実測+公式ドキュメント |

- Vite 8.3.0 は、拡張子が `.ts` / `.tsx` の入口を SSR で外部化しない(`canExternalizeFile`)。Node が `node_modules` の `.ts` を直接読んで失敗する、という心配(推測)は当たらなかった。Cloudflare の worker の環境は `noExternal: true`。根拠: **実測+公式ドキュメント**
- EmDash は、プラグインを `ssr.noExternal` などで特別扱いしていない。`ssr.noExternal` は `emdash` と `@emdash-cms/admin` だけ(`references/emdash/packages/core/src/astro/integration/vite-config.ts:481-602`)。根拠: **公式ドキュメントのみ**
- Node で直接 import すると `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` になる。Astro は設定ファイルの読み込みでこれに失敗すると Vite で読み直すので、dev・build とも影響は無かった。根拠: **実測+公式ドキュメント**
- 管理画面の入口(`.tsx`)は、開発時は `/node_modules/emdash-plugin-base64-image/src/admin.tsx` がソースのまま変換されて配信され(事前バンドルされない)、ビルドでは管理画面の `PluginRegistry.*.js` に入った。根拠: **実測+公式ドキュメント**
- 公式の `@emdash-cms/plugin-color` / `plugin-forms` も、TS ソースのまま npm に公開されている(`main: "src/index.ts"`)。根拠: **公式ドキュメントのみ**

### files: ["src"]

- `npm pack --dry-run` は 17 ファイル(`package.json` と `src/**`)。git 依存で入った中身も同じで、playground などは含まれない。devDependencies も入らない。根拠: **実測のみ**

### npm 12 と min-release-age

- **npm 12 は git 依存を既定で拒否する(`allow-git` の既定が `none`、`EALLOWGIT`)。** 仕様書 14 章の例の `github:` の短縮形も当たる。サイトの `.npmrc` に `allow-git=root` を書くと、`npm ci` は通り、`npm install` は `EALLOWGIT` にならなくなった(`npm install` が止まった別の理由は次の項目)。根拠: **実測+公式ドキュメント**
- npm 12 は、依存の install スクリプト(git 依存の `prepare` を含む)も既定で止める(`allowScripts`)。`prepare` でビルドする配布は、利用者の設定が要る。TS ソースのまま配る理由が 1 つ増えた。根拠: **公式ドキュメントのみ**
- `min-release-age=3` のままだと、プラグインを足すときに peer(`emdash ^0.39.0`)の manifest が期間の条件で取り直され、`ERESOLVE`(`emdash@undefined`)になった。EmDash 0.39.1 の例外と同じ理由なので、そのコマンドにも `--min-release-age=0` を付けた(2026-09-26 19:20 JST ごろ以降は不要)。根拠: **実測のみ**

### ロックファイルの監査(spike のサイト)

- `@astrojs/cloudflare` 14.3.2・`wrangler` 4.135.0・`@cloudflare/workers-types` 5.20260920.1・`@astrojs/check` 0.9.10・`typescript` 6.0.3 は、`min-release-age=3` のままの `npm install` で入れた。`emdash` / `@emdash-cms/cloudflare` の 0.39.1 と、プラグインの git 依存だけに `--min-release-age=0` を付けた。
- 例外のコマンドのあとの監査で、EmDash の外に公開から 3 日未満の版が 7 個入っていた(`@atcute/lexicons` 2.1.1、`@modelcontextprotocol/sdk` 1.30.1、`@wordpress/block-serialization-default-parser` 5.56.0、`dompurify` 3.4.16、`prosemirror-model` 1.25.12、`prosemirror-view` 1.42.5、`yjs` 13.6.33)。spike の `package.json` の `overrides` で、ルートのロックファイルと同じ版(いずれも公開から 3 日以上、依存元の範囲を満たす)に固定した。再監査で EmDash の外は 0 個。プラグインを足したときの差分も 0 個。EmDash 系は 10 個(利用者が了承した例外)。根拠: **実測のみ**
- リポジトリの `package.json` / `package-lock.json` は変更していない。

### 利用者側の型チェック

- `astro check`(EmDash のテンプレートの `typecheck`)は、プラグインの `src` の型エラーを報告しない(わざと入れた型エラーでも 0 件)。根拠: **実測のみ**
- `tsc --noEmit` は報告する(`skipLibCheck` は `.d.ts` だけが対象)。Astro の既定の `include`(`**/*`)で `astro.config.mjs` から辿られるときと、利用者の `.ts` が `emdash-plugin-base64-image/astro` を import したときに検査される。根拠: **実測のみ**
- `phase/2` と同じ `src/shared` を含むフィクスチャーは、TypeScript 6.0.3 の Astro の base / strict / strictest(`exactOptionalPropertyTypes` を含む)と、strictest に無いフラグ(`noPropertyAccessFromIndexSignature` など)で 0 件、TypeScript 7.0.2 でも 0 件だった。根拠: **実測のみ**
- 次の設定では `src/shared/data-url.ts` がエラーになった。根拠: **実測のみ**
  - TypeScript 5.9.3 / 5.8.3(`Uint8Array.fromBase64` / `toBase64` の型が無い。4 件)
  - `lib` を ES2022 + DOM に絞った設定(同じ 4 件)
  - `strict: false`、または TypeScript 5.x で `strict` を書かない base(`if (!decoded.ok)` の絞り込み。2 件)
- 対策の候補(lib の型に頼らずに呼び、`=== false` で絞り込む。3 か所)を spike のコピーで試し、上のすべての設定で 0 件になった(型チェックだけ)。コードは [[git-dependency-ts-source#利用者側の型チェック]]。`src/shared/data-url.ts` は [[T04-webp-utils|T04]] の担当なので、変更していない。根拠: **実測のみ**

### その他

- `emdash migrate --from-config` は、Node が `node_modules` の `.ts` を読めないので失敗する。既定の `emdash migrate`(`astro build` が書く `.emdash/migrations.json` を読む)は成功した。EmDash はデプロイでは build のマニフェストを使うよう案内している。根拠: **実測+公式ドキュメント**
- サイトでは zod が 2 つになった(プラグインが 4.6.5、emdash が 4.5.4)。T03 のスキーマをルートの `input` に渡しても、型チェックと実行の両方で問題なかった。根拠: **実測のみ**

### 仕様書と他のタスクへの影響

T07 で変更してよいファイルの外なので、変更せずにリーダーに報告した(サブタスクの候補)。

- 仕様書 14 章: git 依存の入れ方に、npm 12 では `allow-git=root`(サイトの `.npmrc`)が要ることを足す。「TS ソースのまま配布する」の根拠に T07 の結果と、npm 12 が依存の `prepare` を既定で止めることを足す。
- 仕様書 18 章(既知の制約): 利用者の `tsc` がプラグインの `src` を検査すること、`emdash migrate --from-config` が使えないこと、Cloudflare の `astro dev` の最初の再読み込み。
- [[T33-readme|T33]]: 導入手順に `.npmrc` の `allow-git=root`(`npm ci` の環境にも必要)、Cloudflare の開発時の `vite.ssr.optimizeDeps.include`(任意)、型チェックは `astro check` を使うこと。
- [[T34-release|T34]]: 別のサイトから `github:<owner>/…#v0.1.0` で入れる確認で、npm 12 なら `allow-git=root` が要る。
- [[T04-webp-utils|T04]] の `src/shared/data-url.ts`: 利用者の TypeScript 5.x・lib・strict の設定でも型が通る書き方にするか、対象外として README に書くかを決める。
- [[T29-plugin-definition|T29]]: 配布形態は「TS ソースのまま」。`routes` の型は入力が `unknown` なので、型付きの `RouteContext<T>` を受け取る関数を渡す(公式の forms プラグインと同じ形)。
