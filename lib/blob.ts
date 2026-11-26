/**
 * Media files in Vercel Blob instead of the repository, once the project has a Blob store connected
 * (BLOB_READ_WRITE_TOKEN). The repository then only holds text; items keep their /media/<name> paths, and
 * /media/<name> requests that aren't a file in public/ (older media stays there) are answered from Blob by
 * app/api/media (a fallback rewrite in next.config.ts), so the site, the scene and SVG sandboxing work the
 * same whichever place a file lives in.
 */
import { del, get, put } from "@vercel/blob";

export const blobOn = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

/** public/media/x.webp → media/x.webp, the file's name in the store. */
const nameOf = (repoPath: string) => repoPath.replace(/^public\//, "");

export const isMediaPath = (repoPath: string) => repoPath.startsWith("public/media/");

const TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  json: "application/json",
};
export const typeOf = (path: string) => TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** Store a file. Its name never changes for other content, so writing it again (a retried commit) is harmless. */
export async function blobPut(repoPath: string, content: Buffer) {
  await put(nameOf(repoPath), content, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: typeOf(repoPath),
    cacheControlMaxAge: 60 * 60 * 24 * 365,
  });
}

/** A stored file as a stream with its type, or null when the store doesn't have it. */
export async function blobGet(repoPath: string) {
  if (!blobOn()) return null;
  try {
    const got = await get(nameOf(repoPath), { access: "public" });
    if (!got || got.statusCode !== 200) return null;
    return { stream: got.stream, type: got.blob.contentType || typeOf(repoPath), size: got.blob.size };
  } catch {
    return null;
  }
}

/** Remove files from the store; ones it never had are ignored. */
export async function blobDel(repoPaths: string[]) {
  if (!blobOn() || !repoPaths.length) return;
  try {
    await del(repoPaths.map(nameOf));
  } catch {
    // a file left behind costs a little space, never a broken page
  }
}
