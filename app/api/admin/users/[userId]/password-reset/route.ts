import { TenantType } from "@prisma/client";
import {
  generateMainTenantUserPasswordResetLink,
  generateSubTenantUserPasswordResetLink,
} from "@/src/modules/auth/password-reset.service";
import { findAccountByUuid } from "@/src/modules/users/account";
import { correlationIdFrom, jsonError } from "@/src/lib/auth/http";
import { resolveSessionFromAccessToken } from "@/src/modules/auth/session.service";
import { validationError } from "@/src/lib/errors";

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;
    if (!token) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const session = await resolveSessionFromAccessToken(token);
    const { userId } = await context.params;
    const correlationId = correlationIdFrom(request) ?? undefined;

    const account = await findAccountByUuid(userId);
    if (!account) throw validationError("User not found");

    const result =
      account.tenant.type === TenantType.MAIN
        ? await generateMainTenantUserPasswordResetLink(
            session,
            userId,
            correlationId,
          )
        : await generateSubTenantUserPasswordResetLink(
            session,
            userId,
            correlationId,
          );

    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error, 403);
  }
}
