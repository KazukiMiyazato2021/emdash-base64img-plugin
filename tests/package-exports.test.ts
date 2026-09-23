import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { base64ImagePlugin, createPlugin } from "emdash-plugin-base64-image";
import * as siteEntry from "emdash-plugin-base64-image/astro";

interface PackageJson {
	name: string;
	exports: Record<string, string>;
	files: string[];
}

const packageJsonUrl = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as PackageJson;

describe("package.json の exports", () => {
	it("3 つの入口が、配布に含まれる src/ の実在するファイルを指す", () => {
		expect(Object.keys(pkg.exports).toSorted()).toEqual([".", "./admin", "./astro"]);
		expect(pkg.files).toContain("src");
		for (const target of Object.values(pkg.exports)) {
			expect(target).toMatch(/^\.\/src\//);
			expect(existsSync(new URL(target, packageJsonUrl))).toBe(true);
		}
	});
});

describe("プラグインの descriptor", () => {
	it("entrypoint と adminEntry が、パッケージ名と exports の入口を指す", () => {
		const descriptor = base64ImagePlugin();

		// EmDash は entrypoint から createPlugin を、adminEntry から管理画面の module を import する。
		expect(descriptor.entrypoint).toBe(pkg.name);
		expect(descriptor.adminEntry).toBe(`${pkg.name}/admin`);
		expect(descriptor.format ?? "native").toBe("native");
	});

	it("createPlugin() が descriptor と同じ id・version・管理画面の入口を持つ", () => {
		const descriptor = base64ImagePlugin();
		const plugin = createPlugin();

		expect(plugin.id).toBe("base64-image");
		expect(plugin.id).toBe(descriptor.id);
		expect(plugin.version).toBe(descriptor.version);
		expect(plugin.admin.entry).toBe(descriptor.adminEntry);
	});
});

describe("サイト側の入口", () => {
	it("Node(DOM なし)で読み込める", () => {
		expect(typeof document).toBe("undefined");
		expect(siteEntry).toBeTypeOf("object");
	});
});
