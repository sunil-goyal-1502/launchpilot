export interface DeploymentEvent {
  type: 'phase' | 'checkpoint' | 'blueprint' | 'strategy' | 'security' | 'log' | 'complete' | 'error';
  timestamp: string;
  data: Record<string, unknown>;
}

type Listener = (event: DeploymentEvent) => void;

interface DeploymentStream {
  events: DeploymentEvent[];
  listeners: Set<Listener>;
}

// Use globalThis to persist across Next.js module re-evaluations (Turbopack HMR).
// Without this, different API routes may get separate module instances with
// separate Map objects, breaking SSE event delivery.
const globalForStore = globalThis as unknown as {
  __launchpilot_streams?: Map<string, DeploymentStream>;
};
if (!globalForStore.__launchpilot_streams) {
  globalForStore.__launchpilot_streams = new Map();
}
const streams = globalForStore.__launchpilot_streams;

export function createStream(id: string): void {
  if (!streams.has(id)) {
    streams.set(id, { events: [], listeners: new Set() });
  }
}

export function pushEvent(id: string, event: DeploymentEvent): void {
  const stream = streams.get(id);
  if (!stream) return;
  stream.events.push(event);
  for (const listener of stream.listeners) {
    listener(event);
  }
}

export function subscribe(id: string, listener: Listener): () => void {
  const stream = streams.get(id);
  if (!stream) return () => {};
  stream.listeners.add(listener);
  return () => { stream.listeners.delete(listener); };
}

export function getEvents(id: string): DeploymentEvent[] {
  return streams.get(id)?.events ?? [];
}

export function removeStream(id: string): void {
  streams.delete(id);
}

// Helper to push typed events
export function pushPhase(id: string, phase: string): void {
  pushEvent(id, {
    type: 'phase',
    timestamp: new Date().toISOString(),
    data: { phase },
  });
}

export function pushLog(id: string, message: string): void {
  pushEvent(id, {
    type: 'log',
    timestamp: new Date().toISOString(),
    data: { message },
  });
}
