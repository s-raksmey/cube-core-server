import { toIso } from "@/src/graphql/helpers";

export const typeResolvers = {
  LoginResult: {
    __resolveType(value: { challengeToken?: string; accessToken?: string }) {
      if (value.challengeToken) return "AuthChallenge";
      if (value.accessToken) return "AuthPayload";
      return null;
    },
  },
  Tenant: {
    id: (parent: { id?: string; uuid?: string }) => parent.id ?? parent.uuid,
    createdAt: (parent: { createdAt: Date | string }) => toIso(parent.createdAt),
  },
  User: {
    id: (parent: { id?: string; uuid?: string }) => parent.id ?? parent.uuid,
    createdAt: (parent: { createdAt?: Date | string | null }) =>
      parent.createdAt ? toIso(parent.createdAt) : null,
  },
  ActivityItem: {
    createdAt: (parent: { createdAt: Date | string }) => toIso(parent.createdAt),
  },
};
