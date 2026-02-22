import { prisma } from '@/lib/db';

export default async function HomePage() {
  const users = await prisma.user.findMany({ take: 10 });

  return (
    <main>
      <h1>Welcome to MyApp</h1>
      <ul>
        {users.map(user => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </main>
  );
}
