import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import * as adminEntry from "emdash-plugin-base64-image/admin";

// tests/admin/** が jsdom 環境で動き、tests/setup/dom.ts の設定(jest-dom のマッチャーと描画の後片付け)が読み込まれることを確かめる。
// 2 つ目のテストは 1 つ目の後に動く前提(同じファイル内のテストは順に実行される)。
describe("tests/admin の実行環境", () => {
	it("jsdom で React を描画でき、jest-dom のマッチャーが使える", () => {
		render(<button type="button">保存</button>);

		expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
	});

	it("前のテストで描画した DOM が片付けられている", () => {
		expect(document.body).toBeEmptyDOMElement();
	});

	it("管理画面の入口を読み込める", () => {
		expect(adminEntry.fields).toBeTypeOf("object");
	});
});
