---
title: ギャラリーの widget の並べ替え・フォーカス・処理中の保存(EmDash 0.39.1 の管理画面で確かめた)
aliases:
  - ギャラリーの並べ替え
  - HTML の Drag and Drop での並べ替え
  - 並べ替えとフォーカス
  - React DOM のフォーカスの戻し
  - 処理中の保存で画像が外れる
  - 保存の応答でフォームの値が戻る
tags:
  - docs
  - emdash
  - admin
  - react
  - a11y
  - browser
  - drag-and-drop
source_task: "[[T28-gallery-widget]]"
created: 2026-09-24
updated: 2026-09-24
---

# ギャラリーの widget の並べ替え・フォーカス・処理中の保存(EmDash 0.39.1 の管理画面で確かめた)

> [!summary] 要点
> - 並べ替えは、HTML の Drag and Drop(つまみと縮小画像をつかむ)と ↑↓ ボタンで行う。ドラッグは独自の種類(`application/x-base64-image-gallery-item`)を `setData` し、この widget の中で始まったドラッグ(ref)だけを受け付ける。ファイルのドラッグ・ほかのギャラリーの行は受け付けない。根拠: 実測のみ(Chromium 153・Firefox 155)
> - 縮小画像の包みに `pointer-events: none` を付けると、ドラッグはつまみの `div` から始まり、運ぶ種類は `setData` したものだけになる(`Files`・`text/uri-list` は無い)。根拠: 実測のみ
> - **React DOM 19 は、コミットの前にフォーカスのある要素を覚え、DOM を変えたあとで `focus()` し直す。** そのため、行を動かしても押した ↑↓ ボタンのフォーカスは残る。生の `insertBefore` では、両方のブラウザでフォーカスが body に戻る。根拠: 実測+公式ドキュメント
> - フォーカスのあるボタンを `disabled` にすると、次の描画でフォーカスが外れる(両方のブラウザ)。端の ↑↓ は `aria-disabled` にして、押しても何もしない。根拠: 実測のみ
> - 編集ロック中、つまみ(`draggable` の `div`)は `<fieldset disabled>` で無効にならない。`dragstart` を `preventDefault` して止める。根拠: 実測のみ(fieldset を disabled にして確かめた)
> - **画像の処理中に「Save」を押すと、保存の応答でフォームの値が保存した値に戻り、保存の要求のあいだに足した画像が外れる。** 自動保存では起きない。根拠: 実測+公式ドキュメント。処理中は、進捗の行の下に「処理が終わってから保存してください。」と案内する([[T28-2-save-hint-alt-width|T28-2]]。案内だけで、保存は止めない)
> - Firefox 155 の幅 390px では、代替テキストの入力欄(T22 の `AltTextInput`)が行から 10px はみ出した。T28-2 で Kumo の `Input` に `className="min-w-0"` を渡し(`className` は `<input>` に付く)、収まった。根拠: 実測+公式ドキュメント
> - widget に共通のこと(props・編集ロック・作り直しの時期・フィールドの間隔・フォーカスの戻し方)は [[emdash-plugin-field-widget]] にある。
> - 関連: [[T28-gallery-widget]]、[[T28-2-save-hint-alt-width]]、[[T27-image-widget]]、[[T22-widget-parts]]、[[T23-upload-hook]]、[[emdash-admin-plugin-ui-styling]]、[[admin-image-input-browser-behavior]]、[[astro-dev-background-for-agents]]

## 1. 並べ替えのドラッグ(HTML の Drag and Drop)

新しい npm パッケージは使わず、HTML の Drag and Drop で作った(`src/admin/GalleryField.tsx`)。

