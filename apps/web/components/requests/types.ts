export type RequestKind = 'QUESTION' | 'ISSUE' | 'DISPUTE';
export type RequestStatus = 'OPEN' | 'ANSWERED' | 'CLOSED';
export type FileKind = 'QUESTIONNAIRE' | 'DELIVERABLE' | 'COMPLIANCE' | 'OTHER';

export interface SharedFile {
  id: string; kind: FileKind; name: string; contentType: string; size: number; note: string | null;
  expiresAt: string | null; expired: boolean; fromPortal: boolean; uploadedBy: string; mine: boolean; createdAt: string;
  project: { id: string; projectCode: string } | null; ticketId: string | null;
  sharedWith?: { kind: 'client' | 'vendor'; id: string; name: string } | null;
}

export interface RequestRow {
  id: string; ref: string; number: number; kind: RequestKind; status: RequestStatus; subject: string;
  client?: { id: string; name: string } | null; vendor?: { id: string; name: string } | null;
  project: { id: string; projectCode: string; name: string } | null;
  createdBy: string; assignee: { id: string; name: string } | null; disputedCompletes: number;
  lastMessageAt: string; closedAt: string | null; createdAt: string; messages?: number;
}

export interface RequestFull extends Omit<RequestRow, 'messages'> {
  messages: { id: string; body: string; internal: boolean; fromPortal: boolean; author: string; createdAt: string }[];
  files: SharedFile[];
  sessions: { id: string; uid: string; countryCode: string; status: string; approval: string; invoiced: boolean; completedAt: string | null }[];
}

export const KIND_LABEL: Record<RequestKind, string> = { QUESTION: 'Question', ISSUE: 'Issue', DISPUTE: 'Dispute' };
export const STATUS_LABEL: Record<RequestStatus, string> = { OPEN: 'Waiting for us', ANSWERED: 'Answered', CLOSED: 'Closed' };
export const PORTAL_STATUS_LABEL: Record<RequestStatus, string> = { OPEN: 'Waiting for reply', ANSWERED: 'Answered', CLOSED: 'Closed' };
export const STATUS_TONE: Record<RequestStatus, string> = { OPEN: 'bg-warn/15 text-warn', ANSWERED: 'bg-info/15 text-info', CLOSED: 'bg-sunken text-muted' };
export const FILE_KIND_LABEL: Record<FileKind, string> = { QUESTIONNAIRE: 'Questionnaire', DELIVERABLE: 'Deliverable', COMPLIANCE: 'Compliance', OTHER: 'Other' };
export const FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg,.zip,.sav';

export function fileSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
