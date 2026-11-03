'use client';
import { FilesPanel } from '@/components/requests/files-panel';
import { RequestList } from '@/components/requests/list';
import { Section } from '@/components/ui';
import type { ProjectDetail } from './types';

/** Documents shared on this project (questionnaires, deliverables) and the requests about it. */
export function FilesTab({ project, editable }: { project: ProjectDetail; editable: boolean }) {
  const vendors = [...new Map(project.countries.flatMap((c) => c.allocations.map((a) => [a.vendorId, a.vendor]))).values()];
  const audiences = [
    { value: 'staff', label: 'Staff only' },
    { value: `c:${project.client.id}`, label: `Client · ${project.client.name}`, clientId: project.client.id },
    ...vendors.map((v) => ({ value: `v:${v.id}`, label: `Vendor · ${v.name}`, vendorId: v.id })),
  ];
  return (
    <div className="space-y-6">
      <Section title="Files">
        <p className="mb-4 text-sm text-muted">Share questionnaires and deliverables with the client, or briefs with a vendor. The client and vendors see only the files shared with them, in their portal; they can upload here too.</p>
        <FilesPanel
          portal={false}
          query={{ projectId: project.id }}
          kinds={['DELIVERABLE', 'QUESTIONNAIRE', 'OTHER']}
          audiences={audiences}
          fixed={{ projectId: project.id }}
          canUpload={editable}
          canDelete={() => editable}
          showSharedWith
          empty="No files on this project yet."
        />
      </Section>
      <Section title="Requests about this project">
        <RequestList portal={false} projectId={project.id} />
      </Section>
    </div>
  );
}
