---
title: EmDash 0.38.0 に合わせた依存パッケージの版
aliases:
  - 依存パッケージの版の選び方
  - dependency versions
tags:
  - docs
  - dependencies
  - emdash
  - npm
source_task: "[[T01-scaffold]]"
created: 2026-09-23
updated: 2026-09-23
---

# EmDash 0.38.0 に合わせた依存パッケージの版

> [!summary] 要点
> - `emdash` と `@emdash-cms/admin` は devDependencies で `0.38.0` に固定し、peer は `^0.38.0` にした。`^0.38.0` は 0.39.x も 1.0.0 も含まない。
> - `@cloudflare/kumo` は、`@emdash-cms/admin` 0.38.0 が依存している `2.6.0` に固定した(peer も `2.6.0`)。
> - react / react-dom / `@types/*` / TypeScript / vitest / astro は、EmDash 0.38.0 の開発環境(pnpm の catalog)と同じ版か、その範囲に合わせた。
> - 利用者の `~/.npmrc` に `min-release-age=3` があり、公開から 3 日たっていない版は入らない。`ignore-scripts=true` もある。
> - 関連: [[T01-scaffold]]、[[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14 章]]

## 決めた版

| パッケージ | `package.json` の指定 | ロックの版 | 置き場所 | 理由 |
|---|---|---|---|---|
| `emdash` | `0.38.0` | 0.38.0 | devDependencies(peer は `^0.38.0`) | 対象バージョン。playground も同じ |
| `@emdash-cms/admin` | `0.38.0` | 0.38.0 | devDependencies(peer は `^0.38.0`) | 同上 |
| `@cloudflare/kumo` | `2.6.0` | 2.6.0 | devDependencies(peer も `2.6.0`) | admin 0.38.0 の依存と同じ版([[#Kumo を 2.6.0 に固定する理由]]) |
| `react` / `react-dom` | `19.2.4` | 19.2.4 | devDependencies(peer は `react: ^18.0.0 \|\| ^19.0.0`) | EmDash の catalog と同じ。peer の範囲は admin 0.38.0 と同じ |
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

## `^0.38.0` の範囲

| 版 | `^0.38.0` | `>=0.38.0` |
|---|---|---|
| 0.38.0 / 0.38.1 | 含む | 含む |
| 0.39.0 / 0.39.1(latest、2026-09-23 公開) | **含まない** | 含む |
| 1.0.0(2026-04-27 公開、deprecated) | **含まない** | 含む |

- 0.x の `^` は、マイナーバージョンを固定する(`>=0.38.0 <0.39.0`)。npm の `semver.satisfies` で確かめた。根拠: **実測のみ**
- `npm view "emdash@^0.38.0" version` は `0.38.0` だけを返す。根拠: **実測のみ**
- npm には、0.8.0 より前に公開された `emdash@1.0.0` があり、`Please install the latest version.` で deprecated になっている。**peer に `>=0.38.0` のような下限だけの範囲を書くと、この 1.0.0 や 0.39.x も受け入れてしまう。** 根拠: **実測のみ**(`npm view emdash@1.0.0 deprecated`)
- EmDash のマイナーバージョンが上がったら、動作を確かめてから範囲を広げる(仕様書 14 章の方針)。

## Kumo を 2.6.0 に固定する理由

- `@emdash-cms/admin@0.38.0` は `@cloudflare/kumo` に `2.6.0`(範囲なし)で依存している。0.37.0 / 0.39.0 / 0.39.1 も同じ `2.6.0`。根拠: **実測のみ**(`npm view @emdash-cms/admin@<版> dependencies`)
- EmDash は、管理画面の `styles.css` を Kumo の dist から作ってから配布している。Kumo の版がずれると、部品のクラスが CSS に無く、表示されなくなる。そのため catalog で完全一致に固定している(`references/emdash/pnpm-workspace.yaml:97-102` のコメント)。根拠: **公式ドキュメントのみ**
- `@emdash-cms/cloudflare@0.38.0` の peer も `@cloudflare/kumo: 2.6.0`(完全一致)。根拠: **実測のみ**(`npm view`)
- このプラグインの widget も管理画面の中で Kumo の部品を描画するので、同じ版に揃える。範囲にすると、利用者の環境で別の版が入ったときに、表示が崩れても気付きにくい。完全一致なら、npm が peer の不一致(ERESOLVE)として止める。根拠: **推測のみ**
- Kumo 2.6.0 の peer `@phosphor-icons/react`(省略不可)は、npm が自動で入れた(2.1.10)。`zod` と `echarts` は optional。根拠: **実測のみ**

## zod を 1 つにまとめる

- `emdash@0.38.0` は `zod` に `4.5.4`(範囲なし)で依存している。`astro@7.3.x` は `^4.5.4`。根拠: **実測のみ**(`npm view`)
- latest の zod は 4.6.5。プラグイン側を `^4.5.4` にしてロックファイルが無い状態から入れると、ルートに 4.6.5 が入り、`emdash` の下に 4.5.4 がもう 1 つ入る見込み。根拠: **推測のみ**
- 手順: 最初に `"zod": "4.5.4"` で `npm install` し、あとで `^4.5.4` に変えてもう一度 `npm install` した。ロックは 4.5.4 のまま残り、`node_modules/zod` は 1 つだけになった。根拠: **実測のみ**
- `package.json` の範囲を `^4.5.4` にしたのは、ライブラリとして利用者側の重複排除を妨げないため。

## astro と @astrojs/react を明示する理由

- `emdash@0.38.0` の peer は `astro >=6.0.0-beta.0`、`@astrojs/react >=5.0.0-beta.0`、`react >=18.0.0`、`react-dom >=18.0.0`(いずれも省略不可)。npm 7 以降は、省略不可の peer を自動で入れる。根拠: **実測のみ**(`npm view emdash@0.38.0 peerDependencies`)
- 指定しないと、npm はそれぞれの最新を入れる。`@astrojs/react@7.0.0` には、6.x に無い peer `oxc-transform-react ^0.145.0` が増えている。EmDash 0.38.0 の catalog は `^6.0.5`。根拠: **実測のみ**(`npm view`)
- そのため、ルートの devDependencies と playground の dependencies の両方に、catalog と同じ範囲で書いた。

## TypeScript 6 と vitest 4 を選んだ理由

- TypeScript: latest は 7.0.2(2026-07-08 公開)。EmDash 0.38.0 は `typescript ^6.0.3` で、型チェックだけ `tsgo`(TypeScript 7 のネイティブ版)を使っている(`references/emdash/packages/core/package.json` の `typecheck`)。TypeScript の JS API を使う周辺ツール(`@astrojs/check` など)との相性を考えて、6.0.3 にした。根拠: **推測のみ**
- vitest: latest は 5.0.1(2026-09-15 公開)。EmDash 0.38.0 は `^4.1.5`。EmDash の管理画面のテスト(vitest + jsdom + Testing Library)と同じメジャーにした。根拠: **推測のみ**
- どちらも、上げるときは単独の小さな変更にする([[tasks/00-index|タスク一覧]] の進め方のルール)。

## Playwright を固定する理由

- ブラウザの版は `@playwright/test`(`playwright-core`)の版で決まる。1.63.0 では Chromium 153.0.8010.12(`chromium-1243`)と Firefox 155.0(`firefox-1543`)。根拠: **実測のみ**(`playwright install --dry-run`)
- ブラウザは T01 で 1 回だけ `~/Library/Caches/ms-playwright` に入れ、後続のタスクはそれを使う。`^` のままロックファイルが更新されると、入れたブラウザと合わなくなるので、完全一致にした。

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

- 2026-09-23 時点では、jsdom 30.1.1、oxlint 1.84.0 / 1.85.0、prettier 3.9.9、astro 7.3.4、emdash 0.39.x がこれに当たった。依存を追加するときは、公開日を確かめてから版を決める(`npm view <名前> time --json`)。
- `^7.3.2` のような範囲の指定では、エラーにならず、条件を満たす中で最新の版が選ばれる(astro は 7.3.4 ではなく 7.3.3)。根拠: **実測のみ**
- 他の worktree は `npm ci` でロックファイルの版を入れる。ロックファイルの版は、すべて公開から 3 日以上たったもの。
- `ignore-scripts=true`: インストール時のスクリプト(`postinstall` など)は実行されない。このリポジトリでスクリプトを持つのは `esbuild` 0.28.2 と `fsevents` 2.3.3(optional)だけで、どちらもスクリプトなしで動いた(`esbuild.transformSync` と `require("fsevents")` で確認)。根拠: **実測のみ**
- `emdash` の依存(`@oslojs/*`、`arctic` など)に deprecated の警告が出るが、EmDash 側の問題なので対応しない。

> [!info] 計測環境
> macOS(Darwin 25.4.0、arm64)、Node 26.10.0、npm 12.0.2(mise)。2026-09-23 に計測。
