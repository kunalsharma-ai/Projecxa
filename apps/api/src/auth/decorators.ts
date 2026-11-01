import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthUser } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Restrict an endpoint to these roles. ADMIN always passes. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** Internal staff roles that can use the PM application. */
export const STAFF: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER'];
/** Roles that can change projects and redirect settings. */
export const EDITORS: Role[] = ['ADMIN', 'PROJECT_MANAGER'];

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
