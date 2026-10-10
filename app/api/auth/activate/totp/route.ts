import { z } from "zod";
import { completeActivationTotp } from "@/src/modules/auth/activation.service";
import { correlationIdFrom, jsonError } from "@/src/lib/auth/http";

const bodySchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(6).max(12),
  activationToken: z.string().min(1),
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

    const result = await completeActivationTotp({
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
