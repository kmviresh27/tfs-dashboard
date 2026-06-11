import { useState, useRef, useEffect, useMemo } from 'react';

// ── Area-path tree builder (mirrors vanilla teamFilter.js) ─────────────────
function buildAreaTree(areaPaths) {
  const pathSet = new Set();
  areaPaths.forEach(area => {
    const norm = (area || '').replace(/\//g, '\\').replace(/\\+$/, '').trim();
    if (norm) pathSet.add(norm);
  });
  if (!pathSet.size) return {};

  const paths = [...pathSet].sort();
  const segs0 = paths[0].split('\\');
  let commonLen = segs0.length;
  for (const p of paths) {
    const segs = p.split('\\');
    let i = 0;
    while (i < commonLen && i < segs.length && segs[i] === segs0[i]) i++;
    commonLen = i;
  }

  const baseParts = segs0.slice(0, Math.max(0, commonLen - 1));
  const base = baseParts.join('\\');

  const pathToAbs = {};
  paths.forEach(absPath => {
    const rel = base ? absPath.slice(base.length + 1) : absPath;
    if (!rel) return;
    const parts = rel.split('\\');
    for (let i = 1; i <= parts.length; i++) {
      const relKey = parts.slice(0, i).join('\\');
      if (!pathToAbs[relKey]) pathToAbs[relKey] = base ? base + '\\' + relKey : relKey;
    }
  });

  const trie = {};
  Object.keys(pathToAbs).sort().forEach(relPath => {
    const parts = relPath.split('\\');
    let node = trie;
    parts.forEach((seg, i) => {
      if (!node[seg]) node[seg] = { _abs: pathToAbs[parts.slice(0, i + 1).join('\\')], _children: {} };
      node = node[seg]._children;
    });
  });
  return trie;
}

// Flatten trie for search results
function flattenTree(trie, depth = 0, result = []) {
  Object.keys(trie).sort().forEach(seg => {
    const node = trie[seg];
    const absPath = node._abs || '';
    const val = 'ROOT:' + absPath;
    const parts = absPath.split('\\');
    const pathStr = parts.length > 1 ? parts.slice(0, -1).join(' › ') : '';
    result.push({ seg, val, pathStr, depth });
    flattenTree(node._children, depth + 1, result);
  });
  return result;
}

// ── Recursive tree node component ─────────────────────────────────────────
function TreeNode({ seg, node, depth, selected, onSelect, expandedPaths, toggleExpand }) {
  const val = 'ROOT:' + (node._abs || '');
  const hasChildren = Object.keys(node._children).length > 0;
  const isExpanded = expandedPaths.has(node._abs || '');
  const indent = 10 + depth * 14;

  return (
    <div className={hasChildren ? 'tf-branch' : 'tf-leaf'}>
      <div
        className={`tf-node-row${selected === val ? ' selected' : ''}`}
        style={{ paddingLeft: indent, cursor: 'pointer' }}
        onClick={() => onSelect(val)}
      >
        {hasChildren ? (
          <span
            className={`tf-toggle${isExpanded ? ' open' : ''}`}
            onClick={e => { e.stopPropagation(); toggleExpand(node._abs || ''); }}
          >▶</span>
        ) : (
          <span className="tf-spacer" />
        )}
        <span className="tf-node-label">{seg}</span>
      </div>
      {hasChildren && isExpanded && (
        <div className="tf-children">
          {Object.keys(node._children).sort().map(childSeg => (
            <TreeNode
              key={childSeg}
              seg={childSeg}
              node={node._children[childSeg]}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main TeamFilter component ──────────────────────────────────────────────
export default function TeamFilter({ areaPaths = [], selected, onChange }) {
  const [open, setOpen]               = useState(false);
  const [search, setSearch]           = useState('');
  const [expandedPaths, setExpanded]  = useState(new Set());
  const wrapRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const trie     = useMemo(() => buildAreaTree(areaPaths), [areaPaths]);
  const flatList = useMemo(() => flattenTree(trie), [trie]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return flatList.filter(item => item.seg.toLowerCase().includes(q));
  }, [search, flatList]);

  // Short display label for the trigger button
  const btnLabel = useMemo(() => {
    if (!selected) return 'All Teams';
    const val = selected.startsWith('ROOT:') ? selected.slice(5) : selected;
    const parts = val.split('\\');
    return parts[parts.length - 1] || 'All Teams';
  }, [selected]);

  function handleSelect(val) {
    onChange(val || '');
    setOpen(false);
    setSearch('');
  }

  function toggleExpand(absPath) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(absPath) ? next.delete(absPath) : next.add(absPath);
      return next;
    });
  }

  // Highlight search term in result label
  function highlight(text) {
    if (!search.trim()) return text;
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(
      new RegExp(`(${escaped})`, 'gi'),
      '<mark class="tf-result-match">$1</mark>',
    );
  }

  const isActive = Boolean(selected);

  return (
    <div className="tf-wrap topbar-pi" ref={wrapRef} style={{ position: 'relative' }}>
      <span className="topbar-label">Team</span>
      <button
        className={`topbar-team-filter${open ? ' open' : ''}${isActive ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={selected || 'All Teams'}
        style={{ minWidth: 120, maxWidth: 180 }}
      >
        <span className="tf-label-text">{btnLabel}</span>
        <span className="tf-caret">▾</span>
      </button>

      {open && (
        <div className="tf-panel" style={{ minWidth: 220 }}>
          {/* Search */}
          <div className="tf-search-wrap">
            <input
              className="tf-search-input"
              type="text"
              placeholder="🔍 Search teams…"
              autoComplete="off"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  if (search) setSearch('');
                  else setOpen(false);
                  e.stopPropagation();
                }
              }}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>

          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {search.trim() ? (
              searchResults.length > 0 ? searchResults.map(item => (
                <div
                  key={item.val}
                  className={`tf-result-row${selected === item.val ? ' selected' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleSelect(item.val)}
                >
                  <span
                    className="tf-result-name"
                    dangerouslySetInnerHTML={{ __html: highlight(item.seg) }}
                  />
                  {item.pathStr && <span className="tf-result-path">{item.pathStr}</span>}
                </div>
              )) : (
                <div className="tf-no-results">No teams match "{search}"</div>
              )
            ) : (
              <>
                <div
                  className={`tf-all-row${!selected ? ' selected' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleSelect('')}
                >
                  All Teams
                </div>
                {Object.keys(trie).sort().map(seg => (
                  <TreeNode
                    key={seg}
                    seg={seg}
                    node={trie[seg]}
                    depth={0}
                    selected={selected}
                    onSelect={handleSelect}
                    expandedPaths={expandedPaths}
                    toggleExpand={toggleExpand}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

