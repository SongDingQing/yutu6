import { CheckCircle2, CircleAlert, Cpu, Layers3, MemoryStick, RotateCcw, Save, Settings2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  fetchFrontendRoute,
  fetchRuntimeSettings,
  restartConsole,
  saveFrontendRoute,
  saveRuntimeSettings,
} from '../../lib/api';
import type { FrontendRouteState, FrontendUiTarget, RuntimeSettingsState } from '../../types';

interface RuntimePreset {
  id: string;
  value: number;
  label: string;
  memory: string;
  memoryCap: string;
  cpu: string;
  summary: string;
}

const PRESETS: RuntimePreset[] = [
  { id: 'lean', value: 1, label: '低内存', memory: '4–8 GB', memoryCap: '约 8 GB', cpu: '低', summary: '一次只运行一个重型模型任务，适合后台常驻或同时打开 Unity 等大型应用。' },
  { id: 'balanced', value: 2, label: '均衡', memory: '8–14 GB', memoryCap: '约 14 GB', cpu: '中', summary: '最多并行两个重型模型任务，在响应速度和长期稳定之间取平衡，推荐日常使用。' },
  { id: 'productive', value: 3, label: '高效率', memory: '12–20 GB', memoryCap: '约 20 GB', cpu: '高', summary: '最多并行三个重型模型任务，适合任务集中时使用，内存与 CPU 占用会明显上升。' },
  { id: 'full', value: 4, label: '全速', memory: '16–26 GB', memoryCap: '约 26 GB', cpu: '很高', summary: '最多并行四个重型模型任务，只建议短时突发处理，不宜与大型桌面应用同时运行。' },
];

const UI_OPTIONS: Array<{
  target: FrontendUiTarget;
  label: string;
  badge: string;
  summary: string;
}> = [
  {
    target: 'react',
    label: '简洁 UI',
    badge: 'React',
    summary: '信息层级更清楚、界面更克制，适合日常派单、查看进度和移动窗口使用。',
  },
  {
    target: 'legacy',
    label: '复杂 UI',
    badge: '经典',
    summary: '保留完整密集面板与全部旧版交互，适合需要同时查看大量细节的场景。',
  },
];

function presetFor(value: number): RuntimePreset {
  return PRESETS.find((preset) => preset.value === value) || {
    id: 'custom',
    value,
    label: `现有 ${value}`,
    memory: `${Math.max(4, value * 4)}–${Math.max(6, value * 6 + 2)} GB`,
    memoryCap: `约 ${Math.max(6, value * 6 + 2)} GB`,
    cpu: value > 4 ? '极高' : '高',
    summary: '这是此前保存的非标准档位。建议改用常用预设，以便更稳定地估算资源。',
  };
}

