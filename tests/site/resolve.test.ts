import type { ImageValue } from "emdash";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	expectTypeOf,
	it,
	vi,
	type MockInstance,
} from "vitest";

import { resolveBase64Images } from "../../src/astro";
import type { Base64ImageRef, ResolvedBase64Image } from "../../src/shared/types";
import {
	resolveBase64ImagesWith,
	type LoadCollection,
	type LoadCollectionResult,
	type ResolvedBase64Images,
} from "../../src/site/resolve";

// src/astro.ts が EmDash の getEmDashCollection を使うことを確かめるため、emdash を差し替える。
const emdash = vi.hoisted(() => ({ getEmDashCollection: vi.fn<LoadCollection>() }));
vi.mock("emdash", () => emdash);

// 値の形だけを確かめるので、data URL の中身は本物の WebP でなくてよい(接頭辞は確かめる)。
const WEBP_DATA_URL = "data:image/webp;base64,UklGRhYAAABXRUJQ";
const D1_MAX_BINDINGS = 100;
/** locale を指定した取得で、ID のほかに使うバインド変数の数(T09) */
const BINDINGS_BESIDES_IDS = 7;

function imageId(n: number): string {
	return `01J8Z3K4M5N6P7Q8R9S0${String(n).padStart(6, "0")}`;
}

function range(count: number): number[] {
	return Array.from({ length: count }, (_, i) => i + 1);
}

function ref(id: string, overrides: Partial<Base64ImageRef> = {}): Base64ImageRef {
	return { v: 1, id, locale: "ja", width: 1280, height: 853, alt: "説明文", ...overrides };
}

function imageValue(overrides: Record<string, unknown> = {}) {
	return {
		src: WEBP_DATA_URL,
		mimeType: "image/webp",
		width: 1280,
		height: 853,
		filename: "IMG_0001.jpg",
		meta: { v: 1, bytes: 17, quality: 0.77 },
		...overrides,
	};
}

interface StoredImage {
	id: string;
	locale: string;
	image: unknown;
}

function stored(id: string, locale = "ja", image: unknown = imageValue()): StoredImage {
	return { id, locale, image };
}

/** EmDash が返すエントリの形。既定(en)以外のロケールの `entry.id` には `ja/` のような接頭辞が付く */
function toEntry(image: StoredImage) {
	return {
		id: image.locale === "en" ? image.id : `${image.locale}/${image.id}`,
		data: { id: image.id, locale: image.locale, status: "published", image: image.image },
	};
}

/**
 * `getEmDashCollection("b64_images", { where: { id }, locale })` を、T09 の実測に合わせて真似る。
 * - ロケールと ID の IN 句で絞り込む。返る順番は要求の順ではない(`created_at DESC, id DESC`)。
 * - D1 のバインド変数の上限(100 個)を超えると、例外ではなく `{ entries: [], error }` を返す。
 */
function fakeEmDash(images: readonly StoredImage[]) {
	return vi.fn<LoadCollection>(async (_collection, filter) => {
		if (filter.where.id.length + BINDINGS_BESIDES_IDS > D1_MAX_BINDINGS) {
			return {
				entries: [],
				error: new Error("Failed to load collection: too many SQL variables"),
			};
		}
		const entries = images
			.filter((image) => image.locale === filter.locale && filter.where.id.includes(image.id))
			.toSorted((a, b) => (a.id < b.id ? 1 : -1))
			.map(toEntry);
		return { entries };
	});
}

/** 呼び出しごとの `[ロケール, ID]` */
function calledWith(load: ReturnType<typeof fakeEmDash>): [string, string[]][] {
	return load.mock.calls.map(([, filter]) => [filter.locale, filter.where.id]);
}

let warn: MockInstance<typeof console.warn>;

function warnings(): string[] {
	return warn.mock.calls.map(([message]) => String(message));
}

beforeEach(() => {
	warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	emdash.getEmDashCollection.mockReset();
});

