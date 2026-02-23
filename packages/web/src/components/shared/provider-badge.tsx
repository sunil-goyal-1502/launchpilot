'use client';

import { Badge } from '@/components/ui/badge';

const PROVIDER_COLORS: Record<string, string> = {
  aws: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  gcp: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  azure: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
};

export function ProviderBadge({ provider }: { provider: string }) {
  return (
    <Badge variant="outline" className={PROVIDER_COLORS[provider] ?? ''}>
      {provider.toUpperCase()}
    </Badge>
  );
}
