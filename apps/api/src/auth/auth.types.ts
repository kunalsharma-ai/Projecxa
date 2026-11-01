import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  organizationId: string;
  role: Role;
  email: string;
  name: string;
}
