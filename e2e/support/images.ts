/**
 * E2E の入力画像(`node e2e/fixtures/make-images.ts` が `e2e/fixtures/images/` に作る 28 個)の名前と、
 * ブラウザの中で `DataTransfer`(ドロップ)を作る補助。ファイルごとの期待する結果は e2e/fixtures/README.md。
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import type { JSHandle, Page } from "@playwright/test";

import { fixture } from "./env";

/** 受け付ける画像 */
export const ACCEPTED = {
	photo: "photo-2400x1600.jpg",
	photoExif6: "photo-exif-orientation-6.jpg",
	pngAlpha: "png-alpha-640x480.png",
	webp: "webp-640x480.webp",
	avif: "avif-640x480.avif",
	bmp: "bmp-640x480.bmp",
	gif: "gif-animated-320x240.gif",
} as const;

/** ギャラリー用の 12 枚(800 × 600、番号入り) */
export function galleryImage(n: number): string {
	return `gallery-${String(n).padStart(2, "0")}.png`;
}

/** 拒否する画像と、そのときのコード(e2e/fixtures/README.md) */
export const REJECTED = [
	{ file: "heic-640x480.heic", code: "INPUT_HEIC_REJECTED" },
	{ file: "heic-named-as-jpeg.jpg", code: "INPUT_HEIC_REJECTED" },
	{ file: "vector.svg", code: "INPUT_SVG_REJECTED" },
	{ file: "tiff-640x480.tiff", code: "INPUT_FORMAT_REJECTED" },
	{ file: "icon-32x32.ico", code: "INPUT_FORMAT_REJECTED" },
	{ file: "random-bytes.jpg", code: "INPUT_DECODE_FAILED" },
	{ file: "jpeg-broken-after-signature.jpg", code: "INPUT_DECODE_FAILED" },
	{ file: "too-large-file-4000x3334.png", code: "INPUT_FILE_TOO_LARGE" },
	{ file: "too-many-pixels-8000x8001.png", code: "INPUT_TOO_MANY_PIXELS" },
] as const;

/** テストが使う入力画像のすべて(global setup が、無ければ作る) */
export const ALL_FIXTURES: readonly string[] = [
	...Object.values(ACCEPTED),
	...Array.from({ length: 12 }, (_, i) => galleryImage(i + 1)),
	...REJECTED.map((entry) => entry.file),
];

/** 入力画像の MIME タイプ(ドロップ・貼り付けで File を作るときに使う。ブラウザが拡張子から決める値と同じにする) */
const MIME_TYPES: Record<string, string> = {
	".jpg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
	".avif": "image/avif",
	".bmp": "image/bmp",
	".gif": "image/gif",
	".heic": "image/heic",
	".svg": "image/svg+xml",
	".tiff": "image/tiff",
};

function mimeTypeOf(name: string): string {
	const extension = name.slice(name.lastIndexOf("."));
	return MIME_TYPES[extension] ?? "application/octet-stream";
}

/**
 * 入力画像から、ページの中に本物の `DataTransfer`(`items.add(File)`)を作る。
 * 合成の `drop` イベントに渡すと、Chromium・Firefox のどちらでもファイルとして受け取られる
 * (docs/admin-image-input-browser-behavior.md)。
 */
export async function createDataTransfer(
	page: Page,
	names: readonly string[],
): Promise<JSHandle<DataTransfer>> {
	const files = names.map((name) => ({
		name: basename(name),
		type: mimeTypeOf(name),
		base64: readFileSync(fixture(name)).toString("base64"),
	}));
	return page.evaluateHandle((items) => {
		const transfer = new DataTransfer();
		for (const item of items) {
			const binary = atob(item.base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
			transfer.items.add(new File([bytes], item.name, { type: item.type }));
		}
		return transfer;
	}, files);
}
