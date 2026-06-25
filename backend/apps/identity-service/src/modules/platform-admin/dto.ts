import { z } from "zod";

export const platformLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;

export const platformRefreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type PlatformRefreshInput = z.infer<typeof platformRefreshSchema>;

export const platformLogoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export type PlatformLogoutInput = z.infer<typeof platformLogoutSchema>;

/** Claims embedded in the platform (super-admin) access JWT. */
export interface PlatformClaims {
  sub: string; // platform admin id
  scope: "platform";
  role: string;
  name: string;
  jti?: string;
}

export interface PlatformTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PlatformProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  lastLoginAt: string | null;
}

/** The minimal admin shape the token service needs to mint a session. */
export interface PlatformPrincipal {
  id: string;
  role: string;
  name: string;
}

/** DI token for the platform-scoped access-token denylist (its own TTL). */
export const PLATFORM_DENYLIST = Symbol("PLATFORM_DENYLIST");
