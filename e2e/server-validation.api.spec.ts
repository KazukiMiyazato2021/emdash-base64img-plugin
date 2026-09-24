/**
 * サーバー側の検証と記録を、ブラウザを使わずに API で確かめる(project `api`。仕様書 7〜9 章)。
 *
 * - ① アップロードのルート: 不正な data URL・寸法の食い違い・上限・保存先・CSRF・body の上限・スキーマ
 * - ② `b64_images` の保存 hook: 標準 API での作成・更新
 * - ③ 参照を持つコレクションの保存 hook: 無い画像・重複・枚数・代替テキストの長さ・参照の形
 * - 参照元の記録: 複製は記録せず、公開(afterPublish)で記録する。記録は応答のあとに書かれるので、読み直して待つ
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expectApiError, readData, readSampleImage, type ImageRef } from "./support/api";
import { BASE_URL, CSRF_HEADERS, PLUGIN_API, ROOT } from "./support/env";
import { expect, test } from "./support/test";

/** 正しいアップロードの body(`override` で一部を変える) */
function uploadBody(override: Record<string, unknown> = {}): Record<string, unknown> {
	const image = readSampleImage();
	return {
		dataUrl: image.dataUrl,
		thumb: image.thumb,
		width: image.width,
		height: image.height,
		quality: image.quality,
		filename: "e2e-api.webp",
		target: { collection: "posts", field: "cover" },
		...override,
	};
}

test.describe("① アップロードのルート", () => {
	test("正しい入力は 200 で、参照(alt は空)を返す", async ({ api }) => {
		const response = await api.request.post(`${PLUGIN_API}/upload`, {
			headers: CSRF_HEADERS,
			data: uploadBody(),
		});
		const data = await readData<{ ref: ImageRef }>(response, "アップロード");
		expect(data.ref).toMatchObject({ v: 1, width: 480, height: 320, alt: "", locale: "en" });
	});

	const invalidCases: {
		name: string;
		body: () => Record<string, unknown>;
		status: number;
		code: string;
	}[] = [
		{
			name: "WebP でない data URL(PNG)",
			body: () =>
				uploadBody({
					dataUrl:
						"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==",
				}),
			status: 400,
			code: "IMAGE_DATA_INVALID",
		},
		{
			name: "base64 として読めない data URL",
			body: () => uploadBody({ dataUrl: "data:image/webp;base64,@@@@not-base64@@@@" }),
			status: 400,
			code: "IMAGE_DATA_INVALID",
		},
		{
			name: "中身が WebP でない data URL",
			body: () =>
				uploadBody({
					dataUrl: `data:image/webp;base64,${Buffer.from("not a webp file at all").toString("base64")}`,
				}),
			status: 400,
			code: "IMAGE_DATA_INVALID",
		},
		{
			name: "アニメーションの WebP",
			body: () =>
				uploadBody({
					dataUrl: `data:image/webp;base64,${readFileSync(join(ROOT, "tests", "fixtures", "webp", "animated.webp")).toString("base64")}`,
					width: 97,
					height: 61,
				}),
			status: 400,
			code: "IMAGE_DATA_INVALID",
		},
		{
			name: "申告した寸法が WebP と違う",
			body: () => uploadBody({ width: 481 }),
			status: 400,
			code: "IMAGE_DIMENSIONS_MISMATCH",
		},
		{
			name: "保存サイズがフィールドの上限(100,000)を超える",
			body: () => uploadBody({ dataUrl: `data:image/webp;base64,${"A".repeat(100_000)}` }),
			status: 400,
			code: "IMAGE_TOO_LARGE",
		},
		{
			name: "サムネイルの長辺が 96px を超える",
			body: () => uploadBody({ thumb: readSampleImage().dataUrl }),
			status: 400,
			code: "THUMB_DATA_INVALID",
		},
		{
			name: "保存先がこのプラグインのフィールドでない(posts.title)",
			body: () => uploadBody({ target: { collection: "posts", field: "title" } }),
			status: 400,
			code: "INVALID_TARGET",
		},
		{
			name: "保存先のコレクションが無い",
			body: () => uploadBody({ target: { collection: "e2e_missing", field: "cover" } }),
			status: 400,
			code: "INVALID_TARGET",
		},
		{
			name: "スキーマに合わない(サムネイルが無い)",
			body: () => {
				const body = uploadBody();
				delete body["thumb"];
				return body;
			},
			status: 400,
			code: "VALIDATION_ERROR",
		},
		{
			name: "body が上限(600,000 バイト)を超える",
			body: () => uploadBody({ dataUrl: `data:image/webp;base64,${"A".repeat(610_000)}` }),
			status: 413,
			code: "INVALID_PLUGIN_REQUEST",
		},
	];
	for (const entry of invalidCases) {
		test(`${entry.name} → ${entry.status} ${entry.code}`, async ({ api }) => {
			const response = await api.request.post(`${PLUGIN_API}/upload`, {
				headers: CSRF_HEADERS,
				data: entry.body(),
			});
			await expectApiError(response, entry.status, entry.code);
		});
	}

	test("CSRF 対策のヘッダーが無いと 403 CSRF_REJECTED", async ({ api }) => {
		const response = await api.request.post(`${PLUGIN_API}/upload`, { data: uploadBody() });
		await expectApiError(response, 403, "CSRF_REJECTED");
	});

	test("ログインしていないと 401", async ({ playwright }) => {
		// Playwright Test は、`use` の storageState(管理者)を newContext にも当てるので、空の状態を明示する
		const anonymous = await playwright.request.newContext({
			baseURL: BASE_URL,
			storageState: { cookies: [], origins: [] },
		});
		try {
			const response = await anonymous.post(`${PLUGIN_API}/upload`, {
				headers: CSRF_HEADERS,
				data: uploadBody(),
			});
			expect(response.status()).toBe(401);
		} finally {
			await anonymous.dispose();
		}
	});
});

