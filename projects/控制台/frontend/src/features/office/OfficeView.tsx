import { Activity, Building2, Clock3, UserRound } from 'lucide-react';
import { useMemo } from 'react';
import type { WorkspaceRenderContext } from '../../app/WorkspaceShell';
import { useNow } from '../../hooks/useNow';
import { formatElapsed } from '../../lib/format';
import {
  buildAgentStations,
  buildingScene,
  deriveBuildingState,
  type AgentGroup,
  type AgentStation,
  type OfficeMode,
} from './model';

export default function OfficeView({ mode, workspace }: {
  mode: OfficeMode;
  workspace: WorkspaceRenderContext;
}) {
  const stations = useMemo(() => buildAgentStations(workspace.core), [workspace.core]);
  if (mode === 'building') return <BuildingView workspace={workspace} stations={stations} />;
  if (mode === 'desks') return <DeskView stations={stations} />;
  return <OfficeMap stations={stations} />;
}

function OfficeMap({ stations }: { stations: AgentStation[] }) {
  const grouped = groupStations(stations);
  const active = stations.filter(station => station.state === 'working').length;
  return (
    <section className="office-view" aria-labelledby="office-view-title">
      <header className="view-heading">
        <div>
          <p className="eyebrow">等距工作区</p>
          <h1 id="office-view-title">办公室</h1>
        </div>
        <span className="view-live-count"><Activity size={15} />{active} 个工位工作中</span>
      </header>

      <div className="office-scroll">
        <section className="office-zone executive-suite">
          <ZoneHeading title="总裁办公室" meta="董事长 · 秘书 · CEO" />
          <div className="executive-scene">
            <img
              className="executive-scene-art"
              src="/public/office-demo-assets/chairman/chairman-office-lounge.png"
              alt="董事长等距办公室"
            />
            <div className="executive-status">
              <img src="/public/assets/avatars/chairman.png" alt="" />
              <div><strong>董事长</strong><span>{active ? '关注团队执行' : '办公室待命'}</span></div>
            </div>
            <div className="executive-stations">
              {grouped.executive.map(station => <OfficeStation station={station} key={station.id} />)}
            </div>
          </div>
        </section>

        <OfficeZone title="董事会" meta={`${grouped.board.length} 席事前评议`} stations={grouped.board} />
        <OfficeZone title="维修部门" meta="主管 + 执行员" stations={grouped.repair} />
        <ProjectZones stations={grouped.project} />
        <OfficeZone title="公共协作区" meta="质量 · 洞察 · HR · 工具" stations={grouped.collaboration} />
      </div>
    </section>
  );
}

function BuildingView({ workspace, stations }: {
  workspace: WorkspaceRenderContext;
  stations: AgentStation[];
}) {
  const now = useNow();
  const state = deriveBuildingState(workspace.core, now);
  const scene = buildingScene(state);
  const runningCount = stations.filter(station => station.state === 'working').length;
  return (
    <section className="building-view" aria-labelledby="building-view-title">
      <header className="view-heading">
        <div>
          <p className="eyebrow">自动场景</p>
          <h1 id="building-view-title">办公楼</h1>
        </div>
        <span className={`building-state state-${state}`}><span />{scene.label}</span>
      </header>
      <div className="building-layout">
        <aside className="building-directory" aria-label="办公楼房间">
          <RoomButton icon={<Building2 size={16} />} label="总裁办公室" meta="董事长 + 秘书" active />
          <RoomButton label="董事会" meta={`${stations.filter(item => item.group === 'board').length} 席评审`} />
          <RoomButton label="项目片区" meta={`${stations.filter(item => item.group === 'project').length} 个工位`} />
          <RoomButton label="维修部门" meta={`${stations.filter(item => item.group === 'repair').length} 个工位`} />
          <RoomButton label="公共协作区" meta={`${stations.filter(item => item.group === 'collaboration').length} 个工位`} />
        </aside>
        <div className="building-stage">
          <div className="building-auto-line">
            <span className={`building-dot state-${state}`} />
            <strong>自动状态 · {scene.label}</strong>
            <span>{state === 'typing' ? `${runningCount} 个任务执行中` : state === 'handoff' ? '检测到新派单' : '团队当前空闲'}</span>
          </div>
          <div className="building-image-wrap">
            <img key={state} src={scene.image} alt={`总裁办公室 · ${scene.label}`} />
          </div>
          <p>{scene.description}</p>
          <small>优先级：交接文件 › 打字办公 › 看书 · 状态来自统一任务仓库</small>
        </div>
      </div>
    </section>
  );
}

