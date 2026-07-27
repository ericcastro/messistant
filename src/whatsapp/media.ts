import type { Message, MessageMedia } from "whatsapp-web.js";

interface RawMediaMetadata {
  directPath: unknown;
  encFilehash: unknown;
  filehash: unknown;
  mediaKey: unknown;
  mediaKeyTimestamp: unknown;
  type: unknown;
  mimetype: unknown;
  filename: unknown;
  size: unknown;
}

interface PageEvaluator {
  evaluate<Result, Argument>(
    pageFunction: (argument: Argument) => Promise<Result>,
    argument: Argument,
  ): Promise<Result>;
}

interface InternalMessage {
  client?: { pupPage?: PageEvaluator };
  rawData?: Record<string, unknown>;
}

export interface MediaMetadataAvailability {
  browserPage: boolean;
  directPath: boolean;
  encFilehash: boolean;
  filehash: boolean;
  mediaKey: boolean;
  mediaKeyTimestamp: boolean;
}

function internals(message: Message): {
  page: PageEvaluator | null;
  metadata: RawMediaMetadata;
} {
  const internal = message as unknown as InternalMessage;
  const raw = internal.rawData ?? {};
  return {
    page: internal.client?.pupPage ?? null,
    metadata: {
      directPath: raw.directPath,
      encFilehash: raw.encFilehash,
      filehash: raw.filehash,
      mediaKey: raw.mediaKey,
      mediaKeyTimestamp: raw.mediaKeyTimestamp,
      type: raw.type,
      mimetype: raw.mimetype,
      filename: raw.filename,
      size: raw.size,
    },
  };
}

export function mediaMetadataAvailability(
  message: Message,
): MediaMetadataAvailability {
  const { page, metadata } = internals(message);
  return {
    browserPage: Boolean(page),
    directPath: Boolean(metadata.directPath),
    encFilehash: Boolean(metadata.encFilehash),
    filehash: Boolean(metadata.filehash),
    mediaKey: Boolean(metadata.mediaKey),
    mediaKeyTimestamp: Boolean(metadata.mediaKeyTimestamp),
  };
}

async function downloadFromEventMetadata(
  message: Message,
): Promise<MessageMedia | null> {
  const { page, metadata } = internals(message);
  if (!page || !metadata.directPath || !metadata.mediaKey) {
    return null;
  }

  const result = await page.evaluate(
    async (media): Promise<{
      data: string;
      mimetype: string;
      filename: string | null;
      filesize: number | null;
    } | null> => {
      const browserWindow = window as unknown as {
        require(name: string): {
          downloadManager: {
            downloadAndMaybeDecrypt(input: Record<string, unknown>): Promise<
              ArrayBuffer
            >;
          };
        };
        WWebJS: {
          arrayBufferToBase64Async(data: ArrayBuffer): Promise<string>;
        };
      };
      const mockQpl = {
        addAnnotations() {
          return this;
        },
        addPoint() {
          return this;
        },
      };

      try {
        const decryptedMedia = await browserWindow
          .require("WAWebDownloadManager")
          .downloadManager.downloadAndMaybeDecrypt({
            directPath: media.directPath,
            encFilehash: media.encFilehash,
            filehash: media.filehash,
            mediaKey: media.mediaKey,
            mediaKeyTimestamp: media.mediaKeyTimestamp,
            type: media.type,
            signal: new AbortController().signal,
            downloadQpl: mockQpl,
          });
        return {
          data:
            await browserWindow.WWebJS.arrayBufferToBase64Async(
              decryptedMedia,
            ),
          mimetype:
            typeof media.mimetype === "string"
              ? media.mimetype
              : "application/octet-stream",
          filename:
            typeof media.filename === "string" ? media.filename : null,
          filesize: typeof media.size === "number" ? media.size : null,
        };
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "status" in error &&
          error.status === 404
        ) {
          return null;
        }
        throw error;
      }
    },
    metadata,
  );

  return result;
}

export async function downloadMessageMedia(
  message: Message,
): Promise<MessageMedia | null> {
  let standardError: unknown = null;
  try {
    const media = await message.downloadMedia();
    if (media?.data) {
      return media;
    }
  } catch (error) {
    standardError = error;
  }

  try {
    const media = await downloadFromEventMetadata(message);
    if (media?.data) {
      return media;
    }
  } catch (fallbackError) {
    throw new AggregateError(
      [standardError, fallbackError].filter(Boolean),
      "Both WhatsApp media download paths failed.",
    );
  }

  if (standardError) {
    throw new Error("WhatsApp's standard media download failed.", {
      cause: standardError,
    });
  }
  return null;
}
