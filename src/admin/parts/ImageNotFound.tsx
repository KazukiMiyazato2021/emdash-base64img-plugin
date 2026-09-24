/**
 * 「画像が見つかりません」の表示(仕様書 11.2)。
 *
 * - プレビューの取得(`preview` ルート)が `image: null` を返した画像に出す(ゴミ箱に入った・削除された・公開されていない・
 *   値が不正。T17 はゴミ箱と削除を区別しない)。
 * - 削除ボタンで参照を外せる。完全に削除された画像を参照したままでは、投稿の保存が拒否されるため(仕様書 8 章③)。
 * - 文言は画面の文字として出し(アイコンだけにしない)、削除ボタンの説明(`aria-describedby`)にも結び付ける。
 *   キーボードでボタンに移ったときに、理由も読み上げられる。
 */

import { Button } from "@cloudflare/kumo";
import { useId, type Ref } from "react";

import { defineMessages, useMessages } from "../../client/i18n";
import { ImageMissingIcon } from "./icons";
import { PREVIEW_BOXES, type PreviewSize } from "./ImagePreview";

const messages = defineMessages({
	ja: {
		title: "画像が見つかりません",
		detail:
			"ゴミ箱に移されたか、削除された可能性があります。削除された画像を参照したままでは保存できないため、削除ボタンで外してください。",
		remove: "削除",
	},
	en: {
		title: "Image not found",
		detail:
			"It may have been moved to the trash or deleted. The entry cannot be saved while it refers to a deleted image, so remove it with the Remove button.",
		remove: "Remove",
	},
});

// 管理画面の CSS にあるクラスだけを使う(tests/admin/parts.test.tsx で確かめる)。
// 大きい枠は EmDash の画像フィールドの「Image not found」と同じ見た目にした。
const LARGE_BOX_CLASS =
	"flex min-h-20 items-center justify-center gap-2 rounded-lg border bg-kumo-tint text-kumo-subtle";
const SMALL_BOX_CLASS =
	"flex flex-col items-center justify-center gap-1 rounded-lg border bg-kumo-tint px-2 text-center text-kumo-subtle";

export interface ImageNotFoundProps {
	/** 削除ボタンで呼ぶ(フィールドの値から参照を外す) */
	readonly onRemove: () => void;
	/** 表示の大きさ。`large` は単一画像、`small` はギャラリーの 1 枚(96px の枠)。既定は `large` */
	readonly size?: PreviewSize | undefined;
	/** 削除ボタンの名前(ギャラリーの「画像 2 を削除」など)。省略するとボタンの文字(「削除」) */
	readonly removeLabel?: string | undefined;
	readonly removeButtonRef?: Ref<HTMLButtonElement> | undefined;
}

/** 参照先の画像が見つからないときの表示と、削除ボタン */
export function ImageNotFound({
	onRemove,
	size = "large",
	removeLabel,
	removeButtonRef,
}: ImageNotFoundProps) {
	const t = useMessages(messages);
	const titleId = useId();
	const detailId = useId();
	const small = size === "small";
	const box = PREVIEW_BOXES.small;
	return (
		<div className="grid gap-2" data-size={size}>
			<div
				className={small ? SMALL_BOX_CLASS : LARGE_BOX_CLASS}
				style={small ? { width: `${box.width}px`, height: `${box.height}px` } : undefined}
			>
				<ImageMissingIcon size={small ? 20 : 24} />
				<p id={titleId} className={small ? "text-xs leading-4" : "text-sm font-medium"}>
					{t.title}
				</p>
			</div>
			{/* ギャラリーの小さな枠では説明を画面に出さず、読み上げ用にだけ残す */}
			<p id={detailId} className={small ? "sr-only" : "text-xs leading-4 text-kumo-subtle"}>
				{t.detail}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					ref={removeButtonRef}
					variant="secondary-destructive"
					size="sm"
					aria-label={removeLabel}
					aria-describedby={`${titleId} ${detailId}`}
					onClick={onRemove}
				>
					{t.remove}
				</Button>
			</div>
		</div>
	);
}
