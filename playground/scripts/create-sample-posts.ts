/**
 * playground に、画像つきのサンプルの投稿を作る(T26)。
 *
 * 実行(リポジトリのルートで。開発サーバーを先に起動しておく):
 *   node playground/scripts/create-sample-posts.ts --base http://localhost:4426
 *
 * オプション:
 *   --base <URL>     開発サーバーの URL(既定 http://localhost:4321)
 *   --posts <数>     作る投稿の数(既定 3)
 *   --gallery <数>   1 つの投稿のギャラリーの枚数(既定 3)
 *   --trash-cover    最後の投稿のカバー画像をゴミ箱に移す(サイトで「画像が見つかりません」を確かめるため)
 *   --token <値>     開発用ログインの代わりに、API トークン(`ec_pat_…`。`admin` スコープが要る)で API を呼ぶ。
 *                    環境変数 `EMDASH_TOKEN` でも渡せる(EmDash の CLI と同じ名前)。ビルドしたサイト
 *                    (`wrangler dev`・`astro preview`)では開発用ログインが 403 なので、こちらを使う(T32)
 *
 * 流れ:
 * 1. 開発用ログイン(dev-bypass)で Cookie を得る。開発サーバー(`astro dev`)でだけ使える。
 *    `--token` を渡したときは、ログインせずに `Authorization: Bearer` で送る。
 * 2. 画像(WebP の本体とサムネイル)を、Playwright の Chromium の canvas で作る。
 * 3. アップロードのルート(`POST /_emdash/api/plugins/base64-image/upload`)に 1 枚ずつ送り、参照を受け取る。
 *    画像エントリの作成・公開と `imageRefs` の記録はルートが行う。そのため、この画像を参照する投稿は、
 *    管理画面でも保存できる(seed で作った画像は `imageRefs` に記録が無く、保存 hook に拒否される。T16)。
 * 4. 標準の REST API で投稿を作り(`cover` と `gallery` に参照)、公開する。
 *
 * アップロードのルートは、プラグインの定義(`src/index.ts`、T29)が登録する。登録される前は 404 になる。
 * このファイルは Node が型の注釈を取り除いて実行する。型は `npm run typecheck` で検査する(T26-1)。
 */

import { parseArgs } from "node:util";

import { chromium, type Page } from "@playwright/test";

/** アップロードのルート(プラグイン ID `base64-image`、ルート名 `upload`) */
const UPLOAD_PATH = "/_emdash/api/plugins/base64-image/upload";
/** seed の `posts` の `cover` / `gallery` の `maxStoredBytes` */
const MAX_STORED_BYTES = 100_000;
/** サムネイルの data URL の上限と長辺(仕様書 6.4) */
const THUMB_MAX_STORED_BYTES = 8_000;
const THUMB_EDGE = 96;
/** 画質はこの順に試し、予算に収まった最初の値を使う */
const QUALITIES = [0.8, 0.7, 0.6] as const;

export interface SampleImageSpec {
	width: number;
	height: number;
	/** 背景の色相(0〜359) */
	hue: number;
	/** 画像の中央に描く文字 */
	label: string;
}

export interface SampleImage {
	dataUrl: string;
	thumb: string;
	width: number;
	height: number;
	quality: number;
}

/** 参照(仕様書 5.2) */
export interface ImageRef {
	v: 1;
	id: string;
	locale: string;
	width: number;
	height: number;
	alt: string;
}

/** EmDash の API の応答(`{ success, data }` / `{ success: false, error }`) */
interface ApiResponse<T> {
	success: boolean;
	data?: T;
	error?: { code: string; message: string };
}

/**
 * API に送る認証。文字列は開発用ログインの Cookie(`login` の戻り値)、`{ token }` は API トークン
 * (`Authorization: Bearer`。プラグインのルートには `admin` スコープが要る)。
 */
export type ApiAuth = string | { token: string };

/** 認証のヘッダー */
function authHeaders(auth: ApiAuth): Record<string, string> {
	return typeof auth === "string" ? { Cookie: auth } : { Authorization: `Bearer ${auth.token}` };
}

/** 開発用ログインで、API に送る Cookie を得る */
export async function login(base: string): Promise<string> {
	const res = await fetch(`${base}/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`, {
		redirect: "manual",
	});
	const cookie = res.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
	if (!cookie) {
		throw new Error(
			`開発用ログインに失敗しました(HTTP ${res.status})。開発サーバー(astro dev)で動かすか、ビルドしたサイトでは --token(または環境変数 EMDASH_TOKEN)で API トークンを渡してください。`,
		);
	}
	return cookie;
}

/**
 * 画像を Chromium の canvas で描き、WebP の data URL(本体とサムネイル)にする。
 * 本体は `MAX_STORED_BYTES`、サムネイルは `THUMB_MAX_STORED_BYTES` 以下になる画質を `QUALITIES` の順に探す。
 */
