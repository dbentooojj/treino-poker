import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { authRateLimitClientIp, clearSessionCookie, isEmailVerificationToken, isPasswordResetToken, sessionCookie } from "../db/auth";
import { register } from "../instrumentation";
import { publicAppOrigin, secureCookiesRequired, validateProductionConfiguration } from "../lib/server-config";

test("cookies de sessão são Secure em produção mesmo diante de URL HTTP inválida", () => {
  assert.equal(secureCookiesRequired({ NODE_ENV: "production", APP_BASE_URL: "http://example.com" }), true);
  const previousNodeEnv = process.env.NODE_ENV;
  const previousBaseUrl = process.env.APP_BASE_URL;
  try {
    setEnvironment("NODE_ENV", "production");
    setEnvironment("APP_BASE_URL", "http://example.com");
    assert.match(sessionCookie("token", 60), /; Secure$/);
    assert.match(clearSessionCookie(), /; Secure$/);
  } finally {
    restoreEnvironment("NODE_ENV", previousNodeEnv);
    restoreEnvironment("APP_BASE_URL", previousBaseUrl);
  }
});

test("cookies acompanham HTTPS em desenvolvimento sem bloquear HTTP local", () => {
  assert.equal(secureCookiesRequired({ NODE_ENV: "development", APP_BASE_URL: "http://localhost:3000" }), false);
  assert.equal(secureCookiesRequired({ NODE_ENV: "development", APP_BASE_URL: "https://localhost" }), true);
});

test("modo Docker local permite HTTP somente com opt-in e host privado", () => {
  const local = {
    NODE_ENV: "production",
    APP_BASE_URL: "http://192.168.1.93",
    SITE_ADDRESS: ":80",
    ALLOW_INSECURE_LOCAL_HTTP: "true",
  };
  assert.doesNotThrow(() => validateProductionConfiguration(local));
  assert.equal(publicAppOrigin(local), "http://192.168.1.93");
  assert.equal(secureCookiesRequired(local), false);

  assert.throws(() => validateProductionConfiguration({ ...local, ALLOW_INSECURE_LOCAL_HTTP: "false" }), /HTTPS/);
  assert.throws(() => validateProductionConfiguration({ ...local, APP_BASE_URL: "http://example.com" }), /HTTPS/);
  assert.throws(() => validateProductionConfiguration({ ...local, SITE_ADDRESS: "http://192.168.1.94" }), /mesma origem HTTP privada/);
  assert.equal(secureCookiesRequired({ ...local, APP_BASE_URL: "http://example.com" }), true);
});

test("configuração pública exige origem HTTPS limpa em produção", () => {
  assert.equal(publicAppOrigin({ NODE_ENV: "production", APP_BASE_URL: "https://app.example.com/" }), "https://app.example.com");
  assert.throws(() => publicAppOrigin({ NODE_ENV: "production", APP_BASE_URL: "http://app.example.com" }), /HTTPS/);
  assert.throws(() => publicAppOrigin({ NODE_ENV: "production", APP_BASE_URL: "https://user:pass@app.example.com" }), /apenas a origem/);
  assert.throws(() => publicAppOrigin({ NODE_ENV: "production", APP_BASE_URL: "https://app.example.com/path" }), /apenas a origem/);
  assert.throws(() => publicAppOrigin({ NODE_ENV: "production" }), /não está configurada/);
});

test("produção exige também a configuração canônica de recuperação", () => {
  assert.throws(() => validateProductionConfiguration({ NODE_ENV: "production", APP_BASE_URL: "https://app.example.com" }), /SITE_ADDRESS/);
  assert.throws(() => validateProductionConfiguration({ NODE_ENV: "production", APP_BASE_URL: "https://app.example.com", SITE_ADDRESS: "app.example.com" }), /RESEND_API_KEY/);
  assert.throws(() => validateProductionConfiguration({ NODE_ENV: "production", APP_BASE_URL: "https://app.example.com", SITE_ADDRESS: "app.example.com", RESEND_API_KEY: "key" }), /EMAIL_FROM/);
  assert.doesNotThrow(() => validateProductionConfiguration({
    NODE_ENV: "production",
    APP_BASE_URL: "https://app.example.com",
    SITE_ADDRESS: "app.example.com",
    RESEND_API_KEY: "key",
    EMAIL_FROM: "RangeLab <no-reply@example.com>",
  }));
});

