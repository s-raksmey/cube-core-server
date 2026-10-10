import { z } from "zod";
import { completeActivationCredentials } from "@/src/modules/auth/activation.service";
import { correlationIdFrom, jsonError } from "@/src/lib/auth/http";
import { passwordPolicySchema } from "@/src/lib/auth/password";

const bodySchema = z.object({
  token: z.string().min(1),
  username: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      "Username may only contain letters, numbers, dots, underscores, and hyphens",
    ),
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

    const result = await completeActivationCredentials({
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
