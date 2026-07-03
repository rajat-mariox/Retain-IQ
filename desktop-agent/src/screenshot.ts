/**
 * Screen capture → upload. Grabs the primary display via Electron's
 * desktopCapturer, downscales/compresses to a JPEG, reserves quota + a presigned
 * URL from identity, and uploads the bytes directly to object storage.
 */
import { desktopCapturer, screen } from "electron";
import { requestScreenshotUpload, putBinary } from "./api.js";

const CONTENT_TYPE = "image/jpeg";

/** Capture the primary display as a downscaled JPEG buffer, or null on failure. */
async function capture(maxWidth: number, quality: number): Promise<Buffer | null> {
  try {
    const { width, height } = screen.getPrimaryDisplay().size;
    const scale = width > maxWidth ? maxWidth / width : 1;
    const thumbnailSize = { width: Math.round(width * scale), height: Math.round(height * scale) };
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize });
    const img = sources[0]?.thumbnail;
    if (!img || img.isEmpty()) return null;
    return img.toJPEG(Math.max(1, Math.min(100, quality)));
  } catch {
    // Screen-recording permission denied (macOS) or capture failed.
    return null;
  }
}

/** Capture the screen and upload it; returns the stored object key, or null. */
export async function captureAndUpload(maxWidth: number, quality: number): Promise<string | null> {
  const buffer = await capture(maxWidth, quality);
  if (!buffer || buffer.length === 0) return null;
  const meta = await requestScreenshotUpload(buffer.length, CONTENT_TYPE);
  if (!meta) return null; // screenshots disabled for the org, over quota, or unreachable
  const ok = await putBinary(meta.uploadUrl, buffer, CONTENT_TYPE);
  return ok ? meta.key : null;
}
