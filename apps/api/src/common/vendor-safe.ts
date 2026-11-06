/**
 * Vendors never see a project's internal name: it often names the client or the topic
 * (docs/CLIENTS_VENDORS_EDITING.md). They see Project.vendorTitle, or "Survey <code>" when it is empty.
 */
export function vendorProjectName(p: { projectCode: string; vendorTitle?: string | null }): string {
  return p.vendorTitle?.trim() || `Survey ${p.projectCode}`;
}

/** Replaces `name` with the vendor-facing title and drops vendorTitle from the payload. */
export function forVendor<T extends { projectCode: string; name?: string; vendorTitle?: string | null }>(p: T): Omit<T, 'vendorTitle'> & { name: string } {
  const { vendorTitle: _v, ...rest } = p;
  return { ...rest, name: vendorProjectName(p) };
}
