import { config } from '../common/config';
import { EVENT_NAMES, WEBHOOK_EVENTS } from '../webhooks/webhook.events';
import { API_SCOPES, SCOPE_NAMES } from './api-keys';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const pageOf = (item: string) => ({ type: 'object', properties: { data: { type: 'array', items: ref(item) }, nextCursor: { type: 'string', nullable: true, description: 'Pass as `cursor` to get the next page. Null on the last page.' } } });
const limit = { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } };
const cursor = { name: 'cursor', in: 'query', schema: { type: 'string' }, description: '`nextCursor` from the previous page.' };
const projectRef = { name: 'ref', in: 'path', required: true, schema: { type: 'string' }, description: 'Project code (PRX10001) or id.' };
const countryCode = { name: 'countryCode', in: 'path', required: true, schema: { type: 'string', pattern: '^[A-Za-z]{2}$' } };
const date = (name: string, d: string) => ({ name, in: 'query', schema: { type: 'string', format: 'date-time' }, description: d });
const json = (schema: object) => ({ content: { 'application/json': { schema } } });
const errors = {
  '401': { description: 'Missing, invalid, revoked or expired key.' },
  '403': { description: 'The key lacks the permission (scope) this call needs.' },
  '404': { description: 'Not found in your organization.' },
  '429': { description: 'Rate limit reached. See Retry-After.' },
};
const op = (summary: string, scope: string | null, extra: object, ok: object) => ({
  summary,
  ...(scope ? { description: `Needs the \`${scope}\` permission.`, 'x-scope': scope } : {}),
  ...extra,
  responses: { '200': { description: 'OK', ...json(ok) }, ...errors },
});

