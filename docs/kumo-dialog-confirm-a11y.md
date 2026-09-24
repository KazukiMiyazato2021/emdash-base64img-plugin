---
title: Kumo 2.6.0 の Dialog で確認のダイアログを作るときのフォーカスと読み上げ
aliases:
  - Kumo の確認ダイアログ
  - alertdialog のフォーカス
  - 確認のあとのフォーカスの移し方
  - 処理中のボタン(aria-disabled)
tags:
  - docs
  - kumo
  - admin
  - a11y
source_task: "[[T25-images-page]]"
created: 2026-09-24
updated: 2026-09-24
---

# Kumo 2.6.0 の Dialog で確認のダイアログを作るときのフォーカスと読み上げ

> [!summary] 要点
> - `Dialog.Root role="alertdialog"` は Base UI の AlertDialog になり、**外側を押しても閉じない**(`role="dialog"` は閉じる。EmDash の確認は `disablePointerDismissal` を付けて閉じないようにしている)。Escape では閉じる。根拠: 実測+公式ドキュメント
> - 開くと、ダイアログの中の最初のフォーカスできる要素にフォーカスが移る。取り消せる側(「キャンセル」)を先に置くと、そこに移る。Tab / Shift+Tab はダイアログの中を回り、閉じると開く前にフォーカスのあった要素(押したボタン)に戻る。根拠: 実測のみ(Chromium 153 と jsdom)
> - 開いている間、外側は `aria-hidden` で読み上げから隠れる。ただし **`aria-live` の領域とその祖先は隠さない**(Base UI の仕様)。ページの読み上げの領域(`<output aria-live>`)に書いた文は、ダイアログを閉じる前でも読まれる。`aria-modal` は付かない。根拠: 実測+公式ドキュメント
> - 操作が成功して、押したボタンが消える(行が消える・別のボタンになる)ときは、`onOpenChangeComplete(false)`(閉じ終わったとき)でフォーカスを移す。閉じたときに Base UI が戻すフォーカスと重ならない。Kumo の `Dialog`(中身)は `finalFocus` を渡せない。根拠: 実測+公式ドキュメント
> - 処理中のボタンは `disabled` にするとフォーカスが失われる。Kumo の `Button` の `loading` も `disabled` になり、英語の「Loading」を読み上げる `Loader` を入れる。`aria-disabled` と、Kumo が `disabled` のときに付けるクラス(`cursor-not-allowed opacity-50`)にして、押されても何もしないようにした。根拠: 公式ドキュメントのみ(Kumo のソース)+実測(テスト)
> - 関連: [[T25-images-page]]、[[emdash-admin-plugin-ui-styling#Kumo 2.6.0 の注意点]]、[[emdash-admin-plugin-pages]]、[[react-hook-testing-pitfalls]]

> [!info] 計測の方法と環境
> - 画像管理ページ(`src/admin/ImagesPage.tsx`)を登録した使い捨てのサイト([[emdash-admin-plugin-pages#再現手順]])で、Playwright(Chromium 153.0.8010.12、ヘッドレス)からキーボードで操作した。比べるために、EmDash の投稿の一覧の「ゴミ箱に移動」の確認と、開き方を変えた 4 通りの Kumo の `Dialog`(`role` が `dialog` / `alertdialog`、`open` を渡す / `Dialog.Trigger` で開く)も調べた。
> - jsdom では、`tests/admin/ImagesPage.test.tsx` と、使い捨てのテスト(外側を押したとき)で確かめた。
> - macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、`@cloudflare/kumo` 2.6.0(Base UI は Kumo の中の `dist/chunks/vendor-base-ui-f9z44m829vvptrg0.js`。型は `@base-ui/react` 1.8.0)、React 19.2.4、jsdom 30.1.0、`@testing-library/user-event` 14.6.7、Playwright 1.63.0。2026-09-24 に計測。

## role と外側を押したとき

Kumo の `Dialog.Root` は、`role="alertdialog"` なら Base UI の `AlertDialog.Root`、ほかは `Dialog.Root` を描く(`node_modules/@cloudflare/kumo/dist/chunks/dialog-g1b8161nbyixdit0.js:71-81`)。Base UI の `AlertDialogRootProps` は `modal` と `disablePointerDismissal` を持たない(`node_modules/@base-ui/react/alert-dialog/root/AlertDialogRoot.d.ts`)。根拠: **実測+公式ドキュメント**

| `Dialog.Root` | 外側(`document.body`)を押したとき(jsdom、`user.click`) |
|---|---|
| `role="dialog"`(`open` を渡し、`onOpenChange` で閉じる) | 閉じた |
| `role="alertdialog"`(同じ) | 閉じなかった |

- EmDash の確認(`admin/src/components/ConfirmDialog.tsx:71-75`、一覧の「ゴミ箱に移動」の `ContentList.tsx:1356`)は `role="dialog"` に `disablePointerDismissal` を付けている。`alertdialog` なら付けなくても同じ動き(付けると型エラー)。
- Escape は、どちらも `onOpenChange(false)` を呼ぶ。`open` を渡しているときは、処理中なら無視すれば閉じない(画像管理ページは、送信中は閉じない)。

## フォーカス

Chromium 153 で、キーを押して 150ms 待ってから `document.activeElement` を読んだ。根拠: **実測のみ**

| 操作 | 画像管理ページ(`alertdialog`) | EmDash の一覧の確認(`dialog`) |
|---|---|---|
| 開く(ボタンで Enter) | 「キャンセル」 | 「キャンセル」 |
| Tab → Tab → Tab | 移動 → キャンセル → 移動(中を回る) | 同じ |
| Shift+Tab → Shift+Tab | キャンセル → 移動 | 同じ |
| Escape | 開いたボタンに戻る | 開いたボタン(`Dialog.Trigger`)に戻る |

- キーを押した直後に読むと、Base UI のフォーカスの見張り(`span`)が返ることがあった。少し待つと中の要素に移っている。
- `open` を渡して開く(`Dialog.Trigger` を使わない)ときも、開く前にフォーカスのあった要素に戻った。jsdom でも同じ(`tests/admin/ImagesPage.test.tsx` の「キャンセル・Escape では送らずに閉じ、フォーカスをボタンに戻す」)。
- 最初のフォーカスは、ダイアログの中の最初のフォーカスできる要素だった。取り消せる側を先に置けば、Enter の押し間違いで削除しない。

### 成功したあとにフォーカスを移す

ゴミ箱に移すと「ゴミ箱に移動」のボタンが「完全に削除」に替わり、完全に削除すると行が消える。フォーカスを戻す先が無くなるので、別の場所に移す。

- Kumo の `Dialog`(中身の部品)は `className` / `children` / `style` / `size` / `container` だけを受け取り、Base UI の `Popup` の `finalFocus` を渡せない(`dialog-g1b8161nbyixdit0.js:46-69`)。根拠: 公式ドキュメントのみ
- 画像管理ページは、移す先を覚えておき、`Dialog.Root` の `onOpenChangeComplete(false)`(閉じるアニメーションが終わったとき)で `focus()` する。移す先は行の見出しのセル(`<th scope="row" tabIndex={-1}>`。完全削除では次の行、最後の行なら前の行、無ければページの見出し)。Chromium 153 で、ゴミ箱に移したあとは同じ行の見出し、完全削除のあとは次の行の見出しにフォーカスがあった。jsdom でも同じ(`onOpenChangeComplete` はアニメーションが無いのですぐ呼ばれる)。根拠: 実測のみ

```tsx
<Dialog.Root
	role="alertdialog"
	open={dialogOpen}
	onOpenChange={(open) => {
		if (!open) closeDialog(); // 処理中は閉じない
	}}
	onOpenChangeComplete={(open) => {
		if (!open) onDialogClosed(); // 覚えておいた先に focus()
	}}
>
```

## 読み上げ

`alertdialog` は、`Dialog.Title` を `aria-labelledby`、`Dialog.Description` を `aria-describedby` に持つ。`Dialog.Description` に `render={<div />}` を渡すと、段落を複数入れられ、説明は段落をつないだ文になった。根拠: **実測のみ**(Playwright の `ariaSnapshot` と属性)

- 開いている間、外側の要素に `aria-hidden="true"` が付き、見出し・表・サイドバーはアクセシビリティツリーから消えた。ページの `<output aria-live="polite">` とその祖先(`main`)は隠れず、ツリーには `main > status`・通知の領域・`alertdialog` だけが残った。EmDash の一覧の確認(`main` の中に `aria-live` が無い)では `main` ごと隠れた。根拠: **実測+公式ドキュメント**
- Base UI は、外側を隠すときに `[aria-live]` の要素とその祖先を残す(`vendor-base-ui-f9z44m829vvptrg0.js:1009`)。そのため、画像管理ページは、操作の結果の読み上げ(「…をゴミ箱に移動しました。」)をダイアログを閉じる前に書き込んでいる。
- ダイアログの要素に `aria-modal` は付かなかった(4 通りの開き方のすべて)。外側は `aria-hidden` で隠れるので、読み上げの範囲は閉じ込められる。

## 処理中のボタン

Kumo の `Button` は、`loading` か `disabled` があると `disabled` 属性を付け、`disabled` のときは `cursor-not-allowed opacity-50` を足す。`loading` のときは、アイコンの代わりに `Loader`(英語の `aria-label="Loading"` と `role="status"`)を入れる(`node_modules/@cloudflare/kumo/dist/chunks/button-gtdhvogt5rlrf1is.js:146-178`)。根拠: **公式ドキュメントのみ**(Kumo のソース。フォーカスの動きは jsdom で実測)

- `disabled` にすると、押したボタンからフォーカスが失われる(読み上げの利用者が位置を見失う)。画像管理ページは `aria-disabled` と同じクラスにして、押されてもハンドラーで何もしない。送信中の二度押しは、描画を待たない `ref` の印で防ぐ。
- 文字は「移動しています…」のように言い換え、`aria-disabled="true"` で押せないことを伝える。
- jsdom では、`aria-disabled` のボタンも `user.click` で押せる(`disabled` と違い、イベントは届く)。二度押しを防いでいることを、押して要求の数を数えて確かめた。
