// Shared TFS link components

// External-link SVG icon (12x12)
function ExtIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         style={{ flexShrink: 0 }}>
      <path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7"/>
      <path d="M8 1h3m0 0v3m0-3L5 7"/>
    </svg>
  );
}

/**
 * TFSLink — action link for card headers / buttons
 * Usage: <TFSLink href={url} label="Open in TFS" />
 *        <TFSLink href={url} label="Features" />
 */
export function TFSLink({ href, label = 'Open in TFS' }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="tfs-link">
      <ExtIcon />
      {label}
    </a>
  );
}

/**
 * TFSItemLink — inline ID link for table cells
 * Usage: <TFSItemLink id={123} tfsBaseUrl={url} />
 *        Renders: #123456 with external-link icon on hover
 */
export function TFSItemLink({ id, tfsBaseUrl, href }) {
  if (!id) return null;
  const resolvedHref = href || (tfsBaseUrl ? `${tfsBaseUrl}/_workitems/edit/${id}` : null);
  if (!resolvedHref) return <span className="tfs-item-link">#{id}</span>;
  return (
    <a
      href={resolvedHref}
      target="_blank"
      rel="noreferrer noopener"
      className="tfs-item-link"
      title={`Open #${id} in TFS`}
    >
      #{id}
      <ExtIcon />
    </a>
  );
}
