import { prisma } from "@/lib/prisma";

export async function getOrganization() {
  const org = await prisma.organization.findFirst();
  if (!org) {
    throw new Error("Organization is not seeded");
  }
  return org;
}

export async function getSettings() {
  const org = await getOrganization();
  const settings = await prisma.platformSetting.findUnique({
    where: { organizationId: org.id },
  });
  if (!settings) {
    throw new Error("Platform settings are not seeded");
  }
  return settings;
}

export async function getCurrentPolicy() {
  const org = await getOrganization();
  const policy = await prisma.policyVersion.findFirst({
    where: { organizationId: org.id },
    orderBy: { effectiveAt: "desc" },
  });
  if (!policy) {
    throw new Error("Policy version is not seeded");
  }
  return policy;
}

export function resolveSessionPrice(
  session: { priceOverrideCents: number | null; protectionOverrideCents: number | null },
  settings: { defaultClassPriceCents: number; extendedProtectionPriceCents: number },
) {
  return {
    classPriceCents: session.priceOverrideCents ?? settings.defaultClassPriceCents,
    protectionPriceCents:
      session.protectionOverrideCents ?? settings.extendedProtectionPriceCents,
    currency: settings.currency,
  };
}
