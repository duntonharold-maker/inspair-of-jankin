import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  return process.env.MCP_SECRET || "";
}

/** In local dev without MCP_SECRET everything is allowed; in production a secret is required. */
export function authConfigured() {
  return Boolean(secret()) || process.env.NODE_ENV !== "production";
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Accepts the secret either as the last URL segment or as `Authorization: Bearer <secret>`. */
export function isAuthorized(req: Request, pathSecret?: string) {
  const s = secret();
  if (!s) return process.env.NODE_ENV !== "production";
  if (pathSecret && safeEqual(pathSecret, s)) return true;
  const header = req.headers.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return Boolean(m && safeEqual(m[1].trim(), s));
}

const b64url = (b: Buffer) => b.toString("base64url");

function sign(body: string) {
  return b64url(createHmac("sha256", secret() || "dev-only-secret").update(body).digest());
}

/** A short-lived token that lets one curl call upload a file with pre-approved metadata. */
export function createUploadToken(payload: unknown, ttlSeconds = 30 * 60) {
  const body = b64url(Buffer.from(JSON.stringify({ p: payload, exp: Date.now() + ttlSeconds * 1000 })));
  return `${body}.${sign(body)}`;
}

export function readUploadToken(token: string): unknown {
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sig, sign(body))) throw new Error("Invalid upload token.");
  const { p, exp } = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (typeof exp !== "number" || Date.now() > exp) throw new Error("Upload token expired — ask the MCP server for a new one.");
  return p;
}
