// jsdom 環境(tests/admin/**・tests/client/**)の共通設定。
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest の globals を使っていないので、Testing Library の自動クリーンアップは働かない。
// テストごとに描画した DOM を明示的に片付ける。
afterEach(() => {
	cleanup();
});
