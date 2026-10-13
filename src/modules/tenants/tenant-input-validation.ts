import { z } from "zod";
import {
  LOCAL_DEVELOPMENT_HOSTNAME,
} from "@/src/modules/tenants/local-development-tenant.service";
import { normalizeTenantHostname } from "@/src/modules/tenants/tenant-domain.service";
function optionalHostname() {
  return z.preprocess(
    (value) => (typeof value === "string" && !value.trim() ? null : value),
    z
      .string()
      .trim()
      .transform((value, ctx) => {
        const normalized = normalizeTenantHostname(value);
        if (!normalized) {
          ctx.addIssue({
            code: "custom",
            message: "Enter a valid hostname without a protocol, port, or path",
          });
          return z.NEVER;
        }
        return normalized;
      })
      .nullable()
      .optional(),
  );
}

const tenantDomainsSchema = {
  managementDomain: optionalHostname(),
  websiteDomain: optionalHostname(),
};

const localDevelopmentHostnameSchema = z.preprocess(
  (value) => (typeof value === "string" && !value.trim() ? null : value),
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (value !== LOCAL_DEVELOPMENT_HOSTNAME) {
        ctx.addIssue({
          code: "custom",
          message: "Local development hostname must be localhost or empty",
        });
        return z.NEVER;
      }
      return value;
    })
    .nullable()
    .optional(),
);

function rejectDuplicateDomains<T extends {
  managementDomain?: string | null;
  websiteDomain?: string | null;
}>(schema: z.ZodType<T>) {
  return schema.superRefine((value, ctx) => {
    for (const field of ["managementDomain", "websiteDomain"] as const) {
      const hostname = value[field];
      if (hostname === "localhost" || hostname?.endsWith(".localhost")) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message:
            "Localhost is shared by all local tenants and cannot be configured as a custom domain",
        });
      }
    }
    if (
      value.managementDomain &&
      value.managementDomain === value.websiteDomain
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["websiteDomain"],
        message: "Management and public domains must be different",
      });
    }
    const sharedTenantAppUrl = process.env.TENANT_APP_URL;
    if (value.managementDomain && sharedTenantAppUrl) {
      try {
        const sharedHostname = normalizeTenantHostname(
          new URL(sharedTenantAppUrl).hostname,
        );
        if (sharedHostname === value.managementDomain) {
          ctx.addIssue({
            code: "custom",
            path: ["managementDomain"],
            message: "The shared tenant app hostname cannot be assigned to one tenant",
          });
        }
      } catch {
        // Invalid deployment configuration does not weaken input validation.
      }
    }
  });
}

export const createSubTenantSchema = rejectDuplicateDomains(z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
  ...tenantDomainsSchema,
}));

export const updateSubTenantSchema = rejectDuplicateDomains(z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
  ...tenantDomainsSchema,
  localDevelopmentHostname: localDevelopmentHostnameSchema,
}));

