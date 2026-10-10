import { z } from "zod";
import { verifyTotpEnrollment } from "@/src/modules/auth/totp.service";
import { correlationIdFrom, jsonError } from "@/src/lib/auth/http";

const bodySchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(6).max(12),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid verification code" }, { status: 400 });
    }

    const result = await verifyTotpEnrollment({
      challengeToken: parsed.data.challengeToken,
      code: parsed.data.code,
      correlationId: correlationIdFrom(request) ?? undefined,
    });

    return Response.json({
      status: "AUTHENTICATED",
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      audience: result.audience,
      user: result.user,
    });
  } catch (error) {
    return jsonError(error, 401);
  }
}
