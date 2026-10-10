import { z } from "zod";
import { loginWithPassword } from "@/src/modules/auth/auth.service";
import { correlationIdFrom, jsonError } from "@/src/lib/auth/http";

const bodySchema = z.object({
  /** Username or email. */
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1),
  audience: z.enum(["ADMIN_CONSOLE", "TENANT_APP"]).default("ADMIN_CONSOLE"),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: "Invalid email or password" }, { status: 400 });
    }

    const result = await loginWithPassword(
      parsed.data.email,
      parsed.data.password,
      parsed.data.audience,
      correlationIdFrom(request) ?? undefined,
    );

    return Response.json(result);
  } catch (error) {
    return jsonError(error, 401);
  }
}
