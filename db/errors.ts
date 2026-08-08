export function hasPostgresErrorCode(error: unknown, expectedCode: string) {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    if ("code" in current && (current as { code?: unknown }).code === expectedCode) return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}
