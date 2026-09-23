---
title: EmDash 0.38.0 の native プラグインの入口
aliases:
  - native プラグインの入口
  - createPlugin と descriptor
tags:
  - docs
  - emdash
  - plugin
source_task: "[[T01-scaffold]]"
created: 2026-09-23
updated: 2026-09-23
---

# EmDash 0.38.0 の native プラグインの入口

> [!summary] 要点
> - サイトの設定に渡す descriptor(`base64ImagePlugin()` が返す `PluginDescriptor`)は、`id` / `version` / `entrypoint` が必須。
> - EmDash は `entrypoint` のモジュールから **名前付き export の `createPlugin`** を import し、`createPlugin(descriptor.options)` を呼ぶ。default export は native 形式では使われない。
> - 管理画面の React は 2 か所で指定する: descriptor の `adminEntry`(ビルド時にバンドルへ入れる)と、`definePlugin({ admin: { entry } })`(実行時にマニフェストで `adminMode: "react"` にする)。
> - 関連: [[T01-scaffold]]、[[T29-plugin-definition]]、[[T30-admin-entry]]、[[base64-image-plugin-spec#14. 配布とバージョン|仕様書 14 章]]

## descriptor(`PluginDescriptor`)

`emdash` から `import type { PluginDescriptor } from "emdash"` で使える(`references/emdash/packages/core/src/index.ts:461`)。定義は `references/emdash/packages/core/src/astro/integration/runtime.ts:84`。根拠: **公式ドキュメントのみ**

| フィールド | 必須 | このプラグインの値(T01 時点) | 使われ方 |
|---|---|---|---|
| `id` | ○ | `"base64-image"` | プラグイン ID |
| `version` | ○ | `"0.0.0"` | semver |
| `entrypoint` | ○ | `"emdash-plugin-base64-image"` | 仮想モジュールが import する(`:90`) |
| `options` | | `{}` | `createPlugin()` に渡る |
| `format` | | 省略(= `"native"`) | `"standard"` は sandboxed 形式(`:108`) |
| `adminEntry` | | `"emdash-plugin-base64-image/admin"` | 管理画面のバンドルに入れる(`:110`) |

- `fieldWidgets` / `adminPages` などは descriptor にも書けるが、integration が descriptor の値を使うのは standard / sandboxed 形式のときだけ(`references/emdash/packages/core/src/astro/integration/virtual-modules.ts:291`、`:297`、`:704`、`:710`)。native 形式では、実行時のプラグイン(`definePlugin` の `admin`)の値がマニフェストに使われる(`references/emdash/packages/core/src/emdash-runtime.ts:2917-2940`)。根拠: **公式ドキュメントのみ**
- 公式の color プラグインも同じ形(`references/emdash/packages/plugins/color/src/index.ts:23`(`createPlugin`)、`:41`(default export)、`:46`(descriptor 関数))。根拠: **公式ドキュメントのみ**

## 読み込まれ方

`references/emdash/packages/core/src/astro/integration/virtual-modules.ts:252` の `generatePluginsModule` が、次のコードを生成する。根拠: **公式ドキュメントのみ**

```js
// native 形式(format が無い、または "native")
import { createPlugin as createPlugin0 } from "emdash-plugin-base64-image";
export const plugins = [createPlugin0({})];
```

- `entrypoint` が無いと、ビルド時にエラーにする(`:270`)。`definePlugin({...})` の結果を `plugins: []` に直接渡す使い方はできない。
- 管理画面は、`adminEntry` を `import * as` で読み込む(`:347`)。管理画面が読むのは `widgets` / `pages` / `fields` / `contentEditorPanels` / `contentListColumns`(`references/emdash/packages/admin/src/lib/plugin-context.tsx:16` の `PluginAdminModule`)。
- 実行時に `plugin.admin.entry` があると、マニフェストの `adminMode` が `"react"` になる(`references/emdash/packages/core/src/emdash-runtime.ts:2917`、`:2925`)。

## `definePlugin` の検証

- `id` は `^[a-z0-9-]+$`(または `@scope/name`)、`version` は `^\d+\.\d+\.\d+` で始まること(`references/emdash/packages/core/src/plugins/define-plugin.ts:114`、`:118`)。
- capability は既知の名前だけ受け付ける。ルート・MCP・エディターの拡張の組み合わせも検証する。根拠: **公式ドキュメントのみ**

## T01 の仮実装

```ts
// src/index.ts(抜粋)
export function createPlugin() {
	return definePlugin({ id: "base64-image", version: "0.0.0", admin: { entry: "emdash-plugin-base64-image/admin" } });
}
export default createPlugin;
export function base64ImagePlugin(): PluginDescriptor {
	return { id: "base64-image", version: "0.0.0", entrypoint: "emdash-plugin-base64-image", options: {}, adminEntry: "emdash-plugin-base64-image/admin" };
}
```

- `tests/package-exports.test.ts` で、`entrypoint` / `adminEntry` が `package.json` の `name` と `exports` に一致すること、`createPlugin()` の `id` / `version` / `admin.entry` が descriptor と一致することを確かめている。`adminEntry` を `…/admin.tsx` に変えると失敗することも確かめた。根拠: **実測のみ**
- vitest の node 環境で、`emdash` のメインの入口(`definePlugin`)を import できた。Astro の仮想モジュールは不要だった。根拠: **実測のみ**
- `src/astro.ts` は、まだ何も export しない空のモジュール。oxlint の `unicorn/no-empty-file` がコメントだけのファイルを拒否するので、`export {};` に理由付きの `oxlint-disable-next-line` を付けている([[T15-site-resolve]] で置き換える)。

> [!info] 計測環境
> macOS(Darwin 25.4.0、arm64)、Node 26.10.0、npm 12.0.2、emdash 0.38.0、vitest 4.1.11。2026-09-23 に計測。
