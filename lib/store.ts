/**
 * Storage for items, the site config and media files.
 *
 * - GitHub mode (GITHUB_TOKEN + GITHUB_REPO set, i.e. on Vercel): every change is
 *   one commit to the repository through the GitHub Git Data API. Vercel then
 *   redeploys the site from that commit.
 * - Local mode (no token, i.e. `npm run dev` on your machine): changes are written
 *   straight to content/ and public/media/ in the working tree.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { ItemSchema, SiteSchema, type Item, type Site } from "./types";
import { blobDel, blobGet, blobOn, blobPut, isMediaPath } from "./blob";

export const ITEMS_PATH = "content/items.json";
export const SITE_PATH = "content/site.json";
export const MEDIA_DIR = "public/media";

export type FileWrite = { path: string; content: Buffer };

export type Snapshot = { items: Item[]; site: Site };

export type Change<T> = {
  /** New full item list; omit to leave items.json untouched. */
  items?: Item[];
  /** New site config; omit to leave site.json untouched. */
  site?: Site;
  addFiles?: FileWrite[];
  deleteFiles?: string[];
  message: string;
  result: T;
};

export type Mutator<T> = (snapshot: Snapshot) => Promise<Change<T>> | Change<T>;

export interface Store {
  readonly mode: "github" | "local";
  read(): Promise<Snapshot>;
  /** Read one file of the repository (e.g. public/media/…) as it is now. */
  readFile(path: string): Promise<Buffer>;
  /** The media files kept in the repository itself (public/media/…). */
  repoMedia(): Promise<string[]>;
  /** Read the latest state, apply the mutator, write the result. Retries on races. */
  mutate<T>(mutator: Mutator<T>): Promise<{ result: T; commit?: string }>;
}

function parseSnapshot(itemsText: string, siteText: string): Snapshot {
  const items = ItemSchema.array().parse(JSON.parse(itemsText));
  const site = SiteSchema.parse(JSON.parse(siteText));
  return { items, site };
}

export const serialize = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/* ------------------------------------------------------------------ local */

class LocalStore implements Store {
  readonly mode = "local" as const;
  constructor(private root = process.cwd()) {}

  // Local mode only runs in development; keep the bundler from tracing the whole project.
  private p(rel: string) {
    const abs = path.resolve(/*turbopackIgnore: true*/ this.root, rel);
    if (!abs.startsWith(path.resolve(/*turbopackIgnore: true*/ this.root) + path.sep)) throw new Error(`Bad path: ${rel}`);
    return abs;
  }

  async read(): Promise<Snapshot> {
    const [items, site] = await Promise.all([
      fs.readFile(this.p(ITEMS_PATH), "utf8"),
      fs.readFile(this.p(SITE_PATH), "utf8"),
    ]);
    return parseSnapshot(items, site);
  }

  readFile(rel: string) {
    return fs.readFile(this.p(rel));
  }

  async repoMedia() {
    const names = await fs.readdir(this.p(MEDIA_DIR)).catch(() => [] as string[]);
    return names.filter((n) => !n.startsWith(".")).map((n) => `${MEDIA_DIR}/${n}`);
  }

  async mutate<T>(mutator: Mutator<T>) {
    const change = await mutator(await this.read());
    for (const f of change.addFiles ?? []) {
      await fs.mkdir(path.dirname(this.p(f.path)), { recursive: true });
      await fs.writeFile(this.p(f.path), f.content);
    }
    for (const f of change.deleteFiles ?? []) await fs.rm(this.p(f), { force: true });
    if (change.items) await fs.writeFile(this.p(ITEMS_PATH), serialize(change.items));
    if (change.site) await fs.writeFile(this.p(SITE_PATH), serialize(change.site));
    return { result: change.result };
  }
}

/* ----------------------------------------------------------------- github */

class ConflictError extends Error {}

class GitHubStore implements Store {
  readonly mode = "github" as const;
  constructor(
    private token: string,
    private repo: string,
    private branch: string,
  ) {}

