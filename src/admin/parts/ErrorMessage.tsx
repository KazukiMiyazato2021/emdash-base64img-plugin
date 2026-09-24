/**
 * エラーの表示(仕様書 11.2 の「失敗したらその場にエラーを表示し、フィールドの値は変えない」)。
 *
 * - 文言は T14 の `useErrorMessage` で、エラーのコードから決める(コードの分からないエラーは「予期しないエラー」)。
 * - 中断(`AbortError`)はエラーとして出さない。キャンセルは利用者の操作のため(tasks/T14-admin-i18n-api.md)。
 *   呼び出し側も `signal.aborted` を見て中断をエラーにしないが、この部品は渡されても出さない。
 * - `role="alert"` の領域は、エラーが無いときも残す。領域が先に DOM にあれば、中身が入ったときに確実に読み上げられる。
 *   widget はこの部品を常に描画し、`error` だけを変える。
 */

import { Banner, Button } from "@cloudflare/kumo";

import { useErrorMessage } from "../../client/error-messages";
import { defineMessages, useMessages } from "../../client/i18n";
import { WarningIcon } from "./icons";

const messages = defineMessages({
	ja: {
		dismiss: "閉じる",
		dismissLabel: "エラーを閉じる",
	},
	en: {
		dismiss: "Dismiss",
		dismissLabel: "Dismiss the error",
	},
});

/**
 * 中断によるエラーか(`AbortController#abort()` の既定の理由は、`name` が `AbortError` の `DOMException`)。
 * jsdom などでは `DOMException` のクラスが違うことがあるので、`instanceof` ではなく名前で見る。
 */
export function isAbortError(error: unknown): boolean {
	return (
		typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
	);
}

export interface ErrorMessageProps {
	/** 表示するエラー(`Base64ImageError` など)。`null` / `undefined` / 中断なら何も出さない */
	readonly error: unknown;
	/** 見出し(どのファイルのエラーか。ギャラリーの「IMG_0001.jpg」など)。省略すると本文だけ */
	readonly title?: string | undefined;
	/** 閉じるボタンで呼ぶ。省略するとボタンを出さない */
	readonly onDismiss?: (() => void) | undefined;
}

/** エラーの表示(Kumo の Banner の `error`) */
export function ErrorMessage({ error, title, onDismiss }: ErrorMessageProps) {
	const t = useMessages(messages);
	const text = useErrorMessage(isAbortError(error) ? null : error);
	return (
		<div role="alert">
			{text === undefined ? null : (
				<Banner
					variant="error"
					icon={<WarningIcon />}
					{...(title === undefined ? {} : { title })}
					description={text}
					action={
						onDismiss === undefined ? undefined : (
							<Button variant="ghost" size="sm" aria-label={t.dismissLabel} onClick={onDismiss}>
								{t.dismiss}
							</Button>
						)
					}
				/>
			)}
		</div>
	);
}
