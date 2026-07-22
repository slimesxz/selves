/**
 * The Living Graph — a private mirror of self-knowledge.
 * Edges derive their weight from correspondence volume (placement history).
 * Nothing on this stage is stored except node coordinates.
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Self, Connection } from '../types';
import { IconRenderer } from './IconRenderer';

interface LivingGraphProps {
  selves: Self[];
  connections: Connection[];
  currentSelfId: string;
  inspectedSelfId: string | null;
  setInspectedSelfId: (id: string | null) => void;
  activeVisualSignals: { id: string; fromX: number; fromY: number; toX: number; toY: number }[];
  updateGraphPosition: (id: string, x: number, y: number) => void;
  correspondenceVolume: (aId: string, bId: string) => number;
  hasKey: (holderId: string, granterId: string) => boolean;
}

export function LivingGraph({
  selves,
  connections,
  currentSelfId,
  inspectedSelfId,
  setInspectedSelfId,
  activeVisualSignals,
  updateGraphPosition,
  correspondenceVolume,
  hasKey
}: LivingGraphProps) {
  const containerRef = useRef<SVGSVGElement>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  // Deduplicated connected pairs with derived weight.
  const getEdgesToDraw = () => {
    const seen = new Set<string>();
    const edges: { id: string; from: Self; to: Self; volume: number; keyed: boolean }[] = [];

    connections.forEach(conn => {
      if (conn.status !== 'connected') return;
      const pairKey = [conn.fromSelfId, conn.toSelfId].sort().join('::');
      if (seen.has(pairKey)) return;
      seen.add(pairKey);

      const fromSelf = selves.find(s => s.id === conn.fromSelfId);
      const toSelf = selves.find(s => s.id === conn.toSelfId);
      if (!fromSelf || !toSelf) return;

      edges.push({
        id: pairKey,
        from: fromSelf,
        to: toSelf,
        volume: correspondenceVolume(fromSelf.id, toSelf.id),
        keyed: hasKey(fromSelf.id, toSelf.id) || hasKey(toSelf.id, fromSelf.id)
      });
    });

    return edges;
  };

  const handleMouseDown = (selfId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDraggingNodeId(selfId);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingNodeId || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(50, Math.min(750, ((e.clientX - rect.left) / rect.width) * 800));
      const y = Math.max(50, Math.min(550, ((e.clientY - rect.top) / rect.height) * 600));
      updateGraphPosition(draggingNodeId, Math.round(x), Math.round(y));
    };
    const handleMouseUp = () => setDraggingNodeId(null);
    if (draggingNodeId) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingNodeId, updateGraphPosition]);

  const edges = getEdgesToDraw();

  // Edge weight is derived: correspondence volume -> stroke.
  const getEdgeStroke = (volume: number) => {
    if (volume === 0) return { stroke: '#374151', strokeWidth: 1, strokeDasharray: '4 4' }; // connected, no correspondence yet
    if (volume <= 2) return { stroke: '#4b5563', strokeWidth: 1.25 };
    if (volume <= 5) return { stroke: '#14b8a6', strokeWidth: 1.75 };
    return { stroke: '#f59e0b', strokeWidth: 2.5 };
  };

  return (
    <div id="living-graph-container" className="relative w-full h-[320px] md:h-[420px] bg-neutral-950 border border-neutral-900 rounded-lg overflow-hidden font-mono text-[10px] select-none">

      {/* Telemetry labels */}
      <div className="absolute top-3 left-3 flex flex-col gap-0.5 pointer-events-none text-neutral-500 z-10">
        <span className="text-neutral-400 font-bold">LIVING GRAPH</span>
        <span>EDGES DERIVE FROM PLACEMENT HISTORY</span>
        <span>PRIVATE // VISIBLE ONLY TO YOU</span>
      </div>

      <div className="absolute top-3 right-3 flex items-center gap-1.5 pointer-events-none text-neutral-500 z-10">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span>GRAPH_ENGINE_V2.0</span>
      </div>

      {/* Derived-weight legend */}
      <div className="absolute bottom-3 left-3 flex items-center gap-4 pointer-events-none text-neutral-600 z-10 text-[9px]">
        <span className="uppercase text-neutral-500">Edge weight (derived):</span>
        <div className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-neutral-600 border-t border-dashed"></span>
          <span>none</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-neutral-500"></span>
          <span>light</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-teal-500"></span>
          <span>steady</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-[3px] bg-amber-500"></span>
          <span>deep</span>
        </div>
      </div>

      <svg
        ref={containerRef}
        viewBox="0 0 800 600"
        className="w-full h-full cursor-crosshair"
        onClick={() => setInspectedSelfId(null)}
      >
        <defs>
          <pattern id="gridPattern" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="20" r="1" fill="#1f2937" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#gridPattern)" />

        {/* Edges */}
        <g id="graph-edges">
          {edges.map(edge => {
            const strokeProps = getEdgeStroke(edge.volume);
            return (
              <g key={edge.id} className="transition-opacity duration-300">
                <line
                  x1={edge.from.graphPosition.x}
                  y1={edge.from.graphPosition.y}
                  x2={edge.to.graphPosition.x}
                  y2={edge.to.graphPosition.y}
                  {...strokeProps}
                  className="opacity-60 hover:opacity-100 cursor-help transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    setInspectedSelfId(edge.from.id);
                  }}
                />
                {/* Key access marker at edge midpoint */}
                {edge.keyed && (
                  <circle
                    cx={(edge.from.graphPosition.x + edge.to.graphPosition.x) / 2}
                    cy={(edge.from.graphPosition.y + edge.to.graphPosition.y) / 2}
                    r="2.5"
                    fill="#ef4444"
                    className="animate-pulse"
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* Nodes */}
        <g id="graph-nodes">
          {selves.map(self => {
            const isActive = self.id === currentSelfId;
            const isInspected = self.id === inspectedSelfId;
            const isOwn = self.userId === 'user_1';

            return (
              <g
                key={self.id}
                transform={`translate(${self.graphPosition.x}, ${self.graphPosition.y})`}
                className="cursor-grab active:cursor-grabbing transition-transform duration-75"
                onMouseDown={(e) => handleMouseDown(self.id, e)}
                onClick={(e) => {
                  e.stopPropagation();
                  setInspectedSelfId(self.id);
                }}
              >
                {(isActive || isInspected) && (
                  <circle
                    r="24"
                    fill="none"
                    stroke={self.color}
                    strokeWidth="1.5"
                    className="animate-ping opacity-25"
                    style={{ animationDuration: '3s' }}
                  />
                )}

                <circle
                  r="18"
                  fill="#0a0a0a"
                  stroke={isInspected ? '#ffffff' : self.color}
                  strokeWidth={isActive ? 3 : 1.5}
                  className="transition-all duration-200"
                />

                <g transform="translate(-8, -8)" className="pointer-events-none text-white opacity-85">
                  <IconRenderer name={self.icon} size={16} className="text-white" />
                </g>

                {/* Own Selves get a subtle base tick instead of a category badge */}
                {isOwn && (
                  <circle cx="0" cy="14" r="1.5" fill={self.color} opacity="0.9" />
                )}

                <text
                  y="28"
                  textAnchor="middle"
                  fill={isInspected ? '#ffffff' : isActive ? self.color : '#a3a3a3'}
                  className={`text-[9px] select-none font-bold tracking-tight transition-colors ${isActive ? 'underline decoration-dotted' : ''}`}
                >
                  {self.name}
                </text>
              </g>
            );
          })}
        </g>

        {/* Signals in motion */}
        <g id="signal-propagations">
          <AnimatePresence>
            {activeVisualSignals.map(signal => (
              <motion.circle
                key={signal.id}
                r="4"
                fill="#f59e0b"
                initial={{ cx: signal.fromX, cy: signal.fromY, opacity: 1, r: 4 }}
                animate={{ cx: signal.toX, cy: signal.toY, opacity: [1, 0.8, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.2, ease: 'easeInOut' }}
              />
            ))}
          </AnimatePresence>
        </g>
      </svg>

      <div className="absolute bottom-2 right-3 pointer-events-none text-neutral-600 text-[8px] tracking-tight">
        SELVES: {selves.length} | EDGES: {edges.length}
      </div>
    </div>
  );
}