export async function renderSampleImage(page: Page, spec: SampleImageSpec): Promise<SampleImage> {
	for (const quality of QUALITIES) {
		// oxlint-disable-next-line no-await-in-loop -- 予算に収まらなかったときだけ、次の(低い)画質で作り直す
		const rendered = await page.evaluate(
			async ({ image, webpQuality, thumbEdge }) => {
				const { width, height, hue, label } = image;
				const canvas = new OffscreenCanvas(width, height);
				const ctx = canvas.getContext("2d");
				if (!ctx) throw new Error("canvas の 2d コンテキストを作れません");
				const gradient = ctx.createLinearGradient(0, 0, width, height);
				gradient.addColorStop(0, `hsl(${hue} 70% 60%)`);
				gradient.addColorStop(1, `hsl(${(hue + 60) % 360} 60% 30%)`);
				ctx.fillStyle = gradient;
				ctx.fillRect(0, 0, width, height);
				for (let i = 0; i < 7; i++) {
					ctx.beginPath();
					ctx.fillStyle = `hsl(${(hue + 40 * i) % 360} 80% 70% / 0.45)`;
					const x = ((i * 0.37 + 0.11) % 1) * width;
					const y = ((i * 0.61 + 0.23) % 1) * height;
					ctx.arc(x, y, (0.08 + 0.03 * i) * Math.min(width, height), 0, Math.PI * 2);
					ctx.fill();
				}
				ctx.fillStyle = "#fff";
				ctx.font = `bold ${Math.round(Math.min(width, height) / 9)}px sans-serif`;
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(label, width / 2, height / 2);
				ctx.font = `${Math.round(Math.min(width, height) / 20)}px sans-serif`;
				ctx.fillText(`${width} × ${height}`, width / 2, height / 2 + Math.min(width, height) / 7);

				const scale = thumbEdge / Math.max(width, height);
				const thumbWidth = Math.max(1, Math.round(width * scale));
				const thumbHeight = Math.max(1, Math.round(height * scale));
				const thumbCanvas = new OffscreenCanvas(thumbWidth, thumbHeight);
				const thumbCtx = thumbCanvas.getContext("2d");
				if (!thumbCtx) throw new Error("canvas の 2d コンテキストを作れません");
				thumbCtx.imageSmoothingQuality = "high";
				thumbCtx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);

				const blobs = await Promise.all(
					[canvas, thumbCanvas].map((c) =>
						c.convertToBlob({ type: "image/webp", quality: webpQuality }),
					),
				);
				const [mainUrl, thumbUrl] = await Promise.all(
					blobs.map(async (blob) => {
						if (blob.type !== "image/webp") throw new Error(`WebP を作れません(${blob.type})`);
						return `data:image/webp;base64,${new Uint8Array(await blob.arrayBuffer()).toBase64()}`;
					}),
				);
				return { dataUrl: mainUrl ?? "", thumb: thumbUrl ?? "" };
			},
			{ image: spec, webpQuality: quality, thumbEdge: THUMB_EDGE },
		);
		if (
			rendered.dataUrl.length <= MAX_STORED_BYTES &&
			rendered.thumb.length <= THUMB_MAX_STORED_BYTES
		) {
			return { ...rendered, width: spec.width, height: spec.height, quality };
		}
	}
	throw new Error(`画像「${spec.label}」を予算内の WebP にできませんでした`);
}

