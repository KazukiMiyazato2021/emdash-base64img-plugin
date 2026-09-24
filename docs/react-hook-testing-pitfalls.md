---
title: React のフックのテストと lint の注意(StrictMode の effect の二重実行・act の警告・oxlint の memo-dependencies)
aliases:
  - renderHook と StrictMode
  - StrictMode の effect の二重実行をテストで確かめる
  - oxlint memo-dependencies の誤検出
tags:
  - docs
  - test
  - react
  - lint
source_task: "[[T23-upload-hook]]"
created: 2026-09-24
updated: 2026-09-24
---

# React のフックのテストと lint の注意(StrictMode の effect の二重実行・act の警告・oxlint の memo-dependencies)

> [!summary] 要点
> - Testing Library の `renderHook(..., { wrapper })` で `<StrictMode>` を包んでも、**初回のマウントで effect は 2 回動かない**(描画は 2 回になる)。effect の二重実行を確かめるなら、**`reactStrictMode: true`** を渡す(ルートを `<StrictMode>` にする)。根拠: 実測+公式ドキュメント(React 19.2.4 の配布物のソース)
> - 非同期の処理で状態が変わるフックは、`console.error` を見張ると、act の外での状態の変化(React の警告)をテストの失敗にできる。根拠: 実測のみ
> - oxlint 1.83.0 の `react(memo-dependencies)` は、`useCallback` の中に **`catch` の無い `try { } finally { }`** があると(入れ子の関数の中でも)、使っている依存をすべて「余分」と誤って報告する。`catch` のある `try` なら出ない。根拠: 実測のみ
> - わざと不具合を入れるテスト(ミューテーションテスト)で見つからなかった不具合は、テストが思った条件で動いていない印のことがある。上の StrictMode は、この方法で分かった。根拠: 実測のみ
> - 関連: [[T23-upload-hook]]、[[test-lint-setup]]、[[jsdom-browser-api-gaps]]

環境: macOS(Darwin 25.4.0)、Node 26.10.0、React / react-dom 19.2.4、@testing-library/react 16.3.3、vitest 4.1.11(jsdom 30.1.0、`NODE_ENV=test` で React は開発版)、oxlint 1.83.0。

## StrictMode の effect の二重実行

`useEffect` の setup・cleanup と描画を記録するフックを、3 つの方法で描いた。根拠: **実測のみ**(下のコードを `tests/admin/` に置いて実行した)

| 描き方 | 記録 |
|---|---|
| `renderHook(fn, { wrapper: ({ children }) => createElement(StrictMode, null, children) })` | `render, render, setup` |
| `renderHook(fn, { reactStrictMode: true })` | `render, render, setup, cleanup, setup` |
| `render(createElement(StrictMode, null, createElement(Comp)))` | `render, render, setup, cleanup, setup` |

```ts
function track(events: string[]) {
	events.push("render");
	useEffect(() => {
		events.push("setup");
		return () => {
			events.push("cleanup");
		};
	}, []);
}
renderHook(() => track(events), { reactStrictMode: true });
```

- 理由: react-dom の開発版は、commit のあとに fiber の木をたどり、新しく置かれた(placement の印のある)fiber のうち StrictMode の中にあるものだけ、effect をもう一度動かす。新しく置かれた fiber が StrictMode の中になければ、その下へはたどらない。`wrapper` の部品は StrictMode の外で新しく置かれるので、その中の `<StrictMode>` まで届かない。根拠: 公式ドキュメントのみ(`node_modules/react-dom/cjs/react-dom-client.development.js:18653-18717` の `recursivelyTraverseAndDoubleInvokeEffectsInDEV` と `commitDoubleInvokeEffectsInDEV`)
- `reactStrictMode` は `RenderOptions`(`renderHook` の options も同じ)にある。`configure({ reactStrictMode: true })` で全体に掛けることもできる(`node_modules/@testing-library/react/types/index.d.ts:17`・`:163`)。
- 描画が 2 回になることだけを見ると、`wrapper` でも StrictMode が掛かっているように見える。effect の cleanup と setup を確かめたいテスト(中断・購読の解除・取得のやり直し)では、**effect が 2 回動いたこと自体をテストで確かめる**。T23 の `usePreviewImages` のテストは、最初の要求が中断され、2 回目の要求で取得することを `[true, false]`(各要求の `signal.aborted`)で確かめている。

