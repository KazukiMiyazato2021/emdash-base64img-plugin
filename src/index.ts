/**
 * base64-image プラグイン(サーバー側の入口)。仮実装。
 *
 * EmDash 0.38.0 の native プラグインの形に合わせている(`packages/plugins/color/src/index.ts`)。
 * - `createPlugin()`: EmDash が生成する仮想モジュールが、`entrypoint` から名前付きで import して呼ぶ。
 * - `base64ImagePlugin()`: サイトの `astro.config.mjs` で `plugins: [base64ImagePlugin()]` に渡す descriptor。
 *
 * ルート・hook・ストレージ・capability・widget の登録は T29 で行う。
 */

import type { PluginDescriptor } from "emdash";
import { definePlugin } from "emdash";

const PLUGIN_ID = "base64-image";
const PLUGIN_VERSION = "0.0.0";
const PACKAGE_NAME = "emdash-plugin-base64-image";
const ADMIN_ENTRY = `${PACKAGE_NAME}/admin`;

/**
 * プラグイン本体を作る。EmDash が `createPlugin(descriptor.options)` の形で呼ぶ。
 */
export function createPlugin() {
	return definePlugin({
		id: PLUGIN_ID,
		version: PLUGIN_VERSION,
		admin: {
			entry: ADMIN_ENTRY,
		},
	});
}

export default createPlugin;

/**
 * サイトの設定(`emdash({ plugins: [...] })`)に渡す descriptor を返す。
 */
export function base64ImagePlugin(): PluginDescriptor {
	return {
		id: PLUGIN_ID,
		version: PLUGIN_VERSION,
		entrypoint: PACKAGE_NAME,
		options: {},
		adminEntry: ADMIN_ENTRY,
	};
}
