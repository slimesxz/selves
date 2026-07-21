import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { Correspondence, Self } from "../types";
import { correspondenceWeight } from "../lib/recency";

interface GNode extends d3.SimulationNodeDatum {
  id: string; // correspondence id, or the self id for the center
  name: string;
  kind: "self" | "person" | "vault";
  connected: boolean;
  coId?: string; // correspondence to open on click
}
interface GLink extends d3.SimulationLinkDatum<GNode> {
  source: string | GNode;
  target: string | GNode;
  weight: number;
  connected: boolean;
}

/**
 * The graph of correspondences. Each edge IS a correspondence — an ongoing line
 * of disclosure — and the placements live inside it. Edge weight reflects
 * recency-decayed activity (fades, never erases). Node size is constant. The
 * simulation cools to stillness and only reheats to answer a placement.
 */
export default function CorrespondenceGraph({
  self,
  correspondences,
  openId,
  onOpen,
}: {
  self: Self;
  correspondences: Correspondence[];
  openId: string | null;
  onOpen: (correspondenceId: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  const max = useMemo(
    () => Math.max(1, ...correspondences.map((c) => correspondenceWeight(c))),
    [correspondences],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setDims({ w: el.clientWidth, h: el.clientHeight }),
    );
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || dims.w === 0) return;
    const { w, h } = dims;

    const nodes: GNode[] = [
      { id: self.id, name: self.name, kind: "self", connected: true },
      ...correspondences.map((c) => ({
        id: c.id,
        name: c.vault ? "Vault" : c.with.name,
        kind: c.vault ? ("vault" as const) : ("person" as const),
        connected: c.with.connected,
        coId: c.id,
      })),
    ];
    const links: GLink[] = correspondences.map((c) => ({
      source: self.id,
      target: c.id,
      weight: correspondenceWeight(c) / max,
      connected: c.with.connected,
    }));

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${w} ${h}`);
    const root = svg.append("g");

    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.4, 3])
        .on("zoom", (e) => root.attr("transform", e.transform)) as any,
    );

    const link = root
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", self.accent)
      .attr("stroke-opacity", (d) => 0.12 + 0.5 * d.weight)
      .attr("stroke-width", (d) => 0.6 + 2.4 * d.weight)
      .attr("stroke-dasharray", (d) => (d.connected ? null : "2 3"));

    const node = root
      .append("g")
      .selectAll<SVGGElement, GNode>("g")
      .data(nodes)
      .join("g")
      .style("cursor", (d) => (d.coId ? "pointer" : "default"))
      .on("click", (_e, d) => d.coId && onOpen(d.coId))
      .call(
        d3
          .drag<SVGGElement, GNode>()
          .on("start", (e, d) => {
            if (!e.active) sim.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (e, d) => {
            d.fx = e.x;
            d.fy = e.y;
          })
          .on("end", (e, d) => {
            if (!e.active) sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }) as any,
      );

    // Constant node size. Size never encodes anything.
    node
      .append("circle")
      .attr("r", (d) => (d.kind === "self" ? 8 : 6))
      .attr("fill", (d) =>
        d.kind === "self"
          ? self.accent
          : d.id === openId
            ? self.accent
            : d.connected
              ? "#1c1c1f"
              : "#0c0c0d",
      )
      .attr("stroke", (d) =>
        d.kind === "self" || d.id === openId
          ? self.accent
          : d.connected
            ? "#3a3a3e"
            : "#2b2b30",
      )
      .attr("stroke-width", (d) => (d.kind === "self" || d.id === openId ? 2 : 1))
      .attr("stroke-dasharray", (d) => (!d.connected && d.kind === "person" ? "2 2" : null))
      .style("filter", (d) =>
        d.kind === "self" || d.id === openId
          ? `drop-shadow(0 0 6px ${self.accent}88)`
          : null,
      );

    node
      .append("text")
      .text((d) => d.name)
      .attr("x", 11)
      .attr("y", 4)
      .attr("font-size", 11)
      .attr("font-family", "Inter, sans-serif")
      .attr("fill", (d) =>
        d.kind === "self" ? "#fff" : d.id === openId ? "#fff" : "#888",
      );

    const sim = d3
      .forceSimulation<GNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<GNode, GLink>(links)
          .id((d) => d.id)
          .distance((d) => 120 - 55 * d.weight)
          .strength((d) => 0.18 + 0.5 * d.weight),
      )
      .force("charge", d3.forceManyBody().strength(-230))
      .force("center", d3.forceCenter(w / 2, h / 2))
      .force("collide", d3.forceCollide(34))
      .on("tick", () => {
        link
          .attr("x1", (d) => (d.source as GNode).x!)
          .attr("y1", (d) => (d.source as GNode).y!)
          .attr("x2", (d) => (d.target as GNode).x!)
          .attr("y2", (d) => (d.target as GNode).y!);
        node.attr("transform", (d) => `translate(${d.x},${d.y})`);
      });
    sim.alpha(0.9).restart();
    return () => void sim.stop();
  }, [self.id, self.accent, correspondences, dims, max, openId, onOpen]);

  return (
    <div className="relative h-full w-full" ref={wrapRef}>
      <svg ref={svgRef} className="w-full h-full block" />
      <div className="absolute left-4 top-4 pointer-events-none">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-[#666]">
          Graph / {self.name}
        </div>
        <div className="text-[10px] font-mono text-[#3a3a3e] mt-0.5">
          edges are correspondences — reach one to open it
        </div>
      </div>
    </div>
  );
}
