import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { InstructorPermission } from "./permissions";

export async function isAssignedToSession(userId: string, classSessionId: string) {
  const row = await prisma.sessionInstructor.findUnique({
    where: {
      classSessionId_userId: { classSessionId, userId },
    },
  });
  return Boolean(row);
}

export async function assertOwner(user: User) {
  if (user.role !== "OWNER") {
    throw new AuthzError("Owner access required");
  }
}

export async function hasInstructorPermission(
  userId: string,
  key: InstructorPermission,
) {
  const row = await prisma.userPermission.findUnique({
    where: { userId_key: { userId, key } },
  });
  return Boolean(row);
}

export async function assertSessionAccess(
  user: User,
  classSessionId: string,
  permission: InstructorPermission,
) {
  if (user.role === "OWNER") return;
  const assigned = await isAssignedToSession(user.id, classSessionId);
  if (!assigned) {
    throw new AuthzError("Not assigned to this class");
  }
  const allowed = await hasInstructorPermission(user.id, permission);
  if (!allowed) {
    throw new AuthzError("Missing permission");
  }
}

export class AuthzError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthzError";
  }
}
