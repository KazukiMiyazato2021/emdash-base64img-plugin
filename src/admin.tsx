/**
 * base64-image プラグインの管理画面の入口(descriptor の `adminEntry` = `emdash-plugin-base64-image/admin`)。
 *
 * EmDash 0.39.1 の管理画面は、起動時にこのモジュールを静的に読み込み
 * (`references/emdash/packages/core/src/astro/integration/virtual-modules.ts:327-359`)、次の export を使う
 * (`@emdash-cms/admin` の `PluginAdminModule`)。名前とパスは、サーバー側の宣言(`src/server/plugin.ts` の
 * `admin.fieldWidgets` と `admin.pages`)と同じ定数(`WIDGET_KINDS`・`IMAGES_PAGE`)に合わせる。
 * - `fields`: 編集画面の widget。管理画面は、フィールドの `widget`(`base64-image:image` など)の `:` の後ろの名前で探し、
 *   無ければ標準の入力(`json` なら textarea)を出す(`references/emdash/packages/admin/src/components/ContentEditor.tsx:1806-1863`)。
 * - `pages`: 画像管理ページ。サイドバーの項目は、ここに部品があるページだけに出る
 *   (`references/emdash/packages/admin/src/components/Sidebar.tsx:488-505`)。
 * - `contentListColumns`: コンテンツ一覧のサムネイル列。
 *
 * 決めたことは tasks/T30-admin-entry.md の「結果」。
 */

import type { PluginAdminModule } from "@emdash-cms/admin";

import { GalleryField } from "./admin/GalleryField";
import { ImageField } from "./admin/ImageField";
import { ImagesPage } from "./admin/ImagesPage";
import { preloadThumbnailColumn, thumbnailColumn } from "./admin/ThumbnailColumn";
import { IMAGES_PAGE } from "./shared/constants";

// 一覧の列を出すコレクションの判定に使うマニフェストを、読み込み時に取り始める(T24)。一覧の画面は、列の
// `collections` をコレクションなどが変わったときにしか呼び直さないので、呼ばないと、最初に開いた一覧で、
// このプラグインのフィールドの無いコレクションにも空の列が出る。失敗しても(ログイン画面の 401 など)例外は外に出ず、
// 次に `collections` が呼ばれたときに取り直す。
preloadThumbnailColumn();

/**
 * 編集画面の widget。キーは `WIDGET_KINDS` の名前(`base64-image:image` / `base64-image:gallery` の `:` の後ろ)。
 * 型の注釈(`PluginAdminModule["fields"]` や `satisfies`)は付けない。0.39.1 の `fields` の型は props 無しの
 * `Record<string, React.ComponentType>` で、props が必須の widget は代入できない(TS2322。公式の field-kit も付けない)。
 */
export const fields = { image: ImageField, gallery: GalleryField };

/** 画像管理ページ(`/_emdash/admin/plugins/base64-image/images`)。キーは `admin.pages` の `path` と同じ */
export const pages = { [IMAGES_PAGE.path]: ImagesPage } satisfies NonNullable<
	PluginAdminModule["pages"]
>;

/** コンテンツ一覧のサムネイル列。`thumbnailColumn` の項目は上書きしない(`label` は管理画面の辞書の ID) */
export const contentListColumns = [thumbnailColumn] satisfies NonNullable<
	PluginAdminModule["contentListColumns"]
>;
