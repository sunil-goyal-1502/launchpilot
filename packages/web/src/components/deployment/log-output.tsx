'use client';

import { useRef, useEffect } from 'react';

export function LogOutput({ logs }: { logs: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div
      ref={scrollRef}
      className="h-64 overflow-y-auto rounded-lg bg-gray-950 p-4 font-mono text-xs text-gray-300"
    >
      {logs.length === 0 ? (
        <p className="text-gray-600">Waiting for logs...</p>
      ) : (
        logs.map((log, i) => (
          <div key={i} className="py-0.5">
            <span className="text-gray-600">{String(i + 1).padStart(3, ' ')} </span>
            <span className={log.startsWith('ERROR') ? 'text-red-400' : ''}>{log}</span>
          </div>
        ))
      )}
    </div>
  );
}
