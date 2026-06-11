import useStore from '../store/useStore.js';

export function usePolicies() {
  const activeRole      = useStore(s => s.activeRole);
  const policies        = useStore(s => s.policies);
  const slideshowRunning = useStore(s => s.slideshowRunning);
  const slideshowCharts  = useStore(s => s.slideshowCharts);

  const rp = (policies || {})[activeRole] || {};
  const hiddenPages  = rp.hiddenPages  || [];
  const hiddenTabs   = rp.hiddenTabs   || [];
  const hiddenCharts = rp.hiddenCharts || [];

  return {
    pageVisible:  (pageId)           => !hiddenPages.includes(pageId),
    tabVisible:   (pageId, tabId)    => !hiddenTabs.includes(`${pageId}.${tabId}`),
    chartVisible: (pageId, chartId)  => {
      // During slideshow with an explicit chart whitelist, only show whitelisted charts
      if (slideshowRunning && Array.isArray(slideshowCharts)) {
        return slideshowCharts.includes(`${pageId}.${chartId}`);
      }
      return !hiddenCharts.includes(`${pageId}.${chartId}`);
    },
  };
}