  private async gh<T>(method: string, route: string, body?: unknown, accept?: string): Promise<T> {
    const api = process.env.GITHUB_API_URL || "https://api.github.com";
    const res = await fetch(`${api}/repos/${this.repo}${route}`, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept ?? "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "inspair-mcp",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 422 && method === "PATCH") throw new ConflictError("Branch moved");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub ${method} ${route} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return (accept?.includes("raw") ? await res.text() : await res.json()) as T;
  }

  private async head() {
    const ref = await this.gh<{ object: { sha: string } }>("GET", `/git/ref/heads/${this.branch}`);
    const commit = await this.gh<{ tree: { sha: string } }>("GET", `/git/commits/${ref.object.sha}`);
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  }

  private file(rel: string, ref: string) {
    return this.gh<string>("GET", `/contents/${rel}?ref=${ref}`, undefined, "application/vnd.github.raw+json");
  }

  private async readAt(ref: string) {
    const [items, site] = await Promise.all([this.file(ITEMS_PATH, ref), this.file(SITE_PATH, ref)]);
    return parseSnapshot(items, site);
  }

  async read() {
    const { commitSha } = await this.head();
    return this.readAt(commitSha);
  }

  async readFile(rel: string) {
    // newer media lives in the Blob store, older media in the repository
    if (blobOn() && isMediaPath(rel)) {
      const got = await blobGet(rel);
      if (got) return Buffer.from(await new Response(got.stream).arrayBuffer());
    }
    const { commitSha } = await this.head();
    const api = process.env.GITHUB_API_URL || "https://api.github.com";
    const res = await fetch(`${api}/repos/${this.repo}/contents/${rel}?ref=${commitSha}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "inspair-mcp",
      },
    });
    if (!res.ok) throw new Error(`GitHub GET ${rel} → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async repoMedia() {
    const { commitSha } = await this.head();
    return [...(await this.mediaInRepo(commitSha))];
  }

  /** The media files kept in the repository at a commit (older media, from before the Blob store). */
  private async mediaInRepo(ref: string) {
    try {
      const list = await this.gh<{ path: string }[]>("GET", `/contents/${MEDIA_DIR}?ref=${ref}`);
      return new Set(list.map((f) => f.path));
    } catch {
      return new Set<string>();
    }
  }

  async mutate<T>(mutator: Mutator<T>) {
    // Blobs are content-addressed, so uploading them again on a retry is harmless.
    for (let attempt = 0; ; attempt++) {
      const { commitSha, treeSha } = await this.head();
      const change = await mutator(await this.readAt(commitSha));

      const tree: Record<string, unknown>[] = [];
      // media goes to the Blob store when there is one; the commit then only carries text
      const toBlob = blobOn() ? (change.addFiles ?? []).filter((f) => isMediaPath(f.path)) : [];
      for (const f of toBlob) await blobPut(f.path, f.content);
      const deletes = change.deleteFiles ?? [];
      const inRepo = blobOn() && deletes.some(isMediaPath) ? await this.mediaInRepo(commitSha) : null;
      const repoDeletes = inRepo ? deletes.filter((p) => !isMediaPath(p) || inRepo.has(p)) : deletes;
      const blobDeletes = inRepo ? deletes.filter((p) => isMediaPath(p) && !inRepo.has(p)) : [];
      for (const f of (change.addFiles ?? []).filter((f) => !toBlob.includes(f))) {
        const blob = await this.gh<{ sha: string }>("POST", "/git/blobs", {
          content: f.content.toString("base64"),
          encoding: "base64",
        });
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
      }
      for (const p of repoDeletes) tree.push({ path: p, mode: "100644", type: "blob", sha: null });
      if (change.items) tree.push({ path: ITEMS_PATH, mode: "100644", type: "blob", content: serialize(change.items) });
      if (change.site) tree.push({ path: SITE_PATH, mode: "100644", type: "blob", content: serialize(change.site) });
      if (!tree.length) {
        await blobDel(blobDeletes);
        return { result: change.result };
      }

      const newTree = await this.gh<{ sha: string }>("POST", "/git/trees", { base_tree: treeSha, tree });
      const commit = await this.gh<{ sha: string }>("POST", "/git/commits", {
        message: change.message,
        tree: newTree.sha,
        parents: [commitSha],
      });
      try {
        await this.gh("PATCH", `/git/refs/heads/${this.branch}`, { sha: commit.sha, force: false });
        // the items no longer point at these: free the space
        await blobDel(blobDeletes);
        return { result: change.result, commit: commit.sha };
      } catch (e) {
        if (e instanceof ConflictError && attempt < 3) continue;
        throw e;
      }
    }
  }
}

/* ---------------------------------------------------------------- factory */

let cached: Store | undefined;

export function getStore(): Store {
  if (cached) return cached;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (token && repo) {
    cached = new GitHubStore(token, repo, process.env.GITHUB_BRANCH || "main");
  } else if (process.env.VERCEL) {
    throw new Error("GITHUB_TOKEN and GITHUB_REPO must be set on Vercel, otherwise changes have nowhere to go.");
  } else {
    cached = new LocalStore();
  }
  return cached;
}
