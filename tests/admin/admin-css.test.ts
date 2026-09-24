import { describe, expect, it } from "vitest";

import {
	ADMIN_CSS,
	collectClassNames,
	escapeClassName,
	findMissingClasses,
	hasClassSelector,
	sourceTokens,
} from "./admin-css";

function element(html: string): HTMLElement {
	const root = document.createElement("div");
	root.innerHTML = html;
	return root;
}

describe("escapeClassName", () => {
	it.each([
		["sr-only", "sr-only"],
		["rounded-[10px]", "rounded-\\[10px\\]"],
		["hover:bg-kumo-tint", "hover\\:bg-kumo-tint"],
		["gap-2.5", "gap-2\\.5"],
		["w-1/2", "w-1\\/2"],
		["2xl:p-4", "\\32 xl\\:p-4"],
	])("%s → %s", (name, escaped) => {
		expect(escapeClassName(name)).toBe(escaped);
	});
});

describe("hasClassSelector(管理画面の CSS)", () => {
	it.each([
		"sr-only",
		"border-kumo-brand",
		"min-h-32",
		"rounded-[10px]",
		"hover:bg-kumo-tint",
		"gap-2.5",
		"max-h-48",
	])("%s はある", (name) => {
		expect(hasClassSelector(ADMIN_CSS, name)).toBe(true);
	});

	it.each(["max-h-24", "bg-red-517", "w-1/2", "disabled:text-kumo-disabled"])(
		"%s は無い",
		(name) => {
			expect(hasClassSelector(ADMIN_CSS, name)).toBe(false);
		},
	);

	it("長いクラスの先頭の一致は数えない(.min-h-3 は .min-h-32 の一部としてだけ現れる)", () => {
		expect(ADMIN_CSS).toContain(".min-h-3");
		expect(hasClassSelector(ADMIN_CSS, "min-h-3")).toBe(false);
	});

	it("セレクタの直後が区切りなら一致とみなす", () => {
		expect(hasClassSelector(".a-b{color:red}", "a-b")).toBe(true);
		expect(hasClassSelector(".a-b:hover{color:red}", "a-b")).toBe(true);
		expect(hasClassSelector(".a-b", "a-b")).toBe(true);
		expect(hasClassSelector(".a-bc{color:red}", "a-b")).toBe(false);
		expect(hasClassSelector(".a-b-c{color:red}", "a-b")).toBe(false);
		expect(hasClassSelector(".a-b\\:c{color:red}", "a-b")).toBe(false);
	});
});

describe("collectClassNames", () => {
	it("要素自身と子孫のクラスを、重複と空を除いて集める", () => {
		const root = element(`<p class="a  b"><span class="b c"></span><i class=""></i></p>`);
		root.className = "root";

		expect(collectClassNames(root).toSorted()).toEqual(["a", "b", "c", "root"]);
	});
});

describe("sourceTokens", () => {
	it("ファイルとディレクトリ(直下のファイル)の語を集める", () => {
		const fromFile = sourceTokens("src/admin/parts/DropZone.tsx");
		const fromDir = sourceTokens("src/admin/parts");

		expect(fromFile.has("border-dashed")).toBe(true);
		expect(fromFile.has("emdash-media-transparency-grid")).toBe(false);
		expect(fromDir.has("border-dashed")).toBe(true);
		expect(fromDir.has("emdash-media-transparency-grid")).toBe(true);
	});

	it("複数のパスをまとめる", () => {
		const tokens = sourceTokens("src/admin/parts/DropZone.tsx", "src/admin/parts/ImagePreview.tsx");

		expect(tokens.has("border-dashed")).toBe(true);
		expect(tokens.has("emdash-media-transparency-grid")).toBe(true);
	});
});

describe("findMissingClasses", () => {
	it("CSS にあるクラスは返さない", () => {
		const root = element(`<div class="sr-only rounded-[10px] hover:bg-kumo-tint"></div>`);

		expect(findMissingClasses(root, new Set(["sr-only"]))).toEqual({ fromSource: [], unknown: [] });
	});

	it("CSS に無く、ソースに書いたクラスは fromSource", () => {
		const root = element(`<div class="sr-only max-h-24"></div>`);

		expect(findMissingClasses(root, new Set(["max-h-24"]))).toEqual({
			fromSource: ["max-h-24"],
			unknown: [],
		});
	});

	it("CSS に無く、ソースにも Kumo の JS にも無いクラスは unknown", () => {
		const root = element(`<div class="bg-red-517"></div>`);

		expect(findMissingClasses(root, new Set())).toEqual({
			fromSource: [],
			unknown: ["bg-red-517"],
		});
	});

	it("CSS に無くても、Kumo が自分で付けるクラス(ソースに無い)は返さない", () => {
		const root = element(`<input class="disabled:text-kumo-disabled" />`);

		expect(findMissingClasses(root, new Set())).toEqual({ fromSource: [], unknown: [] });
		// 同じクラスでも、自分のソースに書いたなら fromSource
		expect(findMissingClasses(root, new Set(["disabled:text-kumo-disabled"]))).toEqual({
			fromSource: ["disabled:text-kumo-disabled"],
			unknown: [],
		});
	});
});
