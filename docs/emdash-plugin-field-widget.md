---
title: EmDash 0.39.1 の plugin widget が受け取るものと、実際の管理画面での振る舞い(単一画像の widget で確かめた)
aliases:
  - plugin widget の props
  - 編集ロック中の widget
  - widget が作り直される時期
  - 表示の切り替えでフォーカスを戻す方法
  - 単一画像の widget のブラウザでの確認
tags:
  - docs
  - emdash
  - admin
  - react
  - a11y
  - browser
source_task: "[[T27-image-widget]]"
created: 2026-09-24
updated: 2026-09-24
---

# EmDash 0.39.1 の plugin widget が受け取るものと、実際の管理画面での振る舞い(単一画像の widget で確かめた)

> [!summary] 要点
> - plugin widget の props は `value`・`onChange`・`label`・`id`(`field-<slug>`)・`required`・`options`・`validation`・`minimal` の 8 つで、**`readOnly` は渡らない**。ただし、フィールドの並びは `<fieldset disabled={readOnly}>` の中にあるので、編集ロック中は widget の中のボタンと入力欄もブラウザが無効にする。**`div` で受けるドロップだけは届く**(widget の確認を外すと、ロック中でもアップロードが始まった)ので、widget の側で受け付けないようにする。根拠: 実測+公式ドキュメント
> - フィールドは、エントリ ID を含む `key` で描かれる。そのため**新規作成を保存すると widget は作り直され**、state は初めに戻る(`prime` した手元のプレビューが残らず、プレビューを取得し直した)。保存後の URL は `/_emdash/admin/content/posts/<ID>?locale=en` になった。根拠: 実測+公式ドキュメント
> - 管理画面の入口の型 `PluginAdminModule` の `fields` は `Record<string, React.ComponentType>`(props 無し)。props が必須の widget はこの型に代入できないので、`fields` に型の注釈を付けない。根拠: 公式ドキュメントのみ(型チェックの結果で確かめた)
> - `?field=<slug>` の付いた編集画面は、`#field-<slug>` を `scrollIntoView` して `focus()` する。widget の fieldset ではフォーカスは移らず、body のままだった。根拠: 実測+公式ドキュメント。標準の画像フィールドも `id` を div に付けるので、同じになるとみられる(推測のみ)
> - フィールドの間隔は `space-y-6`(24px)で、詳細度 0 の `:where()` で付く(公式ドキュメントのみ)。そのため widget の根に余白のクラス(`m-0` など)を付けると、この間隔が消えるはず(推測のみ。付けて試してはいない)。空の読み上げの領域(高さ 0)を grid に並べると、gap が付いてフィールドの下に余白が残った(実測のみ)
> - 単一画像の widget を Chromium 153 と Firefox 155 で動かし、選択・ドロップ・貼り付け・差し替え・削除・代替テキスト・キャンセル・エラー・「画像が見つかりません」・正しくない値・編集ロック・保存を確かめた。違いは、Firefox のヘッドレスが貼り付けの画像を読めないこと([[admin-image-input-browser-behavior]] と同じ)だけだった。根拠: 実測のみ
> - 関連: [[T27-image-widget]]、[[emdash-admin-content-editor-url]]、[[admin-image-input-browser-behavior]]、[[emdash-admin-plugin-ui-styling]]、[[upload-hook-browser-check]]、[[astro-dev-background-for-agents]]

## 1. widget が受け取る props

管理画面は、フィールドの `widget` が `<プラグイン ID>:<名前>` のとき、プラグインの管理画面の入口の `fields[<名前>]` を次の props で描く(`references/emdash/packages/admin/src/components/ContentEditor.tsx:1814-1843`)。`PluginFieldErrorBoundary` で包まれる。

| prop | 値 | 根拠 |
|---|---|---|
| `value` | フォームの値(`formData[name]`)。`json` フィールドなら任意の JSON | `ContentEditor.tsx:1383` |
| `onChange` | `(v) => onChange(name, v)` | `ContentEditor.tsx:1794` |
| `label` | フィールドの表示名 | `ContentEditor.tsx:1790` |
| `id` | `field-${name}` | `ContentEditor.tsx:1791` |
| `required` / `options` / `validation` | フィールド定義の値をそのまま | `ContentEditor.tsx:1838-1840` |
| `minimal` | フィールドの並び(`:1379-1400`)は渡さないので `undefined` | `ContentEditor.tsx:1841` |

