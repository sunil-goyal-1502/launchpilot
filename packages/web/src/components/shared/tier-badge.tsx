'use client';

import { Badge } from '@/components/ui/badge';

const TIER_STYLES: Record<string, string> = {
  low: 'bg-emerald-100 text-emerald-800',
  medium: 'bg-blue-100 text-blue-800',
  high: 'bg-violet-100 text-violet-800',
};

const TIER_LABELS: Record<string, string> = {
  low: 'Starter',
  medium: 'Production',
  high: 'Enterprise',
};

export function TierBadge({ tier }: { tier: string }) {
  return (
    <Badge variant="outline" className={TIER_STYLES[tier] ?? ''}>
      {TIER_LABELS[tier] ?? tier}
    </Badge>
  );
}