/** OpenAPI 3.0 description of the public API, served at /api/v1/public/openapi.json. */
export function openApiSpec() {
  const status = { type: 'string', enum: ['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED'] };
  return {
    openapi: '3.0.3',
    info: {
      title: 'PROJEXA public API',
      version: '1.0.0',
      description: `Read projects, fieldwork progress, sessions, quotas and finance, and change project, market and vendor link status. Authenticate with an API key from Settings → API and webhooks. Permissions: ${SCOPE_NAMES.map((s) => `${s} (${API_SCOPES[s]})`).join('; ')}. Webhook events: ${EVENT_NAMES.map((e) => `${e}: ${WEBHOOK_EVENTS[e]}`).join(' ')}`,
    },
    servers: [{ url: `${config.publicBaseUrl}/api/v1/public` }],
    security: [{ bearer: [] }, { apiKeyHeader: [] }],
    paths: {
      '/me': { get: op('The key and organization making the call', null, {}, ref('Me')) },
      '/projects': {
        get: op('List projects, newest first', 'projects:read', {
          parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED', 'INVOICED'] } }, date('updatedSince', 'Only projects changed at or after this time.'), limit, cursor],
        }, pageOf('ProjectSummary')),
      },
      '/projects/{ref}': {
        get: op('A project with its markets, vendor links and session counts', 'projects:read', { parameters: [projectRef] }, ref('Project')),
        patch: op('Change project status or field dates', 'projects:write', {
          parameters: [projectRef],
          requestBody: { required: true, ...json({ type: 'object', additionalProperties: false, properties: { status, fieldStartAt: { type: 'string', format: 'date', nullable: true }, fieldEndAt: { type: 'string', format: 'date', nullable: true } } }) },
        }, ref('Project')),
      },
      '/projects/{ref}/markets/{countryCode}': {
        patch: op('Change a market status or target', 'projects:write', {
          parameters: [projectRef, countryCode],
          requestBody: { required: true, ...json({ type: 'object', additionalProperties: false, properties: { status, targetCompletes: { type: 'integer', minimum: 1 } } }) },
        }, ref('Project')),
      },
      '/projects/{ref}/markets/{countryCode}/vendor-links/{linkId}': {
        patch: op('Pause, reopen or close a vendor link, or change its target', 'projects:write', {
          parameters: [projectRef, countryCode, { name: 'linkId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, ...json({ type: 'object', additionalProperties: false, properties: { status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'CLOSED'] }, targetCompletes: { type: 'integer', minimum: 1 } } }) },
        }, ref('Project')),
      },
      '/projects/{ref}/sessions': {
        get: op('Respondent sessions (live traffic only), newest first', 'sessions:read', {
          parameters: [projectRef, { name: 'status', in: 'query', schema: { type: 'string', enum: ['STARTED', 'COMPLETE', 'TERMINATE', 'QUOTA_FULL', 'QUALITY_FAIL', 'DUPLICATE', 'SECURITY_REJECT', 'PARTIAL', 'TECHNICAL_ERROR'] } }, date('outcomeSince', 'Only sessions that ended at or after this time.'), limit, cursor],
        }, pageOf('Session')),
      },
      '/projects/{ref}/quotas': { get: op('Quota cells per market', 'quotas:read', { parameters: [projectRef] }, { type: 'object' }) },
      '/invoices': { get: op('Client invoices, newest first', 'finance:read', { parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['DRAFT', 'SENT', 'PAID', 'VOID'] } }, date('updatedSince', 'Only invoices changed at or after this time.'), limit, cursor] }, pageOf('Invoice')) },
      '/bills': { get: op('Vendor bills, newest first', 'finance:read', { parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['DRAFT', 'APPROVED', 'PAID', 'VOID'] } }, date('updatedSince', 'Only bills changed at or after this time.'), limit, cursor] }, pageOf('Bill')) },
    },
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'Authorization: Bearer pjx_...' },
        apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      schemas: {
        Me: { type: 'object', properties: { organization: { type: 'object' }, key: { type: 'object', properties: { name: { type: 'string' }, prefix: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } }, expiresAt: { type: 'string', nullable: true } } } } },
        ProjectSummary: { type: 'object', properties: { id: { type: 'string' }, projectCode: { type: 'string' }, name: { type: 'string' }, status: { type: 'string' }, category: { type: 'string' }, targetCompletes: { type: 'integer' }, completes: { type: 'integer' }, markets: { type: 'array', items: { type: 'object' } }, client: { type: 'object' }, fieldStartAt: { type: 'string', nullable: true }, fieldEndAt: { type: 'string', nullable: true }, updatedAt: { type: 'string' } } },
        Project: { type: 'object', properties: { id: { type: 'string' }, projectCode: { type: 'string' }, name: { type: 'string' }, status: { type: 'string' }, markets: { type: 'array', items: { type: 'object', properties: { countryCode: { type: 'string' }, status: { type: 'string' }, targetCompletes: { type: 'integer' }, completes: { type: 'integer' }, cpi: { type: 'number' }, currency: { type: 'string' }, sessions: { type: 'object', additionalProperties: { type: 'integer' } }, vendorLinks: { type: 'array', items: { type: 'object' } } } } } } },
        Session: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, statusDetail: { type: 'string', nullable: true }, outcomeVerified: { type: 'boolean' }, approval: { type: 'string' }, vendorRespondentId: { type: 'string' }, countryCode: { type: 'string' }, vendor: { type: 'object' }, startedAt: { type: 'string' }, outcomeAt: { type: 'string', nullable: true }, revenue: { type: 'number', nullable: true }, payout: { type: 'number', nullable: true }, currency: { type: 'string' } } },
        Invoice: { type: 'object', properties: { id: { type: 'string' }, number: { type: 'string' }, status: { type: 'string' }, currency: { type: 'string' }, subtotal: { type: 'number' }, taxAmount: { type: 'number' }, total: { type: 'number' }, project: { type: 'object' }, client: { type: 'object' } } },
        Bill: { type: 'object', properties: { id: { type: 'string' }, number: { type: 'string' }, status: { type: 'string' }, currency: { type: 'string' }, subtotal: { type: 'number' }, taxAmount: { type: 'number' }, total: { type: 'number' }, vendor: { type: 'object' } } },
      },
    },
  };
}
