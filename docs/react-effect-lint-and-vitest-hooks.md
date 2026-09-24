---
title: oxlint の set-state-in-effect を避ける書き方と、Vitest の afterEach で例外を投げたときの片付け
aliases:
  - set-state-in-effect
  - effect から非同期に読む書き方
  - afterEach の例外で cleanup が呼ばれない
tags:
  - docs
  - react
  - oxlint
  - vitest
  - testing
source_task: "[[T25-images-page]]"
created: 2026-09-24
updated: 2026-09-24
---

# oxlint の set-state-in-effect を避ける書き方と、Vitest の afterEach で例外を投げたときの片付け

> [!summary] 要点
> - oxlint 1.83.0 の `react(set-state-in-effect)` は、`useEffect` から呼んだ関数の中の `setState` を、`await` のあとにあってもエラーにした。**状態を変えない読み込みの関数**と、**結果を反映する関数**を分け、effect では `.then` の中で反映するようにすると通った。根拠: 実測のみ
> - Vitest 4.1.11 の `afterEach` は、登録と逆の順に 1 つずつ呼ばれ、**どれかが例外を投げると残りは呼ばれない**。`console.error` を見張って `afterEach` で投げるテスト([[react-hook-testing-pitfalls#act の外での状態の変化を失敗にする|T23 の形]])では、`tests/setup/dom.ts` の `cleanup()` が呼ばれず、描画が次のテストに残って、関係の無いテストまで失敗した。**投げる `afterEach` の中で、先に `cleanup()` を呼ぶ**。根拠: 実測+公式ドキュメント
> - 関連: [[T25-images-page]]、[[react-hook-testing-pitfalls]]、[[test-lint-setup#Testing Library の後片付け]]

> [!info] 環境
> - macOS 26.4(Darwin 25.4.0、arm64)、Node 26.10.0、oxlint 1.83.0(このリポジトリの `.oxlintrc.json`)、vitest 4.1.11(`@vitest/runner` 4.1.11)、`@testing-library/react` 16.3.3、React 19.2.4。2026-09-24 に確かめた。

## effect から一覧を読む書き方(set-state-in-effect)

画像管理ページ(`src/admin/ImagesPage.tsx`)は、最初の表示で一覧を読む。次の順に書き直して、`oxlint --deny-warnings` を通した。根拠: **実測のみ**

| 書き方 | oxlint |
|---|---|
| effect の中で `async` 関数を呼び、`await` のあとで `setList` などを呼ぶ | `react(set-state-in-effect)` のエラー |
| 読み込みの関数(`readImageList(cursor, signal)`。状態を変えず、結果を返すだけ)と、反映の関数(`applyList` / `failList`)に分け、`readImageList(…).then(反映)` にする | 通った。ただし `.then` の成功側で値を返さないと `promise(always-return)` の警告 |
| `.then((read) => ({ ok: true, read }), (error) => ({ ok: false, error }))` で結果を値にしてから、`.then(settle)` で反映する | 通った |

```tsx
const startList = useCallback(
	(mode: LoadMode, cursor: string | undefined, controller: AbortController) => {
		const settle = (
			outcome: { readonly ok: true; readonly read: ImagesListRead } | { readonly ok: false; readonly error: unknown },
		) => {
			if (controller.signal.aborted) return; // 中断した読み込みの結果は捨てる
			if (outcome.ok === false) failList(mode, outcome.error);
			else applyList(mode, outcome.read);
		};
		void readImageList(cursor, controller.signal)
			.then(
				(read) => ({ ok: true, read }) as const,
				(error: unknown) => ({ ok: false, error }) as const,
			)
			.then(settle);
	},
	[applyList, failList],
);

useEffect(() => {
	const controller = new AbortController();
	controllerRef.current = controller;
	startList("reset", undefined, controller); // 状態の初期値を「読み込み中」にしておき、effect の中では setState しない
	return () => controllerRef.current?.abort();
}, [startList]);
```

- 読み込み中の表示は、状態の初期値(`useState<LoadMode | null>("reset")`)で出す。effect の中で `setLoading(true)` を呼ばない。
- 前の応答で次のカーソルが決まるループの `await` は、`eslint(no-await-in-loop)` の警告になる。理由を書いて `// oxlint-disable-next-line no-await-in-loop -- 次の要求のカーソルは、前の応答で決まる` とした。
- 結果を捨てる判定(`controller.signal.aborted`)は、StrictMode の effect の二重実行で必要になる。1 回目の要求は cleanup で中断され、その失敗を反映すると、2 回目の要求が終わる前に「読み込み中」の表示が消える。`render(<StrictMode>…</StrictMode>)` のテストで確かめた(判定を消すと失敗する)。根拠: 実測のみ([[react-hook-testing-pitfalls#StrictMode の effect の二重実行]])

## afterEach で例外を投げると、ほかの afterEach が呼ばれない

`@vitest/runner` 4.1.11 は、`sequence.hooks` が `parallel` でなければ、`afterEach` を `for (const hook of hooks) callbacks.push(await runHook(hook))` で 1 つずつ呼ぶ(`node_modules/@vitest/runner/dist/chunk-artifact.js:2625-2631`)。例外はそのまま外に出るので、あとの hook は呼ばれない。既定の順(`stack`)では、setup ファイルの `afterEach` は最後に呼ばれる。根拠: **実測+公式ドキュメント**

- 起きたこと: 一覧の重複を除く処理を壊したとき(ミューテーションテスト)、壊れたテストは React の「同じ key の子」の `console.error` を `afterEach` で投げて失敗した。すると `cleanup()` が呼ばれず、次のテストの `getByText("ID img-1")` が「複数見つかった」で失敗した(前のテストの描画が残っていた)。
- 直し方: 投げる `afterEach` の先頭で `cleanup()` を呼ぶ。アンマウントのときの警告も数えられる。`cleanup()` は、あとで setup の `afterEach` からもう一度呼ばれても害が無い。直したあとは、壊れたテストだけが失敗した。

```ts
afterEach(() => {
	cleanup(); // 先に片付ける(ここで失敗しても、次のテストに DOM を残さない)
	vi.unstubAllGlobals();
	const warnings = consoleError.mock.calls.map((args) => args.map(String).join(" "));
	consoleError.mockRestore();
	if (warnings.length > 0) throw new Error(`console.error was called:\n${warnings.join("\n")}`);
});
```

## そのほか(Testing Library)

- `alt=""` の `<img>` は役割が `presentation` になり、`getByRole("img")` では見つからない。`container.querySelector("img")` で調べる。根拠: 実測のみ
- `<output>` の暗黙の役割は `status` で、Kumo の `Loader`(`role="status"`)と同じ。読み込み中は `getByRole("status")` で両方が当たりうるので、読み上げの領域は `document.querySelector("output[aria-live]")` で探した。根拠: 公式ドキュメントのみ(HTML の暗黙の役割と、Kumo の `loader-g8a6j76ue5nq0lr8.js`)