test.describe("② b64_images の保存 hook", () => {
	test("標準 API で不正な画像エントリを作ろうとすると 422 SAVE_REJECTED(日本語と英語の文)", async ({
		api,
		token,
	}) => {
		const response = await api.request.post("/_emdash/api/content/b64_images", {
			headers: CSRF_HEADERS,
			data: {
				slug: `e2e-invalid-entry-${token}`,
				data: {
					image: {
						src: "data:image/png;base64,iVBORw0KGgo=",
						mimeType: "image/webp",
						width: 1,
						height: 1,
					},
				},
			},
		});
		const { message } = await expectApiError(response, 422, "SAVE_REJECTED");
		expect(message).toContain("画像エントリ(b64_images.image)");
		expect(message).toContain("Image entry (b64_images.image)");
	});

	test("標準 API で画像エントリの image を更新しようとすると、値によらず 422", async ({ api }) => {
		const ref = await api.uploadImage({ collection: "posts", field: "cover" });
		const current = await api.getEntry("b64_images", ref.id);
		const response = await api.updateEntry("b64_images", ref.id, { image: current.data["image"] });
		const { message } = await expectApiError(response, 422, "SAVE_REJECTED");
		expect(message).toContain("作成したあとは変更できません。");
		expect(message).toContain("it cannot be changed after it is created.");
	});
});

