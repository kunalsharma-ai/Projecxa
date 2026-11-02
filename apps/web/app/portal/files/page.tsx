'use client';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { FilesPanel } from '@/components/requests/files-panel';
import { PageHeader, Section } from '@/components/ui';
import { get } from '@/lib/api';

export default function PortalFilesPage() {
  const me = useMe();
  const vendor = me?.user.role === 'VENDOR_USER';
  const [projects, setProjects] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    if (!me) return;
    if (vendor) {
      get<{ project: { id: string; projectCode: string; name: string } }[]>('/portal/vendor/allocations')
        .then((r) => setProjects([...new Map(r.map((a) => [a.project.id, { id: a.project.id, label: `${a.project.projectCode} · ${a.project.name}` }])).values()]))
        .catch(() => {});
    } else {
      get<{ id: string; projectCode: string; name: string }[]>('/portal/client/projects').then((r) => setProjects(r.map((p) => ({ id: p.id, label: `${p.projectCode} · ${p.name}` })))).catch(() => {});
    }
  }, [me, vendor]);
  if (!me) return null;
  return (
    <>
      <PageHeader
        title="Files"
        subtitle={vendor ? 'Keep your compliance documents up to date and find files we shared with you.' : 'Send questionnaires and find the deliverables we shared with you.'}
      />
      {vendor ? (
        <div className="space-y-6">
          <Section title="Compliance documents">
            <p className="mb-4 text-sm text-muted">Certificates (for example ISO 20252), data-protection agreements and panel books. Add the date each stops being valid; we remind you before it does.</p>
            <FilesPanel portal query={{ kind: 'COMPLIANCE' }} kinds={['COMPLIANCE']} canDelete={(f) => f.mine} empty="No compliance documents yet." />
          </Section>
          <Section title="Other files">
            <FilesPanel portal query={{ kind: 'OTHER' }} kinds={['OTHER']} projects={projects} canDelete={(f) => f.mine} showProject empty="No other files." />
          </Section>
        </div>
      ) : (
        <Section title="Shared files">
          <FilesPanel portal query={{}} kinds={['QUESTIONNAIRE', 'OTHER']} projects={projects} canDelete={(f) => f.mine} showProject empty="No files yet. Upload a questionnaire to get started." />
        </Section>
      )}
    </>
  );
}
