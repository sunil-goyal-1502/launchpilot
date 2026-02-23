'use client';

import { Badge } from '@/components/ui/badge';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  analyzing: 'bg-yellow-100 text-yellow-800',
  planning: 'bg-blue-100 text-blue-800',
  deploying: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  destroyed: 'bg-gray-100 text-gray-500',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status] ?? ''}>
      {status}
    </Badge>
  );
}
