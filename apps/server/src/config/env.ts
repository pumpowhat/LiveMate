export const DEFAULT_DEMO_SELLER_EMAIL = "demo@livemate.vn";
export const DEFAULT_DEMO_SELLER_PASSWORD = "livemate-demo";
export const MIN_AUTH_SECRET_LENGTH = 32;
export const MIN_PROD_DEMO_PASSWORD_LENGTH = 12;

export interface DemoSeedConfig {
  email: string;
  password: string;
  explicitPassword: boolean;
}

export function resolveDemoSeedConfig(env: NodeJS.ProcessEnv = process.env): DemoSeedConfig {
  const isProduction = env.NODE_ENV === "production";
  const email = (env.DEMO_SELLER_EMAIL ?? DEFAULT_DEMO_SELLER_EMAIL).trim().toLowerCase() || DEFAULT_DEMO_SELLER_EMAIL;
  const rawPassword = env.DEMO_SELLER_PASSWORD;
  const explicitPassword = typeof rawPassword === "string" && rawPassword.length > 0;

  if (isProduction) {
    if (!explicitPassword) {
      throw new Error("DEMO_SELLER_PASSWORD is required in production (at least 12 characters, cannot be livemate-demo)");
    }
    if (rawPassword === DEFAULT_DEMO_SELLER_PASSWORD || rawPassword.trim() === DEFAULT_DEMO_SELLER_PASSWORD) {
      throw new Error("DEMO_SELLER_PASSWORD cannot be the default 'livemate-demo' in production");
    }
    if (rawPassword.length < MIN_PROD_DEMO_PASSWORD_LENGTH) {
      throw new Error(`DEMO_SELLER_PASSWORD must be at least ${MIN_PROD_DEMO_PASSWORD_LENGTH} characters in production`);
    }
    return { email, password: rawPassword, explicitPassword: true };
  }

  return {
    email,
    password: explicitPassword ? rawPassword : DEFAULT_DEMO_SELLER_PASSWORD,
    explicitPassword,
  };
}

export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const isProduction = env.NODE_ENV === "production";
  const secret = env.AUTH_SECRET?.trim() ?? "";
  if (isProduction) {
    if (secret.length < MIN_AUTH_SECRET_LENGTH) {
      throw new Error(`AUTH_SECRET is required in production and must be at least ${MIN_AUTH_SECRET_LENGTH} characters`);
    }
    return secret;
  }
  return secret || undefined;
}
