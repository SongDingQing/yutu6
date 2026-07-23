import { useEffect, useSyncExternalStore } from 'react';
import { workspaceStore } from '../store/workspaceStore';

const refreshAll = () => workspaceStore.refresh(true);
const refreshCore = () => workspaceStore.refresh();
const refreshBulletin = () => workspaceStore.refreshBulletin();

export function useWorkspaceData() {
  const state = useSyncExternalStore(
    workspaceStore.subscribe,
    workspaceStore.getSnapshot,
    workspaceStore.getSnapshot,
  );

  useEffect(() => workspaceStore.start(), []);

  const issueText = state.core
    ? Object.values(state.core.issues).map(issue => issue?.message || '').filter(Boolean)
    : [];
  const error = [...issueText, state.error, state.warning].filter(Boolean).join('；');

  return {
    core: state.core,
    bulletin: state.bulletin,
    error,
    refreshing: state.connection === 'connecting' || state.connection === 'resyncing',
    connection: state.connection,
    lastUpdated: state.lastUpdated,
    refreshAll,
    refreshCore,
    refreshBulletin,
  };
}
