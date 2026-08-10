import { createInitialAdmin, normalizeEmail } from "../db/auth";
import { closeDb } from "../db/index";
import { passwordPolicyError } from "../lib/password-policy";

const name = process.env.ADMIN_NAME?.trim() ?? "";
const email = normalizeEmail(process.env.ADMIN_EMAIL ?? "");
const password = process.env.ADMIN_PASSWORD ?? "";

try {
  if (name.length < 2 || name.length > 80) throw new Error("ADMIN_NAME deve ter entre 2 e 80 caracteres.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("ADMIN_EMAIL deve ser um e-mail válido.");
  const passwordError = passwordPolicyError(password);
  if (passwordError) throw new Error(`ADMIN_PASSWORD inválida: ${passwordError}`);

  const admin = await createInitialAdmin(name, email, password);
  console.info(`Administrador inicial criado: ${admin.email}`);
} finally {
  await closeDb();
}
