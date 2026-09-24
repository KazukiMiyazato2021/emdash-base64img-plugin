/**
 * プレビューと情報の表示(仕様書 11.2 の「設定済みのとき」)。
 *
 * - `ImagePreview`: `<img src width height>`。`width` / `height` には画像の本来の寸法(参照の値)を入れ、表示の幅は CSS で決める。
 *   高さは `width` / `height` の比で決まるので、画像を読み込む前から枠の大きさが決まり、表示がずれない。
 *   `src` が無い(保存済みの画像のプレビューを取得している)ときは、同じ大きさの枠に読み込み中の表示を出す。
 * - `ImageInfo`: 「1280×853 · 保存サイズ 98.2KB · 画質 0.77」。
 */

import { Loader } from "@cloudflare/kumo";

import { defineMessages, useMessages } from "../../client/i18n";
import { formatKilobytes, formatQuality } from "./format";

/** プレビューの大きさ。`large` は単一画像、`small` はギャラリーの 1 枚 */
export type PreviewSize = "large" | "small";

/**
 * 表示の枠(CSS の px)。`large` の高さは EmDash の画像フィールドのプレビュー(`max-h-48` = 192px)に合わせ、
 * 幅は CSS の `max-width: 100%`(フィールドの幅)に任せる。`small` は一覧のサムネイルと同じ 96px。
 */
export const PREVIEW_BOXES = {
	large: { width: Number.POSITIVE_INFINITY, height: 192 },
	small: { width: 96, height: 96 },
} as const satisfies Record<PreviewSize, { readonly width: number; readonly height: number }>;

/** 枠に収まるよう、比を保って縮めた表示の大きさ(px)。拡大はしない */
export function getPreviewDisplaySize(
	width: number,
	height: number,
	size: PreviewSize,
): { width: number; height: number } {
	const box = PREVIEW_BOXES[size];
	const scale = Math.min(1, box.width / width, box.height / height);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

const messages = defineMessages({
	ja: {
		loading: "プレビューを読み込み中",
		dimensions: (width: number, height: number) => `${width}×${height}`,
		storedSize: (kilobytes: string) => `保存サイズ ${kilobytes}KB`,
		quality: (quality: string) => `画質 ${quality}`,
	},
	en: {
		loading: "Loading preview",
		dimensions: (width, height) => `${width}×${height}`,
		storedSize: (kilobytes) => `Stored size ${kilobytes} KB`,
		quality: (quality) => `Quality ${quality}`,
	},
});

// 管理画面の CSS にあるクラスだけを使う(tests/admin/parts.test.tsx で確かめる)。
// `emdash-media-transparency-grid` は EmDash の管理画面のクラスで、透過した部分を市松模様で見せる。
const IMAGE_CLASS = "block max-w-full rounded-lg border emdash-media-transparency-grid";
const PLACEHOLDER_CLASS =
	"flex max-w-full items-center justify-center rounded-lg border bg-kumo-tint text-kumo-subtle";

export interface ImagePreviewProps {
	/** 画像の data URL。`undefined` なら、読み込み中の枠を同じ大きさで出す */
	readonly src: string | undefined;
	/** 画像の本来の幅(px)。参照の `width` */
	readonly width: number;
	/** 画像の本来の高さ(px)。参照の `height` */
	readonly height: number;
	/** 表示の大きさ。既定は `large` */
	readonly size?: PreviewSize | undefined;
	/**
	 * `img` の `alt`。既定は空(寸法などは `ImageInfo`、画像の説明は代替テキストの欄で伝える。
	 * EmDash の画像フィールドのプレビューも `alt=""`)。
	 */
	readonly alt?: string | undefined;
}

/** 画像のプレビュー */
export function ImagePreview({ src, width, height, size = "large", alt = "" }: ImagePreviewProps) {
	const t = useMessages(messages);
	const display = getPreviewDisplaySize(width, height, size);
	if (src === undefined) {
		return (
			<div
				className={PLACEHOLDER_CLASS}
				data-size={size}
				style={{ width: `${display.width}px`, aspectRatio: `${width} / ${height}` }}
			>
				<Loader size="sm" aria-label={t.loading} />
			</div>
		);
	}
	return (
		<img
			src={src}
			width={width}
			height={height}
			alt={alt}
			decoding="async"
			className={IMAGE_CLASS}
			data-size={size}
			style={{ width: `${display.width}px`, height: "auto" }}
		/>
	);
}

export interface ImageInfoProps {
	/** 画像の幅(px) */
	readonly width: number;
	/** 画像の高さ(px) */
	readonly height: number;
	/** 保存サイズ(data URL の長さ。バイト)。分からなければ省く */
	readonly storedBytes?: number | undefined;
	/** 圧縮したときの画質(0〜1。画像エントリの `meta.quality`)。分からなければ省く */
	readonly quality?: number | undefined;
}

/** 寸法・保存サイズ・画質の 1 行 */
export function ImageInfo({ width, height, storedBytes, quality }: ImageInfoProps) {
	const t = useMessages(messages);
	const items = [t.dimensions(width, height)];
	if (storedBytes !== undefined) items.push(t.storedSize(formatKilobytes(storedBytes)));
	if (quality !== undefined) items.push(t.quality(formatQuality(quality)));
	return <p className="text-xs leading-4 text-kumo-subtle tabular-nums">{items.join(" · ")}</p>;
}
