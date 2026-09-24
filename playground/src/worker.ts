/**
 * playground を Cloudflare Workers で動かすときの Worker の入口(T32。`wrangler.jsonc` の `main`)。
 *
 * EmDash のテンプレート(`templates/starter-cloudflare/src/worker.ts`)と同じ形。Astro の Cloudflare アダプターの
 * ハンドラーに、EmDash の定期処理の `scheduled` を足し、sandboxed プラグイン用の `PluginBridge`(Durable Object)を
 * export する。playground の `wrangler.jsonc` には cron も Worker Loader も無いので、どちらも呼ばれない。
 *
 * `ExportedHandler` は Workers の型(`@cloudflare/workers-types` か `wrangler types` の出力)で、`npm run typecheck`
 * の対象外(`tsconfig.json` の `include` に playground/src は無い)。
 */
import handler, { createScheduledHandler, PluginBridge } from "@emdash-cms/cloudflare/worker";

export { PluginBridge };

export default {
	...handler,
	scheduled: createScheduledHandler(),
} satisfies ExportedHandler;