test("produção rejeita proxy HTTP ou apontado para outra origem", () => {
  const base = {
    NODE_ENV: "production",
    APP_BASE_URL: "https://app.example.com",
    RESEND_API_KEY: "key",
    EMAIL_FROM: "RangeLab <no-reply@example.com>",
  };
  assert.throws(() => validateProductionConfiguration({ ...base, SITE_ADDRESS: ":80" }), /HTTPS/);
  assert.throws(() => validateProductionConfiguration({ ...base, SITE_ADDRESS: "http://app.example.com" }), /HTTPS/);
  assert.throws(() => validateProductionConfiguration({ ...base, SITE_ADDRESS: "other.example.com" }), /mesma origem/);
  assert.throws(() => validateProductionConfiguration({ ...base, APP_BASE_URL: "https://app.example.com:80", SITE_ADDRESS: "app.example.com:80" }), /porta HTTPS 443/);
  assert.throws(() => validateProductionConfiguration({ ...base, APP_BASE_URL: "https://app.example.com:8443", SITE_ADDRESS: "app.example.com:8443" }), /porta HTTPS 443/);
  assert.doesNotThrow(() => validateProductionConfiguration({ ...base, SITE_ADDRESS: "app.example.com:443" }));
  assert.doesNotThrow(() => validateProductionConfiguration({ ...base, SITE_ADDRESS: "https://app.example.com" }));
});

test("proxy remove o header Cloudflare forjável e o rate limit usa o X-Forwarded-For sanitizado", () => {
  const caddyfile = readFileSync(new URL("../Caddyfile", import.meta.url), "utf8");
  assert.match(caddyfile, /header_up\s+-CF-Connecting-IP/);

  const forwarded = new Request("https://app.example.com", {
    headers: { "x-forwarded-for": "198.51.100.10", "cf-connecting-ip": "203.0.113.99" },
  });
  assert.equal(authRateLimitClientIp(forwarded), "198.51.100.10");
  assert.equal(authRateLimitClientIp(new Request("https://app.example.com", { headers: { "cf-connecting-ip": "203.0.113.99" } })), "unknown");
});

test("token de recuperação aceita somente os 32 bytes em base64url emitidos pelo servidor", () => {
  assert.equal(isPasswordResetToken("A".repeat(43)), true);
  assert.equal(isPasswordResetToken(`${"A".repeat(41)}-_`), true);
  assert.equal(isPasswordResetToken("A".repeat(42)), false);
  assert.equal(isPasswordResetToken("A".repeat(44)), false);
  assert.equal(isPasswordResetToken(`${"A".repeat(42)}=`), false);
  assert.equal(isPasswordResetToken(123), false);
});

test("token de confirmação usa o mesmo formato aleatório estrito", () => {
  assert.equal(isEmailVerificationToken("A".repeat(43)), true);
  assert.equal(isEmailVerificationToken("A".repeat(42)), false);
  assert.equal(isEmailVerificationToken(`${"A".repeat(42)}=`), false);
  assert.equal(isEmailVerificationToken(null), false);
});

test("instrumentation falha antes do servidor aceitar tráfego com configuração insegura", () => {
  const previous = Object.fromEntries(["NEXT_RUNTIME", "NODE_ENV", "APP_BASE_URL", "SITE_ADDRESS", "RESEND_API_KEY", "EMAIL_FROM", "ALLOW_INSECURE_LOCAL_HTTP"].map((name) => [name, process.env[name]]));
  try {
    setEnvironment("NEXT_RUNTIME", "nodejs");
    setEnvironment("NODE_ENV", "production");
    setEnvironment("APP_BASE_URL", "https://app.example.com");
    setEnvironment("SITE_ADDRESS", ":80");
    setEnvironment("RESEND_API_KEY", "key");
    setEnvironment("EMAIL_FROM", "RangeLab <no-reply@example.com>");
    setEnvironment("ALLOW_INSECURE_LOCAL_HTTP", undefined);
    assert.throws(() => register(), /SITE_ADDRESS/);
  } finally {
    for (const [name, value] of Object.entries(previous)) restoreEnvironment(name, value);
  }
});

function restoreEnvironment(name: string, value: string | undefined) {
  setEnvironment(name, value);
}

function setEnvironment(name: string, value: string | undefined) {
  const environment = process.env as Record<string, string | undefined>;
  if (value === undefined) delete environment[name];
  else environment[name] = value;
}
