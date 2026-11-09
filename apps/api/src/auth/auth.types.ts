import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  organizationId: string;
  role: Role;
  email: string;
  name: string;
  /** Runs the SampTrek server (docs/SUPER_ADMIN.md). */
  superAdmin?: boolean;
  /** The Super Admin is looking at this organisation read-only (docs/SUPER_ADMIN_OBSERVE.md); organizationId is that organisation. */
  observing?: { organizationId: string; name: string; homeOrganizationId: string };
}
