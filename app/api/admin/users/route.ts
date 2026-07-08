import { NextResponse } from "next/server";
import type { ManagedUser } from "@/lib/admin";
import { normalizeSubscriptionTier, normalizeUsername, seedUsers, userIdFromUsername } from "@/lib/admin";
import { deleteManagedUser, hasDatabase, listManagedUsers, markManagedUserLogin, upsertManagedUser } from "@/lib/db";
import { publicUser, requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

function normalizeUser(body: Partial<ManagedUser>): ManagedUser {
  const now = new Date().toISOString();
  const username = normalizeUsername(String(body.username || ""));
  return {
    id: body.id || userIdFromUsername(username),
    username,
    password: String(body.password || ""),
    name: String(body.name || username || "User"),
    role: body.role === "admin" ? "admin" : "user",
    tier: normalizeSubscriptionTier(body.tier, body.role === "admin" ? "admin" : "user"),
    status: body.status === "inactive" ? "inactive" : "active",
    createdAt: body.createdAt || now,
    updatedAt: now,
    lastLoginAt: body.lastLoginAt
  };
}

function fallbackUsers(extra?: ManagedUser) {
  const records = extra ? [extra, ...seedUsers.filter((user) => user.username !== extra.username)] : seedUsers;
  return records.sort((a, b) => `${a.role}-${a.username}`.localeCompare(`${b.role}-${b.username}`));
}

function publicUsers(records: ManagedUser[]) {
  return records.map(publicUser);
}

async function resolveExistingUser(user: ManagedUser) {
  const records = hasDatabase() ? await listManagedUsers() : seedUsers;
  return records.find((item) => item.id === user.id || normalizeUsername(item.username) === normalizeUsername(user.username));
}

export async function GET(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;
  if (!hasDatabase()) {
    return NextResponse.json({ records: publicUsers(seedUsers), warning: "Database is not configured. Using built-in initial users." });
  }
  const records = await listManagedUsers();
  return NextResponse.json({ records: publicUsers(records) });
}

export async function POST(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;
  try {
    const body = (await request.json()) as Partial<ManagedUser> & { login?: boolean };
    const user = normalizeUser(body);
    const existing = await resolveExistingUser(user).catch(() => undefined);
    if (!user.password && existing?.password) {
      user.password = existing.password;
    }
    if (!user.username || !user.password || !user.name) {
      return NextResponse.json({ error: "Username, password, and display name are required for new users." }, { status: 400 });
    }

    if (hasDatabase()) {
      if (body.login) {
        await markManagedUserLogin(user.username);
      } else {
        await upsertManagedUser(user);
      }
      const records = await listManagedUsers();
      return NextResponse.json({ ok: true, records: publicUsers(records) });
    }

    return NextResponse.json({
      ok: true,
      records: publicUsers(fallbackUsers(user)),
      warning: "Database is not configured. User is stored locally for this session only."
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save user." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const auth = requireAuth(request, ["admin"]);
  if ("response" in auth) return auth.response;
  try {
    const body = (await request.json()) as { id?: string };
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "User id is required." }, { status: 400 });
    if (id === "user-admin-rsm") {
      return NextResponse.json({ error: "The default admin user cannot be deleted." }, { status: 400 });
    }
    if (hasDatabase()) {
      await deleteManagedUser(id);
      const records = await listManagedUsers();
      return NextResponse.json({ ok: true, records: publicUsers(records) });
    }
    return NextResponse.json({
      ok: true,
      records: publicUsers(seedUsers.filter((user) => user.id !== id)),
      warning: "Database is not configured. Delete is local-session only."
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete user." },
      { status: 500 }
    );
  }
}
