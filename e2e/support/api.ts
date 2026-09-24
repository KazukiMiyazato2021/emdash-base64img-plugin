/**
 * E2E のデータを API で作る・確かめるための補助。
 *
 * - 画像は、このプラグインのアップロードのルートで作る(seed や標準 API で作った画像は `imageRefs` に記録が無く、
 *   それを参照する投稿は保存 hook に拒否される。T16)。API で上げる画像は、global setup が Chromium の canvas で作った
 *   WebP(`e2e/.cache/sample-image.json`)を毎回使う(同じ中身でも、アップロードのたびに別の画像エントリになる)。
 * - 投稿は標準の REST API(`/_emdash/api/content/<collection>`)で作る。同じ slug は 409 になるので、呼ぶ側で重ならない値にする。
 * - どの要求にも CSRF 対策のヘッダーを付ける(`CSRF_HEADERS`)。
 */

import { readFileSync } from "node:fs";

import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";

import { CSRF_HEADERS, PLUGIN_API, SAMPLE_IMAGE_PATH } from "./env";

/** 参照(仕様書 5.2) */
export interface ImageRef {
	v: 1;
	id: string;
	locale: string;
	width: number;
	height: number;
	alt: string;
}

/** API で上げる画像(global setup が作る) */
export interface SampleImage {
	dataUrl: string;
	thumb: string;
	width: number;
	height: number;
	quality: number;
}

/** アップロードの保存先(仕様書 7 章の `target`) */
export interface UploadTarget {
	collection: string;
	field: string;
	entryId?: string;
	locale?: string;
}

/** 画像管理の一覧の 1 枚(`src/shared/types.ts` の `ImageListItem` のうち、テストで見るもの) */
export interface ImageListItem {
	id: string;
	entryStatus: "active" | "trashed" | "missing";
	entryPublication: "published" | "draft" | "scheduled" | null;
	usage: "in_use" | "owner_deleted" | "detached" | "no_owner";
	owners: { collection: string; entryId: string; locale: string; field: string; status: string }[];
	ownersTotal: number;
}

/** EmDash の API の応答の形 */
interface Envelope<T> {
	success: boolean;
	data?: T;
	error?: { code: string; message: string };
}

let sampleImage: SampleImage | undefined;

/** global setup が作った画像 */
export function readSampleImage(): SampleImage {
	sampleImage ??= JSON.parse(readFileSync(SAMPLE_IMAGE_PATH, "utf8")) as SampleImage;
	return sampleImage;
}

/** 応答の `data` を読む。成功でなければ、状態・コード・メッセージを含めて失敗にする */
export async function readData<T>(response: APIResponse, what: string): Promise<T> {
	const text = await response.text();
	let body: Envelope<T> | undefined;
	try {
		body = JSON.parse(text) as Envelope<T>;
	} catch {
		body = undefined;
	}
	if (!response.ok() || body?.success !== true || body.data === undefined) {
		throw new Error(`${what} が失敗しました(HTTP ${response.status()}): ${text.slice(0, 500)}`);
	}
	return body.data;
}

/** 失敗の応答のコードとメッセージ */
export async function readError(
	response: APIResponse,
): Promise<{ status: number; code: string | undefined; message: string | undefined }> {
	const text = await response.text();
	try {
		const body = JSON.parse(text) as Envelope<unknown>;
		return { status: response.status(), code: body.error?.code, message: body.error?.message };
	} catch {
		return { status: response.status(), code: undefined, message: text.slice(0, 200) };
	}
}

/** 管理者(または global setup が作ったロールの利用者)として API を呼ぶ */
export class AdminApi {
	constructor(readonly request: APIRequestContext) {}

	/** アップロードのルートに画像を送り、参照(`alt` は空)を受け取る */
	async uploadImage(target: UploadTarget, filename = "e2e-sample.webp"): Promise<ImageRef> {
		const image = readSampleImage();
		const response = await this.request.post(`${PLUGIN_API}/upload`, {
			headers: CSRF_HEADERS,
			data: {
				dataUrl: image.dataUrl,
				thumb: image.thumb,
				width: image.width,
				height: image.height,
				quality: image.quality,
				filename,
				target,
			},
		});
		const data = await readData<{ ref: ImageRef }>(response, "画像のアップロード");
		return data.ref;
	}

	/** エントリを作る(下書き)。`data` はフィールドの値 */
	async createEntry(
		collection: string,
		slug: string,
		data: Record<string, unknown>,
	): Promise<{ id: string; slug: string }> {
		const response = await this.request.post(`/_emdash/api/content/${collection}`, {
			headers: CSRF_HEADERS,
			data: { slug, data },
		});
		const created = await readData<{ item: { id: string; slug: string } }>(
			response,
			`${collection} の作成`,
		);
		return { id: created.item.id, slug: created.item.slug };
	}

