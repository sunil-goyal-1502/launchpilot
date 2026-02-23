'use client';

import { use } from 'react';
import { ProgressView } from '@/components/deployment/progress-view';

export default function DeployProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProgressView deploymentId={id} />;
}
