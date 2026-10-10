import { z } from "zod";
import { refreshAuthenticatedSession } from "@/src/modules/auth/session.service";
import { jsonError } from "@/src/lib/auth/http";
import { mapAuthUser } from "@/src/modules/users/account";

const bodySchema = z.object({
  refreshToken: z.string().min(1),
  audience: z.enum(["ADMIN_CONSOLE", "TENANT_APP"]),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid refresh request" }, { status: 400 });
    }

    const result = await refreshAuthenticatedSession(parsed.data);
    return Response.json({
      accessToken: result.accessToken,
      audience: result.audience,
      user: mapAuthUser(result.account),
    });
  } catch (error) {
    return jsonError(error, 401);
  }
}
