import { and, eq, gt, lte, ne, sql } from "drizzle-orm";
import { getDb } from "./index";
import { hasPostgresErrorCode } from "./errors";
import { authRateLimits, passwordResetTokens, sessions, users } from "./schema";
import { publicAppOrigin, secureCookiesRequired } from "../lib/server-config";

const SESSION_COOKIE = "rangelab_session";
const PASSWORD_ITERATIONS = 310_000;
const SESSION_DAY_SECONDS = 60 * 60 * 24;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
};

type UserWithPassword = AuthUser & {
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function registerUser(name: string, email: string, password: string) {
  const db = getDb();
  const normalizedEmail = normalizeEmail(email);
  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = new Date();

  try {
    await db.insert(users).values({
      id,
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: hash,
      passwordSalt: salt,
      passwordIterations: PASSWORD_ITERATIONS,
      role: "user",
      createdAt: now,
      updatedAt: now,
    });
    return { id, name: name.trim(), email: normalizedEmail, role: "user" } satisfies AuthUser;
  } catch (error) {
    if (hasPostgresErrorCode(error, "23505")) throw new Error("EMAIL_IN_USE");
    throw error;
  }
}

export async function createInitialAdmin(name: string, email: string, password: string) {
  const db = getDb();
  const normalizedEmail = normalizeEmail(email);
  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(846213579)`);
      const [existingAdmin] = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
      if (existingAdmin) throw new Error("ADMIN_ALREADY_EXISTS");
      await tx.insert(users).values({
        id,
        name: name.trim(),
        email: normalizedEmail,
        passwordHash: hash,
        passwordSalt: salt,
        passwordIterations: PASSWORD_ITERATIONS,
        role: "admin",
        createdAt: now,
        updatedAt: now,
      });
    });
    return { id, name: name.trim(), email: normalizedEmail, role: "admin" } satisfies AuthUser;
  } catch (error) {
    if (error instanceof Error && error.message === "ADMIN_ALREADY_EXISTS") throw error;
    if (hasPostgresErrorCode(error, "23505")) throw new Error("EMAIL_IN_USE");
    throw error;
  }
}

export async function authenticateUser(email: string, password: string): Promise<AuthUser | null> {
  const [row] = await getDb().select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    passwordHash: users.passwordHash,
    passwordSalt: users.passwordSalt,
    passwordIterations: users.passwordIterations,
  }).from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
  if (!row) {
    await hashPassword(password);
    return null;
  }
  if (!await verifyPassword(password, row.passwordSalt, row.passwordHash, row.passwordIterations)) return null;
  return toAuthUser(row);
}

export async function createSession(userId: string, remember: boolean) {
  const token = randomToken(32);
  const id = await hashToken(token);
  const maxAge = SESSION_DAY_SECONDS * (remember ? 30 : 1);
  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.delete(sessions).where(lte(sessions.expiresAt, now));
    await tx.insert(sessions).values({ id, userId, expiresAt: new Date(now.getTime() + maxAge * 1000), createdAt: now, lastUsedAt: now });
  });
  return { token, maxAge };
}

export async function getSessionUser(request: Request): Promise<AuthUser | null> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const id = await hashToken(token);
  const now = new Date();
  const [user] = await getDb().select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!user) return null;
  await getDb().update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, id));
  return user;
}

export async function destroySession(request: Request) {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (token) await getDb().delete(sessions).where(eq(sessions.id, await hashToken(token)));
}

export async function createPasswordReset(email: string): Promise<string | null> {
  const [user] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
  if (!user) return null;
  const token = randomToken(32);
  const id = await hashToken(token);
  const now = new Date();
  await getDb().insert(passwordResetTokens)
    .values({ id, userId: user.id, expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS), createdAt: now })
    .onConflictDoUpdate({
      target: passwordResetTokens.userId,
      set: { id, expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS), usedAt: null, createdAt: now },
    });
  await getDb().delete(passwordResetTokens).where(and(ne(passwordResetTokens.userId, user.id), lte(passwordResetTokens.expiresAt, now)));
  return token;
}

export async function resetPassword(token: string, password: string) {
  if (!isPasswordResetToken(token)) return false;
  const id = await hashToken(token);
  const now = new Date();
  const [available] = await getDb().select({ id: passwordResetTokens.id })
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.id, id), sql`${passwordResetTokens.usedAt} IS NULL`, gt(passwordResetTokens.expiresAt, now)))
    .limit(1);
  if (!available) return false;
  const { hash, salt } = await hashPassword(password);
  const claimedAt = new Date();
  return getDb().transaction(async (tx) => {
    const [claimed] = await tx.update(passwordResetTokens)
      .set({ usedAt: claimedAt })
      .where(and(eq(passwordResetTokens.id, id), sql`${passwordResetTokens.usedAt} IS NULL`, gt(passwordResetTokens.expiresAt, claimedAt)))
      .returning({ userId: passwordResetTokens.userId });
    if (!claimed) return false;
    await tx.update(users).set({ passwordHash: hash, passwordSalt: salt, passwordIterations: PASSWORD_ITERATIONS, updatedAt: claimedAt }).where(eq(users.id, claimed.userId));
    await tx.delete(sessions).where(eq(sessions.userId, claimed.userId));
    await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, claimed.userId));
    return true;
  });
}

export function isPasswordResetToken(value: unknown): value is string {
  return typeof value === "string" && RESET_TOKEN_PATTERN.test(value);
}

export type AccountUpdateResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: "NOT_FOUND" | "INVALID_PASSWORD" | "EMAIL_IN_USE" };

export async function updateUserProfile(userId: string, name: string, email: string, currentPassword: string): Promise<AccountUpdateResult> {
  const normalizedEmail = normalizeEmail(email);
  const row = await findUserWithPassword(userId);
  if (!row) return { ok: false, reason: "NOT_FOUND" };
  if (normalizedEmail !== row.email) {
    const passwordIsValid = currentPassword
      ? await verifyPassword(currentPassword, row.passwordSalt, row.passwordHash, row.passwordIterations)
      : false;
    if (!passwordIsValid) return { ok: false, reason: "INVALID_PASSWORD" };
    const [existing] = await getDb().select({ id: users.id }).from(users).where(and(eq(users.email, normalizedEmail), ne(users.id, userId))).limit(1);
    if (existing) return { ok: false, reason: "EMAIL_IN_USE" };
  }
  try {
    await getDb().update(users).set({ name: name.trim(), email: normalizedEmail, updatedAt: new Date() }).where(eq(users.id, userId));
  } catch (error) {
    if (hasPostgresErrorCode(error, "23505")) return { ok: false, reason: "EMAIL_IN_USE" };
    throw error;
  }
  return { ok: true, user: { id: row.id, name: name.trim(), email: normalizedEmail, role: row.role } };
}

export async function changeUserPassword(userId: string, currentPassword: string, newPassword: string) {
  const row = await findUserWithPassword(userId);
  if (!row) return "NOT_FOUND" as const;
  if (!await verifyPassword(currentPassword, row.passwordSalt, row.passwordHash, row.passwordIterations)) return "INVALID_PASSWORD" as const;
  const { hash, salt } = await hashPassword(newPassword);
  await getDb().transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: hash, passwordSalt: salt, passwordIterations: PASSWORD_ITERATIONS, updatedAt: new Date() }).where(eq(users.id, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  });
  return "OK" as const;
}

export async function consumeAuthRateLimit(request: Request, scope: string, discriminator: string, limit: number, windowMs: number) {
  const ip = authRateLimitClientIp(request);
  const id = await hashToken(`${scope}:${ip}:${normalizeEmail(discriminator)}`);
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);
  const expiresAt = new Date(now.getTime() + windowMs);
  const nowIso = now.toISOString();
  const windowStartIso = windowStart.toISOString();
  const db = getDb();
  const [row] = await db.insert(authRateLimits).values({ id, hits: 1, windowStartedAt: now, expiresAt })
    .onConflictDoUpdate({
      target: authRateLimits.id,
      set: {
        hits: sql`CASE WHEN ${authRateLimits.windowStartedAt} <= ${windowStartIso}::timestamptz THEN 1 ELSE ${authRateLimits.hits} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${authRateLimits.windowStartedAt} <= ${windowStartIso}::timestamptz THEN ${nowIso}::timestamptz ELSE ${authRateLimits.windowStartedAt} END`,
        expiresAt,
      },
    }).returning({ hits: authRateLimits.hits });
  await db.delete(authRateLimits).where(and(lte(authRateLimits.expiresAt, now), ne(authRateLimits.id, id)));
  return row.hits <= limit;
}

export function consumeAuthIpRateLimit(request: Request, scope: string, limit: number, windowMs: number) {
  return consumeAuthRateLimit(request, scope, "", limit, windowMs);
}

export function authRateLimitClientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function findUserWithPassword(userId: string): Promise<UserWithPassword | undefined> {
  const [row] = await getDb().select({
    id: users.id, name: users.name, email: users.email, role: users.role,
    passwordHash: users.passwordHash, passwordSalt: users.passwordSalt, passwordIterations: users.passwordIterations,
  }).from(users).where(eq(users.id, userId)).limit(1);
  return row;
}

function toAuthUser(row: UserWithPassword): AuthUser {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export function isTrustedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const expected = publicAppOrigin(process.env, request.url);
    return origin === expected;
  } catch {
    return false;
  }
}

export function sessionCookie(token: string, maxAge: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookiesRequired() ? "; Secure" : ""}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookiesRequired() ? "; Secure" : ""}`;
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
