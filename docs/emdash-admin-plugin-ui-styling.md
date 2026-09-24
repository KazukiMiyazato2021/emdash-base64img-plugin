---
title: EmDash 0.39.1 の管理画面で、プラグインの部品に Kumo と CSS のクラスを使うときの注意
aliases:
  - 管理画面の CSS とプラグインのクラス
  - Kumo 2.6.0 の注意点
  - プラグインの部品の見た目
tags:
  - docs
  - emdash
  - admin
  - kumo
  - css
  - a11y
source_task: "[[T22-widget-parts]]"
created: 2026-09-24
updated: 2026-09-24
---

# EmDash 0.39.1 の管理画面で、プラグインの部品に Kumo と CSS のクラスを使うときの注意

> [!summary] 要点
> - 管理画面の CSS は、`@emdash-cms/admin` がビルド済みで配る 1 枚(`dist/styles.css`)。Tailwind が読むのは管理画面自身と Kumo の dist だけで、**プラグインのファイルは読まない**。プラグインが付けた Tailwind のクラスは、その CSS にたまたまあるものだけが当たる。
> - 管理画面の CSS は、層(`@layer`)の外に `* { border-color: var(--color-kumo-line) }` を持つ。層の外の規則は `@layer utilities` のクラスより常に強いので、**`border-kumo-brand` などの枠の色のクラスは当たらない**(EmDash 自身のドロップ先の、ドラッグ中の青い枠も出ていない)。枠の色は style で付ける。
> - Kumo 2.6.0 の注意: `Loader` は `role="status"` と英語の `aria-label="Loading"` を持ち、`aria-hidden` を受け取らない。`Label`(`Input` の `label` も)は `required={false}` で英語の「(optional)」を出す。`Button` の `title` はツールチップで包む。`Banner` は role を持たない(HTML の属性は渡せる)。
> - Kumo の props の多くは `x?: T` で、`| undefined` を含まない。利用者の厳しい設定(`exactOptionalPropertyTypes`)では、`undefined` になりうる値を渡すと型エラーになる。条件付きで展開する。
> - このプラグインの部品(`src/admin/parts/`)は、使うクラスがすべて管理画面の CSS にあることを、テストで確かめている(`tests/admin/parts.test.tsx`)。確かめ方はテストの補助 `tests/admin/admin-css.ts` にまとめ、ほかの管理画面の部品のテストでも使う([[T22-1-admin-css-test-helper|T22-1]])。
> - 関連: [[T22-widget-parts]]、[[base64-image-plugin-spec#11.1 共通方針|仕様書 11.1]]、[[admin-image-input-browser-behavior]]、[[emdash-dependency-versions]]、[[test-lint-setup]]

## 管理画面の CSS はビルド済みで、プラグインのファイルを読まない

| 段階 | 内容 | 根拠 |
|---|---|---|
| ビルド | `@emdash-cms/admin` の `build` が `npx @tailwindcss/cli -i src/styles.css -o dist/styles.css --minify` で CSS を作る | `references/emdash/packages/admin/package.json:35` |
| 読む範囲 | `src/styles.css` は Kumo のスタイルと Tailwind を読み込み、`@source` で Kumo の dist を足す。Tailwind の自動の検出は、管理画面のパッケージの中だけ | `references/emdash/packages/admin/src/styles.css:11-17` |
| 読み込み | 管理画面のページは、そのビルド済みの CSS を `<link>` で読む | `references/emdash/packages/core/src/astro/routes/admin.astro:11`、`:86` |

- 根拠レベル: 上の表は公式ドキュメントのみ。インストールされる `@emdash-cms/admin` 0.39.1 の `dist/styles.css`(231,475 バイト、先頭に `tailwindcss v4.3.3`)で、プラグインで使いたいクラスの有無を確かめた(実測+公式ドキュメント)。
- 例: `sr-only`・`min-h-32`・`rounded-[10px]`・`border-dashed`・`bg-kumo-tint`・`max-w-full`・`emdash-media-transparency-grid`(管理画面自身のクラス。透過した部分を市松模様で見せる)はある。`max-h-24`・`max-h-32` は無い。根拠: 実測のみ
- 公式の field-kit プラグインも Tailwind のクラスを使っている(`references/emdash/packages/plugins/field-kit/src/widgets/list.tsx`)。管理画面にあるクラスと重なるものだけが当たる(推測のみ)。
- このプラグインでは、管理画面自身が同じ目的で使っているクラス(EmDash の `ImageDropTarget` や `ImageFieldRenderer` のもの)を選び、無いものは style で書いた(画像の表示の幅など)。

### 使うクラスが CSS にあるかを確かめるテスト

部品を描画して DOM のクラスを集め、CSS のセレクタとして探す。Tailwind v4 の出力は、英数字・`-`・`_` 以外の文字の前に `\` を置く(`rounded-[10px]` → `.rounded-\[10px\]`、`hover:bg-kumo-tint` → `.hover\:bg-kumo-tint`、`gap-2.5` → `.gap-2\.5`)。長いクラスの先頭の一致は数えない(`.min-h-3` は `.min-h-32` の一部としてだけ現れる)。根拠: 実測のみ

確かめ方は、テストの補助 `tests/admin/admin-css.ts` にある([[T22-1-admin-css-test-helper|T22-1]]。そのテストは `tests/admin/admin-css.test.ts`)。管理画面の部品のテストでは、次のように使う。

```tsx
import { findMissingClasses, sourceTokens } from "./admin-css";

const { container } = render(<ThumbnailColumn … />);
// 引数はリポジトリのルートからのパス。ディレクトリなら直下のファイルをすべて読む
const missing = findMissingClasses(container, sourceTokens("src/admin/ThumbnailColumn.tsx"));
expect(missing.fromSource).toEqual([]); // 自分のソースに書いたクラスは、すべて CSS にある
expect(missing.unknown).toEqual([]); // CSS に無い残りは、Kumo が自分で付けるクラスだけ
```

- DOM には Kumo が自分で付けるクラスも入る。CSS に無いクラスのうち、部品のソースに書いた語(`sourceTokens`)は `fromSource` に入れて失敗にする。残りは、Kumo の dist の JS に含まれるなら除き(Kumo のクラスだと分かる)、含まれないものを `unknown` に入れる。
- 状態によって付くクラス(ドラッグ中・エラー・無効など)も確かめるには、その状態にしてから集める。
- ほかに `ADMIN_CSS`(CSS の本文)、`hasClassSelector(css, name)`、`escapeClassName(name)`、`collectClassNames(root)` を export している。
- jsdom の環境では `URL` が jsdom のものになり、`fs` が `new URL(...)` を受け付けない(「The URL must be of scheme file」)。`fileURLToPath(import.meta.url)` と `node:path` でパスの文字列にする。根拠: 実測のみ

## 層の外の `*` の枠の色が、クラスより強い

- 管理画面の `src/styles.css` は、層の外に次の規則を持つ(`references/emdash/packages/admin/src/styles.css:83-85`)。Tailwind のクラスは `@layer utilities` の中にある。CSS のカスケードでは、層の外の宣言が層の中の宣言より強い(詳細度によらない)。

```css
/* Base styles */
* {
	border-color: var(--color-kumo-line);
}
```

- 実測: ドロップゾーンに `border-kumo-brand` を付けても、計算された `border-top-color` は `oklch(0.145 0 0 / 0.1)`(線の色)のままだった。style の `border-color: var(--color-kumo-brand)` にすると `oklch(0.5772 0.2324 260)`(ブランドの青)になった。Chromium 153・Firefox 155 で同じ。根拠: 実測+公式ドキュメント
- EmDash 自身の `ImageDropTarget` も、ドラッグ中に `border-kumo-brand bg-kumo-tint` を付けている(`references/emdash/packages/admin/src/components/media/ImageDropTarget.tsx:87`)。同じ理由で、背景だけが変わり、枠は青くならない(推測のみ。CSS の規則からの推論で、EmDash の画面では確かめていない)。
- 当たらないのは枠の色だけ。枠の太さ(`border-2`)・線の種類(`border-dashed`)・背景(`bg-kumo-*`)・文字の色(`text-kumo-*`)・`ring`(box-shadow)は当たる。根拠: 実測のみ(計算されたスタイルとスクリーンショット)

## Kumo 2.6.0 の注意点

インストールされる `node_modules/@cloudflare/kumo/dist/chunks/` の実装を読んだ(公式ドキュメントのみ)。jsdom と Chromium のアクセシビリティツリーでも確かめた(実測+公式ドキュメント)。

| 部品 | 挙動 | 対処 | 場所 |
|---|---|---|---|
| `Loader` | `<svg role="status" aria-label="Loading">` を描く。受け取る props は `className`・`size`・`aria-label` だけで、`aria-hidden` は渡らない | 飾りなら `<span aria-hidden="true">` で包む。読み込み中を伝えるなら、訳した `aria-label` を渡す | `loader-g8a6j76ue5nq0lr8.js:30`、`:43` |
| `Label`(`Input` の `label` も) | `required={false}` のとき、英語の「(optional)」を足す | 日本語の画面では `required={false}` を渡さない | `label-himqjkdhh0hgfdsa.js:33` |
| `Button` | `type` の既定は `"button"`(EmDash の編集画面は `<form>` なので、送信しない)。`title` を渡すと `Tooltip` で包む | 名前は `title` ではなく `aria-label` で付ける | `button-gtdhvogt5rlrf1is.js:172`、`:177` |
| `Button` | クラスは tailwind-merge で合わせる。`w-max`・`h-9` などの既定を `className` の `w-full`・`h-auto` で上書きできる | 大きなボタン(ドロップゾーン)は EmDash の `ImageDropTarget` と同じクラスにした | — |
| `Input` | `label`・`description` があると Base UI の Field で包み、`aria-labelledby`・`aria-describedby` を付ける。jsdom でも同じ | 説明(空欄の注意など)は `description` で渡す | `input-f2ct7obgdzypjmp2.js` |
| `Input` | 自分で `disabled:text-kumo-disabled` を付けるが、Kumo のテーマに `kumo-disabled` の色が無く、CSS が作られない(管理画面の Input も同じ) | 気にしない(Kumo の不具合) | `input-f2ct7obgdzypjmp2.js:51` |
| `Banner` | role を持たない。残りの props を `div` に渡す。`title`(文字列)と `description` を渡すと、見出しと本文の形になる | エラーは外側の `role="alert"` の領域の中に置く | `banner-es5iwuk4pf25e29e.js:70` |

- Kumo の型定義は `@phosphor-icons/react` の型を読む(`dist/src/components/button/button.d.ts:2`)。`@phosphor-icons/react` は Kumo の peerDependencies で、管理画面の依存にもある。このプラグインの peerDependencies には無いので、アイコンは自前の SVG にした(`src/admin/parts/icons.tsx`)。field-kit は `@phosphor-icons/react` を peerDependencies に入れている(`references/emdash/packages/plugins/field-kit/package.json:25`)。根拠: 公式ドキュメントのみ
- `@cloudflare/kumo` の入口から読み込むと、jsdom での読み込みに約 1 秒かかる(vitest の import の時間)。根拠: 実測のみ

## 利用者の厳しい型チェック(`exactOptionalPropertyTypes`)

- Kumo の props の多くは `title?: string` のように `| undefined` を含まない。`tsconfig.consumer-strict.json` では、`string | undefined` の値を渡すと型エラーになる(`TS2375`)。`tsconfig.json`(`exactOptionalPropertyTypes` なし)では通るので、気付きにくい。根拠: 実測のみ

```tsx
// 型エラー(厳しい設定): Type 'string | undefined' is not assignable to type 'string'.
<Banner variant="error" title={title} description={text} />
// 値があるときだけ渡す
<Banner variant="error" {...(title === undefined ? {} : { title })} description={text} />
```

- React の DOM の属性(`aria-label`・`id`・`disabled` など)と `ReactNode` の props(`description`・`icon`・`action`)は `undefined` を含むので、そのまま渡せる。根拠: 実測のみ(3 つの設定の `tsc --noEmit`)

## 読み上げの領域に `<output>` を使う

- oxlint の `jsx-a11y/prefer-tag-over-role` は、`role="status"` の代わりに `<output>` を求める(`--deny-warnings` なので失敗)。`<output>` の暗黙の role は `status`。根拠: 実測のみ
- Chromium 153 のアクセシビリティツリー(CDP の `Accessibility.getFullAXTree`)で、`<output aria-live="polite">` は role `status`・live `polite` になった。`role="alert"` の `div` は live `assertive`。Testing Library の `getByRole("status")` でも見つかる。根拠: 実測のみ

> [!info] 計測環境
> macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、`@emdash-cms/admin` 0.39.1、`@cloudflare/kumo` 2.6.0、React 19.2.4、TypeScript 6.0.3、vitest 4.1.11 + jsdom 30.1.0、Playwright 1.63.0(Chromium 153.0.8010.12・Firefox 155.0、ヘッドレス)。2026-09-24 に計測。ブラウザでの手順は [[admin-image-input-browser-behavior#再現手順]]。
