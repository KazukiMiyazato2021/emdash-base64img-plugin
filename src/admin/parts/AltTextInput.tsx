/**
 * 代替テキストの入力(仕様書 11.2、11.3)。
 *
 * - 任意入力。空欄(空白だけも含む)のときは「装飾画像として扱われます」と、入力欄の説明として出す
 *   (Kumo の Input の `description`。`aria-describedby` で入力欄に結び付く)。
 * - 上限は `MAX_ALT_LENGTH`(1,000)。HTML の `maxlength` は UTF-16 のコード単位で数えるので、サーバーの上限
 *   (コードポイントで数える)より厳しいか同じになり、上限を超える値は入力できない(`src/shared/constants.ts`)。
 */

import { Input } from "@cloudflare/kumo";
import { useCallback, type ChangeEvent, type Ref } from "react";

import { defineMessages, useMessages } from "../../client/i18n";
import { MAX_ALT_LENGTH } from "../../shared/constants";

const messages = defineMessages({
	ja: {
		label: "代替テキスト",
		labelFor: (itemLabel: string) => `代替テキスト(${itemLabel})`,
		decorative: "空欄のときは、装飾画像として扱われます(スクリーンリーダーは読み上げません)。",
	},
	en: {
		label: "Alternative text",
		labelFor: (itemLabel) => `Alternative text (${itemLabel})`,
		decorative: "When left empty, the image is treated as decorative (screen readers skip it).",
	},
});

export interface AltTextInputProps {
	/** 代替テキスト(参照の `alt`) */
	readonly value: string;
	/** 入力のたびに、新しい値で呼ぶ */
	readonly onChange: (value: string) => void;
	/**
	 * どの画像の欄かを示す名前(ギャラリーの「画像 2」)。ラベルが「代替テキスト(画像 2)」になる。
	 * 省略するとラベルは「代替テキスト」
	 */
	readonly itemLabel?: string | undefined;
	readonly id?: string | undefined;
	readonly disabled?: boolean | undefined;
	readonly inputRef?: Ref<HTMLInputElement> | undefined;
}

/** 代替テキストの入力欄(Kumo の Input) */
export function AltTextInput({
	value,
	onChange,
	itemLabel,
	id,
	disabled = false,
	inputRef,
}: AltTextInputProps) {
	const t = useMessages(messages);
	const handleChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			onChange(event.currentTarget.value);
		},
		[onChange],
	);
	return (
		<Input
			ref={inputRef}
			id={id}
			label={itemLabel === undefined ? t.label : t.labelFor(itemLabel)}
			description={value.trim() === "" ? t.decorative : undefined}
			value={value}
			onChange={handleChange}
			maxLength={MAX_ALT_LENGTH}
			disabled={disabled}
			autoComplete="off"
		/>
	);
}
