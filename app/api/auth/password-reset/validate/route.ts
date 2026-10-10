import { validatePasswordResetToken } from "@/src/modules/auth/password-reset.service";
import { jsonError } from "@/src/lib/auth/http";

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) {
      return Response.json({ error: "Invalid or expired reset link" }, { status: 400 });
    }
    const result = await validatePasswordResetToken(token);
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return jsonError(error, 401);
  }
}
