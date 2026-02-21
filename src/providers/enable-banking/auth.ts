import jwt from "jsonwebtoken";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Generate a JWT for Enable Banking API authentication.
 *
 * RS256 with kid=appId in the header. Tokens live 1 hour.
 * A fresh token is generated per request — no caching needed
 * since generation is sub-millisecond.
 */
export function generateJwt(appId: string, privateKeyPath: string): string {
  const expandedPath = privateKeyPath.replace(/^~/, process.env.HOME || "");
  const privateKey = readFileSync(resolve(expandedPath), "utf-8");

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat: now,
    exp: now + 3600,
  };

  return jwt.sign(payload, privateKey, {
    algorithm: "RS256",
    header: {
      alg: "RS256",
      typ: "JWT",
      kid: appId,
    },
  });
}
