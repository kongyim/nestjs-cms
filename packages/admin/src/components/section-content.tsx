import type { AdminSectionConfig } from '../configs/types';
import ResourceSection from './resource-section';

export default function SectionContent({
  section,
  recordId,
  canWrite,
  onAccessChange,
}: {
  section: AdminSectionConfig;
  recordId: string | null;
  canWrite: boolean;
  onAccessChange: () => Promise<void>;
}) {
  if (section.type === 'custom') {
    const Component = section.component;
    return <Component />;
  }
  return (
    <ResourceSection
      section={section}
      recordId={recordId}
      canWrite={canWrite}
      onAccessChange={onAccessChange}
    />
  );
}
