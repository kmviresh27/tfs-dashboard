import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import ErrorBanner from '../ui/ErrorBanner.jsx';
import SlideshowHUD from '../ui/SlideshowHUD.jsx';
import useStore from '../../store/useStore.js';

export default function Layout({ activeSection, onNavigate, children, areaPaths, onRefresh, error, onClearError, topContent = null }) {
  const [collapsed, setCollapsed] = useState(false);
  const slideshowRunning = useStore(s => s.slideshowRunning);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100vh', overflow: 'hidden' }}>
      <Sidebar active={activeSection} onNavigate={onNavigate} collapsed={collapsed} />
      <div className="main" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        <Topbar
          onToggleSidebar={() => setCollapsed(c => !c)}
          onRefresh={onRefresh}
          areaPaths={areaPaths}
          onNavigateSettings={() => onNavigate('settings')}
          onNavigateHome={() => onNavigate('executive')}
        />
        <ErrorBanner message={error} onClose={onClearError} />
        {topContent}
        <div
          className={`section active${slideshowRunning ? ' slideshow-section' : ''}`}
          style={{ overflowY: slideshowRunning ? 'hidden' : 'auto', flex: 1, height: 0 }}
        >
          {children}
        </div>
      </div>
      <SlideshowHUD />
    </div>
  );
}