| 項目 | 内容 | 根拠レベル |
|---|---|---|
| つかむ場所 | 行の左の「つまみ(6 点)+縮小画像」の `div draggable`。`title` に「ドラッグして並べ替えます」 | 設計判断 |
| 縮小画像 | 包みに `pointer-events: none`。`img` 自体のドラッグ(画像の URL やファイルを運ぶ)にならず、つまみの `div` のドラッグになる。`dragstart` の `target` は `div`、`types` は `setData` した 1 種類だけだった | 実測のみ(両方のブラウザ) |
| 運ぶデータ | `effectAllowed = "move"`、`setData("application/x-base64-image-gallery-item", <行のキー>)` | 設計判断 |
| `setData` の要否 | Playwright(ヘッドレス)の Firefox 155 と Chromium 153 では、`setData` をしなくてもドラッグが始まり、`drop` まで届いた。OS の本物のドラッグは確かめていない。widget は、種類でファイルのドラッグと見分けるために `setData` する | 実測のみ |
| 受け付けるドラッグ | `dragover` で、この widget の中で始まったドラッグ(`dragKeyRef`)で、かつ種類を持つときだけ `preventDefault` する。`dragover` では中身を読めないので、種類と ref で判定する。ほかのギャラリーの行を落としても、どちらの値も変わらなかった | 実測のみ |
| 落とす位置 | 行の `getBoundingClientRect()` の中央より上なら前、下なら後ろ。行の間の隙間では直前の位置のまま。受け口は一覧(`ul`)を包む `div`(`ul` にハンドラーを付けると oxlint の `jsx-a11y` が拒む) | 実測のみ |
| 線 | 落とす行に `box-shadow: 0 ±3px 0 0 var(--color-kumo-brand)`(`style`)。枠の色のクラスは当たらない([[emdash-admin-plugin-ui-styling]])。動かない位置(自分の前後)には出さない。ドラッグ中の行は `opacity-50` | 実測のみ(スクリーンショット) |
| 読み上げ | 落としたら「画像を 3 番目から 1 番目に移動しました(全 3 枚)。」 | 実測のみ |
| 落とした先の入力欄 | 代替テキストの `label` の上に落としても、`drop` を `preventDefault` するので文字は入らない(運ぶのは独自の種類だけ) | 実測のみ |

```tsx
// つまみ(行ごと)
<div draggable title={t.dragHint} data-gallery-handle="" onDragStart={(e) => onDragStart(key, e)} onDragEnd={onDragEnd}>
	<span className="pt-1"><GripIcon /></span>
	<div style={{ pointerEvents: "none" }}>{/* 縮小画像 */}</div>
</div>

// 受け口(一覧を包む div)
const handleListDragOver = (event: DragEvent<HTMLDivElement>) => {
	if (dragKeyRef.current === null || !carriesGalleryItem(event.dataTransfer) || isLocked(rootRef.current)) return;
	event.preventDefault();
	event.dataTransfer.dropEffect = "move";
	const row = findRow(event.target); // closest("[data-gallery-key]")
	if (row === null) return;
	const rect = row.element.getBoundingClientRect();
	updateDropTarget({ key: row.key, position: event.clientY < rect.top + rect.height / 2 ? "before" : "after" });
};
```

- jsdom には `DragEvent` と `DataTransfer` が無い。テストでは `MouseEvent` に偽の `dataTransfer` を `Object.defineProperty` で付けて送り、行の `getBoundingClientRect` を差し替えた(`tests/admin/GalleryField.test.tsx` の `dispatchDrag` と `layoutRows`)。根拠: 実測のみ
- Playwright の `page.mouse`(`down` → `move` を 2 回以上 → `up`)で、両方のブラウザで本物の `dragstart`・`dragover`・`drop` が起きた。根拠: 実測のみ

## 2. 並べ替えとフォーカス

### React DOM がフォーカスを戻す

- react-dom 19.2.4 は、コミットの前に `selectionInformation = { focusedElem, selectionRange }` を覚え(`node_modules/react-dom/cjs/react-dom-client.development.js:13857`)、DOM を変えたあとで、フォーカスのある要素が変わっていて、前の要素がまだ文書の中にあれば `priorFocusedElem.focus()` を呼ぶ(同 `:17978-18068`。祖先のスクロール位置も戻す)。根拠: 公式ドキュメントのみ(React のソース)
- 行を動かすとき、React は行の要素を `insertBefore` で動かす。widget のフォーカスを戻す処理を外して(ミューテーション)管理画面で ↓ を押しても、両方のブラウザでフォーカスは押したボタンに残った。根拠: 実測のみ
- React を使わない `insertBefore` では、両方のブラウザでフォーカスが body に戻った。Chromium は `blur` と `focusout` を出し、Firefox はどちらも出さなかった。`appendChild` でも同じ。根拠: 実測のみ
- そのため、widget は並べ替えのあとにフォーカスを戻さない(はじめは戻していたが、外した)。jsdom のテストでも、React が戻すのでフォーカスは残る。

