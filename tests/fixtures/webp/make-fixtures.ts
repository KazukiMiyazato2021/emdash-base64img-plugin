/**
 * tests/fixtures/webp/ のテスト用 WebP を作り直す。
 *
 * 実行: node tests/fixtures/webp/make-fixtures.ts
 * - 元の画像(PAM)は、このスクリプトが一時ディレクトリに作り、終わったら消す(リポジトリには入れない)。
 * - libwebp のコマンド(cwebp / img2webp / webpmux)の場所は、環境変数 WEBP_BIN_DIR で変えられる。既定は /opt/homebrew/bin。
 * - 作るファイルと、それぞれの中身(チャンクの並び・寸法)は、同じディレクトリの README.md に書いた。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Rgba = readonly [number, number, number, number];
type Pixel = (x: number, y: number) => Rgba;

const OUT_DIR = import.meta.dirname;
const BIN_DIR = process.env.WEBP_BIN_DIR ?? "/opt/homebrew/bin";

/** なめらかなグラデーション(圧縮しやすいので、ファイルが小さくなる)。`invert` で色を反転する */
function gradient(width: number, height: number, invert = false): Pixel {
	return (x, y) => {
		const u = x / (width - 1);
		const v = y / (height - 1);
		const rgb = [255 * u, 255 * v, 255 * (1 - u) * v].map((c) => Math.round(invert ? 255 - c : c));
		return [rgb[0] ?? 0, rgb[1] ?? 0, rgb[2] ?? 0, 255];
	};
}

/** グラデーションに、中央の楕円の外側ほど透明になるアルファを付ける(四隅は完全に透明) */
function vignette(width: number, height: number): Pixel {
	const base = gradient(width, height);
	return (x, y) => {
		const dx = (x - (width - 1) / 2) / (width / 2);
		const dy = (y - (height - 1) / 2) / (height / 2);
		const alpha = Math.round(255 * Math.min(1, Math.max(0, 1.5 - 1.5 * Math.hypot(dx, dy))));
		const [r, g, b] = base(x, y);
		return [r, g, b, alpha];
	};
}

/** PAM(P7)形式で画像を書き出す。cwebp と img2webp は PAM を読める */
function writePam(path: string, width: number, height: number, alpha: boolean, pixel: Pixel) {
	const depth = alpha ? 4 : 3;
	const header = [
		"P7",
		`WIDTH ${width}`,
		`HEIGHT ${height}`,
		`DEPTH ${depth}`,
		"MAXVAL 255",
		`TUPLTYPE ${alpha ? "RGB_ALPHA" : "RGB"}`,
		"ENDHDR",
		"",
	].join("\n");
	const body = new Uint8Array(width * height * depth);
	let i = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [r, g, b, a] = pixel(x, y);
			body[i++] = r;
			body[i++] = g;
			body[i++] = b;
			if (alpha) body[i++] = a;
		}
	}
	writeFileSync(path, Buffer.concat([Buffer.from(header, "ascii"), body]));
}

function run(command: string, args: readonly string[]) {
	execFileSync(join(BIN_DIR, command), args, { stdio: "inherit" });
}

const work = mkdtempSync(join(tmpdir(), "webp-fixtures-"));
const src = (name: string) => join(work, name);
const out = (name: string) => join(OUT_DIR, name);

try {
	// 非可逆(`VP8 ` だけの単純形式)
	writePam(src("lossy.pam"), 300, 199, false, gradient(300, 199));
	run("cwebp", ["-quiet", "-q", "50", src("lossy.pam"), "-o", out("lossy.webp")]);

	// 可逆(`VP8L` だけの単純形式)
	writePam(src("lossless.pam"), 257, 129, false, gradient(257, 129));
	run("cwebp", ["-quiet", "-lossless", src("lossless.pam"), "-o", out("lossless.webp")]);

	// 透過つきの非可逆(`VP8X` + `ALPH` + `VP8 `)
	writePam(src("lossy-alpha.pam"), 261, 173, true, vignette(261, 173));
	run("cwebp", ["-quiet", "-q", "50", src("lossy-alpha.pam"), "-o", out("lossy-alpha.webp")]);

	// 透過つきの可逆(`VP8L` だけの単純形式。透過は VP8L の中に入る)
	writePam(src("lossless-alpha.pam"), 131, 67, true, vignette(131, 67));
	run("cwebp", [
		"-quiet",
		"-lossless",
		src("lossless-alpha.pam"),
		"-o",
		out("lossless-alpha.webp"),
	]);

	// 可逆 + XMP(`VP8X` + `VP8L` + `XMP `)。画像データの後ろにチャンクがある拡張形式。
	// XMP の中身を奇数バイトにして、チャンクの後ろに詰め物の 1 バイトが入るようにする。
	writePam(src("lossless-xmp.pam"), 63, 37, false, gradient(63, 37));
	run("cwebp", ["-quiet", "-lossless", src("lossless-xmp.pam"), "-o", src("lossless-xmp.webp")]);
	let xmp =
		'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
		'<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>fixture</dc:title>' +
		"</rdf:Description></rdf:RDF></x:xmpmeta>";
	if (xmp.length % 2 === 0) xmp += " ";
	writeFileSync(src("meta.xmp"), xmp, "ascii");
	run("webpmux", [
		"-set",
		"xmp",
		src("meta.xmp"),
		src("lossless-xmp.webp"),
		"-o",
		out("lossless-xmp.webp"),
	]);

	// アニメーション(`VP8X` + `ANIM` + `ANMF` × 2)
	writePam(src("frame1.pam"), 97, 61, false, gradient(97, 61));
	writePam(src("frame2.pam"), 97, 61, false, gradient(97, 61, true));
	run("img2webp", [
		"-loop",
		"0",
		"-lossy",
		"-q",
		"50",
		"-d",
		"100",
		src("frame1.pam"),
		src("frame2.pam"),
		"-o",
		out("animated.webp"),
	]);
} finally {
	rmSync(work, { recursive: true, force: true });
}

for (const name of [
	"lossy.webp",
	"lossless.webp",
	"lossy-alpha.webp",
	"lossless-alpha.webp",
	"lossless-xmp.webp",
	"animated.webp",
]) {
	console.log(`${name}: ${statSync(out(name)).size} bytes`);
}
