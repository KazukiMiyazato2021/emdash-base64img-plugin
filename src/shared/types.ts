/**
 * 共有の型。値の形はスキーマ(schema.ts)から導く。
 */

import type { z } from "zod";

import type * as schema from "./schema";

// 画像エントリ(`b64_images` の `image` フィールドの値。仕様書 5.1)
export type Base64ImageMeta = z.infer<typeof schema.base64ImageMetaSchema>;
export type Base64ImageEntry = z.infer<typeof schema.base64ImageEntrySchema>;

// 参照(仕様書 5.2)
export type Base64ImageRef = z.infer<typeof schema.base64ImageRefSchema>;
export type Base64ImageGallery = z.infer<typeof schema.base64ImageGallerySchema>;

// 参照元メタデータ(プラグインストレージ `imageRefs`。仕様書 5.3)
export type ImageOwner = z.infer<typeof schema.imageOwnerSchema>;
export type ImageRefsRecord = z.infer<typeof schema.imageRefsRecordSchema>;

// アップロード
export type UploadTarget = z.infer<typeof schema.uploadTargetSchema>;
export type UploadRequest = z.infer<typeof schema.uploadRequestSchema>;
export type UploadResponse = z.infer<typeof schema.uploadResponseSchema>;

// プレビュー取得
export type PreviewRequest = z.infer<typeof schema.previewRequestSchema>;
export type PreviewItem = z.infer<typeof schema.previewItemSchema>;
export type PreviewResponse = z.infer<typeof schema.previewResponseSchema>;

// サムネイル取得
export type ThumbnailsRequest = z.infer<typeof schema.thumbnailsRequestSchema>;
export type Thumbnail = z.infer<typeof schema.thumbnailSchema>;
export type ThumbnailItem = z.infer<typeof schema.thumbnailItemSchema>;
export type ThumbnailsResponse = z.infer<typeof schema.thumbnailsResponseSchema>;

// 画像管理
export type OwnerStatus = z.infer<typeof schema.ownerStatusSchema>;
export type ImageUsage = z.infer<typeof schema.imageUsageSchema>;
export type ImageEntryStatus = z.infer<typeof schema.imageEntryStatusSchema>;
export type ImagesListRequest = z.infer<typeof schema.imagesListRequestSchema>;
export type ImageListOwner = z.infer<typeof schema.imageListOwnerSchema>;
export type ImageListItem = z.infer<typeof schema.imageListItemSchema>;
export type ImagesListResponse = z.infer<typeof schema.imagesListResponseSchema>;
export type ImagesTrashRequest = z.infer<typeof schema.imagesTrashRequestSchema>;
export type ImagesTrashResponse = z.infer<typeof schema.imagesTrashResponseSchema>;

/**
 * サイト側で描画に使う値(`resolveBase64Images` が返す。仕様書 12 章)。
 * 画像エントリの値に、エントリ ID と参照の `alt` を加えたもの。EmDash の `MediaValue` に代入できる。
 */
export type ResolvedBase64Image = Base64ImageEntry & { id: string; alt: string };
