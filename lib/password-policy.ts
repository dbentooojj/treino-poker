export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;

export function passwordPolicyError(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    return `A senha deve ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres.`;
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "A senha precisa ter pelo menos um caractere especial.";
  }
  return null;
}
