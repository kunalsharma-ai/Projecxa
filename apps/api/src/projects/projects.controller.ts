import { Body, Controller, Get, Module, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ProjectHistoryService } from './project-history';
import { ProjectDraftsController, ProjectTemplatesController } from './project-templates';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import {
  allocationSchema,
  cloneCountrySchema,
  countryInputSchema,
  createProjectSchema,
  CreateProjectInput,
  listQuerySchema,
  restoreSchema,
  updateAllocationSchema,
  updateCountrySchema,
  updateProjectSchema,
} from './projects.schemas';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    return this.projects.list(u, q);
  }

  @Post()
  @Roles(...EDITORS)
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createProjectSchema)) body: CreateProjectInput) {
    return this.projects.create(u, body);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.projects.get(u, id);
  }

  @Patch(':id')
  @Roles(...EDITORS)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateProjectSchema)) body: z.infer<typeof updateProjectSchema>) {
    return this.projects.update(u, id, body);
  }

  @Post(':id/countries')
  @Roles(...EDITORS)
  addCountry(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(countryInputSchema)) body: z.infer<typeof countryInputSchema>) {
    return this.projects.addCountry(u, id, body);
  }

  @Post(':id/countries/clone')
  @Roles(...EDITORS)
  clone(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(cloneCountrySchema)) body: z.infer<typeof cloneCountrySchema>) {
    return this.projects.cloneCountry(u, id, body);
  }

  @Patch(':id/countries/:countryId')
  @Roles(...EDITORS)
  updateCountry(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('countryId') countryId: string,
    @Body(new ZodPipe(updateCountrySchema)) body: z.infer<typeof updateCountrySchema>,
  ) {
    return this.projects.updateCountry(u, id, countryId, body);
  }

  @Post(':id/countries/:countryId/allocations')
  @Roles(...EDITORS)
  addAllocation(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('countryId') countryId: string,
    @Body(new ZodPipe(allocationSchema)) body: z.infer<typeof allocationSchema>,
  ) {
    return this.projects.addAllocation(u, id, countryId, body);
  }

  @Patch(':id/countries/:countryId/allocations/:allocationId')
  @Roles(...EDITORS)
  updateAllocation(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Param('countryId') countryId: string,
    @Param('allocationId') allocationId: string,
    @Body(new ZodPipe(updateAllocationSchema)) body: z.infer<typeof updateAllocationSchema>,
  ) {
    return this.projects.updateAllocation(u, id, countryId, allocationId, body);
  }


  @Get(':id/sessions')
  sessions(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('includeTest') includeTest?: string) {
    return this.projects.sessions(u, id, { includeTest: includeTest === 'true', take: 200 });
  }

  @Get(':id/history')
  history(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.projects.settingsHistory(u, id);
  }

  @Post(':id/history/:version/restore')
  @Roles(...EDITORS)
  restore(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('version', ParseIntPipe) version: number, @Body(new ZodPipe(restoreSchema)) body: z.infer<typeof restoreSchema>) {
    return this.projects.restoreVersion(u, id, version, body.reason);
  }

  @Get(':id/audit')
  audit(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.projects.auditTrail(u, id);
  }
}

@Module({ controllers: [ProjectsController, ProjectTemplatesController, ProjectDraftsController], providers: [ProjectsService, ProjectHistoryService], exports: [ProjectsService, ProjectHistoryService] })
export class ProjectsModule {}
