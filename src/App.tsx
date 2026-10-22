import { useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { checkSupport } from './platform/support';
import { HomePage } from './pages/HomePage';
import { PreparePage } from './pages/PreparePage';
import { SessionPage } from './pages/SessionPage';
import { SummaryPage } from './pages/SummaryPage';
import { StatsPage } from './pages/StatsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UnsupportedPage } from './pages/UnsupportedPage';

export function App() {
  const page = useAppStore((s) => s.page);
  const supportReasons = useAppStore((s) => s.supportReasons);

  useEffect(() => {
    const support = checkSupport();
    if (!support.ok) useAppStore.setState({ supportReasons: support.reasons, page: 'unsupported' });
    void useAppStore.getState().init();
  }, []);

  // 切后台：暂停会话计时；回前台由运动中页提示"会话已中断，是否继续"
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) useAppStore.getState().interrupt();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (page === 'unsupported') return <UnsupportedPage reasons={supportReasons} />;

  switch (page) {
    case 'prepare':
      return <PreparePage />;
    case 'session':
      return <SessionPage />;
    case 'summary':
      return <SummaryPage />;
    case 'stats':
      return <StatsPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}