function DeskView({ stations }: { stations: AgentStation[] }) {
  const grouped = groupStations(stations);
  return (
    <section className="desk-view" aria-labelledby="desk-view-title">
      <header className="view-heading">
        <div>
          <p className="eyebrow">组织状态</p>
          <h1 id="desk-view-title">工位</h1>
        </div>
        <span className="view-live-count"><UserRound size={15} />{stations.length} 个工位</span>
      </header>
      <div className="desk-scroll">
        <DeskSection title="总裁办公室" stations={grouped.executive} />
        <DeskSection title="董事会" stations={grouped.board} />
        <DeskSection title="项目与交付" stations={grouped.project} />
        <DeskSection title="维修部门" stations={grouped.repair} />
        <DeskSection title="公共协作区" stations={grouped.collaboration} />
      </div>
    </section>
  );
}

function OfficeZone({ title, meta, stations }: {
  title: string;
  meta: string;
  stations: AgentStation[];
}) {
  if (!stations.length) return null;
  return (
    <section className="office-zone">
      <ZoneHeading title={title} meta={meta} />
      <div className="office-floor">
        <div className="office-station-grid">
          {stations.map(station => <OfficeStation station={station} key={station.id} />)}
        </div>
      </div>
    </section>
  );
}

function ProjectZones({ stations }: { stations: AgentStation[] }) {
  if (!stations.length) return null;
  const projects = new Map<string, AgentStation[]>();
  for (const station of stations) {
    const project = station.projectId || '共享交付';
    projects.set(project, [...(projects.get(project) || []), station]);
  }
  return (
    <section className="office-zone project-zone">
      <ZoneHeading title="项目片区" meta={`${projects.size} 个项目`} />
      <div className="project-office-list">
        {[...projects.entries()].map(([project, projectStations]) => (
          <section className="project-office" key={project}>
            <h3>{project}</h3>
            <div className="office-floor">
              <div className="office-station-grid">
                {projectStations.map(station => <OfficeStation station={station} key={station.id} />)}
              </div>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function OfficeStation({ station }: { station: AgentStation }) {
  return (
    <article className={`office-station station-${station.state}`} style={{ '--station-accent': station.accent } as React.CSSProperties}>
      <span className="office-state-bubble">{station.stateLabel}</span>
      <img className="office-sprite" src={station.sprite} alt={`${station.label}${station.state === 'working' ? '正在工作' : '坐在工位'}`} />
      <img className="office-avatar" src={station.avatar} alt="" />
      <div className="office-station-console" />
      <strong>{station.label}</strong>
      <p>{station.task || (station.state === 'queued' ? '等待领取任务' : '暂无任务')}</p>
    </article>
  );
}

function DeskSection({ title, stations }: { title: string; stations: AgentStation[] }) {
  if (!stations.length) return null;
  return (
    <section className="desk-section">
      <ZoneHeading title={title} meta={`${stations.length} 个工位`} />
      <div className="desk-grid">
        {stations.map(station => (
          <article className={`agent-desk-card station-${station.state}`} key={station.id} style={{ '--station-accent': station.accent } as React.CSSProperties}>
            <img src={station.avatar} alt="" />
            <div className="agent-desk-main">
              <strong>{station.label}</strong>
              <span>{station.runner || station.role}</span>
              <p>{station.task || '暂无任务'}</p>
            </div>
            <div className="agent-desk-status">
              <b>{station.stateLabel}</b>
              {station.since ? <span><Clock3 size={12} />{formatElapsed(station.since)}</span> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ZoneHeading({ title, meta }: { title: string; meta: string }) {
  return <header className="zone-heading"><h2>{title}</h2><span>{meta}</span></header>;
}

function RoomButton({ icon, label, meta, active = false }: {
  icon?: React.ReactNode;
  label: string;
  meta: string;
  active?: boolean;
}) {
  return (
    <button className={active ? 'active' : ''} type="button" disabled={!active}>
      {icon}<span><strong>{label}</strong><small>{meta}</small></span>
    </button>
  );
}

function groupStations(stations: AgentStation[]): Record<AgentGroup, AgentStation[]> {
  return {
    executive: stations.filter(station => station.group === 'executive'),
    board: stations.filter(station => station.group === 'board'),
    project: stations.filter(station => station.group === 'project'),
    repair: stations.filter(station => station.group === 'repair'),
    collaboration: stations.filter(station => station.group === 'collaboration'),
  };
}
