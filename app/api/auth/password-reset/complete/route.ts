import { z } from "zod";
import { completePasswordReset } from "@/src/modules/auth/password-reset.service";
import { correlationIdFrom, jsonError } from "@/src/lib/auth/http";
import { passwordPolicySchema } from "@/src/lib/auth/password";

const bodySchema = z.object({
  token: z.string().min(1),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  fullName: z.string().trim().min(1).optional(),
  password: passwordPolicySchema,
  confirmPassword: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const result = await completePasswordReset({
      ...parsed.data,
      correlationId: correlationIdFrom(request) ?? undefined,
    });

    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error, 400);
  }
}