> [!note] EmDash の管理画面は StrictMode を使っていない
> `references/emdash/packages/admin/src` と `packages/core/src` に `StrictMode` は無く、管理画面は Astro の `client:only="react"` で描かれる(`packages/core/src/astro/routes/admin.astro:144`)。T23 のフックは StrictMode でも動くようにし、テストで確かめた。根拠: 公式ドキュメントのみ

## act の外での状態の変化を失敗にする

非同期の処理(デコード・圧縮・通信)で状態が変わるフックのテストでは、状態の変化が act の外で起きると、React が `console.error` で警告する(テストは通ってしまう)。T23 のテストは次のようにした。根拠: **実測のみ**

```ts
let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
	consoleError = vi.spyOn(console, "error");
});
afterEach(() => {
	// 投げる前に描画を片付ける(投げると、tests/setup/dom.ts の cleanup が呼ばれない)
	cleanup();
	const warnings = consoleError.mock.calls.map((args) => args.map(String).join(" "));
	consoleError.mockRestore();
	// afterEach で投げると、そのテストが失敗になる
	if (warnings.length > 0) throw new Error(`console.error was called:\n${warnings.join("\n")}`);
});
```

- `cleanup()` を先に呼ぶのは、Vitest 4.1.11 の `afterEach` は 1 つが投げると残りを呼ばないため。呼ばないと、失敗したテストの描画が次のテストに残り、関係の無いテストまで失敗した。T23 の最初の版はこの呼び出しが無く、[[T23-2-hooks-test-cleanup|T23-2]] で足した([[react-effect-lint-and-vitest-hooks]])。根拠: **実測のみ**
- `afterEach` の中の `expect` は、oxlint 1.83.0 の `vitest(no-standalone-expect)` がエラーにする。そのため `throw` で失敗させる(`console.error` を 1 回呼ぶテストで、失敗になることを確かめた)。
- 途中の状態を見るときは、処理を同期の `act(() => { outcome = result.current.upload(file); })` の中で始め、`await waitFor(() => expect(...))` で待つ。`waitFor` は待つ間を act で包む。
- 最後まで進めるときは、`await act(async () => { await outcome; })` の中で待つ。
- アンマウントのあとに起きる状態の変化は、React が捨てるので警告は出ない。

## oxlint の `react(memo-dependencies)` の誤検出

`useCallback` の中に `catch` の無い `try { } finally { }` があると、使っている依存をすべて余分と報告する(`Found extra memoization dependencies`)。`--deny-warnings` なので `npm run lint` が失敗する。根拠: **実測のみ**(oxlint 1.83.0、このリポジトリの `.oxlintrc.json`)

| `useCallback` の本体 | 報告 |
|---|---|
| `async` で `try { await work(); } finally { … }` | 出る(`[work]` を余分と報告) |
| 同期で `try { work(); } finally { done(); }` | 出る(`[work, done]` を余分と報告) |
| 入れ子の関数の中に `try { await work(); } finally { … }` | 出る(`[work]` を余分と報告) |
| `try { … } catch (error) { … } finally { … }` | 出ない |
| `try` が無い | 出ない |

```ts
// 誤って報告される形(oxlint 1.83.0)
const run = useCallback(() => {
	try {
		work();
	} finally {
		done();
	}
}, [work, done]);
```

- 依存を減らすと、React の実行時の動作が変わる(古い関数を呼ぶ)。lint を黙らせるために依存を外さない。
- T23 は、`src/admin/hooks/use-upload-queue.ts` の `pump` の外側の `try` / `finally` をやめて避けた。1 枚分の処理を reject しない入れ子の関数(`run`。`catch` と `finally` のある `try` を持つ)にし、外側の繰り返しは途中で投げないようにした。

## わざと不具合を入れて確かめる

T23 は、フックのソースを 1 か所ずつ書き換える小さなスクリプト(文字列の置き換え → `vitest run tests/admin/hooks.test.ts` → 元に戻す)で、テストが不具合を見つけるかを確かめた。見つからなかった書き換えは、次のどれかだった。根拠: **実測のみ**([[T23-upload-hook#結果|T23 の結果]])

| 見つからなかった理由 | 対応 |
|---|---|
| 同じことを別の処理もしている(重複) | 重複を消す(例: ルーターの値の変換を真似た処理は、`JSON.parse` だけで同じ結果になった) |
| 差し替えた関数(依存)が正しく動くと、違いが見えない | 約束を守らない偽物(中断を見ない `decodeImage`、中断のあとに途中経過を知らせる `compressImage`)でテストを足す |
| テストが思った条件で動いていない | テストを直す(上の StrictMode) |
