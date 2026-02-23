'use client';

import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Globe, Shield, Layers, Server, Database,
  Zap, MessageSquare, Activity, Cloud, Lock,
} from 'lucide-react';

// Strategy-like shape (loose typing for web side)
interface StrategyData {
  provider: string;
  compute: { instanceType: string; count: number; autoScaling?: boolean };
  network: { loadBalancer?: boolean; cdn?: boolean; waf?: boolean };
  database?: { engine: string; instanceType: string };
  cache?: { engine: string };
  queue?: { service: string };
  streaming?: { service: string; shards: number };
  vendorSubscription?: { vendorName: string; features: string[] };
  securityTier?: string;
}

interface Props {
  strategy: StrategyData;
}

// Cloud-specific labels
function getCDN(p: string) { return p === 'aws' ? 'CloudFront' : p === 'gcp' ? 'Cloud CDN' : 'Front Door'; }
function getLB(p: string) { return p === 'aws' ? 'ALB' : p === 'gcp' ? 'Cloud LB' : 'App Gateway'; }
function getDB(p: string) { return p === 'aws' ? 'RDS' : p === 'gcp' ? 'Cloud SQL' : 'Azure SQL'; }
function getCompute(p: string) { return p === 'aws' ? 'ECS' : p === 'gcp' ? 'GCE' : 'VM'; }

const NODE_COLORS: Record<string, string> = {
  internet: '#3b82f6',
  cdn: '#eab308',
  waf: '#ef4444',
  lb: '#22c55e',
  compute: '#3b82f6',
  database: '#a855f7',
  cache: '#06b6d4',
  queue: '#eab308',
  streaming: '#22c55e',
  vendor: '#ec4899',
};

export function ArchitectureDiagram({ strategy }: Props) {
  const { nodes, edges } = useMemo(() => {
    const p = strategy.provider;
    const ns: Node[] = [];
    const es: Edge[] = [];
    let y = 0;
    const cx = 300;
    let lastNodeId = '';

    function addNode(id: string, label: string, sublabel: string, color: string) {
      ns.push({
        id,
        position: { x: cx - 80, y },
        data: { label: `${label}\n${sublabel}` },
        style: {
          background: color + '15',
          border: `2px solid ${color}`,
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 12,
          fontWeight: 600,
          textAlign: 'center' as const,
          width: 160,
          whiteSpace: 'pre-line' as const,
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
      if (lastNodeId) {
        es.push({ id: `${lastNodeId}-${id}`, source: lastNodeId, target: id, animated: true });
      }
      lastNodeId = id;
      y += 100;
    }

    // Internet
    addNode('internet', 'Internet', 'Users', NODE_COLORS.internet);

    // Edge layer
    if (strategy.network.cdn) addNode('cdn', getCDN(p), 'CDN', NODE_COLORS.cdn);
    if (strategy.network.waf) addNode('waf', 'WAF', 'Firewall', NODE_COLORS.waf);

    // Load balancer
    if (strategy.network.loadBalancer) addNode('lb', getLB(p), 'Load Balancer', NODE_COLORS.lb);

    // Compute
    addNode('compute', getCompute(p), `${strategy.compute.instanceType} x${strategy.compute.count}`, NODE_COLORS.compute);

    const computeId = lastNodeId;

    // Data tier (branch out horizontally)
    let dataX = cx - 200;
    const dataY = y;
    const dataNodes: string[] = [];

    if (strategy.database) {
      const id = 'database';
      ns.push({
        id,
        position: { x: dataX, y: dataY },
        data: { label: `${getDB(p)}\n${strategy.database.engine}` },
        style: {
          background: NODE_COLORS.database + '15',
          border: `2px solid ${NODE_COLORS.database}`,
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 12,
          fontWeight: 600,
          textAlign: 'center' as const,
          width: 120,
          whiteSpace: 'pre-line' as const,
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
      dataNodes.push(id);
      dataX += 140;
    }

    if (strategy.cache) {
      const id = 'cache';
      ns.push({
        id,
        position: { x: dataX, y: dataY },
        data: { label: `Cache\n${strategy.cache.engine}` },
        style: {
          background: NODE_COLORS.cache + '15',
          border: `2px solid ${NODE_COLORS.cache}`,
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 12,
          fontWeight: 600,
          textAlign: 'center' as const,
          width: 120,
          whiteSpace: 'pre-line' as const,
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
      dataNodes.push(id);
      dataX += 140;
    }

    if (strategy.queue) {
      const id = 'queue';
      ns.push({
        id,
        position: { x: dataX, y: dataY },
        data: { label: `Queue\n${strategy.queue.service}` },
        style: {
          background: NODE_COLORS.queue + '15',
          border: `2px solid ${NODE_COLORS.queue}`,
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 12,
          fontWeight: 600,
          textAlign: 'center' as const,
          width: 120,
          whiteSpace: 'pre-line' as const,
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
      dataNodes.push(id);
      dataX += 140;
    }

    if (strategy.vendorSubscription) {
      const id = 'vendor';
      ns.push({
        id,
        position: { x: dataX, y: dataY },
        data: { label: `${strategy.vendorSubscription.vendorName}\n${strategy.vendorSubscription.features.slice(0, 2).join('+')}` },
        style: {
          background: NODE_COLORS.vendor + '15',
          border: `2px solid ${NODE_COLORS.vendor}`,
          borderRadius: 8,
          padding: '8px 16px',
          fontSize: 12,
          fontWeight: 600,
          textAlign: 'center' as const,
          width: 120,
          whiteSpace: 'pre-line' as const,
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      });
      dataNodes.push(id);
    }

    // Connect compute to all data nodes
    for (const dataId of dataNodes) {
      es.push({
        id: `${computeId}-${dataId}`,
        source: computeId,
        target: dataId,
        animated: true,
      });
    }

    return { nodes: ns, edges: es };
  }, [strategy]);

  const height = Math.max(500, (nodes.length - 2) * 100 + 200);

  return (
    <div style={{ width: '100%', height }} className="rounded-lg border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        panOnDrag={false}
        zoomOnScroll={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
      </ReactFlow>
    </div>
  );
}