/** EmDash の API を JSON で呼ぶ。失敗したら、コードとメッセージを含む例外を投げる */
async function callApi<T>(
	base: string,
	auth: ApiAuth,
	method: "POST" | "DELETE",
	path: string,
	body?: unknown,
): Promise<T> {
	const res = await fetch(`${base}${path}`, {
		method,
		headers: {
			...authHeaders(auth),
			"X-EmDash-Request": "1",
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const text = await res.text();
	let json: ApiResponse<T> | undefined;
	try {
		json = JSON.parse(text) as ApiResponse<T>;
	} catch {
		json = undefined;
	}
	if (!res.ok || json?.success !== true || json.data === undefined) {
		const detail = json?.error ? `${json.error.code}: ${json.error.message}` : text.slice(0, 200);
		const hint =
			res.status === 404 && path === UPLOAD_PATH
				? "(アップロードのルートがありません。プラグインの定義(T29)でルートが登録されているか確かめてください)"
				: "";
		throw new Error(`${method} ${path} が失敗しました(HTTP ${res.status}): ${detail}${hint}`);
	}
	return json.data;
}

/** アップロードのルートで画像エントリを作り、参照を受け取る */
export async function uploadImage(
	base: string,
	auth: ApiAuth,
	image: SampleImage,
	target: { collection: string; field: string },
	filename: string,
): Promise<ImageRef> {
	const data = await callApi<{ ref: ImageRef }>(base, auth, "POST", UPLOAD_PATH, {
		dataUrl: image.dataUrl,
		thumb: image.thumb,
		width: image.width,
		height: image.height,
		quality: image.quality,
		filename,
		target,
	});
	return data.ref;
}

/** 投稿を作って公開し、エントリ ID を返す */
export async function createPublishedPost(
	base: string,
	auth: ApiAuth,
	post: { title: string; slug: string; cover: ImageRef | null; gallery: ImageRef[] },
): Promise<string> {
	const created = await callApi<{ item: { id: string } }>(
		base,
		auth,
		"POST",
		"/_emdash/api/content/posts",
		{
			slug: post.slug,
			data: { title: post.title, cover: post.cover, gallery: post.gallery },
		},
	);
	const id = created.item.id;
	await callApi(base, auth, "POST", `/_emdash/api/content/posts/${encodeURIComponent(id)}/publish`);
	return id;
}

/** 画像エントリをゴミ箱に移す(標準の REST API の削除) */
export async function trashImage(base: string, auth: ApiAuth, imageId: string): Promise<void> {
	await callApi(
		base,
		auth,
		"DELETE",
		`/_emdash/api/content/b64_images/${encodeURIComponent(imageId)}`,
	);
}

/** 投稿 1 件分の作業に使うもの */
interface SampleContext {
	base: string;
	auth: ApiAuth;
	page: Page;
	/** 実行ごとに違う値(同じタイトル・slug の投稿は 409 で作れないため) */
	runId: string;
}

/** 画像を 1 枚作ってアップロードし、代替テキストを付けた参照を返す */
async function createImage(
	context: SampleContext,
	spec: SampleImageSpec,
	field: "cover" | "gallery",
	filename: string,
	alt: string,
): Promise<ImageRef> {
	const image = await renderSampleImage(context.page, spec);
	const ref = await uploadImage(
		context.base,
		context.auth,
		image,
		{ collection: "posts", field },
		filename,
	);
	return { ...ref, alt };
}

/** n 件目の投稿を、カバー 1 枚とギャラリー `galleryCount` 枚で作って公開する */
async function createSamplePost(
	context: SampleContext,
	n: number,
	galleryCount: number,
): Promise<{ id: string; title: string; slug: string; cover: ImageRef }> {
	const title = `サンプル投稿 ${n}(${context.runId})`;
	const slug = `sample-${context.runId}-${n}`;
	const cover = await createImage(
		context,
		{ width: 1280, height: 853, hue: (n * 47) % 360, label: `Post ${n} cover` },
		"cover",
		`${slug}-cover.webp`,
		`${title} のカバー画像`,
	);
	const gallery: ImageRef[] = [];
	for (let k = 1; k <= galleryCount; k++) {
		// 横長と縦長を交互にする(width / height の違う画像を並べる)
		const landscape = k % 2 === 1;
		gallery.push(
			// oxlint-disable-next-line no-await-in-loop -- アップロードは 1 枚ずつ送る(1 リクエスト 1 枚。同時に送って開発サーバーに負荷をかけない)
			await createImage(
				context,
				{
					width: landscape ? 800 : 600,
					height: landscape ? 600 : 800,
					hue: (n * 47 + k * 90) % 360,
					label: `Post ${n} #${k}`,
				},
				"gallery",
				`${slug}-gallery-${k}.webp`,
				// 最後の 1 枚は代替テキストを空にする(装飾画像)
				k === galleryCount ? "" : `${title} のギャラリー ${k} 枚目`,
			),
		);
	}
	const id = await createPublishedPost(context.base, context.auth, {
		title,
		slug,
		cover,
		gallery,
	});
	return { id, title, slug, cover };
}

function readCount(value: string | undefined, name: string, fallback: number): number {
	if (value === undefined) return fallback;
	const count = Number(value);
	if (!Number.isInteger(count) || count < 0) {
		throw new Error(`${name} は 0 以上の整数にしてください`);
	}
	return count;
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			base: { type: "string", default: "http://localhost:4321" },
			posts: { type: "string" },
			gallery: { type: "string" },
			"trash-cover": { type: "boolean", default: false },
			token: { type: "string" },
		},
	});
	const base = values.base.replace(/\/+$/, "");
	const postCount = readCount(values.posts, "--posts", 3);
	const galleryCount = readCount(values.gallery, "--gallery", 3);
	const runId = new Date().toISOString().replace(/[-:T]/g, "").replace(/\..*$/, "");

	// API トークンがあればそれを使い、無ければ開発用ログイン(開発サーバーだけ)で Cookie を得る
	const token = values.token ?? process.env["EMDASH_TOKEN"];
	const auth: ApiAuth = token ? { token } : await login(base);
	const browser = await chromium.launch();
	try {
		const context: SampleContext = { base, auth, page: await browser.newPage(), runId };
		let lastCover: ImageRef | null = null;
		for (let n = 1; n <= postCount; n++) {
			// oxlint-disable-next-line no-await-in-loop -- 投稿は順に作って公開する(一覧の並び順を、作った順の逆にそろえる)
			const post = await createSamplePost(context, n, galleryCount);
			lastCover = post.cover;
			console.log(`作成: ${post.title} → ${base}/posts/${post.slug}/(ID: ${post.id})`);
		}
		if (values["trash-cover"] && lastCover) {
			await trashImage(base, auth, lastCover.id);
			console.log(`ゴミ箱に移した画像: ${lastCover.id}(最後の投稿のカバー)`);
		}
	} finally {
		await browser.close();
	}
	console.log(`一覧: ${base}/posts/`);
}

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
