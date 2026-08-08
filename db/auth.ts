import { env } from "cloudflare:workers";

const SESSION_COOKIE = "rangelab_session";
const PASSWORD_ITERATIONS = 310_000;
const SESSION_DAY_SECONDS = 60 * 60 * 24;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
};

type UserRow = AuthUser & {
  password_hash: string;
  password_salt: string;
  password_iterations: number;
};

let schemaPromise: Promise<void> | null = null;

export function ensureAuthSchema() {
  schemaPromise ??= (async () => {
    const db = env.DB;
    if (!db) throw new Error("O banco local de usuários não está disponível.");

    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_iterations INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id)"),
      db.prepare("CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS password_reset_user_id_idx ON password_reset_tokens (user_id)"),
      db.prepare("CREATE INDEX IF NOT EXISTS password_reset_expires_at_idx ON password_reset_tokens (expires_at)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS auth_rate_limits (
        id TEXT PRIMARY KEY NOT NULL,
        hits INTEGER NOT NULL,
        window_started_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS auth_rate_limits_expires_at_idx ON auth_rate_limits (expires_at)"),
    ]);
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function registerUser(name: string, email: string, password: string) {
  await ensureAuthSchema();
  const db = env.DB;
  const normalizedEmail = normalizeEmail(email);
  const existing = await db.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").bind(normalizedEmail).first();
  if (existing) throw new Error("EMAIL_IN_USE");

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await db.prepare(`INSERT INTO users
    (id, name, email, password_hash, password_salt, password_iterations, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CASE WHEN EXISTS (SELECT 1 FROM users) THEN 'user' ELSE 'admin' END, ?, ?)`)
      .bind(id, name.trim(), normalizedEmail, hash, salt, PASSWORD_ITERATIONS, now, now)
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("unique")) throw new Error("EMAIL_IN_USE");
    throw error;
  }
  const created = await db.prepare("SELECT role FROM users WHERE id = ?").bind(id).first<{ role: AuthUser["role"] }>();
  const role = created?.role ?? "user";

  return { id, name: name.trim(), email: normalizedEmail, role } satisfies AuthUser;
}

export async function authenticateUser(email: string, password: string): Promise<AuthUser | null> {
  await ensureAuthSchema();
  const row = await env.DB.prepare(`SELECT id, name, email, role, password_hash, password_salt, password_iterations
    FROM users WHERE email = ? LIMIT 1`)
    .bind(normalizeEmail(email))
    .first<UserRow>();
  if (!row) {
    await hashPassword(password);
    return null;
  }
  const valid = await verifyPassword(password, row.password_salt, row.password_hash, row.password_iterations);
  if (!valid) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export async function createSession(userId: string, remember: boolean) {
  await ensureAuthSchema();
  const token = randomToken(32);
  const id = await hashToken(token);
  const maxAge = SESSION_DAY_SECONDS * (remember ? 30 : 1);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, userId, now + maxAge * 1000, now, now),
  ]);
  return { token, maxAge };
}

export async function getSessionUser(request: Request): Promise<AuthUser | null> {
  await ensureAuthSchema();
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const id = await hashToken(token);
  const now = Date.now();
  const user = await env.DB.prepare(`SELECT users.id, users.name, users.email, users.role
    FROM sessions INNER JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ? AND sessions.expires_at > ? LIMIT 1`)
    .bind(id, now)
    .first<AuthUser>();
  if (!user) return null;
  await env.DB.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ?").bind(now, id).run();
  return user;
}

export async function destroySession(request: Request) {
  await ensureAuthSchema();
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await hashToken(token)).run();
}

export async function createPasswordReset(email: string): Promise<string | null> {
  await ensureAuthSchema();
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
    .bind(normalizeEmail(email))
    .first<{ id: string }>();
  if (!user) return null;
  const token = randomToken(32);
  const id = await hashToken(token);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at <= ?").bind(user.id, now),
    env.DB.prepare("INSERT INTO password_reset_tokens (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(id, user.id, now + RESET_TOKEN_TTL_MS, now),
  ]);
  return token;
}

