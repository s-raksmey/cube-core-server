import { getMe } from "@/src/modules/auth/auth.service";
import { jsonError } from "@/src/lib/auth/http";
import { resolveSessionFromAccessToken } from "@/src/modules/auth/session.service";

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;
    if (!token) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const session = await resolveSessionFromAccessToken(token);
    const user = await getMe(session.userId, session.tenantId);
    return Response.json({ user });
  } catch (error) {
    return jsonError(error, 401);
  }
}
