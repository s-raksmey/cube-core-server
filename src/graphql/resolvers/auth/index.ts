import { mergeResolvers } from "@/src/graphql/helpers";
import { authMeResolver } from "@/src/graphql/resolvers/auth/auth-me-resolver";
import { authLoginResolver } from "@/src/graphql/resolvers/auth/auth-login-resolver";
import { authVerifyLoginTotpResolver } from "@/src/graphql/resolvers/auth/auth-verify-login-totp-resolver";
import { authVerifyTotpEnrollmentResolver } from "@/src/graphql/resolvers/auth/auth-verify-totp-enrollment-resolver";
import { authVerifyRecoveryCodeResolver } from "@/src/graphql/resolvers/auth/auth-verify-recovery-code-resolver";
import { authRefreshSessionResolver } from "@/src/graphql/resolvers/auth/auth-refresh-session-resolver";
import { authLogoutResolver } from "@/src/graphql/resolvers/auth/auth-logout-resolver";
import { authValidateActivationTokenResolver } from "@/src/graphql/resolvers/auth/auth-validate-activation-token-resolver";
import { authCompleteActivationResolver } from "@/src/graphql/resolvers/auth/auth-complete-activation-resolver";
import { authCompleteActivationTotpResolver } from "@/src/graphql/resolvers/auth/auth-complete-activation-totp-resolver";
import { authValidatePasswordResetTokenResolver } from "@/src/graphql/resolvers/auth/auth-validate-password-reset-token-resolver";
import { authCompletePasswordResetResolver } from "@/src/graphql/resolvers/auth/auth-complete-password-reset-resolver";
import { authGeneratePasswordResetLinkResolver } from "@/src/graphql/resolvers/auth/auth-generate-password-reset-link-resolver";

export const authResolvers = mergeResolvers(
  authMeResolver,
  authLoginResolver,
  authVerifyLoginTotpResolver,
  authVerifyTotpEnrollmentResolver,
  authVerifyRecoveryCodeResolver,
  authRefreshSessionResolver,
  authLogoutResolver,
  authValidateActivationTokenResolver,
  authCompleteActivationResolver,
  authCompleteActivationTotpResolver,
  authValidatePasswordResetTokenResolver,
  authCompletePasswordResetResolver,
  authGeneratePasswordResetLinkResolver,
);
