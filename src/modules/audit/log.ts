import { prisma } from "@/lib/prisma";

export async function writeAudit(input: {
  organizationId: string;
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  previous?: unknown;
  next?: unknown;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      previousJson: JSON.stringify(input.previous ?? {}),
      newJson: JSON.stringify(input.next ?? {}),
    },
  });
}
