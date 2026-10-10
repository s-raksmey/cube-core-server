import { jsonError } from "@/src/lib/auth/http";
import { resolveSessionFromAccessToken } from "@/src/modules/auth/session.service";
import { revokeSessionById } from "@/src/modules/auth/session.service";
import { writeAuthAudit } from "@/src/modules/auth/audit-auth";

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;
    if (!token) {
      return Response.json({ success: true });
    }

    try {
      const session = await resolveSessionFromAccessToken(token);
      await revokeSessionById(session.sessionId);
      await writeAuthAudit({
        action: "auth.logout",
        actorUserUuid: session.userId,
        tenantUuid: session.tenantId,
      });
    } catch {
      // idempotent logout
    }

    return Response.json({ success: true });
  } catch (error) {
    return jsonError(error, 400);
  }
}
