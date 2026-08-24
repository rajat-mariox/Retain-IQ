/**
 * Screen capture → upload. Grabs every connected display via Electron's
 * desktopCapturer, downscales/compresses each to a JPEG, reserves quota + a
 * presigned URL from identity per image, and uploads the bytes directly to
 * object storage.
 */
import { desktopCapturer, screen } from "electron";
import { uploadScreenshot } from "./api.js";

const CONTENT_TYPE = "image/jpeg";

/** A captured display: its JPEG bytes plus which screen it came from. */
interface Shot {
  buffer: Buffer;
  /** 0-based index into the display list, so several monitors are distinguishable. */
  display: number;
  /** How many displays were captured in this pass — lets the timeline say "2 of 3". */
  displayCount: number;
}

/**
 * Capture every display as downscaled JPEG buffers. One source per screen; a
 * source that fails (e.g. permission denied) is skipped rather than aborting
 * the whole pass, so a working monitor still gets captured.
 */
async function captureAll(maxWidth: number, quality: number): Promise<Shot[]> {
  try {
    const displays = screen.getAllDisplays();
    // Size the thumbnails off the widest display so nothing is upscaled; each
    // source is then returned at its own native aspect within that bound.
    const widest = Math.max(...displays.map((d) => d.size.width), 1);
    const scale = widest > maxWidth ? maxWidth / widest : 1;
    const thumbnailSize = { width: Math.round(widest * scale), height: Math.round(widest * scale) };
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize });
    const q = Math.max(1, Math.min(100, quality));
    const shots: Shot[] = [];
    sources.forEach((src, i) => {
      const img = src.thumbnail;
      if (img && !img.isEmpty()) shots.push({ buffer: img.toJPEG(q), display: i, displayCount: sources.length });
    });
    return shots;
  } catch {
    // Screen-recording permission denied (macOS) or capture failed.
    return [];
  }
}

/** A stored screenshot: its object key and which display it was. */
export interface UploadedShot {
  key: string;
  display: number;
  displayCount: number;
}

/**
 * Capture every screen and upload each one for server-side PII masking + storage.
 * The raw JPEG is sent to identity, which masks it and stores ONLY the masked
 * image — an unmasked capture never reaches object storage. Returns the stored
 * objects (one per display that captured and stored successfully); empty if
 * screenshots are disabled, over quota, masking is unavailable, or capture
 * failed. A partial success is fine — whatever stored is kept.
 */
export async function captureAndUpload(maxWidth: number, quality: number): Promise<UploadedShot[]> {
  const shots = await captureAll(maxWidth, quality);
  const uploaded: UploadedShot[] = [];
  for (const shot of shots) {
    if (shot.buffer.length === 0) continue;
    const stored = await uploadScreenshot(shot.buffer, CONTENT_TYPE);
    if (!stored) break; // disabled / over quota / masking unavailable — stop this pass
    uploaded.push({ key: stored.key, display: shot.display, displayCount: shot.displayCount });
  }
  return uploaded;
}
