import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import type { ManagedUser, UserRole } from "./admin";

export const AUTH_COOKIE_NAME = "tdp_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type AppSession = {
  sub: string;
  username: string;
  name: string;
  role: UserRole;
  iat: number;
  exp: number;
};

type CookieStoreLike = {
  get(name: string): { value: string } | undefined;
};

function isLocalHost(request?: Request) {
  const host = request?.headers.get("host") || "";
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::|$)/i.test(host);
}

function useSecureCookie(request?: Request) {
  if (isLocalHost(request)) return false;
  if (process.env.TDP_SECURE_COOKIES === "false") return false;
  if (process.env.TDP_SECURE_COOKIES === "true") return true;
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}

function authSecret() {
  return (
    process.env.TDP_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.OPENAI_API_KEY ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    "tax-dispute-agentic-advisor-dev-secret"
  );
}

export function hasExplicitAuthSecret() {
  return Boolean(process.env.TDP_AUTH_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET);
}

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function signPayload(payload: string) {
  return createHmac("sha256", authSecret()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function publicUser(user: ManagedUser): ManagedUser {
  return { ...user, password: "" };
}

export function createSessionToken(user: Pick<ManagedUser, "id" | "username" | "name" | "role">) {
  const now = Math.floor(Date.now() / 1000);
  const payload = encodeJson({
    sub: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + SESSION_TTL_SECONDS
  } satisfies AppSession);
  return `${payload}.${signPayload(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): AppSession | null {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, signPayload(payload))) return null;
  const session = decodeJson<AppSession>(payload);
  if (!session || !session.username || !session.name || !session.role || !session.exp) return null;
  if (session.role !== "admin" && session.role !== "user") return null;
  if (session.exp < Math.floor(Date.now() / 1000)) return null;
  return session;
}

export function sessionFromCookieHeader(cookieHeader: string | null) {
  const cookie = String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`));
  return verifySessionToken(cookie ? decodeURIComponent(cookie.slice(AUTH_COOKIE_NAME.length + 1)) : "");
}

export function sessionFromRequest(request: Request) {
  return sessionFromCookieHeader(request.headers.get("cookie"));
}

export function sessionFromCookieStore(cookieStore: CookieStoreLike) {
  return verifySessionToken(cookieStore.get(AUTH_COOKIE_NAME)?.value);
}

export function setSessionCookie(response: NextResponse, token: string, request?: Request) {
  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookie(request),
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export function clearSessionCookie(response: NextResponse, request?: Request) {
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookie(request),
    path: "/",
    maxAge: 0
  });
}

export function requireAuth(request: Request, roles?: UserRole[]) {
  const session = sessionFromRequest(request);
  if (!session) {
    return {
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 })
    };
  }
  if (roles?.length && !roles.includes(session.role)) {
    return {
      response: NextResponse.json({ error: "Admin access required." }, { status: 403 })
    };
  }
  return { session };
}
