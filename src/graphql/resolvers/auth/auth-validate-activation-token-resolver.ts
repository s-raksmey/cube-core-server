import { validateActivationToken } from "@/src/modules/auth/activation.service";

export const authValidateActivationTokenResolver = {
  Query: {
    validateActivationToken: async (_: unknown, args: { token: string }) => {
      return validateActivationToken(args.token);
    },
  },
};