| 操作(フォーカスのあるボタンを含む `li` を動かす) | Chromium 153 | Firefox 155 |
|---|---|---|
| `ul.insertBefore(li, next)` の直後・2 フレーム後 | body(`blur`・`focusout` あり) | body(イベントなし) |
| `ul.appendChild(li)` | body | body |
| React の再描画で行が動く(widget の戻す処理なし) | 押したボタンのまま | 押したボタンのまま |

### 端のボタンは aria-disabled

- フォーカスのあるボタンに `disabled = true` を付けると、直後の `document.activeElement` はそのボタンのままで、次の描画の時点で body に戻る(両方のブラウザで `blur` が出た)。根拠: 実測のみ
- ↓ を押し続けて末尾に着くと、`disabled` ではフォーカスが失われる。端の ↑↓ は `aria-disabled="true"` と `cursor-not-allowed opacity-50`(Kumo が `disabled` のときに付けるもの)にして、押しても何もしない。フォーカスは残った。根拠: 実測のみ。押せないことは `aria-disabled` で支援技術に伝わるとみられる(推測のみ。スクリーンリーダーでは確かめていない)
- 同じ理由で、処理中に無効になるドロップゾーン・差し替えのボタンにフォーカスがあると、次の描画で外れる。widget はそのとき(レイアウトの effect の時点ではまだ無効なボタンにある)キャンセルボタンへ移す。

### そのほかのフォーカス

