import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { UserRole } from "./types";

/**
 * Session applicative signée (HMAC-SHA256) : le tenant et le rôle sont TOUJOURS
 * résolus côté serveur depuis ce cookie — jamais transmis ni modifiables par le client.
 *
 * Le flag Secure dépend de SG_COOKIE_SECURE="true" (à activer derrière HTTPS) :
 * en HTTP local/LAN, un cookie Secure serait ignoré par le navigateur.
 */
export const SESSION_COOKIE = "sg_session";
export const SESSION_TTL_S = 60 * 60 * 12; // 12 h
const SECRET = process.env.SG_SECRET ?? "supergestion-dev-secret-change-in-prod";

export interface Session {
  tenant: string;
  username: string;
  displayName: string;
  role: UserRole;
  exp: number;
}

interface SessionInput {
  tenant: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export const ROLE_LABEL: Record<UserRole, string> = {
  CASHIER: "Caissier·ère",
  STOCK: "Gestionnaire stock",
  LOGISTICS: "Logistique",
  ADMIN: "Administrateur",
  SUPER_ADMIN: "Super admin",
};

let secretWarningShown = false;

/** Alerte (une fois par processus) si les sessions sont signées avec le secret de développement. */
export function warnDefaultSecretOnce(): void {
  if (secretWarningShown) return;
  secretWarningShown = true;
  if (!process.env.SG_SECRET) {
    console.warn(
      "[SuperGestion] ⚠ SG_SECRET non défini : les sessions sont signées avec le secret de développement. " +
        "Définissez SG_SECRET dans .env.local/environnement avant un usage réel.",
    );
  }
}

function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function encodeSession(input: Omit<Session, "exp">): string {
  const payload: Session = { ...input, exp: Date.now() + SESSION_TTL_S * 1000 };
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${data}.${sign(data)}`;
}

export function decodeSession(token: string | undefined | null): Session | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const mac = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(data));
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as Session;
    if (!payload?.tenant || !payload?.username || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  // Secure uniquement derrière HTTPS, sinon le navigateur ignore le cookie en HTTP local/LAN
  secure: process.env.SG_COOKIE_SECURE === "true",
  path: "/",
  maxAge: SESSION_TTL_S,
};