- `readOnly` は `FieldRenderer` までは渡るが(`ContentEditor.tsx:1398`)、plugin widget には渡さない。根拠: 公式ドキュメントのみ
- 型: `PluginAdminModule` は `fields?: Record<string, React.ComponentType>`(`references/emdash/packages/admin/src/lib/plugin-context.tsx:16-19`。インストールされる `@emdash-cms/admin` 0.39.1 の `dist/index.d.ts:2836` も同じ)。`ContentEditor` は取り出すときに props の型へキャストしている(`:1818-1829`)。`ImageFieldProps` のように必須の props を持つ部品は、この型の変数に代入すると TS2322 になる(`tests/admin/ImageField.test.tsx` の `@ts-expect-error` で確かめた)。公式の field-kit も `export const fields = { … }` に型の注釈を付けていない(`references/emdash/packages/plugins/field-kit/src/admin.tsx:6`)。根拠: 公式ドキュメントのみ+型チェックの実測

## 2. 編集ロック中の widget

- 編集画面は、ほかの利用者がロックを持つと `entryLock.readOnly` を `ContentEditor` に渡す(`references/emdash/packages/admin/src/router.tsx:1710`)。`ContentEditor` はフィールドの並びを `<fieldset disabled={readOnly} className="contents">` で包む(`ContentEditor.tsx:1336`)。根拠: 公式ドキュメントのみ
- 実際の管理画面で、lock の API(`POST /_emdash/api/content/posts/<ID>/lock`)を Playwright の `page.route` で差し替え、ほかの利用者がロックを持つ応答(`{ data: { enabled: true, holder: {…}, heldByCaller: false } }`)を返した。結果(Chromium 153・Firefox 155 で同じ)。根拠: 実測のみ
  - 「This entry is open somewhere else」のダイアログ(日本語の画面でも英語)が出て、「Open read-only」「Take over」を選ぶ。ダイアログの後ろでも、widget の fieldset はすでに `:disabled` だった。
  - 「Open read-only」のあとは、フォームの上に「Read-only」の帯が出る。widget の中のボタン(ドロップゾーン・差し替え・削除)、代替テキストの入力欄、`<input type="file">` は、どれも `:disabled` で、`focus()` してもフォーカスは移らなかった(body のまま)。
  - ドロップゾーンの枠(`div`)に、本物の `DataTransfer` を持つ `drop` を `dispatchEvent` で送ると、widget は何もしなかった(アップロードの要求 0 件、処理中の表示なし)。widget は、ファイルを受け取ったときに自分の fieldset が `:disabled`(祖先の fieldset が無効なら当たる)かを見て、受け付けない。
