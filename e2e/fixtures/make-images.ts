/**
 * E2E(T31)で入力に使う画像を `e2e/fixtures/images/` に作る(T26)。
 *
 * 実行(リポジトリのルートで): node e2e/fixtures/make-images.ts
 *
 * - PNG・GIF・SVG・乱数のファイルは Node の標準機能(zlib)で作る。
 * - JPEG・AVIF・BMP・TIFF・ICO・HEIC は、Node で作った PNG を macOS の `sips` で変換する(macOS でだけ動く)。
 * - WebP は Playwright の Chromium の canvas で作る(`sips` は WebP を書けない)。
 * - 作ったファイルは git に入れない(`e2e/fixtures/.gitignore`)。40MB を超えるファイルがあり、どれも数秒で作り直せるため。
 * - 中身は毎回同じ(乱数は種を固定)。ただし sips と Chromium が作るファイルのバイト列は、OS やブラウザの版で変わることがある。
 * - ファイルごとの用途と、判定・デコード・圧縮の結果(Chromium と Firefox で確かめたもの)は、同じディレクトリの README.md にある。
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { chromium } from "@playwright/test";

const OUT_DIR = join(import.meta.dirname, "images");
const SIPS = "/usr/bin/sips";

// ---------------------------------------------------------------------------
// 乱数とノイズ(種を固定して、毎回同じ画素にする)
// ---------------------------------------------------------------------------

/** 32 ビットの乱数(mulberry32)。0 以上 1 未満を返す */
function createRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 格子点ごとの乱数(0 以上 1 未満) */
function hash2(x: number, y: number, seed: number): number {
	let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** なめらかな値のノイズ(0〜1)。`scale` は格子の間隔(px) */
function valueNoise(x: number, y: number, scale: number, seed: number): number {
	const fx = x / scale;
	const fy = y / scale;
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const tx = fx - x0;
	const ty = fy - y0;
	const sx = tx * tx * (3 - 2 * tx);
	const sy = ty * ty * (3 - 2 * ty);
	const a = hash2(x0, y0, seed);
	const b = hash2(x0 + 1, y0, seed);
	const c = hash2(x0, y0 + 1, seed);
	const d = hash2(x0 + 1, y0 + 1, seed);
	return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** 大きさの違うノイズを重ねたもの(0〜1) */
function fractalNoise(x: number, y: number, scale: number, octaves: number, seed: number): number {
	let sum = 0;
	let amplitude = 1;
	let total = 0;
	for (let i = 0; i < octaves; i++) {
		sum += amplitude * valueNoise(x, y, scale / 2 ** i, seed + i);
		total += amplitude;
		amplitude /= 2;
	}
	return sum / total;
}

function clampByte(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

/** 色相(0〜360)・彩度・明度(0〜1)から RGB(0〜255) */
function hsl(h: number, s: number, l: number): [number, number, number] {
	const k = (n: number) => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
	return [clampByte(f(0) * 255), clampByte(f(8) * 255), clampByte(f(4) * 255)];
}

// ---------------------------------------------------------------------------
// 数字(5 × 7 のビットマップ)
// ---------------------------------------------------------------------------

const DIGITS = [
	["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
	["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
	["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
	["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
	["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
	["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
	["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
	["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
	["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
	["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
] as const;

/**
 * 数字の列を、画像の中央に `cell` px の升目で描くときに、画素 (x, y) が文字の上にあるかを返す関数。
 * 文字の間は 1 升あける。
 */
function digitsMask(text: string, width: number, height: number, cell: number) {
	const columns = text.length * 6 - 1;
	const left = Math.floor((width - columns * cell) / 2);
	const top = Math.floor((height - 7 * cell) / 2);
	return (x: number, y: number): boolean => {
		const column = Math.floor((x - left) / cell);
		const row = Math.floor((y - top) / cell);
		if (x < left || y < top || column >= columns || row >= 7 || column % 6 === 5) return false;
		const glyph = DIGITS[Number(text[Math.floor(column / 6)])];
		return glyph?.[row]?.[column % 6] === "1";
	};
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_COLOR_TYPES = {
	gray: { type: 0, channels: 1 },
	rgb: { type: 2, channels: 3 },
	rgba: { type: 6, channels: 4 },
} as const;
type PngColor = keyof typeof PNG_COLOR_TYPES;
/** 1 行分の画素を `row` に書く(`row` の長さは 幅 × チャンネル数) */
type FillRow = (y: number, row: Uint8Array) => void;

function pngChunk(type: string, data: Uint8Array): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(typeAndData) >>> 0);
	return Buffer.concat([length, typeAndData, crc]);
}

/** 8 ビットの PNG を作る。行のフィルターはすべて 0(なし)。IDAT は 1MiB ずつに分ける */
function encodePng(
	width: number,
	height: number,
	color: PngColor,
	fillRow: FillRow,
	level = 6,
): Buffer {
	const { type, channels } = PNG_COLOR_TYPES[color];
	const stride = width * channels + 1;
	const raw = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y++) fillRow(y, raw.subarray(y * stride + 1, (y + 1) * stride));
	const compressed = deflateSync(raw, { level });
	const idat: Buffer[] = [];
	for (let offset = 0; offset < compressed.length; offset += 1 << 20) {
		idat.push(pngChunk("IDAT", compressed.subarray(offset, offset + (1 << 20))));
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = type;
	return Buffer.concat([
		PNG_SIGNATURE,
		pngChunk("IHDR", ihdr),
		...idat,
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

/** 写真の代わりの風景(空・雲・太陽・2 層の山・細かい模様の地面)。圧縮の探索が 1 回で終わらない程度の細部を持つ */
function landscapeRow(width: number, height: number): FillRow {
	const ridgeFar = new Float64Array(width);
	const ridgeNear = new Float64Array(width);
	for (let x = 0; x < width; x++) {
		const u = x / width;
		ridgeFar[x] =
			0.4 +
			0.07 * Math.sin(u * 7.1) +
			0.04 * Math.sin(u * 19.3 + 1.2) +
			0.08 * (fractalNoise(x, 0, 240, 5, 11) - 0.5);
		ridgeNear[x] =
			0.56 +
			0.05 * Math.sin(u * 4.3 + 2) +
			0.03 * Math.sin(u * 27.9) +
			0.1 * (fractalNoise(x, 0, 180, 5, 23) - 0.5);
	}
	const sunX = width * 0.72;
	const sunY = height * 0.2;
	const sunRadius = height * 0.07;
	return (y, row) => {
		const v = y / height;
		for (let x = 0; x < width; x++) {
			let r: number;
			let g: number;
			let b: number;
			if (v < (ridgeFar[x] ?? 0)) {
				// 空: 上ほど濃い青。雲はノイズのしきい値で作る。太陽の周りは明るくする
				const cloud = Math.max(0, fractalNoise(x, y * 2.2, 220, 5, 3) - 0.52) * 3.2;
				const glow = Math.max(0, 1 - Math.hypot(x - sunX, y - sunY) / (sunRadius * 5));
				r = 70 + 120 * v + 170 * cloud + 150 * glow * glow;
				g = 120 + 90 * v + 150 * cloud + 130 * glow * glow;
				b = 200 + 40 * v + 60 * cloud + 60 * glow * glow;
				if (Math.hypot(x - sunX, y - sunY) < sunRadius) [r, g, b] = [255, 244, 214];
			} else if (v < (ridgeNear[x] ?? 0)) {
				// 遠くの山: 青みがかった灰色に、岩肌の模様
				const rock = fractalNoise(x, y, 60, 5, 7);
				r = 80 + 60 * rock;
				g = 95 + 60 * rock;
				b = 120 + 55 * rock;
			} else {
				// 手前の地面: 緑と茶色。細かい模様(草)を足す
				const field = fractalNoise(x, y, 140, 4, 13);
				const grass = fractalNoise(x, y * 3, 9, 3, 17) - 0.5;
				const shade = 0.75 + 0.5 * (v - 0.55);
				r = (60 + 90 * field + 70 * grass) * shade;
				g = (110 + 80 * field + 90 * grass) * shade;
				b = (40 + 30 * field + 40 * grass) * shade;
			}
			row[x * 3] = clampByte(r);
			row[x * 3 + 1] = clampByte(g);
			row[x * 3 + 2] = clampByte(b);
		}
	};
}

/** ギャラリー用: 色相ごとの背景に、大きな番号 */
function numberedRow(width: number, height: number, label: string, hue: number): FillRow {
	const ink = digitsMask(label, width, height, Math.floor(height / 12));
	const [br, bg, bb] = hsl(hue, 0.55, 0.55);
	return (y, row) => {
		for (let x = 0; x < width; x++) {
			const edge = x < 12 || y < 12 || x >= width - 12 || y >= height - 12;
			const on = ink(x, y) || edge;
			row[x * 3] = on ? 255 : br;
			row[x * 3 + 1] = on ? 255 : bg;
			row[x * 3 + 2] = on ? 255 : bb;
		}
	};
}

/** 透過: 中心は不透明な赤、外側ほど透明(四隅は完全に透明) */
function radialAlphaRow(width: number, height: number): FillRow {
	return (y, row) => {
		for (let x = 0; x < width; x++) {
			const d = Math.hypot((x - width / 2) / (width / 2), (y - height / 2) / (height / 2));
			row[x * 4] = 220;
			row[x * 4 + 1] = 40;
			row[x * 4 + 2] = 40;
			row[x * 4 + 3] = clampByte(255 * Math.min(1, Math.max(0, 1.3 - 1.3 * d)));
		}
	};
}

// ---------------------------------------------------------------------------
// GIF(LZW で圧縮した、アニメーションの GIF89a)
// ---------------------------------------------------------------------------

/** GIF の LZW で色の番号の列を圧縮し、サブブロック(255 バイトずつ、最後は 0)に分けて返す */
function gifImageData(indices: Uint8Array, minCodeSize: number): Buffer {
	const clearCode = 1 << minCodeSize;
	const endCode = clearCode + 1;
	const bytes: number[] = [];
	let bitBuffer = 0;
	let bitCount = 0;
	let codeSize = minCodeSize + 1;
	const write = (code: number) => {
		bitBuffer |= code << bitCount;
		bitCount += codeSize;
		while (bitCount >= 8) {
			bytes.push(bitBuffer & 0xff);
			bitBuffer >>>= 8;
			bitCount -= 8;
		}
	};
	let table = new Map<number, number>();
	let nextCode = endCode + 1;
	write(clearCode);
	let prefix = indices[0] ?? 0;
	for (let i = 1; i < indices.length; i++) {
		const symbol = indices[i] ?? 0;
		const key = (prefix << 8) | symbol;
		const code = table.get(key);
		if (code !== undefined) {
			prefix = code;
			continue;
		}
		write(prefix);
		if (nextCode === 4096) {
			// 表がいっぱいになったら、クリアコードを出して最初からにする
			write(clearCode);
			table = new Map();
			nextCode = endCode + 1;
			codeSize = minCodeSize + 1;
		} else {
			// 次に割り当てるコードが今のビット数に収まらなくなる時点で、ビット数を増やす(復号側と同じ時点)
			if (nextCode >= 1 << codeSize) codeSize++;
			table.set(key, nextCode++);
		}
		prefix = symbol;
	}
	write(prefix);
	write(endCode);
	if (bitCount > 0) bytes.push(bitBuffer & 0xff);
	const blocks: number[] = [minCodeSize];
	for (let offset = 0; offset < bytes.length; offset += 255) {
		const block = bytes.slice(offset, offset + 255);
		blocks.push(block.length, ...block);
	}
	blocks.push(0);
	return Buffer.from(blocks);
}

/** 16 ビットの値を、リトルエンディアンの 2 バイトにする */
function u16(value: number): number[] {
	return [value & 0xff, value >> 8];
}

/** 3 フレーム(赤 → 緑 → 青、白い番号入り)を 0.5 秒ずつ繰り返す GIF */
function animatedGif(width: number, height: number): Buffer {
	// 色の表: 0 黒・1 赤・2 緑・3 青・4 白(8 色の表。残りは黒)
	const palette = [
		0, 0, 0, 220, 40, 40, 40, 170, 60, 50, 80, 220, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	];
	const parts: number[] = [
		...Buffer.from("GIF89a", "latin1"),
		...u16(width),
		...u16(height),
		0xf2, // 色の表あり・色の深さ 8 ビット・表は 8 色(2^(2+1))
		0,
		0,
		...palette,
		// NETSCAPE2.0: 無限に繰り返す
		0x21,
		0xff,
		0x0b,
		...Buffer.from("NETSCAPE2.0", "latin1"),
		0x03,
		0x01,
		0,
		0,
		0,
	];
	for (let frame = 1; frame <= 3; frame++) {
		const ink = digitsMask(String(frame), width, height, Math.floor(height / 10));
		const indices = new Uint8Array(width * height);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) indices[y * width + x] = ink(x, y) ? 4 : frame;
		}
		// 画像の表示の制御(0.5 秒)と画像の記述子(全面、色の表なし)
		parts.push(0x21, 0xf9, 0x04, 0x00, ...u16(50), 0, 0);
		parts.push(0x2c, ...u16(0), ...u16(0), ...u16(width), ...u16(height), 0);
		parts.push(...gifImageData(indices, 3));
	}
	parts.push(0x3b);
	return Buffer.from(parts);
}

// ---------------------------------------------------------------------------
// そのほかの形式
// ---------------------------------------------------------------------------

/** PNG を sips で別の形式に変換する */
function convertWithSips(
	png: Buffer,
	format: string,
	out: string,
	work: string,
	options: string[] = [],
): void {
	const source = join(work, `source-${format}.png`);
	writeFileSync(source, png);
	execFileSync(SIPS, ["-s", "format", format, ...options, source, "--out", out], { stdio: "pipe" });
}

/** JPEG の SOI の直後に、EXIF の向き(Orientation)だけを持つ APP1 を入れる */
function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
	const tiff = Buffer.alloc(26);
	tiff.write("MM", 0, "latin1");
	tiff.writeUInt16BE(42, 2);
	tiff.writeUInt32BE(8, 4);
	tiff.writeUInt16BE(1, 8); // IFD0 のエントリの数
	tiff.writeUInt16BE(0x0112, 10); // Orientation
	tiff.writeUInt16BE(3, 12); // SHORT
	tiff.writeUInt32BE(1, 14);
	tiff.writeUInt16BE(orientation, 18);
	const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
	const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, payload.length + 2]), payload]);
	return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** PNG を Chromium の canvas で WebP にする */
async function webpFromPng(png: Buffer, quality: number): Promise<Buffer> {
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		const base64 = await page.evaluate(
			async ({ pngBase64, webpQuality }) => {
				const bytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));
				const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
				const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
				canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
				const blob = await canvas.convertToBlob({ type: "image/webp", quality: webpQuality });
				if (blob.type !== "image/webp") throw new Error(`WebP を作れません(${blob.type})`);
				return new Uint8Array(await blob.arrayBuffer()).toBase64();
			},
			{ pngBase64: png.toString("base64"), webpQuality: quality },
		);
		return Buffer.from(base64, "base64");
	} finally {
		await browser.close();
	}
}

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
	<rect width="640" height="480" fill="#3b82f6"/>
	<circle cx="320" cy="240" r="160" fill="#fbbf24"/>
</svg>
`;

// ---------------------------------------------------------------------------
// 作る
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	if (process.platform !== "darwin") {
		throw new Error("macOS の sips を使うので、macOS で実行してください");
	}
	mkdirSync(OUT_DIR, { recursive: true });
	const work = mkdtempSync(join(tmpdir(), "e2e-images-"));
	const out = (name: string) => join(OUT_DIR, name);
	try {
		// 写真の代わり(2400 × 1600)。長辺が maxEdge(1600)を超えるので、縮小と画質の探索が起きる
		const photo = encodePng(2400, 1600, "rgb", landscapeRow(2400, 1600));
		convertWithSips(photo, "jpeg", out("photo-2400x1600.jpg"), work, ["-s", "formatOptions", "90"]);
		// 同じ JPEG に EXIF の向き 6(時計回りに 90 度)を入れたもの。デコードすると 1600 × 2400 になる
		writeFileSync(
			out("photo-exif-orientation-6.jpg"),
			withExifOrientation(readFileSync(out("photo-2400x1600.jpg")), 6),
		);

		// 形式ごとの画像(640 × 480)。受け付ける形式
		const sample = encodePng(640, 480, "rgb", landscapeRow(640, 480));
		writeFileSync(
			out("png-alpha-640x480.png"),
			encodePng(640, 480, "rgba", radialAlphaRow(640, 480)),
		);
		writeFileSync(out("webp-640x480.webp"), await webpFromPng(sample, 0.9));
		convertWithSips(sample, "avif", out("avif-640x480.avif"), work);
		convertWithSips(sample, "bmp", out("bmp-640x480.bmp"), work);
		writeFileSync(out("gif-animated-320x240.gif"), animatedGif(320, 240));

		// ギャラリー用の 12 枚(800 × 600、番号入り)。枚数の上限(既定 10)を超える分も含む
		for (let n = 1; n <= 12; n++) {
			const label = String(n).padStart(2, "0");
			writeFileSync(
				out(`gallery-${label}.png`),
				encodePng(800, 600, "rgb", numberedRow(800, 600, label, n * 30)),
			);
		}

		// 拒否する形式
		convertWithSips(sample, "heic", out("heic-640x480.heic"), work);
		writeFileSync(out("heic-named-as-jpeg.jpg"), readFileSync(out("heic-640x480.heic")));
		writeFileSync(out("vector.svg"), SVG);
		convertWithSips(sample, "tiff", out("tiff-640x480.tiff"), work);
		convertWithSips(
			encodePng(32, 32, "rgb", numberedRow(32, 32, "1", 200)),
			"ico",
			out("icon-32x32.ico"),
			work,
		);

		// 壊れたファイル。途中で切れた JPEG・PNG は Firefox がデコードできてしまうので使わない(T12)
		const random = createRandom(26);
		const noise = (length: number) =>
			Buffer.from(Array.from({ length }, () => Math.floor(random() * 256)));
		// 中身が形式に当たらない → デコードせずに拒否される
		writeFileSync(out("random-bytes.jpg"), noise(2_000));
		// JPEG のシグネチャ(FF D8 FF)の後ろが乱数 → デコードに失敗する
		writeFileSync(
			out("jpeg-broken-after-signature.jpg"),
			Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), noise(2_000)]),
		);

		// 上限を超えるもの
		// ファイルが 40,000,000 バイトを超える(約 1,334 万画素。黒一色を無圧縮の deflate で入れる)
		writeFileSync(
			out("too-large-file-4000x3334.png"),
			encodePng(4000, 3334, "rgb", () => {}, 0),
		);
		// 画素数が 6,400 万を超える(8000 × 8001。一色なのでファイルは小さい)
		writeFileSync(
			out("too-many-pixels-8000x8001.png"),
			encodePng(8000, 8001, "gray", (_y, row) => row.fill(0x80), 9),
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
	for (const name of FILES) console.log(`${name}: ${statSync(out(name)).size} bytes`);
}

/** 作るファイル(README.md の表と同じ順) */
const FILES = [
	"photo-2400x1600.jpg",
	"photo-exif-orientation-6.jpg",
	"png-alpha-640x480.png",
	"webp-640x480.webp",
	"avif-640x480.avif",
	"bmp-640x480.bmp",
	"gif-animated-320x240.gif",
	...Array.from({ length: 12 }, (_, i) => `gallery-${String(i + 1).padStart(2, "0")}.png`),
	"heic-640x480.heic",
	"heic-named-as-jpeg.jpg",
	"vector.svg",
	"tiff-640x480.tiff",
	"icon-32x32.ico",
	"random-bytes.jpg",
	"jpeg-broken-after-signature.jpg",
	"too-large-file-4000x3334.png",
	"too-many-pixels-8000x8001.png",
] as const;

await main();
