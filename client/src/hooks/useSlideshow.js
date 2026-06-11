import { useEffect, useRef } from 'react';
import useStore from '../store/useStore.js';

export function useSlideshow(setSection, setSlideshowPage) {
  const slideshowRunning    = useStore(s => s.slideshowRunning);
  const slideshowInterval   = useStore(s => s.slideshowInterval);
  const slideshowSections   = useStore(s => s.slideshowSections);
  const activeSection       = useStore(s => s.activeSection);
  const slideshowPage       = useStore(s => s.slideshowPage);
  const slideshowTotalPages = useStore(s => s.slideshowTotalPages);
  const timerRef            = useRef(null);

  useEffect(() => {
    if (!slideshowRunning || slideshowSections.length === 0) {
      clearTimeout(timerRef.current);
      return;
    }
    timerRef.current = setTimeout(() => {
      if (slideshowPage < slideshowTotalPages - 1) {
        setSlideshowPage(slideshowPage + 1);
      } else {
        setSlideshowPage(0);
        const idx  = slideshowSections.indexOf(activeSection);
        const next = slideshowSections[(idx + 1) % slideshowSections.length];
        setSection(next);
      }
    }, slideshowInterval * 1000);
    return () => clearTimeout(timerRef.current);
  }, [slideshowRunning, slideshowInterval, slideshowSections, activeSection, slideshowPage, slideshowTotalPages]); // eslint-disable-line react-hooks/exhaustive-deps
}