- widget の確認を外すと、ロック中でもドロップからアップロードが始まった → [[#編集ロックの確認を外したとき|下の節]]。
- 仕様書 11.1 の「編集ロック中でも widget は操作できてしまう」は、EmDash 0.39.1 では当たらない(操作できるのは `div` のイベントだけ)。

### 編集ロックの確認を外したとき

widget の確認(`isInsideDisabledFieldset`)を一時的に外し、同じ手順(読み取り専用で開いた画像なしの投稿の枠へ、PNG 1 枚の `drop` を送る)を比べた(`spikes/t27-image-widget/check-lock-drop.mjs`)。根拠: 実測のみ

| widget | Chromium 153 | Firefox 155 |
|---|---|---|
| 確認あり(今の実装) | アップロードの要求 0 件。ドロップゾーンのまま | 同じ |
| 確認なし | 要求 1 件。画像が追加され、「画像を追加しました。」まで進む(fieldset は `:disabled` のまま) | 同じ |

- 確認が無いと、ロック中でも画像エントリがサーバーに作られ、フォームの値も変わる(保存はされないが、使われない画像が残る)。ボタンと入力欄の無効化だけでは足りない。
- OS からの本物のドラッグでも同じかは確かめていない(ヘッドレスでは合成のイベントだけを送れる)。`div` は fieldset の無効化の対象ではないので、同じになると見ている(推測のみ)。

## 3. 新規作成を保存すると widget は作り直される

- フィールドは ``key={`${name}:${item?.id ?? "new"}`}`` で描かれる(`ContentEditor.tsx:1371-1377`。翻訳を切り替えたときに各フィールドを作り直すため、とコメントにある)。新規作成の保存でエントリ ID が決まると、`key` が変わる。根拠: 公式ドキュメントのみ
- 実測(両方のブラウザで同じ): 新規作成の画面で画像を追加し、`#field-cover` に目印の属性を付けてから「保存」を押した。根拠: 実測のみ
  - `POST /_emdash/api/content/posts` が 201 を返し、URL は `/_emdash/admin/content/posts/<ID>?locale=en` になった。
  - 目印は消えていた(fieldset が作り直された)。プレビューの取得(`preview`)が 1 回送られた(`prime` で入れた手元の data URL が残っていない)。代替テキストは保存した値(「赤い花」)で表示された。
  - 作り直しで部品の state は初めに戻るので、「画像を追加しました。」の読み上げの文や GIF の注意も残らない。E2E で、保存のあとに読み上げの領域が空に戻ることを確かめた(両方のブラウザ。[[e2e-playwright-emdash-admin#6. テストで確かめた挙動]])。根拠: 実測のみ
- widget への影響: アップロードの結果や、`prime` で入れた手元の data URL は、新規作成の保存を越えて残らない。保存した値から表示し直すので、表示は変わらない。保存後の URL には `?locale=` が付くので、そのあとのアップロードは `target` に `entryId` と `locale` を含む(一覧から開いた画面で `{ collection: "posts", field: "cover", entryId: "<ID>", locale: "en" }` を確かめた)。

## 4. ?field= の付いた URL で開いたとき

- 管理画面は、`field` の検索パラメーターがあると、読み込みのあとの `requestIdleCallback` で `document.getElementById("field-<slug>")` を `scrollIntoView({ behavior: "smooth", block: "center" })` して `focus()` し、URL から `field` を消す(`router.tsx:920-933`)。サイトのビジュアル編集のツールバーが、この URL を作る(`references/emdash/packages/core/src/visual-editing/toolbar.ts:955`)。根拠: 公式ドキュメントのみ
- 単一画像の widget は `id` を fieldset に付けている。`/_emdash/admin/content/posts/<ID>?field=cover` を開くと、フォーカスは body のままで、URL の `field` は消えた(両方のブラウザ)。fieldset はフォーカスできないため。根拠: 実測のみ
- 標準の画像フィールドも、`id` を div に付けている(`references/emdash/packages/admin/src/components/ImageFieldRenderer.tsx:506`)ので、同じくフォーカスは移らない(推測のみ。標準の画像フィールドでは試していない)。
- fieldset に `tabIndex={-1}` を付ければ、フォーカスをグループに移せる(推測のみ。T27 では付けていない)。

## 5. 見た目: フィールドの間隔と fieldset

- フィールドの並びは `space-y-6` の div の中にある(`ContentEditor.tsx:1363-1369`)。管理画面の CSS では `:where(.space-y-6>:not(:last-child)){…margin-block-end:calc(calc(var(--spacing) * 6) * …)}` で、詳細度は 0。根拠: 公式ドキュメントのみ(CSS の規則は `node_modules/@emdash-cms/admin/dist/styles.css` で確認)。widget の根に `m-0` などの余白のクラス(詳細度 0,1,0。同じ `@layer utilities` の中)を付けると、こちらが勝って 24px の間隔が消えるはず。根拠: 推測のみ(付けて試してはいない)
- fieldset の既定の余白・枠は、管理画面の CSS の preflight(`*{margin:0;padding:0;border:0 solid}`)が消している。単一画像の widget の fieldset の計算値は `margin 0 0 24px`(下は `space-y-6`)・`padding 0`・`border 0`・`min-width 0`(`min-w-0` を付けた)だった。legend から中身までは `mt-2` の 8px。根拠: 実測のみ
- 空の読み上げの領域と grid の gap: widget は、進捗・注意・エラーの 3 つの領域を、読み上げのために常に描く(中身が無いときは高さ 0)。最初は中身を `grid gap-2` で並べていたため、高さ 0 の 3 つの要素にも gap が付き、フィールドの下に余白が残った(スクリーンショットで、Cover と Gallery の間が Title と Cover の間より広かった)。gap をやめ、見えるものがあるときだけ上に `mt-2` を付けた。直したあとの間隔(要素の矩形で計測。両方のブラウザ、空・画像ありの両方で同じ): Title → Cover 24px、Cover → Gallery 24px、fieldset の下端 = 中身の下端。根拠: 実測のみ

## 6. 表示の切り替えでフォーカスを戻す方法

押したボタンが表示の切り替えで消えると(処理の開始と終了・削除・エラーを閉じる)、フォーカスは body に戻る。単一画像の widget は、次のように戻している。

- fieldset に `focusin` のリスナーを付け(`useEffect` で 1 回。fieldset の `onFocus` は oxlint の `jsx-a11y/no-noninteractive-element-interactions` が拒む)、最後にフォーカスを受けた要素を ref に覚える。
- 依存配列の無い `useLayoutEffect` で、覚えた要素が DOM から外れていて(`isConnected` が false)、`document.activeElement` が body か null のときだけ、今の表示の主な要素へ `focus()` する。ほかのフィールドにフォーカスがあれば動かさない。
- 移す先: 処理中はキャンセル、追加した直後は代替テキスト、キャンセル・失敗・エラーを閉じたあとは差し替え、画像なしはドロップゾーン、「画像が見つかりません」と正しくない値は削除のボタン。
- 要素が消えたときの `blur` / `focusout` は使わない(ブラウザで違うため。推測のみ)。

```tsx
const lastFocusedRef = useRef<HTMLElement | null>(null);
useEffect(() => {
	const root = rootRef.current;
	if (root === null) return undefined;
	const remember = (event: FocusEvent): void => {
		if (event.target instanceof HTMLElement) lastFocusedRef.current = event.target;
	};
	root.addEventListener("focusin", remember);
	return () => root.removeEventListener("focusin", remember);
}, []);
useLayoutEffect(() => {
	const last = lastFocusedRef.current;
	if (last === null || last.isConnected) return;
	const active = document.activeElement;
	if (active !== null && active !== document.body) return;
	lastFocusedRef.current = null;
	nextFocusTarget()?.focus(); // 今の表示の主な要素
});
```

- 実際の管理画面での結果は、下の表の「フォーカス」の列。jsdom のテスト(`tests/admin/ImageField.test.tsx` の「キーボードとフォーカス」)でも確かめた。`useLayoutEffect` を `useEffect` にしても jsdom のテストは通る(描画が無いため)。描画の前に移すために `useLayoutEffect` にした(推測のみ。ちらつきの有無は比べていない)。根拠: 実測のみ

## 7. 実際の管理画面での確認の結果

投稿(`posts`)の `cover`(`widget: "base64-image:image"`)で確かめた。Chromium 153 と Firefox 155 で、次の表の結果は、画質と保存サイズの数値のほかは同じだった(違いは「貼り付け」だけ)。根拠: 実測のみ

| 確かめたこと | 結果 | フォーカス |
|---|---|---|
| 新規作成の画面で、ドロップゾーンのボタンにフォーカスして Enter | ファイルの選択が開く。`multiple` なし、`accept="image/*"` | — |
| 処理中(2400×1600 の JPEG) | 主な表示が消え、「読み込み中…」→「圧縮中… 1600px / 画質 0.60」→(画質を探す)→「サムネイルを作成中…」→「アップロード中…」とキャンセルのボタンだけになる。読み上げは段階ごとの 4 つと「画像を追加しました。」 | キャンセル |
| 「読み込み中…」の描画とデコードの順 | コミットのあとのフレームがデコードの開始より先だった(Chromium: コミット 1136.1ms・フレーム 1136.5ms・デコード 1154.3ms。Firefox: 1374ms・1374ms・1381ms) | — |
| 追加 | 1600×1067 · 保存サイズ 98.0KB · 画質 0.64(Firefox は 99.1KB · 0.63)。代替テキストの欄と「空欄のときは、装飾画像として扱われます…」 | 代替テキスト |
| 新規作成で送った `target` | `{ collection: "posts", field: "cover" }`(エントリ ID もロケールも無い) | — |
| 代替テキストを入れて保存 | 201。保存した値は `{ v: 1, id, locale: "en", width: 1600, height: 1067, alt: "赤い花" }` | — |
| 一覧から開いた編集画面 | URL は `…/posts/<ID>?locale=en`。`preview` を 1 回送り、保存サイズ・画質も出る | — |
| 差し替え(PNG) | `target` に `entryId` と `locale: "en"`。代替テキストは空になる。保存で `alt` に入れた値が入る | キャンセル → 代替テキスト |
| キャンセル(アップロード中) | 前の画像と代替テキストのまま(値は変わらない) | 差し替え |
| HEIC | 「HEIC / HEIF の画像は使えません。iPhone のカメラ設定を「互換性優先」にするか、JPEG に書き出してください。」。アップロードの要求は 0 件。値は変わらない | 差し替え。閉じたあとも差し替え |
| GIF | 「GIF は最初のフレームだけの静止画になります(アニメーションは保存されません)。」 | — |
| 削除して保存 | ドロップゾーンに戻る。保存した値は `null` | ドロップゾーン |
| ドロップ(1 枚) | 追加される | 代替テキスト |
| ドロップ(2 枚) | 「画像は 1 枚ずつ追加してください。」。要求は 0 件 | — |
| 貼り付け(ボタンにフォーカスして ⌘V) | Chromium: 追加される(`image.png`、320×200)。Firefox(ヘッドレス): 「クリップボードの画像を読み取れませんでした。…」 | Chromium: 代替テキスト |
| 画像エントリをゴミ箱に移してから開く | 「画像が見つかりません」。**参照したままでも保存できた(200)**。削除して保存すると `null` | 削除のあとはドロップゾーン |
| 値が `{}` の投稿を開く | 「画像の値が正しくありません」と説明・削除のボタン。そのまま保存すると 422 `SAVE_REJECTED` で、「保存に失敗しました」のトーストに保存 hook の日英の文が出る。削除すると保存できる | 削除のあとはドロップゾーン |
| 編集ロック中 | → [[#2. 編集ロック中の widget\|2 章]] | フォーカスできない |
| Tab の順(画像あり) | Title → 代替テキスト → 差し替え → 削除 → Gallery(`<input type="file">` には止まらない) | — |
| `?field=cover` | → [[#4. ?field= の付いた URL で開いたとき\|4 章]] | body |
| 英語(`emdash-locale=en`) | 「Replace」「Remove」「Alternative text」「Stored size 1.5 KB · Quality 0.92」「Drop or paste an image」「Select a file」 | — |
| アクセシビリティツリー | `group "Cover"` の中に、ボタン・入力欄と `status`・`alert` の領域(中身が無いときは空) | — |
| コンソールのエラー | Chromium は 422 の読み込みエラー 1 件(正しくない値の保存を拒否したもの)だけ。Firefox は無し | — |

- ゴミ箱の画像を参照したまま保存できるのは、ゴミ箱に移しても `imageRefs` の記録が残るため(保存 hook ③ は記録の有無を見て、記録は完全削除のときだけ消す。仕様書 8 章・10 章、`src/server/hooks/image-deleted.ts`)。「画像が見つかりません」の説明(「削除された画像を参照したままでは保存できない」)は、完全削除のときの話になる。完全削除のあとの保存は確かめていない。
- 本物のドラッグ(OS からのドロップ)と、ヘッドレスでない Firefox の貼り付けは確かめていない。

## 8. 環境と手順

| 項目 | 値 |
|---|---|
| マシン | Apple M5 Pro、macOS 26.4(Darwin 25.4.0) |
| Node / Playwright | 26.10.0 / 1.63.0(ヘッドレス) |
| ブラウザ | Chromium 153.0.8010.12、Firefox 155.0 |
| サイト | `emdash` 0.39.1・`@emdash-cms/admin` 0.39.1・Astro 7.3.3・React 19.2.4・`@cloudflare/kumo` 2.6.0。SQLite、`astro dev`(ポート 4427) |
| 日付 | 2026-09-24 |

1. `playground/` を `spikes/t27-image-widget/site/`(git 管理外)に写し、`package.json` からプラグインのパッケージを外した。プラグインは、ルートと hook を登録する使い捨ての定義(T29 の代わり)と、widget を登録する管理画面の入口(T30 の代わり)にした。

```js
// astro.config.mjs(抜粋): プラグインを記述子で登録する
plugins: [
	{
		id: "base64-image",
		version: "0.0.0",
		entrypoint: "/plugins/base64-image-spike.ts",
		adminEntry: "/plugins/admin.tsx",
		options: {},
	},
],
```

```tsx
// plugins/admin.tsx: 型の注釈を付けない
import { ImageField } from "../../../../src/admin/ImageField";
export const fields = { image: ImageField };
```

```ts
// plugins/base64-image-spike.ts(抜粋): definePlugin に routes(upload・preview・thumbnails・images)・storage(imageRefs)・
// hooks(参照元の記録・画像の削除・content:beforeSave)と admin.entry を渡す。正しくない値の投稿を作るため、
// タイトルが「[raw]」で始まる投稿だけ参照の確認(③)を飛ばした
"content:beforeSave": {
	handler: async (event, ctx) => {
		if (event.collection === IMAGE_COLLECTION) return validateImageEntryBeforeSave(event, ctx);
		const title = event.content["title"];
		if (typeof title === "string" && title.startsWith("[raw]")) return;
		await validateReferencesBeforeSave(event, ctx);
	},
},
```

2. `node node_modules/astro/bin/astro.mjs dev --background --port 4427 --root spikes/t27-image-widget/site` で起動した([[astro-dev-background-for-agents]])。
3. `spikes/t27-image-widget/check.mjs`(Playwright)を実行した。Chromium ではスクリプトの不具合(ロックのダイアログの role など)を直しながら 3 回、Firefox では 1 回実行し、表は最後の実行の結果(前の実行でも、動いたところは同じ結果だった)。`/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` でログインし、`emdash-locale=ja` の cookie を `/_emdash` に付ける。投稿の作成・値の確認・画像のゴミ箱への移動は、同じ cookie の `page.request` で REST API(`X-EmDash-Request: 1`)を呼んだ。

```js
// 処理中の表示を確かめるため、アップロードの要求を止めておく(キャンセルでは abort する)
await page.route("**/_emdash/api/plugins/base64-image/upload", async (route) => {
	const mode = await released; // "continue" | "abort"
	if (mode === "abort") await route.abort();
	else await route.continue();
});
// 編集ロック: ほかの利用者がロックを持つ応答を返す
await page.route("**/_emdash/api/content/posts/*/lock*", (route) =>
	route.request().method() === "DELETE"
		? route.fulfill({ json: { data: { released: false } } })
		: route.fulfill({
				json: {
					data: {
						enabled: true,
						holder: { userId: "t27-other", userName: "別の利用者", acquiredAt, expiresAt },
						heldByCaller: false,
					},
				},
			}),
);
// ドロップ: 本物の DataTransfer を作って、ドロップゾーンのボタンの親(枠)に送る
const dataTransfer = await page.evaluateHandle((items) => {
	const transfer = new DataTransfer();
	for (const item of items) {
		const bytes = Uint8Array.from(atob(item.b64), (c) => c.charCodeAt(0));
		transfer.items.add(new File([bytes], item.name, { type: item.type }));
	}
	return transfer;
}, payload);
const frame = page.locator("#field-cover").getByRole("button", { name: "Cover: ファイルを選択" }).locator("xpath=..");
for (const type of ["dragenter", "dragover", "drop"]) await frame.dispatchEvent(type, { dataTransfer });
// 作り直しの確かめ方: 保存の前に目印を付け、保存のあとに残っているかを見る
await page.evaluate(() => {
	document.getElementById("field-cover").dataset.t27Marker = "before-save";
});
```

4. 貼り付けは [[admin-image-input-browser-behavior#再現手順|T22 の方法]](クリックの中で `navigator.clipboard.write` に PNG を入れ、ボタンにフォーカスして `ControlOrMeta+V`。Chromium は `clipboard-read` / `clipboard-write` の権限を与える)。「読み込み中…」とデコードの順は、`createImageBitmap`(引数が Blob のもの)を包んで開始の時刻を記録し、`MutationObserver` で `decoding` の行が出たときに `requestAnimationFrame` の時刻を記録して比べた([[upload-hook-browser-check]] と同じ見方)。
5. 終わったら `astro dev stop --root spikes/t27-image-widget/site` で止め、`lsof -nP -iTCP:4427 -sTCP:LISTEN` で何も出ないことを確かめた。
