'use client';

import { usePathname } from 'next/navigation';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/deploy': 'Deploy',
  '/deployments': 'Deployment History',
  '/settings': 'Settings',
};

export function Header() {
  const pathname = usePathname();

  let title = PAGE_TITLES[pathname] ?? '';
  if (pathname.startsWith('/deploy/') && pathname !== '/deploy') {
    title = 'Deployment Progress';
  }
  if (pathname.startsWith('/deployments/') && pathname !== '/deployments') {
    title = 'Deployment Detail';
  }

  return (
    <header className="flex h-14 items-center border-b bg-card px-6">
      <h1 className="text-lg font-semibold">{title}</h1>
    </header>
  );
}
