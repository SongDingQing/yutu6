import { Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { WorkspaceRenderContext } from '../../app/WorkspaceShell';
import { buildAgentStations } from '../office/model';
import {
  FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH,
  buildFlowLayout,
  type FlowEdge,
  type FlowNode,
} from './layout';

export default function FlowView({ workspace }: { workspace: WorkspaceRenderContext }) {
  const stations = useMemo(() => buildAgentStations(workspace.core), [workspace.core]);
  const layout = useMemo(() => buildFlowLayout(stations), [stations]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(0.82);
  const [showSupport, setShowSupport] = useState(true);
  const [showRepair, setShowRepair] = useState(true);
  const visibleNodes = layout.nodes.filter(node => (
    (showSupport || node.lane !== 'support')
    && (showRepair || node.lane !== 'repair')
  ));
  const visibleIds = new Set(visibleNodes.map(node => node.id));
  const visibleEdges = layout.edges.filter(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to));

  const setSafeZoom = (value: number) => setZoom(Math.min(1.3, Math.max(0.62, Number(value.toFixed(2)))));
  const fit = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = Math.min(
      1,
      (viewport.clientWidth - 24) / layout.width,
      (viewport.clientHeight - 24) / layout.height,
    );
    setSafeZoom(next);
    viewport.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  };

  return (
    <section className="flow-view" aria-labelledby="flow-view-title">
      <header className="view-heading flow-heading">
        <div>
          <p className="eyebrow">真实调度关系</p>
          <h1 id="flow-view-title">链路图</h1>
        </div>
        <div className="flow-controls" role="toolbar" aria-label="链路图控制">
          <Toggle label="支撑协作" pressed={showSupport} onClick={() => setShowSupport(value => !value)} />
          <Toggle label="维修部门" pressed={showRepair} onClick={() => setShowRepair(value => !value)} />
          <button type="button" onClick={() => setSafeZoom(zoom - 0.1)} title="缩小" aria-label="缩小"><Minus size={15} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setSafeZoom(zoom + 0.1)} title="放大" aria-label="放大"><Plus size={15} /></button>
          <button type="button" onClick={fit} title="适配视图" aria-label="适配视图"><Maximize2 size={15} /></button>
          <button type="button" onClick={() => { setZoom(.82); viewportRef.current?.scrollTo(0, 0); }} title="复位" aria-label="复位"><RotateCcw size={15} /></button>
        </div>
      </header>
      <div className="flow-hint">
        主链：董事长 → 秘书 → 董事会事前评议 → CEO → 项目主管 → 员工
        <span>蓝线为主链，灰线为支撑，虚线为复核回路</span>
      </div>
      <div
        className="flow-viewport"
        ref={viewportRef}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest('.flow-node')) return;
          const viewport = event.currentTarget;
          dragRef.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
          viewport.setPointerCapture(event.pointerId);
          viewport.classList.add('dragging');
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          event.currentTarget.scrollLeft = drag.left - (event.clientX - drag.x);
          event.currentTarget.scrollTop = drag.top - (event.clientY - drag.y);
        }}
        onPointerUp={(event) => {
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          event.currentTarget.classList.remove('dragging');
        }}
      >
        <div className="flow-scaled-space" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div className="flow-canvas" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
            <svg className="flow-edges" width={layout.width} height={layout.height} aria-hidden="true">
              <defs>
                <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
              {visibleEdges.map(edge => <FlowEdgePath edge={edge} nodes={visibleNodes} key={edge.id} />)}
            </svg>
            {visibleNodes.map(node => <FlowNodeCard node={node} key={node.id} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function FlowNodeCard({ node }: { node: FlowNode }) {
  return (
    <article
      className={`flow-node lane-${node.lane} station-${node.state}`}
      style={{
        left: node.x,
        top: node.y,
        width: FLOW_NODE_WIDTH,
        height: FLOW_NODE_HEIGHT,
        '--station-accent': node.accent,
      } as React.CSSProperties}
      title={`${node.label} · ${node.stateLabel}${node.task ? ` · ${node.task}` : ''}`}
    >
      <header><img src={node.avatar} alt="" /><strong>{node.label}</strong><span /></header>
      <p>{node.task || '暂无任务'}</p>
      <footer><b>{node.stateLabel}</b><code>{node.lane}</code></footer>
    </article>
  );
}

function FlowEdgePath({ edge, nodes }: { edge: FlowEdge; nodes: FlowNode[] }) {
  const from = nodes.find(node => node.id === edge.from);
  const to = nodes.find(node => node.id === edge.to);
  if (!from || !to) return null;
  const x1 = from.x + FLOW_NODE_WIDTH / 2;
  const y1 = from.y + FLOW_NODE_HEIGHT;
  const x2 = to.x + FLOW_NODE_WIDTH / 2;
  const y2 = to.y;
  const middle = y1 + (y2 - y1) * .5;
  const path = `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`;
  return <path className={`flow-edge edge-${edge.kind}`} d={path} markerEnd="url(#flow-arrow)" />;
}

function Toggle({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return <button className={pressed ? 'active' : ''} type="button" aria-pressed={pressed} onClick={onClick}>{label}</button>;
}
