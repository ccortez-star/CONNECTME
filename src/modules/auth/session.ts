import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "staff_session";
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export async function createStaffSession(userId: string) {
  const session = await prisma.staffSession.create({
    data: {
      userId,
      expiresAt: new Date(Date.now() + TWELVE_HOURS_MS),
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
}

export async function destroyStaffSession() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) {
    await prisma.staffSession.deleteMany({ where: { id } });
  }
  jar.delete(SESSION_COOKIE);
}

export async function getStaffUser() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const session = await prisma.staffSession.findUnique({
    where: { id },
    include: { user: { include: { permissions: true, assignments: true } } },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) {
    if (session) {
      await prisma.staffSession.delete({ where: { id } }).catch(() => undefined);
    }
    return null;
  }
  return session.user;
}

export async function requireStaffUser() {
  const user = await getStaffUser();
  if (!user) {
    throw new Error("UNAUTHENTICATED");
  }
  return user;
}
