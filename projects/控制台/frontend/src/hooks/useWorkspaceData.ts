import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBulletin, fetchWorkspaceCore } from '../lib/api';
import type { BulletinCard, WorkspaceCoreSnapshot } from '../types';

export function useWorkspaceData() {
  const [core, setCore] = useState<WorkspaceCoreSnapshot | null>(null);
  const [bulletin, setBulletin] = useState<BulletinCard[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const coreInFlight = useRef(false);
  const bulletinInFlight = useRef(false);

  const refreshCore = useCallback(async (showBusy = false) => {
    if (coreInFlight.current) return;
    coreInFlight.current = true;
    if (showBusy) setRefreshing(true);
    try {
      const next = await fetchWorkspaceCore();
      setCore(next);
      setError('');
      setLastUpdated(new Date());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '工作区数据不可用');
    } finally {
      coreInFlight.current = false;
      if (showBusy) setRefreshing(false);
    }
  }, []);

  const refreshBulletin = useCallback(async () => {
    if (bulletinInFlight.current) return;
    bulletinInFlight.current = true;
    try {
      const next = await fetchBulletin();
      setBulletin(next.cards || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '待办公告板不可用');
    } finally {
      bulletinInFlight.current = false;
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshCore(true), refreshBulletin()]);
  }, [refreshBulletin, refreshCore]);

  useEffect(() => {
    void refreshCore(true);
    void refreshBulletin();
    const coreTimer = window.setInterval(() => {
      if (!document.hidden) void refreshCore(false);
    }, 2500);
    const bulletinTimer = window.setInterval(() => {
      if (!document.hidden) void refreshBulletin();
    }, 10000);
    const onVisibility = () => {
      if (!document.hidden) {
        void refreshCore(false);
        void refreshBulletin();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(coreTimer);
      window.clearInterval(bulletinTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshBulletin, refreshCore]);

  return {
    core,
    bulletin,
    error,
    refreshing,
    lastUpdated,
    refreshAll,
    refreshCore,
    refreshBulletin,
  };
}