export async function resetPassword(token: string, password: string) {
  await ensureAuthSchema();
  const id = await hashToken(token);
  const now = Date.now();
  const reset = await env.DB.prepare(`SELECT user_id FROM password_reset_tokens
    WHERE id = ? AND used_at IS NULL AND expires_at > ? LIMIT 1`)
    .bind(id, now)
    .first<{ user_id: string }>();
  if (!reset) return false;
  const claim = await env.DB.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?")
    .bind(now, id, now)
    .run();
  if (!claim.meta.changes) return false;
  const { hash, salt } = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
      .bind(hash, salt, PASSWORD_ITERATIONS, now, reset.user_id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(reset.user_id),
  ]);
  return true;
}

export type AccountUpdateResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: "NOT_FOUND" | "INVALID_PASSWORD" | "EMAIL_IN_USE" };

export async function updateUserProfile(userId: string, name: string, email: string, currentPassword: string): Promise<AccountUpdateResult> {
  await ensureAuthSchema();
  const normalizedEmail = normalizeEmail(email);
  const row = await env.DB.prepare(`SELECT id, name, email, role, password_hash, password_salt, password_iterations
    FROM users WHERE id = ? LIMIT 1`)
    .bind(userId)
    .first<UserRow>();
  if (!row) return { ok: false, reason: "NOT_FOUND" };

  if (normalizedEmail !== row.email) {
    const passwordIsValid = currentPassword
      ? await verifyPassword(currentPassword, row.password_salt, row.password_hash, row.password_iterations)
      : false;
    if (!passwordIsValid) return { ok: false, reason: "INVALID_PASSWORD" };
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1")
      .bind(normalizedEmail, userId)
      .first();
    if (existing) return { ok: false, reason: "EMAIL_IN_USE" };
  }

  try {
    await env.DB.prepare("UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?")
      .bind(name.trim(), normalizedEmail, Date.now(), userId)
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("unique")) return { ok: false, reason: "EMAIL_IN_USE" };
    throw error;
  }

  return { ok: true, user: { id: row.id, name: name.trim(), email: normalizedEmail, role: row.role } };
}

export async function changeUserPassword(userId: string, currentPassword: string, newPassword: string) {
  await ensureAuthSchema();
  const row = await env.DB.prepare(`SELECT id, name, email, role, password_hash, password_salt, password_iterations
    FROM users WHERE id = ? LIMIT 1`)
    .bind(userId)
    .first<UserRow>();
  if (!row) return "NOT_FOUND" as const;
  if (!await verifyPassword(currentPassword, row.password_salt, row.password_hash, row.password_iterations)) return "INVALID_PASSWORD" as const;

  const { hash, salt } = await hashPassword(newPassword);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
      .bind(hash, salt, PASSWORD_ITERATIONS, now, userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
  ]);
  return "OK" as const;
}

export async function consumeAuthRateLimit(request: Request, scope: string, discriminator: string, limit: number, windowMs: number) {
  await ensureAuthSchema();
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const id = await hashToken(`${scope}:${ip}:${normalizeEmail(discriminator)}`);
  const now = Date.now();
  const row = await env.DB.prepare("SELECT hits, window_started_at FROM auth_rate_limits WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ hits: number; window_started_at: number }>();
  if (!row || now - row.window_started_at >= windowMs) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM auth_rate_limits WHERE expires_at <= ?").bind(now),
      env.DB.prepare(`INSERT INTO auth_rate_limits (id, hits, window_started_at, expires_at) VALUES (?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET hits = 1, window_started_at = excluded.window_started_at, expires_at = excluded.expires_at`)
        .bind(id, now, now + windowMs),
    ]);
    return true;
  }
  if (row.hits >= limit) return false;
  await env.DB.prepare("UPDATE auth_rate_limits SET hits = hits + 1 WHERE id = ?").bind(id).run();
  return true;
}

export function isTrustedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const expected = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).origin : new URL(request.url).origin;
    return origin === expected;
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, maxAge: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

async function hashPassword(password: string, suppliedSalt?: string) {
  const saltBytes = suppliedSalt ? decodeBase64Url(suppliedSalt) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: PASSWORD_ITERATIONS }, key, 256);
  return { hash: encodeBase64Url(new Uint8Array(bits)), salt: encodeBase64Url(saltBytes) };
}

async function verifyPassword(password: string, salt: string, expected: string, iterations: number) {
  const saltBytes = decodeBase64Url(salt);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations }, key, 256);
  return constantTimeEqual(encodeBase64Url(new Uint8Array(bits)), expected);
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return encodeBase64Url(new Uint8Array(digest));
}

function randomToken(size: number) {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: string, right: string) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}