export default function SettingsRoute() {
  const [state, setState] = useState<RuntimeSettingsState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState<'load' | 'save' | 'restart' | ''>('load');
  const [uiState, setUiState] = useState<FrontendRouteState | null>(null);
  const [selectedUi, setSelectedUi] = useState<FrontendUiTarget | null>(null);
  const [uiFeedback, setUiFeedback] = useState('');
  const [uiBusy, setUiBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchRuntimeSettings()
      .then((next) => {
        if (!alive) return;
        setState(next);
        setSelected(next.pending);
        setFeedback('');
      })
      .catch((error) => {
        if (alive) setFeedback(error instanceof Error ? error.message : '设置读取失败');
      })
      .finally(() => {
        if (alive) setBusy('');
      });
    fetchFrontendRoute()
      .then((next) => {
        if (!alive) return;
        setUiState(next);
        setSelectedUi(next.target);
        setUiFeedback('');
      })
      .catch((error) => {
        if (alive) setUiFeedback(error instanceof Error ? error.message : '界面设置读取失败');
      })
      .finally(() => {
        if (alive) setUiBusy(false);
      });
    return () => { alive = false; };
  }, []);

  const preset = useMemo(() => presetFor(selected || state?.pending || 2), [selected, state?.pending]);
  const valid = Boolean(state && selected && Number.isInteger(selected) && selected >= state.min && selected <= state.max);
  const saved = Boolean(valid && selected === state?.pending);
  const needsRestart = Boolean(saved && state?.restartRequired);
  const uiSaved = Boolean(uiState && selectedUi === uiState.target);
  const loading = busy === 'load' || uiBusy;
  const allSaved = saved && uiSaved;

  const applyUi = async () => {
    if (!selectedUi || uiSaved) return;
    setUiBusy(true);
    setUiFeedback('');
    try {
      const next = await saveFrontendRoute(selectedUi);
      setUiState(next);
      setSelectedUi(next.target);
      setUiFeedback(`已切换为${next.target === 'react' ? '简洁 UI' : '复杂 UI'}。`);
      window.location.assign(next.workspace);
    } catch (error) {
      setUiFeedback(error instanceof Error ? `切换失败：${error.message}` : '切换失败');
    } finally {
      setUiBusy(false);
    }
  };

  const save = async () => {
    if (!valid || selected == null) return;
    setBusy('save');
    setFeedback('');
    try {
      const next = await saveRuntimeSettings(selected);
      setState(next);
      setSelected(next.pending);
      setFeedback('配置已安全写入本机。');
    } catch (error) {
      setFeedback(error instanceof Error ? `保存失败：${error.message}` : '保存失败');
    } finally {
      setBusy('');
    }
  };

  const restart = async () => {
    if (!needsRestart || !window.confirm('确认安全重启控制台以应用新档位？运行中的任务会阻止重启。')) return;
    setBusy('restart');
    setFeedback('');
    try {
      const result = await restartConsole();
      setFeedback(`安全重启已排程；${result.cooldownSec || 30} 秒内不会重复执行。`);
    } catch (error) {
      setFeedback(error instanceof Error ? `重启未执行：${error.message}` : '重启未执行');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="settings-route" aria-labelledby="settings-route-title">
      <header className="settings-route-heading">
        <div>
          <p className="eyebrow">本机运行配置</p>
          <h1 id="settings-route-title"><Settings2 size={22} />设置中心</h1>
          <p>只管理控制台的安全运行参数，不会写入 Git 或改变模型凭据。</p>
        </div>
        <span className={`settings-state ${loading ? 'loading' : allSaved ? 'saved' : 'unsaved'}`} role="status">
          {loading ? <RotateCcw size={14} className="spin" /> : allSaved ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
          {loading ? '读取中' : allSaved ? '已保存' : '未保存'}
        </span>
      </header>

      <div className="settings-route-card">
        <div className="settings-route-title">
          <div>
            <h2>工作区界面</h2>
            <p>两套界面共用同一份任务、队列与设置数据，可以随时切换。</p>
          </div>
          {uiState ? <code>当前：{uiState.target === 'react' ? '简洁 UI' : '复杂 UI'}</code> : null}
        </div>

        <div className="settings-ui-options" role="radiogroup" aria-label="选择工作区界面">
          {UI_OPTIONS.map((item) => {
            const selectedOption = selectedUi === item.target;
            return (
              <button
                key={item.target}
                type="button"
                role="radio"
                aria-checked={selectedOption}
                disabled={!uiState || uiBusy}
                className={selectedOption ? 'selected' : ''}
                onClick={() => {
                  setSelectedUi(item.target);
                  setUiFeedback('');
                }}
              >
                <span className="settings-ui-icon">
                  {item.target === 'react' ? <Sparkles size={18} /> : <Layers3 size={18} />}
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.badge}</small>
                  <p>{item.summary}</p>
                </span>
                <span className="settings-ui-check" aria-hidden="true">
                  {selectedOption ? <CheckCircle2 size={18} /> : null}
                </span>
              </button>
            );
          })}
        </div>

        <div className="settings-route-actions">
          <span className={uiFeedback.includes('失败') ? 'error' : ''} aria-live="polite">{uiFeedback}</span>
          <button type="button" className="secondary-action" onClick={() => void applyUi()} disabled={!uiState || uiSaved || uiBusy}>
            <Save size={16} />{uiBusy ? '读取中' : uiSaved ? '当前界面' : '应用界面'}
          </button>
        </div>
      </div>

      <div className="settings-route-card">
        <div className="settings-route-title">
          <div>
            <h2>模型并发上限</h2>
            <p>选择预设即可一次设置全部数字；保存后按提示决定是否重启。</p>
          </div>
          {state ? <code>允许 {state.min}–{state.max}</code> : null}
        </div>

        <div className="settings-preset-tabs" role="tablist" aria-label="运行资源档位">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected === item.value}
              disabled={!state || item.value < state.min || item.value > state.max}
              onClick={() => setSelected(item.value)}
            >
              <strong>{item.label}</strong>
              <span>并发 {item.value}</span>
            </button>
          ))}
        </div>

        <div className="settings-resource-preview" role="tabpanel">
          <div className="settings-preview-icon"><MemoryStick size={20} /></div>
          <div>
            <h3>{preset.label}模式</h3>
            <p>{preset.summary}</p>
          </div>
          <dl>
            <div><dt>模型并发</dt><dd>{preset.value}</dd></div>
            <div><dt>预计内存</dt><dd>{preset.memory}</dd></div>
            <div><dt>资源上限</dt><dd>{preset.memoryCap}</dd></div>
            <div><dt>CPU 压力</dt><dd>{preset.cpu}</dd></div>
          </dl>
          <small>内存是控制台、worker 与模型 CLI 的保守估算，不包含浏览器、Unity、ToDesk 等其他应用。</small>
        </div>

        <div className="settings-route-actions">
          <span className={feedback.includes('失败') || feedback.includes('未执行') ? 'error' : ''} aria-live="polite">{feedback}</span>
          <button type="button" className="secondary-action" onClick={() => void save()} disabled={!valid || saved || Boolean(busy)}>
            <Save size={16} />{busy === 'save' ? '保存中' : '保存配置'}
          </button>
          <button type="button" className="restart-action" onClick={() => void restart()} disabled={!needsRestart || Boolean(busy)}>
            <Cpu size={16} />{busy === 'restart' ? '正在排程' : needsRestart ? '重启以应用' : '无需重启'}
          </button>
        </div>
      </div>
    </section>
  );
}
