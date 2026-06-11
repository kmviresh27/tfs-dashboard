import { useEffect } from 'react';
import useStore from '../../store/useStore.js';

export default function SlideshowPager({ pages }) {
  const slideshowRunning       = useStore(s => s.slideshowRunning);
  const slideshowPage          = useStore(s => s.slideshowPage);
  const setSlideshowTotalPages = useStore(s => s.setSlideshowTotalPages);

  useEffect(() => {
    if (slideshowRunning) setSlideshowTotalPages(pages.length);
  }, [slideshowRunning, pages.length, setSlideshowTotalPages]);

  if (!slideshowRunning) {
    return <>{pages.map((p, i) => <div key={i}>{p}</div>)}</>;
  }

  const idx = Math.min(slideshowPage, pages.length - 1);
  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {pages[idx]}
      </div>
    </div>
  );
}