test.describe("③ 参照を持つコレクションの保存 hook", () => {
	test("無い画像を参照すると 422(どのフィールドの何が問題かを日本語と英語で返す)", async ({
		api,
		token,
	}) => {
		const response = await api.request.post("/_emdash/api/content/posts", {
			headers: CSRF_HEADERS,
			data: {
				slug: `e2e-missing-ref-${token}`,
				data: {
					title: `E2E missing ref ${token}`,
					cover: {
						v: 1,
						id: "01E2EMISSINGIMAGE000000000",
						locale: "en",
						width: 10,
						height: 10,
						alt: "",
					},
				},
			},
		});
		const { message } = await expectApiError(response, 422, "SAVE_REJECTED");
		expect(message).toContain("画像フィールド「Cover」(cover)");
		expect(message).toContain("画像が見つかりません(ID: 01E2EMISSINGIMAGE000000000)");
		expect(message).toContain(
			'Image field "Cover" (cover): image not found (ID: 01E2EMISSINGIMAGE000000000)',
		);
	});

	test("ギャラリーの重複・枚数の上限・代替テキストの長さ・参照の形を拒否する(422)", async ({
		api,
		token,
	}) => {
		const ref = await api.uploadImage({ collection: "posts", field: "gallery" });
		const eleven: ImageRef[] = [];
		for (let i = 0; i < 11; i++) {
			// oxlint-disable-next-line no-await-in-loop -- アップロードは 1 枚ずつ
			eleven.push(await api.uploadImage({ collection: "posts", field: "gallery" }));
		}
		const cases: { name: string; data: Record<string, unknown>; ja: string }[] = [
			{ name: "重複", data: { gallery: [ref, ref] }, ja: "2 枚目: 1 枚目と同じ画像です" },
			{
				name: "枚数",
				data: { gallery: eleven },
				ja: "画像が 11 枚あり、上限の 10 枚を超えています。",
			},
			{
				name: "代替テキスト",
				data: { cover: { ...ref, alt: "あ".repeat(1_001) } },
				ja: "代替テキストが 1,000 文字を超えています(1,001 文字)。",
			},
			{ name: "参照の形", data: { cover: {} }, ja: "画像の参照の形式が正しくありません" },
		];
		for (const [index, entry] of cases.entries()) {
			// oxlint-disable-next-line no-await-in-loop -- 1 件ずつ確かめる
			const response = await api.request.post("/_emdash/api/content/posts", {
				headers: CSRF_HEADERS,
				data: {
					slug: `e2e-reject-${token}-${index}`,
					data: { title: `E2E reject ${entry.name} ${token}`, ...entry.data },
				},
			});
			// oxlint-disable-next-line no-await-in-loop -- 同上
			const { message } = await expectApiError(response, 422, "SAVE_REJECTED");
			expect(message, entry.name).toContain(entry.ja);
		}
	});

	test("ゴミ箱に入った画像を参照する保存は通る(記録は完全削除まで残る)", async ({ api, token }) => {
		const ref = await api.uploadImage({ collection: "posts", field: "cover" });
		await api.trashImage(ref.id);
		const post = await api.createPost({
			title: `E2E trashed ref ${token}`,
			slug: `e2e-trashed-ref-${token}`,
			cover: ref,
		});
		expect(post.id).toMatch(/^[0-9A-Z]{26}$/);
	});
});

test.describe("参照元の記録(afterSave / afterPublish)", () => {
	test("複製は記録しない。複製を公開すると記録される(記録は応答のあとに書かれるので、読み直して待つ)", async ({
		api,
		token,
	}) => {
		const ref = await api.uploadImage({ collection: "posts", field: "cover" });
		const original = await api.createPost({
			title: `E2E original ${token}`,
			slug: `e2e-original-${token}`,
			cover: ref,
		});
		const ownersOf = async () =>
			((await api.findImage(ref.id))?.owners ?? []).map((owner) => owner.entryId).toSorted();
		await expect.poll(ownersOf, { timeout: 20_000 }).toEqual([original.id]);

		const duplicated = await readData<{ item: { id: string } }>(
			await api.request.post(`/_emdash/api/content/posts/${original.id}/duplicate`, {
				headers: CSRF_HEADERS,
			}),
			"複製",
		);
		const copyId = duplicated.item.id;
		// 複製はどの hook も呼ばない(仕様書 9 章)
		await new Promise((resolve) => setTimeout(resolve, 1_000));
		expect(await ownersOf()).toEqual([original.id]);

		await api.publish("posts", copyId);
		await expect.poll(ownersOf, { timeout: 20_000 }).toEqual([original.id, copyId].toSorted());
	});
});
