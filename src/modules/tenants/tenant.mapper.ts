import {
  TenantDomainStatus,
  TenantStatus,
  TenantType,
} from "@prisma/client";
export function mapTenant(tenant: {
  uuid: string;
  name: string;
  slug: string;
  type: TenantType;
  status: TenantStatus;
  createdAt: Date;
  domains?: {
    purpose: "MANAGEMENT" | "WEBSITE";
    hostname: string | null;
    status: TenantDomainStatus;
    verifiedAt?: Date | null;
  }[];
  localDevelopmentAssignment?: { hostname: string } | null;
  _count?: { memberships: number };
}) {
  return {
    id: tenant.uuid,
    uuid: tenant.uuid,
    name: tenant.name,
    slug: tenant.slug,
    type: tenant.type,
    status: tenant.status,
    createdAt: tenant.createdAt.toISOString(),
    managementDomain:
      tenant.domains?.find((domain) => domain.purpose === "MANAGEMENT")
        ?.hostname ?? null,
    websiteDomain:
      tenant.domains?.find((domain) => domain.purpose === "WEBSITE")?.hostname ??
      null,
    managementDomainStatus:
      tenant.domains === undefined
        ? null
        : tenant.domains.find((domain) => domain.purpose === "MANAGEMENT")?.status ?? TenantDomainStatus.DISABLED,
    websiteDomainStatus:
      tenant.domains === undefined
        ? null
        : tenant.domains.find((domain) => domain.purpose === "WEBSITE")?.status ?? TenantDomainStatus.DISABLED,
    managementDomainVerifiedAt:
      tenant.domains?.find((domain) => domain.purpose === "MANAGEMENT")?.verifiedAt?.toISOString() ?? null,
    websiteDomainVerifiedAt:
      tenant.domains?.find((domain) => domain.purpose === "WEBSITE")?.verifiedAt?.toISOString() ?? null,
    localDevelopmentHostname: tenant.localDevelopmentAssignment?.hostname ?? null,
    userCount: tenant._count?.memberships ?? 0,
  };
}