describe("resolveBase64ImagesWith: 取得と値", () => {
	it("参照が指す画像を、エントリ ID と参照の alt を付けた MediaValue 互換の値で返す", async () => {
		const id = imageId(1);
		const load = fakeEmDash([stored(id)]);

		const images = await resolveBase64ImagesWith(load, [ref(id, { alt: "表紙の写真" })]);

		expect(load.mock.calls).toStrictEqual([["b64_images", { where: { id: [id] }, locale: "ja" }]]);
		expect(images.get(ref(id, { alt: "表紙の写真" }))).toStrictEqual({
			...imageValue(),
			id,
			alt: "表紙の写真",
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it("寸法は参照ではなく画像エントリの値を使う(data URL の画像と一致する)", async () => {
		const id = imageId(1);
		const load = fakeEmDash([stored(id, "ja", imageValue({ width: 300, height: 199 }))]);

		const images = await resolveBase64ImagesWith(load, [ref(id, { width: 1280, height: 853 })]);

		expect(images.get(ref(id))).toMatchObject({ width: 300, height: 199 });
	});

	it("参照が空なら取得しない", async () => {
		const load = fakeEmDash([stored(imageId(1))]);

		const images = await resolveBase64ImagesWith(load, []);

		expect(load).not.toHaveBeenCalled();
		expect(images.get(ref(imageId(1)))).toBeUndefined();
		expect(warn).not.toHaveBeenCalled();
	});

	it("参照の形でない値は取得せず、get も undefined を返す", async () => {
		const id = imageId(1);
		const load = fakeEmDash([stored(id)]);
		const notRefs = [
			null,
			undefined,
			{ id: imageId(2) },
			{ ...ref(imageId(3)), locale: undefined },
		];

		const images = await resolveBase64ImagesWith(load, [
			...(notRefs as unknown as Base64ImageRef[]),
			ref(id),
		]);

		expect(calledWith(load)).toStrictEqual([["ja", [id]]]);
		expect(images.get(null as unknown as Base64ImageRef)).toBeUndefined();
		expect(images.get({ ...ref(id), alt: 1 } as unknown as Base64ImageRef)).toBeUndefined();
		expect(images.get(ref(id))).toBeDefined();
	});
});

describe("resolveBase64ImagesWith: 分割(50 件ずつ)", () => {
	it.each([
		[1, [1]],
		[50, [50]],
		[51, [50, 1]],
		[120, [50, 50, 20]],
	])("同じロケールの %i 件を、%j 件ずつに分けて取得し、すべて描画できる", async (count, sizes) => {
		const ids = range(count).map(imageId);
		const load = fakeEmDash(ids.map((id) => stored(id)));

		const images = await resolveBase64ImagesWith(
			load,
			ids.map((id) => ref(id)),
		);

		expect(calledWith(load).map(([, batch]) => batch.length)).toStrictEqual(sizes);
		expect(calledWith(load).flatMap(([, batch]) => batch)).toStrictEqual(ids);
		for (const id of ids) expect(images.get(ref(id))?.id).toBe(id);
		expect(warn).not.toHaveBeenCalled();
	});

	it("1 回の取得を D1 のバインド変数の上限(100 個)に収め、分けずに渡すと失敗する件数でもすべて描画できる", async () => {
		const ids = range(150).map(imageId);
		const load = fakeEmDash(ids.map((id) => stored(id)));
		const unsplit = await load("b64_images", { where: { id: ids }, locale: "ja" });
		expect(unsplit.error).toBeInstanceOf(Error);
		load.mockClear();

		const images = await resolveBase64ImagesWith(
			load,
			ids.map((id) => ref(id)),
		);

		for (const [, batch] of calledWith(load)) {
			expect(batch.length + BINDINGS_BESIDES_IDS).toBeLessThanOrEqual(D1_MAX_BINDINGS);
		}
		for (const id of ids) expect(images.get(ref(id))?.id).toBe(id);
		expect(warn).not.toHaveBeenCalled();
	});
});

describe("resolveBase64ImagesWith: ロケール", () => {
	it("参照の locale ごとにまとめ、どの呼び出しにも locale を渡す", async () => {
		const en = [imageId(1), imageId(2)];
		const ja = [imageId(3)];
		const load = fakeEmDash([...en.map((id) => stored(id, "en")), ...ja.map((id) => stored(id))]);

		const images = await resolveBase64ImagesWith(load, [
			ref(en[0]!, { locale: "en" }),
			ref(ja[0]!),
			ref(en[1]!, { locale: "en" }),
		]);

		expect(load.mock.calls).toStrictEqual([
			["b64_images", { where: { id: en }, locale: "en" }],
			["b64_images", { where: { id: ja }, locale: "ja" }],
		]);
		expect(images.get(ref(en[0]!, { locale: "en" }))?.id).toBe(en[0]);
		expect(images.get(ref(en[1]!, { locale: "en" }))?.id).toBe(en[1]);
		expect(images.get(ref(ja[0]!))?.id).toBe(ja[0]);
		expect(warn).not.toHaveBeenCalled();
	});

	it("既定以外のロケールでも、entry.id(ja/…)ではなく entry.data.id で対応づける", async () => {
		const id = imageId(1);
		const load = fakeEmDash([stored(id, "ja")]);

		const images = await resolveBase64ImagesWith(load, [ref(id)]);

		await expect(load.mock.results[0]?.value).resolves.toMatchObject({
			entries: [{ id: `ja/${id}`, data: { id } }],
		});
		expect(images.get(ref(id))?.id).toBe(id);
	});

	it("同じ ID でも、参照の locale で見つからなければ描画しない(ほかのロケールの結果を使わない)", async () => {
		const id = imageId(1);
		const load = fakeEmDash([stored(id, "en")]);
		const enRef = ref(id, { locale: "en", alt: "cover" });
		const jaRef = ref(id, { locale: "ja", alt: "表紙" });

		const images = await resolveBase64ImagesWith(load, [enRef, jaRef]);

		expect(calledWith(load)).toStrictEqual([
			["en", [id]],
			["ja", [id]],
		]);
		expect(images.get(enRef)?.alt).toBe("cover");
		expect(images.get(jaRef)).toBeUndefined();
		expect(warnings()).toStrictEqual([expect.stringContaining(`not found`)]);
		expect(warnings()[0]).toContain(`locale "ja"`);
		expect(warnings()[0]).toContain(id);
	});
});

describe("resolveBase64ImagesWith: 順番・並べ替え・重複", () => {
	it("返る順番が要求の順と違っても、ID で対応づける", async () => {
		const ids = range(5).map(imageId);
		const load = fakeEmDash(ids.map((id, i) => stored(id, "ja", imageValue({ width: 100 + i }))));

		const images = await resolveBase64ImagesWith(
			load,
			ids.map((id) => ref(id)),
		);

		const returned: LoadCollectionResult | undefined = await load.mock.results[0]?.value;
		expect(returned?.entries.map(({ data }) => (data as { id: string }).id)).toStrictEqual(
			ids.toReversed(),
		);
		expect(ids.map((id) => images.get(ref(id))?.width)).toStrictEqual([100, 101, 102, 103, 104]);
	});

	it("ID を並べ替えてから呼ぶ(参照の順番が違っても、同じ引数で呼ぶ)", async () => {
		const ids = range(60).map(imageId);
		const shuffled = [
			...ids.filter((_, i) => i % 2 === 1).toReversed(),
			...ids.filter((_, i) => i % 2 === 0),
		];
		const first = fakeEmDash(ids.map((id) => stored(id)));
		const second = fakeEmDash(ids.map((id) => stored(id)));

		await resolveBase64ImagesWith(
			first,
			ids.map((id) => ref(id)),
		);
		await resolveBase64ImagesWith(
			second,
			shuffled.map((id) => ref(id)),
		);

		expect(calledWith(first)).toStrictEqual([
			["ja", ids.slice(0, 50)],
			["ja", ids.slice(50)],
		]);
		expect(calledWith(second)).toStrictEqual(calledWith(first));
	});

	it("ロケールも並べ替えてから呼ぶ", async () => {
		const load = fakeEmDash([]);

		await resolveBase64ImagesWith(load, [
			ref(imageId(1), { locale: "zh-Hant" }),
			ref(imageId(2), { locale: "en" }),
			ref(imageId(3), { locale: "ja" }),
		]);

		expect(calledWith(load).map(([locale]) => locale)).toStrictEqual(["en", "ja", "zh-Hant"]);
	});

	it("重複した ID は 1 回だけ取得し、get は参照ごとの alt を付けた別々の値を返す", async () => {
		const ids = range(50).map(imageId);
		const load = fakeEmDash(ids.map((id) => stored(id)));
		const same = ids[0]!;
		const cover = ref(same, { alt: "表紙" });
		const inGallery = ref(same, { alt: "ギャラリーの 1 枚目" });
		const decorative = ref(same, { alt: "" });

		const images = await resolveBase64ImagesWith(load, [
			...ids.map((id) => ref(id)),
			cover,
			inGallery,
			decorative,
		]);

		expect(calledWith(load)).toStrictEqual([["ja", ids]]);
		const [a, b, c] = [images.get(cover), images.get(inGallery), images.get(decorative)];
		expect([a?.alt, b?.alt, c?.alt]).toStrictEqual(["表紙", "ギャラリーの 1 枚目", ""]);
		expect(a).not.toBe(b);
		expect(a?.src).toBe(b?.src);
	});
});

describe("resolveBase64ImagesWith: 描画しない画像と警告ログ", () => {
	it("見つからない ID は undefined を返し、呼び出しごとに 1 回、ロケールと ID を警告ログに出す", async () => {
		const [a, b, c, d] = range(4).map(imageId) as [string, string, string, string];
		const load = fakeEmDash([stored(a), stored(c)]);

		const images = await resolveBase64ImagesWith(load, [ref(d), ref(c), ref(b), ref(a)]);

		expect(images.get(ref(a))?.id).toBe(a);
		expect(images.get(ref(c))?.id).toBe(c);
		expect(images.get(ref(b))).toBeUndefined();
		expect(images.get(ref(d))).toBeUndefined();
		expect(warnings()).toHaveLength(1);
		expect(warnings()[0]).toMatch(/^\[base64-image\] 2 image\(s\) not found in "b64_images"/);
		expect(warnings()[0]).toContain(`locale "ja"`);
		expect(warnings()[0]).toContain(`${b}, ${d}`);
	});

	it("取得が error を返したら、その呼び出しの ID をすべて描画せず、error を付けて警告する(ほかの呼び出しは使う)", async () => {
		const enId = imageId(1);
		const jaIds = [imageId(2), imageId(3)];
		const error = new Error("Failed to load collection: too many SQL variables");
		// ja の呼び出しは error を返す。entries に値があっても使わないことも確かめる
		const load = vi.fn<LoadCollection>(async (_collection, filter) =>
			filter.locale === "ja"
				? { entries: jaIds.map((id) => toEntry(stored(id))), error }
				: { entries: [toEntry(stored(enId, "en"))] },
		);

		const images = await resolveBase64ImagesWith(load, [
			ref(enId, { locale: "en" }),
			...jaIds.map((id) => ref(id)),
		]);

		expect(images.get(ref(enId, { locale: "en" }))?.id).toBe(enId);
		for (const id of jaIds) expect(images.get(ref(id))).toBeUndefined();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(`Failed to load 2 image(s) from "b64_images" (locale "ja")`),
			error,
		);
		expect(warnings()[0]).toContain(jaIds.join(", "));
	});

	it("失敗した呼び出しの ID だけを描画しない(同じロケールのほかの呼び出しの結果は使う)", async () => {
		const ids = range(51).map(imageId);
		const fake = fakeEmDash(ids.map((id) => stored(id)));
		const load = vi.fn<LoadCollection>(async (collection, filter) =>
			filter.where.id.length === 1
				? { entries: [], error: new Error("Failed to load collection: D1_ERROR") }
				: fake(collection, filter),
		);

		const images = await resolveBase64ImagesWith(
			load,
			ids.map((id) => ref(id)),
		);

		expect(ids.filter((id) => images.get(ref(id)) === undefined)).toStrictEqual([ids[50]]);
		expect(warnings()).toStrictEqual([expect.stringContaining(`Failed to load 1 image(s)`)]);
	});

	it("取得が例外を投げても error と同じに扱い、ページの描画を止めない", async () => {
		const enId = imageId(1);
		const jaId = imageId(2);
		const thrown = new Error("astro:content is not available");
		const load = vi.fn<LoadCollection>(async (_collection, filter) => {
			if (filter.locale === "ja") throw thrown;
			return { entries: [toEntry(stored(enId, "en"))] };
		});

		const images = await resolveBase64ImagesWith(load, [ref(enId, { locale: "en" }), ref(jaId)]);

		expect(images.get(ref(enId, { locale: "en" }))?.id).toBe(enId);
		expect(images.get(ref(jaId))).toBeUndefined();
		expect(warn).toHaveBeenCalledWith(expect.stringContaining(jaId), thrown);
	});

	it("画像エントリの値が不正なら描画せず、見つからないときと別の文で警告する", async () => {
		const { meta: _meta, ...withoutMeta } = imageValue();
		const invalidValues: Record<string, unknown> = {
			"width が無い": { ...imageValue(), width: undefined },
			"width が 0": imageValue({ width: 0 }),
			知らないキー: imageValue({ provider: "local" }),
			PNG: imageValue({ mimeType: "image/png" }),
			"src が外部の URL": imageValue({ src: "https://tracker.example/pixel.gif" }),
			"src が同じサイトのパス": imageValue({ src: "/_emdash/api/media/file/x.webp" }),
			"src が PNG の data URL": imageValue({ src: "data:image/png;base64,iVBORw0KGgo=" }),
			"meta が無い": withoutMeta,
			オブジェクトでない: WEBP_DATA_URL,
			null: null,
		};
		const validId = imageId(100);
		const invalidIds = Object.keys(invalidValues).map((_, i) => imageId(i + 1));
		const load = fakeEmDash([
			stored(validId),
			...Object.values(invalidValues).map((value, i) => stored(invalidIds[i]!, "ja", value)),
		]);

		const images = await resolveBase64ImagesWith(load, [
			ref(validId),
			...invalidIds.map((id) => ref(id)),
		]);

		expect(images.get(ref(validId))?.id).toBe(validId);
		expect(invalidIds.filter((id) => images.get(ref(id)) !== undefined)).toStrictEqual([]);
		expect(warnings()).toHaveLength(1);
		expect(warnings()[0]).toContain(
			`${invalidIds.length} image(s) in "b64_images" (locale "ja") have an invalid value`,
		);
		expect(warnings()[0]).toContain(invalidIds.join(", "));
	});

	it("要求していない ID のエントリと、data.id の無いエントリは使わない", async () => {
		const requested = imageId(1);
		const other = imageId(2);
		const load = vi.fn<LoadCollection>(async () => ({
			entries: [
				toEntry(stored(other)),
				{ id: requested, data: { image: imageValue() } },
				{ id: requested, data: null },
			],
		}));

		const images = await resolveBase64ImagesWith(load, [ref(requested)]);

		expect(images.get(ref(requested))).toBeUndefined();
		expect(images.get(ref(other))).toBeUndefined();
		expect(warnings()).toStrictEqual([expect.stringContaining(`not found`)]);
	});
});

describe("resolveBase64Images(src/astro.ts)", () => {
	it("EmDash の getEmDashCollection で b64_images を取得する", async () => {
		const id = imageId(1);
		emdash.getEmDashCollection.mockResolvedValue({ entries: [toEntry(stored(id))] });

		const images = await resolveBase64Images([ref(id, { alt: "表紙" })]);

		expect(emdash.getEmDashCollection).toHaveBeenCalledExactlyOnceWith("b64_images", {
			where: { id: [id] },
			locale: "ja",
		});
		expect(images.get(ref(id, { alt: "表紙" }))).toStrictEqual({
			...imageValue(),
			id,
			alt: "表紙",
		});
	});
});

describe("型(tsc で確かめる)", () => {
	it("get の値は emdash/ui の Image の image(ImageValue)にそのまま渡せる", () => {
		expectTypeOf<ReturnType<ResolvedBase64Images["get"]>>().toEqualTypeOf<
			ResolvedBase64Image | undefined
		>();
		expectTypeOf<ResolvedBase64Image>().toExtend<ImageValue>();
	});
});
