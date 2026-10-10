import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";

export async function writeAuthAudit(input: {
  action: string;
  actorUserUuid?: string | null;
  tenantUuid?: string | null;
  targetType?: string | null;
  targetUuid?: string | null;
  correlationId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({
    data: {
      actorUserUuid: input.actorUserUuid ?? null,
      tenantUuid: input.tenantUuid ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetUuid: input.targetUuid ?? null,
      requestId: input.correlationId ?? null,
      metadata: input.metadata ?? {},
    },
  });
}
