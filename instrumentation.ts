import { validateProductionConfiguration } from "./lib/server-config";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") validateProductionConfiguration();
}
