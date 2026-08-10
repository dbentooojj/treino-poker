type ServerEnvironment = {
  readonly NODE_ENV?: string;
  readonly APP_BASE_URL?: string;
  readonly SITE_ADDRESS?: string;
  readonly RESEND_API_KEY?: string;
  readonly EMAIL_FROM?: string;
  readonly ALLOW_INSECURE_LOCAL_HTTP?: string;
};

export function publicAppOrigin(environment: ServerEnvironment = process.env, fallbackUrl?: string) {
  const configured = environment.APP_BASE_URL?.trim();
  const candidate = configured || (environment.NODE_ENV === "production" ? "" : fallbackUrl?.trim());
  if (!candidate) throw new Error("APP_BASE_URL não está configurada.");

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("APP_BASE_URL deve ser uma URL absoluta válida.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("APP_BASE_URL deve usar HTTP ou HTTPS.");
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw new Error("APP_BASE_URL deve conter apenas a origem pública, sem credenciais, caminho, query ou fragmento.");
  }
  if (environment.NODE_ENV === "production" && url.protocol !== "https:" && !allowsInsecureLocalHttp(environment, url)) {
    throw new Error("APP_BASE_URL deve usar HTTPS em produção.");
  }
  return url.origin;
}

export function secureCookiesRequired(environment: ServerEnvironment = process.env) {
  const configured = environment.APP_BASE_URL?.trim();
  if (environment.NODE_ENV === "production") {
    if (!configured) return true;
    try {
      return !allowsInsecureLocalHttp(environment, new URL(configured));
    } catch {
      return true;
    }
  }
  if (!configured) return false;
  try {
    return new URL(configured).protocol === "https:";
  } catch {
    return false;
  }
}

export function validateProductionConfiguration(environment: ServerEnvironment = process.env) {
  if (environment.NODE_ENV !== "production") {
    if (environment.APP_BASE_URL?.trim()) publicAppOrigin(environment);
    return;
  }
  const appOrigin = publicAppOrigin(environment);
  if (allowsInsecureLocalHttp(environment, new URL(appOrigin))) {
    validateLocalSiteAddress(environment.SITE_ADDRESS, appOrigin);
    return;
  }
  validateProductionSiteAddress(environment.SITE_ADDRESS, appOrigin);
  if (!environment.RESEND_API_KEY?.trim()) throw new Error("RESEND_API_KEY não está configurada.");
  if (!environment.EMAIL_FROM?.trim()) throw new Error("EMAIL_FROM não está configurada.");
}

function allowsInsecureLocalHttp(environment: ServerEnvironment, url: URL) {
  return environment.ALLOW_INSECURE_LOCAL_HTTP?.trim().toLowerCase() === "true"
    && url.protocol === "http:"
    && isPrivateOrLoopbackHost(url.hostname);
}

function isPrivateOrLoopbackHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "[::1]" || normalized === "::1") return true;
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

function validateLocalSiteAddress(value: string | undefined, appOrigin: string) {
  const configured = value?.trim();
  if (!configured) throw new Error("SITE_ADDRESS não está configurada para o modo HTTP local.");
  if (configured === ":80") return;
  let site: URL;
  try {
    site = new URL(configured);
  } catch {
    throw new Error("SITE_ADDRESS local deve ser :80 ou a mesma origem HTTP privada de APP_BASE_URL.");
  }
  if (site.protocol !== "http:" || site.origin !== appOrigin || site.username || site.password || site.search || site.hash || (site.pathname && site.pathname !== "/")) {
    throw new Error("SITE_ADDRESS local deve ser :80 ou a mesma origem HTTP privada de APP_BASE_URL.");
  }
}

function validateProductionSiteAddress(value: string | undefined, appOrigin: string) {
  const configured = value?.trim();
  if (!configured) throw new Error("SITE_ADDRESS não está configurada.");
  let site: URL;
  try {
    site = new URL(configured.includes("://") ? configured : `https://${configured}`);
  } catch {
    throw new Error("SITE_ADDRESS deve ser um endereço HTTPS válido.");
  }
  if (site.protocol !== "https:" || site.username || site.password || site.search || site.hash || (site.pathname && site.pathname !== "/")) {
    throw new Error("SITE_ADDRESS deve conter somente o endereço HTTPS público.");
  }
  if (site.port && site.port !== "443") {
    throw new Error("SITE_ADDRESS deve usar a porta HTTPS 443 exposta pelo Compose.");
  }
  if (site.origin !== appOrigin) throw new Error("SITE_ADDRESS e APP_BASE_URL devem representar a mesma origem HTTPS.");
}
