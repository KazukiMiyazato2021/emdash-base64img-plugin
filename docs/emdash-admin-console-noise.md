---
title: EmDash 0.39.1 の管理画面が console に出す、プラグインと関係の無い警告・エラー
aliases:
  - 管理画面の console の警告
  - コマンドパレットの Lingui の警告
  - Firefox の CSP の eval の違反
  - Firefox の scroll-linked positioning effect
  - E2E で除く console のメッセージ
tags:
  - docs
  - emdash
  - admin
  - browser
  - lingui
  - testing
source_task: "[[T30-admin-entry]]"
created: 2026-09-24
updated: 2026-09-24
---

# EmDash 0.39.1 の管理画面が console に出す、プラグインと関係の無い警告・エラー

> [!summary] 要点
> - 管理画面を Playwright で操作すると、プラグインが無くても(または、プラグインの部品と関係の無い操作で)console に次の 3 つが出る。E2E([[T31-e2e|T31]])で console を見張るときは除く。
>   1. **本番のビルド**で、コマンドパレットの項目を選ぶと、Lingui の「Uncompiled message detected!」(メッセージは空)が 1 回出る。どの項目でも出る。根拠: 実測+公式ドキュメント
>   2. **Firefox の本番のビルド**で、管理画面を読み込むたびに「Content-Security-Policy: … blocked a JavaScript eval …(Missing 'unsafe-eval')」のエラーが 1 回出る。zod 4 が JIT を使えるかを確かめる処理で、動きは変わらない。プラグインの入口が仮実装のビルドでも同じ回数出た。根拠: 実測+公式ドキュメント
>   3. **Firefox** で、サイドバーをスクロールすると「This site appears to use a scroll-linked positioning effect…」の警告が出る(開発サーバーでも)。根拠: 実測のみ
> - Chromium 153 の開発サーバーでは、どれも出なかった(console の警告・エラーは 0 件)。
> - 関連: [[T30-admin-entry]]、[[emdash-admin-entry-assembly]]、[[emdash-admin-content-list-columns#列の見出し(label)と Lingui の ID]]、[[emdash-admin-plugin-pages]]

> [!info] 環境
> - Apple M5 Pro、macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、`emdash` / `@emdash-cms/admin` 0.39.1、Astro 7.3.3、zod 4.5.4、`@lingui/core` 5.9.5、Playwright 1.63.0(ヘッドレス。Chromium 153.0.8010.12、Firefox 155.0)。2026-09-24 に計測。
> - playground(ポート 4430)。本番のビルドは `npm run build -w playground` と `npm run preview -w playground -- --port 4430`。
> - 行番号は `references/emdash/packages/` 以下(タグ `emdash@0.39.1`)。

## 一覧

| # | メッセージ | 出る場面 | ブラウザ | 開発 / 本番 | 原因 | 影響 |
|---|---|---|---|---|---|---|
| 1 | `warning`: `Uncompiled message detected! Message: > (空)` | コマンドパレットで項目を選んだとき(1 回) | Chromium・Firefox | 本番だけ | EmDash の `itemToStringValue` | なし(表示と移動は正しい) |
| 2 | `error`: `Content-Security-Policy: The page’s settings blocked a JavaScript eval (script-src) … (Missing 'unsafe-eval')` | 管理画面の読み込みごとに 1 回(ダッシュボード・一覧・編集画面・プラグインのページ) | Firefox だけ | 本番だけ | zod 4 の `allowsEval` と、EmDash の CSP | なし(zod は JIT を使わずに動く) |
| 3 | `warning`: `This site appears to use a scroll-linked positioning effect. …` | サイドバーをスクロールしたとき | Firefox だけ | 両方 | EmDash のサイドバー | なし(性能の注意) |

## 1. コマンドパレットの項目を選ぶと出る Lingui の警告

- EmDash のコマンドパレットは `CommandPalette.Root` に `itemToStringValue={(group) => t(group.label)}` を渡している(`admin/src/components/AdminCommandPalette.tsx:435`)。群(`ResultGroup`)には `label` があるが、項目(`ResultItem`)には無い。項目を選ぶと、この関数が項目に対しても呼ばれ、`t(undefined)` が空のメッセージになる。本番のビルドの Lingui はコンパイラーを持たず、訳が辞書に無いと警告する([[emdash-admin-content-list-columns#列の見出し(label)と Lingui の ID]])。根拠: 公式ドキュメントのみ(呼ばれ方の推論)。スタックは下のとおりで、`itemToStringValue` から `i18n._` が呼ばれていた(実測)
- 本番のビルドで、「Posts」「設定」(EmDash の項目)と「画像」(このプラグインのページ)を選んで比べた。どれも 1〜2 回出た(「設定」は 2 回)。項目を選ばずに Escape で閉じたとき、入力しただけのときは出なかった。根拠: 実測のみ

```text
at console.warn (<anonymous>:8:26) | at vt._ (PluginRegistry.BncHfa0t.js:4:379) | at itemToStringValue (PluginRegistry.BncHfa0t.js:176:8249) | at to (PluginRegistry.BncHfa0t.js:13:36845) | ...
```

- このプラグインのページのラベル(`an5hVd`)と一覧の列の見出し(`hG89Ed`)は辞書にある ID なので、それ自体は警告を出さない([[emdash-admin-plugin-pages]])。

## 2. Firefox の本番のビルドの CSP の違反(zod の eval の確認)

- EmDash は、本番では `/_emdash` の応答に CSP を付ける(`core/src/astro/middleware/auth.ts:320-335`。開発サーバーでは付けない)。`script-src 'self' 'unsafe-inline'` で、`unsafe-eval` が無い(`core/src/astro/middleware/csp.ts:81-101`)。`img-src` は `data:` を許すので、このプラグインの data URL の画像は表示される。根拠: 公式ドキュメントのみ(画像の表示は実測)
- zod 4 は、オブジェクトの検証を速くするために、`new Function("")` で eval が使えるかを 1 回だけ確かめる(`node_modules/zod/v4/core/util.js:148-165` の `allowsEval`。`z.config({ jitless: true })` なら確かめない)。CSP が拒否した例外は zod が捕まえるが、Firefox は違反を console のエラーとして出す。zod のソースのコメントにも「strict CSPs report the caught `new Function` as a `securitypolicyviolation`」とある。根拠: 公式ドキュメントのみ
- 管理画面の本体と、このプラグインは、同じ zod を使う(管理画面のチャンクに 1 つ)。確かめるのはページの読み込みごとに 1 回で、SPA の中の移動では出ない。根拠: 実測のみ
- 入口が仮実装(`fields = {}`)のビルドでも、ダッシュボード・Posts の一覧・Notes の一覧・新規作成の画面で、読み込みごとに 1 回出た。組み立てたあとのビルドと同じ回数だった。EmDash の管理画面が自分で zod を使うため。Chromium 153 では、同じ操作で console に出なかった。根拠: 実測のみ
- 避けるなら、管理画面で `z.config({ jitless: true })` を設定する(EmDash 側の変更)。プラグインから設定すると、管理画面の zod 全体に効いてしまう(推測のみ)。

## 3. Firefox のサイドバーのスクロールの警告

- Firefox の「This site appears to use a scroll-linked positioning effect」は、スクロールに合わせて位置を変える処理を見つけたときの性能の注意。
- 画面の高さが 900px のとき、サイドバーの「プラグイン」のグループ(このプラグインの「画像」)は下にあり、Playwright がそこへスクロールすると出た。Notes の一覧(このプラグインの列が無い)でも同じ。「設定」の項目を `scrollIntoViewIfNeeded` しても、高さが 900px ならスクロールせずに見えているので出ず、高さを 480px にして「設定」までスクロールさせると出た。一覧の上でホイールを回したとき(内容が短く、ページがスクロールしたかは確かめていない)と、ページ全体のスクリーンショットでは出なかった。根拠: 実測のみ
- 原因の要素は特定していない(EmDash のサイドバーのどれか。推測のみ)。

## E2E(Playwright)で見つかった、EmDash と関係の無いもの

[[T31-e2e|T31]] の E2E で console を見張ったときに出た。どちらも EmDash やこのプラグインの不具合ではない。見張りから除く方法は [[e2e-playwright-emdash-admin#5. console の見張り]]。根拠: **実測のみ**

- Chromium は、4xx の応答(API の 403・422、404 の文書)ごとに、console に「Failed to load resource: the server responded with a status of …」の `error` を出す。その応答を確かめるテストだけで除く。
- Firefox は、Playwright の `evaluate` がページの読み込みの途中でレイアウトを読むと、「Layout was forced before the page was fully loaded … debugger eval code」の `warning` を出す。Playwright が原因なので除く。

## 再現手順

- playground を起動し、Playwright の `page.on("console")` で `warning` と `error` を集める。本番のビルドは、開発サーバーで保存した `storageState` を使う([[emdash-admin-entry-assembly#6. 再現手順]])。
- 警告のスタックは、`console.warn` を包んで残した。

```js
await context.addInitScript(() => {
	const original = console.warn.bind(console);
	window.__lingui = [];
	console.warn = (...args) => {
		if (String(args[0] ?? "").includes("Uncompiled message")) window.__lingui.push(new Error().stack);
		original(...args);
	};
});
// コマンドパレット: ⌘K(ControlOrMeta+K)→ 入力 → 項目を押す
await page.keyboard.press("ControlOrMeta+K");
await page.keyboard.type("Posts");
await page.getByRole("option", { name: /^Posts$/ }).first().click();
```

- CSP の違反の比べ方: 入口を `bb05e05` の仮実装に一時的に戻して `npm run build -w playground` し、同じ Firefox の手順(各ページを読み込み直して、`unsafe-eval` を含むメッセージを数える)で比べた。比べたあとで入口を元に戻し(ハッシュで確認)、ビルドし直した。