- 削除: 同じ位置の(次の)画像の見出し(`tabIndex={-1}` の `p`)へ。最後の画像なら前の画像、無くなればドロップゾーン。値が描き直されてから移す(親の描き直しを待つ。`pending.when === "value"`)。根拠: 実測のみ(両方のブラウザと jsdom)
- 処理の開始と終了: [[emdash-plugin-field-widget#6. 表示の切り替えでフォーカスを戻す方法|T27 と同じ考え方]]で、この widget の中で最後にフォーカスを受けた要素(根の `focusin`)が消えた・無効になり、フォーカスが body に戻った(か、その要素に残っている)ときだけ移す。開始はキャンセル。終了は、追加ならドロップゾーン(押せなければ最後の画像の見出し)、差し替えが終わったらその画像の代替テキスト(空になったので入力を促す。T27 と同じ)、差し替えの失敗・キャンセルなら差し替えのボタン。根拠: 実測のみ
- 差し替えた行は、画像 ID を含むキーが変わるので作り直される。作り直した行の Kumo の `Input` には、`id` を渡しても、親のレイアウトの effect の時点ではまだ付いていなかった(jsdom)。代替テキストへ移すときは、`id` ではなく行の要素の中の `input` を探す。根拠: 実測のみ
- マウスでファイルをドロップしただけ(widget にフォーカスが一度も無い)なら、開始と終了のどちらでもフォーカスは body のままだった。ほかのフィールドにフォーカスがあれば奪わない(jsdom のテスト)。根拠: 実測のみ

## 3. 読み上げ

- 並べ替え・削除・差し替え・値の直し(空にする・1 枚目にする)は、widget の `<output aria-live="polite" className="sr-only">` で伝える。同じ文が続いても読まれるよう、中身を `<span key={連番}>` にして要素を作り直す。根拠: 実測のみ(jsdom と両方のブラウザで文字の変化を確かめた。スクリーンリーダーでは確かめていない)
- 追加の進捗・完了は T22 の `UploadProgress` の読み上げ(「3 枚中 1 枚目: 画像を読み込んでいます。」…「3 枚の画像を追加しました。」)。受け付けたときの判定で失敗したファイル(大きすぎる・HEIC など)は T23 が数えないので、「1 / 3」のあとに「1 / 2」になることがある(Firefox で観測)。根拠: 実測のみ

## 4. 処理中に「Save」を押したとき(EmDash の挙動)

- 編集画面は、`item` が変わると(保存の応答のあとなど)フォームの値を `item.data` に置き換える。置き換えないのは、自動保存が終わったとき・公開中・保存の衝突の通知が出ているときだけ(`references/emdash/packages/admin/src/components/ContentEditor.tsx:509-533`、`setFormData(item.data)` は `:528`)。根拠: 公式ドキュメントのみ
- そのため、手動の保存の要求を送ってから応答が届くまでに widget が足した画像は、応答でフォームから外れる。値が保存済みと同じになるので、自動保存も走らない。根拠: 実測のみ
- 確かめ方: 4 枚を選び、1 枚目が値に入ったところで「Save」を押す。`page.route` で手動の保存(`skipRevision` の無い `PUT`)の応答だけを 4 秒遅らせ、そのあいだに残りを処理させた。

| | Chromium 153 | Firefox 155 |
|---|---|---|
| 処理が終わった直後の行の数 | 4 | 4 |
| 保存の応答のあとの行の数 | 1(保存したときの 1 枚) | 2(保存したときの 2 枚) |
| 保存の要求の `gallery` | 1 件 | 2 件 |
| そのあとの自動保存 | なし | なし |

- 外れた画像のエントリは `b64_images` に残る(アップロードで作られたもの)。値には入っていないので、利用者が気付かなければ使われない画像になる。
- 応答が速ければ(ふつうは数十〜数百 ms)外れにくいが、大きい画像や遅い回線では 1 枚ほど外れうる。widget は、外から値が変わったと区別できない(復元などと同じ)ので、新しい値の後ろに次の画像を足す。
- 新規作成の最初の保存では、widget が作り直されて処理が止まる([[emdash-plugin-field-widget#3. 新規作成を保存すると widget は作り直される]])。E2E で確かめた: 処理中のアップロードは中断され、残りのファイルは処理されず、知らせも出ない(両方のブラウザ。[[e2e-playwright-emdash-admin#6. テストで確かめた挙動]])。根拠: 実測のみ

### 処理中の案内(T28-2)

- 処理中は、T22 の `UploadProgress` が進捗の行の下に「処理が終わってから保存してください。」(英語は「Save after processing finishes.」)と出す。部品に足したので、単一画像とギャラリーの両方に出る。処理していないときは描画しない。案内だけで、保存は止めない。
- 案内は `aria-live` の領域の外に置き、キャンセルボタンの `aria-describedby` にした。
  - 領域に入れると、段階が変わるたびに(1 枚につき 4 回)案内も読み上げられる。
  - ドロップゾーンのボタンから処理を始める(Enter でファイルを選ぶ・貼り付け)と、ボタンが消える・無効になるので、widget はフォーカスをキャンセルボタンへ移す([[emdash-plugin-field-widget]])。そのとき、ボタンの名前のあとに説明として読まれる。
  - マウスでドロップしたとき(widget にフォーカスが無い)は、フォーカスを動かさないので読まれない。見える案内だけになる。
- 見た目は 12px・行の高さ 16px・`text-kumo-subtle`。進捗の行との間は 8px(`UploadProgress` の `grid gap-2`)。

| 確かめたこと(T28-2) | Chromium 153 | Firefox 155 |
|---|---|---|
| 単一画像(Cover)の処理中に、進捗の行の下に出る | 出た | 出た |
| ギャラリーの処理中に出る(1 枚目を足したあと、2 枚目の処理中も) | 出た | 出た |
| 処理していない widget には出ない / 処理が終わると消える | 出ない / 消えた | 出ない / 消えた |
| 読み上げの領域の文に入らない(`output` の変化をすべて記録した) | 入らない | 入らない |
| キャンセルボタンの `aria-describedby` が案内を指す | 指す | 指す |
| 支援技術のツリーでのキャンセルボタンの説明 | 「Save after processing finishes.」 | 読む手段が無く、確かめていない |
| キーボードで処理を始めたときのフォーカス | キャンセルボタン | キャンセルボタン |
| フィールドの間隔(画像なし・単一画像の処理中・ギャラリーの処理中・画像あり) | どれも 24px、widget の下の余白は 0 | 同じ |
| 処理中に「Save」を押したとき(上の確かめ方) | 4 枚 → 1 枚 | 4 枚 → 2 枚 |

- 根拠: 実測のみ。Chromium の説明は CDP の `Accessibility.getPartialAXTree` で読んだ。スクリーンリーダーでは確かめていない。アップロードの要求を `page.route` で 3 秒遅らせて、処理中の表示を測った。spike の管理画面の入口には、単一画像の widget も登録した(`export const fields = { image: ImageField, gallery: GalleryField }`)。
- 案内を出しても、押せば画像は外れる(最後の行。T28 と同じ数)。外れた画像を知らせて足し直す案は行っていない。

## 5. 狭い画面での代替テキストの入力欄(Firefox)

- 行は「つまみ+縮小画像(96px)」と「見出し・代替テキスト・ボタン」の横並び。幅 390px の管理画面で、右の列は 196px になる。
- Firefox 155 では、代替テキストの入力欄とラベル・説明が 215px になり、行から 10px はみ出した。Kumo の `Input` はラベル付きのとき `grid gap-2`(`auto` の列)で包まれ、その列の最小幅が入力欄の既定の幅(Firefox で約 215px)になるため。Chromium 153 でははみ出さなかった。根拠: 実測のみ
- 右の列に `grid-cols-1`(`minmax(0, 1fr)`)を付けても直らなかった。ページに `input { min-width: 0 }` を入れると、Firefox でもはみ出さなくなった(Kumo の包みの列も縮んだ)。根拠: 実測のみ
- T28 の時点の案は、T22 の `AltTextInput` で `Input` に `className="min-w-0"` を渡すこと(下の T28-2 で行った)。ページ全体の横スクロールは出ない(0px)。

### T28-2 で直した結果

- T22 の `AltTextInput` で、Kumo の `Input` に `className="min-w-0"` を渡した。Kumo 2.6.0 の `Input` は、`className` を `<input>`(Base UI の Input)に付け、ラベル・説明を包む Field(`grid gap-2`)には付けない(`node_modules/@cloudflare/kumo/dist/chunks/input-f2ct7obgdzypjmp2.js:96-101`、包みは `field-f1hy08um3jf9jos6.js:18`)。根拠: 実測+公式ドキュメント(jsdom のテストと、両方のブラウザで `<input>` の計算値の `min-width` が `0px`)
- `.min-w-0{min-width:0}` は管理画面の CSS にある(部品のテストの「管理画面の CSS」で確かめている)。

| 幅 390px(T28-2) | Chromium 153 | Firefox 155 |
|---|---|---|
| ギャラリーの行の入力欄 | 196px。行の右端から 9px 内側 | 196px。同じ |
| 単一画像の入力欄 | 342px(fieldset の幅いっぱい) | 342px |
| widget からはみ出す要素・ページの横スクロール | 0・0px | 0・0px |
| 対照: 入力欄を `min-width: auto` に戻す | はみ出さない(196px のまま) | 行の入力欄が 214.7px になり、9.7px はみ出す(要素 14 個) |
| 幅 1280px | 行 458px・単一画像 604px(列の幅いっぱい) | 同じ |

- 単一画像は 390px でも列が 342px あり、`min-w-0` が無くてもはみ出さない。同じ部品なので、付けたままにした(狭い列に置いたときに備える)。根拠: 実測のみ
- 6. の確認のうち Firefox 155 で通らなかった「390px で widget が横にはみ出さない」は、T28-2 のあと通った(6. の全項目を両方のブラウザで実行し、すべて通った)。根拠: 実測のみ

## 6. 実際の管理画面での確認の結果

`spikes/` の使い捨てのサイトで、`gallery`(`maxItems: 10`)と `photos`(`maxItems: 3`)の 2 つのフィールドを確かめた。確認は 97 項目で、Chromium 153 はすべて通り、Firefox 155(ヘッドレス)は 5. の 1 項目を除いて通った。根拠: 実測のみ

| 確かめたこと | 結果 |
|---|---|
| 複数の追加(Enter でファイルの選択を開く・`multiple`) | 3 枚を 1 枚ずつ送った(同時に送った要求は最大 1)。送った `target` は `{ collection: "posts", field: "gallery", entryId, locale: "en" }`。追加した画像のプレビューは取得しない |
| 進捗・フォーカス・読み上げ | 「Image 1 of 3: Reading the image.」…「3 images added.」。処理中はキャンセル、終わるとドロップゾーンへ |
| ↑↓(Enter・Space) | 動かし、押したボタンにフォーカスが残る。末尾の ↓ は `aria-disabled` で、押しても何もしない。代替テキストも一緒に動く |
| ドラッグ(つまみ・縮小画像) | 上半分・下半分で前・後ろに入る。線と薄い表示が出る。動かない位置には線を出さない |
| ほかのギャラリーへのドラッグ | どちらの値も変わらない |
| HEIC | 1 枚だけ失敗の表示(ファイル名つき)。残りは追加。閉じるとドロップゾーンへ |
| 上限(`photos` に 5 枚) | 3 枚を追加し、2 枚はファイルごとに「The gallery has more images than allowed.」。ドロップゾーンは押せず、「The gallery is full (3 images).」。フォーカスは最後の画像の見出し。「Dismiss all errors」で閉じられる |
| 削除 | 次の画像の見出しへ。最後なら前の画像。「Removed image 2. 3 images left.」 |
| 差し替え | その位置だけ新しい画像になり、代替テキストは空。「Replaced image 1.」。フォーカスはその画像の代替テキストへ移る |
| 保存と読み込み直し | 並びと代替テキストが残る。プレビューはまとめて 1 回取得 |
| 「画像が見つかりません」 | ゴミ箱の画像と完全削除した画像の行に出る(代替テキストと差し替えは出さず、↑↓ と削除は出す)。完全削除した画像を参照したままの保存は 422(トースト「Failed to save」)。ゴミ箱の画像だけなら保存できる。削除すると保存できた |
| キャンセル | 何も足さず、ドロップゾーンへ |
| `?field=gallery` | ドロップゾーンのボタン(`id="field-gallery"`)にフォーカスが移った |
| 日本語 | 「2 / 10 枚」「あと 8 枚追加できます(最大 10 枚)。」「画像 1 を下へ移動」「代替テキスト(画像 2)」、GIF の注意。widget の英語の文字は出ない |
| 編集ロック(fieldset を disabled にした) | ボタン・入力欄は無効。ファイルのドロップは送らない。つまみのドラッグは始まらない(`dragstart` の `types` は空) |
| フィールドの間隔 | Gallery の下端 → Photos は 24px(画像なし・1 枚のどちらも)。はじめは空の領域 3 つに `gap-3` が付いて 60px だった |
| コンソール | エラーは、拒否された保存の 422 の 1 件だけ(Chromium) |

## 7. 環境と手順

- macOS 26.4(25E246)、Node 26.10.0、EmDash 0.39.1、`@emdash-cms/admin` 0.39.1、React 19.2.4、Kumo 2.6.0、Astro 7.3.3、Playwright 1.63.0(`playwright-core`)、Chromium 153.0.8010.12・Firefox 155.0(どちらもヘッドレス)。jsdom 30.1.0・vitest 4.1.11。
- `playground/` を `spikes/t28-gallery/site/`(git 管理外)に写し、`package.json` から `file:..` の依存を外して、リポジトリの `node_modules` の Astro で動かした(`node ../../../node_modules/astro/bin/astro.mjs dev --port 4428`。エージェントの中では自動でバックグラウンドになる。止めるのは `… astro.mjs dev stop`。[[astro-dev-background-for-agents]])。
- プラグインは記述子で登録し、ルートと hook を登録する仮の定義(T29 の代わり)と、管理画面の入口(T30 の代わり)を spike の中に置いた。seed の `posts` に `photos` を足した。

```js
// astro.config.mjs(抜粋)
plugins: [{ id: "base64-image", version: "0.0.0", entrypoint: "/plugins/base64-image-spike.ts", options: {}, adminEntry: "/plugins/gallery-admin.tsx" }],
```

```tsx
// plugins/gallery-admin.tsx
import { GalleryField } from "../../../../src/admin/GalleryField";
export const fields = { gallery: GalleryField };
```

```json
{ "slug": "photos", "label": "Photos", "type": "json", "widget": "base64-image:gallery", "options": { "maxItems": 3 } }
```

- 操作は Playwright のスクリプト(`spikes/t28-gallery/check.mjs`)で行った。`/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin` でログインし、`X-EmDash-Request: 1` を付けた REST で投稿を作り、`/_emdash/admin/content/posts/<ID>?locale=en` を開いた。画像は `e2e/fixtures/make-images.ts` で作ったもの。フォーカスは `focusin`、読み上げの領域は `MutationObserver`、ドラッグは `window` の `dragstart` / `drop` で記録した。
- ゴミ箱は `DELETE /_emdash/api/content/b64_images/<ID>`、完全削除は続けて `DELETE …/<ID>/permanent`。編集ロックは、widget を包む EmDash の `fieldset` に `disabled = true` を付けて代えた(本物のロックは T27 が確かめた)。
- `insertBefore` と `disabled` のフォーカス、`setData` の要否は、`page.setContent` で作った素のページで確かめた(`spikes/t28-gallery/focus-move.mjs`・`dnd-setdata.mjs`)。