	/** 投稿を作る。`publish` なら公開もする */
	async createPost(post: {
		title: string;
		slug: string;
		cover?: ImageRef | null;
		gallery?: ImageRef[];
		publish?: boolean;
	}): Promise<{ id: string; slug: string }> {
		const data: Record<string, unknown> = { title: post.title };
		if (post.cover !== undefined) data["cover"] = post.cover;
		if (post.gallery !== undefined) data["gallery"] = post.gallery;
		const created = await this.createEntry("posts", post.slug, data);
		if (post.publish === true) await this.publish("posts", created.id);
		return created;
	}

	/** エントリの値を更新する(保存 hook を通る) */
	async updateEntry(
		collection: string,
		id: string,
		data: Record<string, unknown>,
	): Promise<APIResponse> {
		return this.request.put(`/_emdash/api/content/${collection}/${encodeURIComponent(id)}`, {
			headers: CSRF_HEADERS,
			data: { data },
		});
	}

	/** エントリを公開する */
	async publish(collection: string, id: string): Promise<void> {
		const response = await this.request.post(
			`/_emdash/api/content/${collection}/${encodeURIComponent(id)}/publish`,
			{ headers: CSRF_HEADERS },
		);
		await readData(response, `${collection}/${id} の公開`);
	}

	/** エントリを取得する */
	async getEntry(collection: string, id: string): Promise<{ data: Record<string, unknown> }> {
		const response = await this.request.get(
			`/_emdash/api/content/${collection}/${encodeURIComponent(id)}`,
		);
		const data = await readData<{ item: { data: Record<string, unknown> } }>(
			response,
			`${collection}/${id} の取得`,
		);
		return data.item;
	}

	/** エントリをゴミ箱に移す(標準 API) */
	async trashEntry(collection: string, id: string): Promise<void> {
		const response = await this.request.delete(
			`/_emdash/api/content/${collection}/${encodeURIComponent(id)}`,
			{ headers: CSRF_HEADERS },
		);
		await readData(response, `${collection}/${id} をゴミ箱に移す`);
	}

	/** ゴミ箱から戻す(標準 API。戻した画像は下書きになる) */
	async restoreEntry(collection: string, id: string): Promise<void> {
		const response = await this.request.post(
			`/_emdash/api/content/${collection}/${encodeURIComponent(id)}/restore`,
			{ headers: CSRF_HEADERS },
		);
		await readData(response, `${collection}/${id} を戻す`);
	}

	/** 画像をゴミ箱に移す(このプラグインのルート `images/trash`) */
	async trashImage(id: string): Promise<void> {
		const response = await this.request.post(`${PLUGIN_API}/images/trash`, {
			headers: CSRF_HEADERS,
			data: { id },
		});
		await readData(response, `画像 ${id} をゴミ箱に移す`);
	}

	/** 画像を完全に削除する(ゴミ箱に移してから、標準 API の完全削除。記録は afterDelete の hook が消す) */
	async deleteImagePermanently(id: string): Promise<void> {
		await this.trashImage(id);
		const response = await this.request.delete(
			`/_emdash/api/content/b64_images/${encodeURIComponent(id)}/permanent`,
			{ headers: CSRF_HEADERS },
		);
		await readData(response, `画像 ${id} の完全削除`);
	}

	/** 画像管理の一覧の 1 ページ */
	async listImages(cursor?: string): Promise<{ items: ImageListItem[]; nextCursor?: string }> {
		const response = await this.request.post(`${PLUGIN_API}/images/list`, {
			headers: CSRF_HEADERS,
			data: cursor === undefined ? {} : { cursor },
		});
		return readData(response, "画像の一覧");
	}

	/**
	 * 画像管理の一覧から 1 枚を探す(先頭から最大 `maxPages` ページ)。参照元の記録は保存の応答のあとに書かれるので
	 * (afterSave は応答を待たせない。T20)、記録を確かめるときは `expect.poll` で読み直す。
	 */
	async findImage(id: string, maxPages = 30): Promise<ImageListItem | undefined> {
		let cursor: string | undefined;
		for (let page = 0; page < maxPages; page++) {
			// oxlint-disable-next-line no-await-in-loop -- 次のページのカーソルは、前の応答で決まる
			const result = await this.listImages(cursor);
			const found = result.items.find((item) => item.id === id);
			if (found !== undefined) return found;
			if (result.nextCursor === undefined) return undefined;
			cursor = result.nextCursor;
		}
		return undefined;
	}
}

/** 応答が成功でなかったことと、そのコードを確かめる */
export async function expectApiError(
	response: APIResponse,
	status: number,
	code: string,
): Promise<{ message: string | undefined }> {
	const error = await readError(response);
	expect(error, `応答: ${JSON.stringify(error)}`).toMatchObject({ status, code });
	return { message: error.message };
}
