import {
  fetchBulletin,
  fetchEvents,
  fetchWorkspaceBootstrap,
} from '../lib/api';
import {
  initialWorkspaceState,
  reduceWorkspaceState,
  type WorkspaceState,
} from './workspaceState';

const EVENT_POLL_MS = 1000;
const HIDDEN_POLL_MS = 5000;
const MAX_RETRY_MS = 10000;
const RESUME_SNAPSHOT_AFTER_MS = 30000;
const CURSOR_KEY = 'yt6-react-workspace-event-cursor-v1';

class WorkspaceStore {
  private state: WorkspaceState = {
    ...initialWorkspaceState,
    cursor: readStoredCursor(),
  };
  private readonly listeners = new Set<() => void>();
  private startCount = 0;
  private timer: number | null = null;
  private inFlight = false;
  private stopped = true;
  private retryCount = 0;
  private hiddenAt = 0;

  getSnapshot = (): WorkspaceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start = (): (() => void) => {
    this.startCount += 1;
    if (this.startCount === 1) {
      this.stopped = false;
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      void this.refresh(true).finally(() => this.schedule(0));
    }
    return () => {
      this.startCount = Math.max(0, this.startCount - 1);
      if (this.startCount === 0) this.stop();
    };
  };

  refresh = async (showBusy = false): Promise<void> => {
    if (this.inFlight) return;
    this.inFlight = true;
    this.dispatch({
      type: 'connection.changed',
      connection: this.state.core ? 'resyncing' : 'connecting',
    });
    try {
      const result = await fetchWorkspaceBootstrap({
        core: this.state.core,
        bulletin: this.state.bulletinResponse,
      });
      this.dispatch({ type: 'snapshot.loaded', result });
      persistCursor(this.state.cursor);
      this.retryCount = 0;
    } catch (error) {
      this.retryCount += 1;
      this.dispatch({
        type: 'connection.changed',
        connection: 'retrying',
        error: error instanceof Error ? error.message : '工作区同步失败',
      });
    } finally {
      this.inFlight = false;
      if (showBusy && this.state.connection === 'connecting') {
        this.dispatch({ type: 'connection.changed', connection: 'retrying' });
      }
    }
  };

  refreshBulletin = async (): Promise<void> => {
    const bulletin = await fetchBulletin();
    this.dispatch({ type: 'bulletin.loaded', bulletin });
  };

  private poll = async (): Promise<void> => {
    if (this.stopped || this.inFlight) {
      this.schedule(EVENT_POLL_MS);
      return;
    }
    if (document.hidden) {
      this.schedule(HIDDEN_POLL_MS);
      return;
    }
    this.inFlight = true;
    try {
      const response = await fetchEvents(this.state.cursor, 250);
      this.dispatch({
        type: 'events.received',
        events: response.events,
        lastSeq: response.lastSeq,
      });
      persistCursor(this.state.cursor);
      this.retryCount = 0;
      if (this.state.needsResync) {
        this.inFlight = false;
        await this.refresh();
      }
    } catch (error) {
      this.retryCount += 1;
      this.dispatch({
        type: 'connection.changed',
        connection: 'retrying',
        error: error instanceof Error ? error.message : '事件连接失败',
      });
    } finally {
      this.inFlight = false;
      const delay = this.retryCount
        ? Math.min(MAX_RETRY_MS, EVENT_POLL_MS * 2 ** Math.min(this.retryCount, 4))
        : EVENT_POLL_MS;
      this.schedule(delay);
    }
  };

  private schedule(delay: number): void {
    if (this.stopped) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, delay);
  }

  private dispatch(action: Parameters<typeof reduceWorkspaceState>[1]): void {
    const next = reduceWorkspaceState(this.state, action);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private onVisibilityChange = (): void => {
    if (document.hidden) {
      this.hiddenAt = Date.now();
      return;
    }
    const hiddenFor = this.hiddenAt ? Date.now() - this.hiddenAt : 0;
    this.hiddenAt = 0;
    if (hiddenFor >= RESUME_SNAPSHOT_AFTER_MS) {
      void this.refresh();
    } else {
      this.schedule(0);
    }
  };

  private stop(): void {
    this.stopped = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }
}

function readStoredCursor(): number {
  try {
    const value = Number(localStorage.getItem(CURSOR_KEY) || 0);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch (_) {
    return 0;
  }
}

function persistCursor(cursor: number): void {
  try {
    localStorage.setItem(CURSOR_KEY, String(Math.max(0, cursor)));
  } catch (_) {}
}

export const workspaceStore = new WorkspaceStore();
