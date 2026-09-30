"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createStaffSession, destroyStaffSession, getStaffUser } from "@/modules/auth/session";
import { writeAudit } from "@/modules/audit/log";
import { getOrganization } from "@/lib/settings";
import { INSTRUCTOR_PERMISSIONS, type InstructorPermission } from "@/modules/authz/permissions";
import { assertOwner, AuthzError } from "@/modules/authz";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = await prisma.user.findFirst({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "Invalid email or password" };
  }
  await createStaffSession(user.id);
  redirect(user.role === "OWNER" ? "/admin" : "/instructor");
}

export async function logoutAction() {
  await destroyStaffSession();
  redirect("/login");
}

async function requireOwner() {
  const user = await getStaffUser();
  if (!user) redirect("/login");
  try {
    await assertOwner(user);
  } catch (e) {
    if (e instanceof AuthzError) redirect("/instructor");
    throw e;
  }
  return user;
}

export async function saveSettingsAction(formData: FormData) {
  const user = await requireOwner();
  const org = await getOrganization();
  const previous = await prisma.platformSetting.findUnique({
    where: { organizationId: org.id },
  });
  const data = {
    defaultClassPriceCents: Math.round(Number(formData.get("defaultClassPrice")) * 100),
    extendedProtectionPriceCents: Math.round(
      Number(formData.get("extendedProtectionPrice")) * 100,
    ),
    currency: String(formData.get("currency") ?? "USD").toUpperCase(),
    holdMinutes: Number(formData.get("holdMinutes") ?? 15),
  };
  await prisma.platformSetting.update({
    where: { organizationId: org.id },
    data,
  });
  await writeAudit({
    organizationId: org.id,
    userId: user.id,
    action: "pricing_changed",
    resourceType: "platform_setting",
    resourceId: org.id,
    previous,
    next: data,
  });
  redirect("/admin/settings");
}

export async function createInstructorAction(formData: FormData) {
  const actor = await requireOwner();
  const org = await getOrganization();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email,
      name,
      passwordHash: await bcrypt.hash(password, 12),
      role: "INSTRUCTOR",
    },
  });
  await writeAudit({
    organizationId: org.id,
    userId: actor.id,
    action: "instructor_created",
    resourceType: "user",
    resourceId: user.id,
    next: { email, name },
  });
  redirect(`/admin/instructors/${user.id}`);
}

export async function saveInstructorPermissionsAction(formData: FormData) {
  const actor = await requireOwner();
  const org = await getOrganization();
  const userId = String(formData.get("userId") ?? "");
  const previous = await prisma.userPermission.findMany({ where: { userId } });
  await prisma.userPermission.deleteMany({ where: { userId } });
  const keys = INSTRUCTOR_PERMISSIONS.filter(
    (key) => formData.get(key) === "on",
  ) as InstructorPermission[];
  if (keys.length) {
    await prisma.userPermission.createMany({
      data: keys.map((key) => ({ userId, key })),
    });
  }
  await writeAudit({
    organizationId: org.id,
    userId: actor.id,
    action: "permission_changed",
    resourceType: "user",
    resourceId: userId,
    previous: previous.map((p) => p.key),
    next: keys,
  });
  redirect(`/admin/instructors/${userId}`);
}

export async function createClassAction(formData: FormData) {
  const actor = await requireOwner();
  const org = await getOrganization();
  const settings = await prisma.platformSetting.findUniqueOrThrow({
    where: { organizationId: org.id },
  });
  const timezone = String(formData.get("timezone") ?? org.defaultTimezone);
  const startsAt = new Date(String(formData.get("startsAt")));
  const endsAt = new Date(String(formData.get("endsAt")));
  const priceRaw = String(formData.get("price") ?? "").trim();
  const protectionRaw = String(formData.get("protectionPrice") ?? "").trim();
  const created = await prisma.classSession.create({
    data: {
      organizationId: org.id,
      locationId: String(formData.get("locationId")),
      categoryId: String(formData.get("categoryId")),
      name: String(formData.get("name")).trim(),
      description: String(formData.get("description") ?? ""),
      startsAt,
      endsAt,
      timezone,
      capacity: Number(formData.get("capacity")),
      priceOverrideCents: priceRaw === "" ? null : Math.round(Number(priceRaw) * 100),
      protectionOverrideCents:
        protectionRaw === "" ? null : Math.round(Number(protectionRaw) * 100),
      status: String(formData.get("status") ?? "PUBLISHED"),
    },
  });
  const instructorId = String(formData.get("instructorId") ?? "");
  if (instructorId) {
    await prisma.sessionInstructor.create({
      data: { classSessionId: created.id, userId: instructorId },
    });
  }
  await writeAudit({
    organizationId: org.id,
    userId: actor.id,
    action: "class_created",
    resourceType: "class_session",
    resourceId: created.id,
    next: { name: created.name, defaultPrice: settings.defaultClassPriceCents },
  });
  redirect("/admin/classes");
}

export async function updateClassAction(formData: FormData) {
  const actor = await requireOwner();
  const org = await getOrganization();
  const id = String(formData.get("id"));
  const previous = await prisma.classSession.findUnique({ where: { id } });
  const priceRaw = String(formData.get("price") ?? "").trim();
  const protectionRaw = String(formData.get("protectionPrice") ?? "").trim();
  const updated = await prisma.classSession.update({
    where: { id },
    data: {
      locationId: String(formData.get("locationId")),
      categoryId: String(formData.get("categoryId")),
      name: String(formData.get("name")).trim(),
      description: String(formData.get("description") ?? ""),
      startsAt: new Date(String(formData.get("startsAt"))),
      endsAt: new Date(String(formData.get("endsAt"))),
      timezone: String(formData.get("timezone")),
      capacity: Number(formData.get("capacity")),
      priceOverrideCents: priceRaw === "" ? null : Math.round(Number(priceRaw) * 100),
      protectionOverrideCents:
        protectionRaw === "" ? null : Math.round(Number(protectionRaw) * 100),
      status: String(formData.get("status")),
    },
  });
  const instructorId = String(formData.get("instructorId") ?? "");
  await prisma.sessionInstructor.deleteMany({ where: { classSessionId: id } });
  if (instructorId) {
    await prisma.sessionInstructor.create({
      data: { classSessionId: id, userId: instructorId },
    });
  }
  await writeAudit({
    organizationId: org.id,
    userId: actor.id,
    action: previous?.status !== updated.status && updated.status === "CANCELED"
      ? "class_canceled"
      : "class_edited",
    resourceType: "class_session",
    resourceId: id,
    previous,
    next: updated,
  });
  redirect("/admin/classes");
}

export async function deleteClassAction(formData: FormData) {
  const actor = await requireOwner();
  const org = await getOrganization();
  const id = String(formData.get("id"));
  const previous = await prisma.classSession.findUnique({ where: { id } });
  await prisma.classSession.delete({ where: { id } });
  await writeAudit({
    organizationId: org.id,
    userId: actor.id,
    action: "class_deleted",
    resourceType: "class_session",
    resourceId: id,
    previous,
  });
  redirect("/admin/classes");
}
