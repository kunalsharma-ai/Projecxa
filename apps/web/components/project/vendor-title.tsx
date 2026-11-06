'use client';
import { EyeOff } from 'lucide-react';
import { InlineEdit } from '@/components/form/tags';
import { patch } from '@/lib/api';
import type { ProjectDetail } from './types';

/**
 * The project name often names the client or the brand, so vendors never see it: their portal and
 * emails use this title instead (docs/CLIENTS_VENDORS_EDITING.md).
 */
export function VendorTitle({ project, editable, reload }: { project: ProjectDetail; editable: boolean; reload: () => void }) {
  const fallback = `Survey ${project.projectCode}`;
  return (
    <div className="card flex flex-wrap items-start gap-3 p-4">
      <span className="icon-tile tone-blue hidden sm:grid"><EyeOff className="h-5 w-5" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">Name vendors see</div>
        <p className="text-xs text-muted">Vendors never see “{project.name}”. Their portal, links and emails show this instead, with the project code.</p>
        <div className="mt-2 max-w-md">
          {editable ? (
            <InlineEdit
              label="name vendors see"
              value={project.vendorTitle ?? ''}
              placeholder={`${fallback} (default). Click to change`}
              validate={(v) => (v.length > 200 ? 'Use at most 200 characters.' : v.trim() && project.name.toLowerCase().includes(v.trim().toLowerCase()) && v.trim().length > 6 ? 'This repeats the internal project name; vendors would see it.' : null)}
              onSave={async (v) => { await patch(`/projects/${project.id}`, { vendorTitle: v.trim() || null }); reload(); }}
            />
          ) : (
            <span className="text-sm">{project.vendorTitle || fallback}</span>
          )}
        </div>
      </div>
    </div>
  );
}
