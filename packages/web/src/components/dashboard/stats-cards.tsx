'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Rocket, Activity, DollarSign, TrendingUp } from 'lucide-react';

interface StatsCardsProps {
  total: number;
  active: number;
  totalCost: number;
  successRate: number;
}

export function StatsCards({ total, active, totalCost, successRate }: StatsCardsProps) {
  const cards = [
    { title: 'Total Deployments', value: String(total), icon: Rocket, color: 'text-blue-500' },
    { title: 'Active', value: String(active), icon: Activity, color: 'text-green-500' },
    { title: 'Est. Monthly Cost', value: `$${totalCost.toFixed(0)}`, icon: DollarSign, color: 'text-yellow-500' },
    { title: 'Success Rate', value: `${successRate.toFixed(0)}%`, icon: TrendingUp, color: 'text-purple-500' },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map(c => (
        <Card key={c.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
            <c.icon className={`h-4 w-4 ${c.color}`} />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{c.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
