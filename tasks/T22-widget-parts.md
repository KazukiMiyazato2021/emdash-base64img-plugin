---
id: T22
title: "widget 共通の UI 部品を作る"
type: 実装
status: done
wave: 3
depends_on:
  - "[[T14-admin-i18n-api]]"
soft_depends_on: []
blocks:
  - "[[T27-image-widget]]"
  - "[[T28-gallery-widget]]"
files:
  - "src/admin/parts/**"
  - "tests/admin/parts.test.tsx"
spec:
  - "[[base64-image-plugin-spec#11.1 共通方針]]"
  - "[[base64-image-plugin-spec#11. 管理画面 UI]]"
tags:
  - task
  - impl
  - admin
created: 2026-09-23
---

# T22 widget 共通の UI 部品を作る

> [!info] 概要
> - 種別: 実装 / ウェーブ: 3
> - 着手の条件(依存): [[T14-admin-i18n-api|T14]]
> - このタスクを待つもの: [[T27-image-widget|T27]]、[[T28-gallery-widget|T28]]
> - 仕様: [[base64-image-plugin-spec#11.1 共通方針|仕様書 11.1]]、[[base64-image-plugin-spec#11. 管理画面 UI|仕様書 11章]]

## 目的

単一画像とギャラリーの widget が共通で使う UI 部品を作る。

## 作業内容

- [x] ドロップゾーン(ファイル選択・ドロップ・貼り付け、キーボード操作)
- [x] 処理状況の表示(`aria-live`、キャンセルボタン)
- [x] プレビュー(`<img width height>`)と情報表示(寸法・保存サイズ・画質)
- [x] 代替テキストの入力(空欄のときの注意)
- [x] エラー表示と「画像が見つかりません」の表示
- [x] Kumo のコンポーネントを使う

## 完了条件

- [x] コンポーネントのテスト(jsdom + Testing Library)
- [x] 日本語・英語で表示でき、キーボードで操作できる

## 変更してよいファイル

- `src/admin/parts/**`
- `tests/admin/parts.test.tsx`

> [!note] ここに挙げたファイル以外を変更する必要が出てきたら、そのファイルを担当するタスクと調整する(並列作業での衝突を避けるため)。

## 結果

> [!success] 概要(2026-09-24)
> - `src/admin/parts/` に、単一画像([[T27-image-widget|T27]])とギャラリー([[T28-gallery-widget|T28]])が共通で使う部品を作った。部品は表示と操作だけを受け持ち、値とコールバックを props で受け取る。アップロードの処理([[T23-upload-hook|T23]])や API の呼び出しは持たない。
> - 文言は部品ごとのファイルに `defineMessages({ ja, en })` で持つ。エラーは T14 の `useErrorMessage`、注意は `getNoticeMessage`。
> - `tests/admin/parts.test.tsx` に 78 件のテスト(jsdom + Testing Library)。不具合を 62 種類入れて、すべてテストが失敗することを確かめた。
> - 実ブラウザ(Chromium 153・Firefox 155)でも、部品だけのページでキーボード・ドロップ・貼り付け・見た目を確かめた。
> - 利用者向けの型チェック(`tsconfig.consumer-loose.json`・`tsconfig.consumer-strict.json`)は、`.tsx` を含めて通る。
> - 知見ノート: [[emdash-admin-plugin-ui-styling]](管理画面の CSS と Kumo の注意点)、[[admin-image-input-browser-behavior]](選択・ドロップ・貼り付けのブラウザでの挙動)

### 部品と props(T27・T28 向け)

`import { … } from "./parts";`(`src/admin/ImageField.tsx`・`src/admin/GalleryField.tsx` から)。省略できる props は `x?: T | undefined` なので、`undefined` を渡してよい(利用者の厳しい型チェックでも通る)。

#### `ImageDropZone`(`DropZone.tsx`)

画像が無いとき(単一画像)と、画像を足すとき(ギャラリー)の入力欄。破線の枠の全体が 1 つのボタンで、ファイルの選択・ドロップ・貼り付けで画像を受け取る。

| prop | 型 | 内容 |
|---|---|---|
| `onFiles` | `(files: File[]) => void` | 受け取ったファイル(1 つ以上)。**形式は確かめない**(HEIC なども渡る。判定と案内は T12 の `inspectInputFile` / `decodeImage`) |
| `multiple` | `boolean` | ギャラリーは `true`(ファイルの選択でも複数を選べる)。`false`(既定)で複数がドロップ・貼り付けされたら、`onFiles` を呼ばずに「画像は 1 枚ずつ追加してください。」を出す |
| `disabled` | `boolean` | 処理中・上限に達したとき。ボタンを押せず、ドロップと貼り付けを無視する(ドロップの既定の動作だけは止め、ページの移動を防ぐ) |
| `label` | `string` | フィールドの表示名。ボタンの名前が「カバー: ファイルを選択」になる |
| `description` | `ReactNode` | 枠の下の補足(ギャラリーの「あと 3 枚追加できます」)。ボタンの説明(`aria-describedby`)にもなる |
| `id` | `string` | ボタンの `id` |
| `buttonRef` | `Ref<HTMLButtonElement>` | キャンセルや失敗のあとで、フォーカスを戻すため |

- 貼り付けは、ボタンにフォーカスがあるとき(またはイベントの対象が枠の中のとき)だけ受け取る。ファイルの種類があるのに取り出せないときは「クリップボードの画像を読み取れませんでした。…」を出す。
- ボタンは押されたときに自分でフォーカスを取る(ファイルの選択を閉じたあとに ⌘V で貼り付けられる)。

#### `FileSelectButton`(`DropZone.tsx`)

ファイルの選択だけを開く Kumo の Button(単一画像の「差し替え」など)。`accept` はドロップゾーンと同じ `image/*`。

| prop | 型 | 内容 |
|---|---|---|
| `onFiles` | `(files: File[]) => void` | 選んだファイル |
| `children` | `ReactNode` | ボタンの文字(「差し替え」)。文字は呼び出し側の辞書に持つ |
| `multiple` / `disabled` | `boolean` | 既定は `false` |
| `variant` | `"primary" \| "secondary" \| "ghost" \| "outline"` | 既定は `secondary` |
| `size` | `"xs" \| "sm" \| "base" \| "lg"` | 既定は `sm` |
| `icon` | `ReactNode` | 文字の前のアイコン |
| `id` / `aria-label` / `aria-describedby` | `string` | ギャラリーでは `aria-label` で「画像 2 を差し替え」のように区別する |
| `buttonRef` | `Ref<HTMLButtonElement>` | — |

#### `UploadProgress`(`UploadProgress.tsx`)

「2 / 3 枚目 IMG_0002.jpg 圧縮中… 1280px / 画質 0.74 [キャンセル]」の行と、画面に出さない読み上げの領域(`<output aria-live="polite">`)。**処理の有無にかかわらず常に描画する**(読み上げの領域を先に DOM に置くため)。

| prop | 型 | 内容 |
|---|---|---|
| `progress` | `UploadProgressInfo \| null` | `null` なら行を出さない |
| `onCancel` | `() => void` | キャンセルボタン。省略するとボタンを出さない |
| `completed` | `number` | 直前の処理で追加した枚数。`progress` が `null` のときに「画像を追加しました。」「3 枚の画像を追加しました。」と読み上げる |
| `cancelButtonRef` | `Ref<HTMLButtonElement>` | 処理を始めたときにフォーカスを移すため |

`UploadProgressInfo`: `{ stage: UploadStage; compress?: CompressProgress; filename?: string; index?: number; total?: number }`

- `stage`: `"decoding"`(読み込み中…)/ `"compressing"`(圧縮中…)/ `"thumbnail"`(サムネイルを作成中…)/ `"uploading"`(アップロード中…)。`UPLOAD_STAGES` に一覧がある。
- `compress`: T13 の `onProgress` の値(`src/shared/pipeline.ts` の `CompressProgress`)。長辺と画質を出す。
- `index`(1 から)と `total`: 複数を順に処理するとき。`total` が 1 以下なら出さない。
- 読み上げは段階と何枚目かだけで決め、画質を探すたびには変えない。Kumo の `Loader` は読み上げから隠している。

#### `ImagePreview` / `ImageInfo`(`ImagePreview.tsx`)

| 部品 | prop | 型 | 内容 |
|---|---|---|---|
| `ImagePreview` | `src` | `string \| undefined` | data URL。`undefined` なら、同じ縦横比の枠に「プレビューを読み込み中」(Kumo の `Loader`)を出す |
| | `width` / `height` | `number` | 画像の本来の寸法(参照の値)。`<img width height>` に入れる |
| | `size` | `"large" \| "small"` | `large`(既定。高さ 192px に収める)/ `small`(ギャラリー。96px の枠) |
| | `alt` | `string` | 既定は `""`(寸法などは `ImageInfo`、説明は代替テキストの欄で伝える) |
| `ImageInfo` | `width` / `height` | `number` | 「1280×853」 |
| | `storedBytes` | `number` | 保存サイズ(data URL の長さ)。保存済みの画像は `preview` ルートの `image.src.length`、追加したばかりの画像は T13 の `storedBytes`。省くと出さない |
| | `quality` | `number` | 画質(`image.meta.quality`。任意の項目)。省くと出さない |

- 表示の幅は CSS で決め、高さは `width` / `height` の比で決まる。読み込み中の枠と読み込んだ後の画像が同じ大きさになり、ずれない(実測: 1280×853 は 288×191.9)。拡大はしない。
- 枠の大きさを先に知りたいときは `getPreviewDisplaySize(width, height, size)`。

#### `AltTextInput`(`AltTextInput.tsx`)

| prop | 型 | 内容 |
|---|---|---|
| `value` / `onChange` | `string` / `(value: string) => void` | 参照の `alt`。入力のたびに呼ぶ |
| `itemLabel` | `string` | ギャラリーの「画像 2」。ラベルが「代替テキスト(画像 2)」になる |
| `id` / `disabled` / `inputRef` | — | — |

- Kumo の `Input`。空欄(空白だけも)のときは、入力欄の説明に「空欄のときは、装飾画像として扱われます(スクリーンリーダーは読み上げません)。」を出す。`maxLength` は `MAX_ALT_LENGTH`(1,000)。

#### `ErrorMessage`(`ErrorMessage.tsx`)

| prop | 型 | 内容 |
|---|---|---|
| `error` | `unknown` | `Base64ImageError` など。`null` / `undefined`、**中断(`name` が `AbortError`)なら何も出さない** |
| `title` | `string` | 見出し(ギャラリーの「IMG_0001.jpg」) |
| `onDismiss` | `() => void` | 閉じるボタン(名前は「エラーを閉じる」)。省略するとボタンを出さない |

- Kumo の `Banner`(`error`)を、`role="alert"` の領域の中に出す。**常に描画し、`error` だけを変える**。中断の判定は `isAbortError`(`instanceof DOMException` では jsdom で外れるので `name` で見る)。

#### `ImageNotFound`(`ImageNotFound.tsx`)

| prop | 型 | 内容 |
|---|---|---|
| `onRemove` | `() => void` | 削除ボタン(参照を外す) |
| `size` | `"large" \| "small"` | `small` は 96px の枠で、長い説明は読み上げ用にだけ残す |
| `removeLabel` | `string` | ギャラリーの「画像 2 を削除」 |
| `removeButtonRef` | `Ref<HTMLButtonElement>` | — |

- 「画像が見つかりません」と理由(ゴミ箱・削除、削除された画像を参照したままでは保存できない)を文字で出し、削除ボタンの説明(`aria-describedby`)に結び付ける。

#### `UploadNotices`(`UploadNotices.tsx`)

| prop | 型 | 内容 |
|---|---|---|
| `notices` | `readonly NoticeCode[]` | T12 の `decoded.notices`(GIF は最初のフレームだけ)。同じコードは 1 回だけ出す |
| `title` | `string` | 見出し(ファイル名) |

- Kumo の `Banner`(`alert`)を `aria-live="polite"` の領域の中に出す。**常に描画する**。

#### そのほかの export

`getTransferFiles`(`DataTransfer` からファイルを取り出す)、`IMAGE_FILE_ACCEPT`(`"image/*"`)、`isAbortError`、`PREVIEW_BOXES`、`getPreviewDisplaySize`、`formatKilobytes`(「98.2」)、`formatQuality`(「0.77」)、`longEdge`、アイコン(`UploadIcon`・`ImageMissingIcon`・`WarningIcon`。飾りで `aria-hidden`)。

### 使い方の例

単一画像([[T27-image-widget|T27]])。`upload` は T23 のフックの結果を想定した名前、`entry` はプレビューの取得の結果(`preview` ルートの `image`。読み込み中は `undefined`、見つからなければ `null`)。どちらも実際の形に合わせて読み替える。「差し替え」「削除」の文字は T27 の辞書に持つ。

```tsx
import { Button } from "@cloudflare/kumo";
import { useRef } from "react";

import {
	AltTextInput,
	ErrorMessage,
	FileSelectButton,
	ImageDropZone,
	ImageInfo,
	ImageNotFound,
	ImagePreview,
	UploadNotices,
	UploadProgress,
	type UploadProgressInfo,
} from "./parts";

// ---- コンポーネントの中 ----
const zoneRef = useRef<HTMLButtonElement>(null);
const cancelRef = useRef<HTMLButtonElement>(null);
// T23 の状態から作る。処理していなければ null
const progress: UploadProgressInfo | null = upload.busy
	? { stage: upload.stage, compress: upload.compress, filename: upload.filename }
	: null;

return (
	<div className="grid gap-2">
		{value === null ? (
			progress === null ? (
				// 処理を始めたら cancelRef.current?.focus()、キャンセル・失敗のあとは zoneRef.current?.focus()
				<ImageDropZone onFiles={(files) => upload.start(files[0])} label={label} id={id} buttonRef={zoneRef} />
			) : null
		) : entry === null ? (
			<ImageNotFound onRemove={() => onChange(null)} />
		) : (
			<>
				<ImagePreview src={entry?.src} width={value.width} height={value.height} />
				<ImageInfo width={value.width} height={value.height} storedBytes={entry?.src.length} quality={entry?.meta.quality} />
				<AltTextInput value={value.alt} onChange={(alt) => onChange({ ...value, alt })} />
				<div className="flex flex-wrap items-center gap-2">
					<FileSelectButton onFiles={(files) => upload.start(files[0])}>{t.replace}</FileSelectButton>
					<Button variant="secondary-destructive" size="sm" onClick={() => onChange(null)}>
						{t.remove}
					</Button>
				</div>
			</>
		)}
		{/* 次の 3 つは常に描画する(読み上げの領域を先に置く) */}
		<UploadProgress progress={progress} onCancel={upload.cancel} completed={upload.justAdded ? 1 : undefined} cancelButtonRef={cancelRef} />
		<UploadNotices notices={upload.notices} />
		<ErrorMessage error={upload.error} onDismiss={upload.clearError} />
	</div>
);
```

ギャラリー([[T28-gallery-widget|T28]])。上限を超える分の拒否と「あと N 枚」の文字は T28 が持つ。

```tsx
<ImageDropZone
	multiple
	label={label}
	disabled={remaining === 0 || queue.busy}
	description={t.remaining(remaining)}
	onFiles={(files) => queue.add(files.slice(0, remaining))}
/>
<ul>
	{items.map((item, index) => (
		<li key={item.ref.id}>
			{item.missing ? (
				<ImageNotFound size="small" removeLabel={t.removeItem(index + 1)} onRemove={() => remove(index)} />
			) : (
				<>
					<ImagePreview size="small" src={item.src} width={item.ref.width} height={item.ref.height} />
					<AltTextInput itemLabel={t.item(index + 1)} value={item.ref.alt} onChange={(alt) => setAlt(index, alt)} />
				</>
			)}
			{/* ↑↓・削除のボタンは T28 が Kumo の Button で作る */}
		</li>
	))}
</ul>
{/* queue.progress は { stage, compress, filename, index, total }(処理していなければ null)。completed は追加し終えた枚数 */}
<UploadProgress progress={queue.progress} onCancel={queue.cancel} completed={queue.added} />
<ErrorMessage error={queue.error} title={queue.errorFilename} onDismiss={queue.clearError} />
```

### Kumo の部品と、自分で作ったもの

| 使った Kumo の部品 | 使い道 |
|---|---|
| `Button` | ドロップゾーンの大きなボタン(`ghost`。EmDash の `ImageDropTarget` とほぼ同じクラス)、`FileSelectButton`、キャンセル、閉じる、削除(`secondary-destructive`) |
| `Input` | 代替テキスト(`label` と `description` で、ラベルと注意を入力欄に結び付ける) |
| `Banner` | エラー(`error`)、注意(`alert`) |
| `Loader` | 処理中の行(読み上げから隠す)、プレビューの読み込み中(「プレビューを読み込み中」の `role="status"`) |

| 自分で作ったもの | 理由 |
|---|---|
| ドロップゾーンの枠(ドラッグ・ドロップ・貼り付けの受け取り)と、画面に出さないファイルの入力欄 | Kumo にドロップゾーンが無い。見た目は EmDash の `ImageDropTarget` に合わせた |
| 読み上げの領域(`<output aria-live="polite">`) | 段階が変わったときだけ読み上げ、処理していないときも領域を残すため |
| プレビューの `<img>` と読み込み中の枠、情報の 1 行、「画像が見つかりません」の枠 | Kumo に該当する部品が無い。枠は EmDash の画像フィールドの「Image not found」と同じクラスにした(`references/emdash/packages/admin/src/components/ImageFieldRenderer.tsx:523`) |
| アイコン(SVG) | `@phosphor-icons/react` がこのプラグインの peerDependencies に無いため |

### アクセシビリティ

| 求められていること | 行ったこと | 根拠レベル |
|---|---|---|
| ファイル選択をキーボードで | Tab でボタンに移り、Enter / Space で開く | 実測のみ(jsdom・Chromium 153・Firefox 155) |
| 貼り付けをキーボードで | ボタンにフォーカスがある状態で Ctrl+V(⌘V)。案内はボタンの説明(`aria-describedby`)に入れた | 実測のみ(Chromium は受け取れた。Firefox はヘッドレスの制約でファイルを読めず、知らせを出した) |
| ドロップをキーボードで | ドロップはポインターの操作なので、キーボードでは選択と貼り付けで同じことをする(ボタンの説明に書いた) | 設計判断 |
| 進捗を `aria-live` で | `<output aria-live="polite">` を常に置き、段階と何枚目か・追加した枚数を入れる | 実測のみ(Chromium のアクセシビリティツリーで role `status`・live `polite`) |
| エラーを読める形に | `role="alert"` の領域を常に置き、エラーの文を入れる。中断は出さない | 実測のみ(jsdom・Chromium のツリーで live `assertive`) |
| 「画像が見つかりません」を読める形に | 文字で出し、削除ボタンの説明に理由を結び付ける | 実測のみ(Chromium のツリーでボタンの説明を確認) |
| フォーカスが見える | Kumo の Button の `focus-visible` の ring(2px)が出る | 実測のみ(スクリーンショットと計算されたスタイル) |

### 決めたこと

| # | 決定 | 理由 | 根拠レベル |
|---|---|---|---|
| 1 | ドロップゾーンは、破線の枠の全体を 1 つの Kumo の Button にする | EmDash の標準の画像フィールドのドロップ先(`ImageDropTarget`)と同じ形。フォーカスの行き先が 1 つで、貼り付けの判定も単純 | 公式ドキュメントのみ(`references/emdash/packages/admin/src/components/media/ImageDropTarget.tsx:86`、`:117`) |
| 2 | 受け取ったファイルは形式を確かめずに渡す。`accept` は `image/*` | 形式の判定と、HEIC などの読めない形式の案内は T12(`src/client/input.ts` の `inspectInputFile`)が行う。`accept` で形式を絞ると、HEIC を選べず、案内も出せない | 設計判断(`accept` で選べなくなる点は推測のみ) |
| 3 | 単一画像に複数のファイルが来たら、受け付けずに「1 枚ずつ」と出す(最初の 1 枚だけを使うことはしない) | どれが使われたか分からなくなるのを避ける。EmDash の `ImageDropTarget` も拒否する(「Drop one image at a time.」) | 公式ドキュメントのみ(`references/emdash/packages/admin/src/components/media/ImageDropTarget.tsx:47-48`) |
| 4 | 貼り付けは `document` で受け、イベントの対象かフォーカスのある要素が枠の中のときだけ扱う。ページのどこでも受け取る形にはしない | Firefox 155 は body(か選択範囲のある要素)に届ける。画像のフィールドが複数あると、どこに入るか分からない | 実測のみ |
| 5 | `Files` の種類があるのにファイルを取り出せない貼り付けは、「読み取れませんでした」と知らせる | 何も起きないと、利用者は理由が分からない | 実測のみ(Firefox 155 のヘッドレス) |
| 6 | ボタンは押されたときに自分でフォーカスを取る | クリックでフォーカスが移るかはブラウザと OS で違う | 外部ドキュメントのみ(MDN) |
| 7 | ドラッグ中の枠の色は style で付ける | 管理画面の CSS の、層の外の `*` の `border-color` がクラスより強い | 実測+公式ドキュメント |
| 8 | 読み上げは段階の変化だけにし、領域は常に置く | 画質を探すたびに読み上げると追いつかない。領域が後から入ると読み上げない支援技術がある | 推測のみ(支援技術の一般的な挙動) |
| 9 | 中断のエラーは `ErrorMessage` でも出さない(`name` が `AbortError` で判定) | T14 のとおり、キャンセルはエラーではない。jsdom では `DOMException` のクラスが 2 つあり、`instanceof` では外れる | 実測のみ |
| 10 | プレビューの `width` / `height` は本来の寸法、表示の幅は CSS(`large` は高さ 192px、`small` は 96px の枠)。拡大しない | 仕様書 11.2 の `<img width height>`。読み込み前から大きさが決まり、ずれない。192px は EmDash の画像フィールドのプレビュー(`max-h-48`)に合わせた | 表示の大きさは実測のみ。192px は公式ドキュメントのみ(`references/emdash/packages/admin/src/components/ImageFieldRenderer.tsx:534`) |
| 11 | 保存サイズは KB(1,000 バイト)の小数 1 桁、画質は小数 2 桁、圧縮中は長辺の px | 仕様書 11.2 の画面の例(「98.2KB」「0.77」「1280px」)。上限の表記(10 進)と揃える | 設計判断 |
| 12 | 代替テキストは空白だけでも装飾画像の注意を出す。`maxLength` は 1,000(UTF-16 で数えるので、サーバーの上限より厳しいか同じ) | 空白だけの alt は実質的に空。上限を超える値を入力させない | 設計判断(`src/shared/constants.ts` のコメント) |
| 13 | 「画像が見つかりません」は `role="status"` にせず、削除ボタンの説明に理由を結び付ける | 編集画面を開くたびに読み上げると邪魔になる。ボタンに移ったときに理由が伝わる | 設計判断 |
| 14 | アイコンは自前の SVG | `@phosphor-icons/react` はこのプラグインの peerDependencies に無い(Kumo と管理画面の依存にはある) | 公式ドキュメントのみ |
| 15 | 使うクラスは管理画面の CSS にあるものだけにし、テストで確かめる | 管理画面の CSS はビルド済みで、プラグインのファイルを読まない | 実測+公式ドキュメント |
| 16 | 読み上げの領域は `<output>` | oxlint の `jsx-a11y/prefer-tag-over-role` が `role="status"` を拒む。`<output>` の暗黙の role は `status` | 実測のみ |
| 17 | 文言は T14 に合わせ、日本語は「です・ます」、括弧は半角にした | 管理画面の文言を揃える([[T14-admin-i18n-api#結果|T14]] の決定 12) | — |

### テスト

- `tests/admin/parts.test.tsx`: 78 件。各部品の ja / en の文言、言語の切り替え、キーボード(Tab・Enter・Space)、ファイルの選択(`user.upload`)、ドロップ(ドラッグ中の表示・枠の中の出入り・文字列のドラッグ・disabled)、貼り付け(ボタン・body・枠の中の対象・`items` だけ・文字だけ・枠の外・読み取れない)、読み上げの領域(`aria-live`・同じ要素のまま・Loader を隠す)、表示の大きさ、情報の書式、代替テキストの説明、エラー(中断・知らないエラー・閉じる)、「画像が見つかりません」の説明、使うクラスが管理画面の CSS にあること。
- 偽の `DataTransfer` を使った(jsdom に無いため。`fireEvent` の `dataTransfer` / `clipboardData` にそのまま入る)。
- ソースに不具合を 1 つずつ入れて、62 種類すべてでテストが失敗することを確かめた(スクリプトは scratchpad に置いた使い捨て)。例: `accept` を MIME の列挙にする / 入力欄の値を空にしない / 単一画像で複数を拒否しない / 貼り付けをフォーカス・対象で判定しない / 各 `preventDefault` を外す / `dropEffect` を変える / 出入りを数えない / `items` を見ない / ドラッグ中の枠の色を付けない / クリックでフォーカスを取らない / 長辺でなく幅 / 1 枚でも何枚目 / `aria-live` を外す / 読み上げの領域を作り直す / Loader を隠さない / 読み上げに画質を含める / KB を 1,024 で数える / 拡大する / 読み込み中の枠の縦横比を外す / 空白だけを空欄とみなさない / `maxLength` を外す / 中断を `instanceof` で判定する / `role="alert"` を外す / 削除ボタンの説明を外す / 管理画面の CSS に無いクラスを使う / 注意の重複を除かない / 英語の文言を日本語にする。根拠: 実測のみ
- `npm run verify`: build・lint・test が通った(テスト 13 ファイル・1,138 件)。

### 実ブラウザでの確認

部品だけのページ(`spikes/widget-parts/`、git 管理外)を Playwright(Chromium 153・Firefox 155、ヘッドレス)で操作した。詳細は [[admin-image-input-browser-behavior]]。根拠: 実測のみ

- キーボードでファイルの選択を開ける(両方)。ドロップは本物の `DataTransfer` で両方とも受け取れた。
- キーボードの貼り付け: Chromium はボタンに届き、ファイルを受け取れた。Firefox は body に届き(フォーカスはボタン)、ヘッドレスでは画像を読めなかった(textarea でも同じ)。部品は「読み取れませんでした」を出した。
- 見た目: 管理画面の CSS を読み込んで撮った。破線の枠・Kumo のボタン・透過の市松模様・Banner が管理画面と同じ見た目になった。ドラッグ中の枠は、クラスでは色が変わらず、style にして青くなった。

### 利用者向けの型チェック

- `.tsx` を含む `src` が、`tsconfig.json`・`tsconfig.consumer-loose.json`・`tsconfig.consumer-strict.json` のすべてで通った。根拠: 実測のみ
- 厳しい設定(`exactOptionalPropertyTypes`)では、Kumo の `Banner` の `title` に `string | undefined` を渡すと型エラーになる(通常の設定では通る)。値があるときだけ展開する形にした。一時的に戻して、厳しい設定だけが失敗することを確かめた。根拠: 実測のみ
- ES2023 以降の組み込みは使っていない。`FileList` などは `Array.from` で配列にした。

### 仕様書の変更

- 11.1: 管理画面の CSS にあるクラスだけを使うこと(無いものと枠の色は style)、共通の部品の置き場所(`src/admin/parts/`)、画像の追加のキーボード操作(ボタンで選択・貼り付け、ドロップは選択と貼り付けで代える)、貼り付けの届き先がブラウザで違うこととその受け方、進捗は段階が変わったときだけ読み上げることを加えた。
- 11.2: 空の入力欄に複数のファイルをドロップ・貼り付けしたときは受け付けず「1 枚ずつ」と出すことを加えた。
- 11.3 は変えていない(複数の選択・ドロップは `multiple` で受け取れる。枚数の上限と並べ替えは T28)。

### 後続タスク・未解決

1. [[T27-image-widget|T27]] / [[T28-gallery-widget|T28]]: `UploadProgress`・`ErrorMessage`・`UploadNotices` は常に描画する(読み上げの領域を先に置く)。フォーカスは、処理を始めたらキャンセルボタンへ(`cancelButtonRef`)、キャンセル・失敗のあとはドロップゾーンへ(`buttonRef`)移す(ボタンが消えるとフォーカスが失われるため)。
2. T27 / T28: 「差し替え」「削除」「↑」「↓」「あと N 枚追加できます」などの文字は、各自の辞書(`defineMessages`)に持つ。部品は持たない。
3. [[T31-e2e|T31]]: Firefox では合成した `ClipboardEvent` の中身が空になり、ヘッドレスのクリップボードの画像も読めない。貼り付けの E2E は Chromium で行う。
4. 実際の(ヘッドレスでない)Firefox で画像を貼り付けられるかは確かめていない(利用者のクリップボードを書き換えるため)。手で確かめるなら、ボタンにフォーカスして ⌘V。
5. アイコンを Phosphor に揃えたいなら、`@phosphor-icons/react` を peerDependencies に足す必要がある(`package.json` の変更。サブタスクの候補。今は不要)。
6. EmDash の `ImageDropTarget` のドラッグ中の枠の色(`border-kumo-brand`)は、同じ理由で出ていないとみられる(推測のみ。EmDash 側の不具合の候補)。
7. `docs/00-index.md` に [[emdash-admin-plugin-ui-styling]] と [[admin-image-input-browser-behavior]] を登録する(リーダー)。
