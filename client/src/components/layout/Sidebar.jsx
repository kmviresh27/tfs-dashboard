import useStore from '../../store/useStore.js';
import { NAV_ITEMS, getEffectiveRoleSections } from '../../constants.js';
import { useAuth } from '../../hooks/useAuth.js';
import { usePolicies } from '../../hooks/usePolicies.js';

export default function Sidebar({ active, onNavigate, collapsed }) {
  const activeRole    = useStore(s => s.activeRole);
  const customRoles   = useStore(s => s.customRoles);
  const roleOverrides = useStore(s => s.roleOverrides);
  const branding      = useStore(s => s.branding);

  const { user, logout } = useAuth();
  const { pageVisible }  = usePolicies();

  const roleSections = getEffectiveRoleSections(customRoles, roleOverrides);
  const allowed      = roleSections[activeRole] ?? roleSections.all;
  const isAdmin      = user?.isAdmin || user?.isSuperAdmin || false;
  const isSuperAdmin = user?.isSuperAdmin || false;
  const visibleItems = NAV_ITEMS.filter(item =>
    !item.adminOnly && allowed.includes(item.id) && pageVisible(item.id)
  );
  // Admin-only items shown at bottom — superAdminOnly items only for super admins
  const adminItems = NAV_ITEMS.filter(item =>
    item.adminOnly && (item.superAdminOnly ? isSuperAdmin : isAdmin)
  );

  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Main navigation">
      <div className="sidebar-brand">
        <div className="brand-text">
          <div className="brand-name">{branding.appName || 'AV Dashboard'}</div>
          <div className="brand-sub">{branding.appSubtitle || ''}</div>
        </div>
      </div>

      <div className="sidebar-nav">
        {(() => {
          const items = [];
          let lastGroup = null;
          visibleItems.forEach(item => {
            if (item.group && item.group !== lastGroup) {
              lastGroup = item.group;
              items.push(
                <div key={`grp-${item.group}`} className="sidebar-section">{item.group}</div>
              );
            }
            items.push(
              <a key={item.id}
                href={`#${item.id}`}
                className={`nav-link${active === item.id ? ' active' : ''}`}
                onClick={e => { e.preventDefault(); onNavigate(item.id); }}>
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </a>
            );
          });
          // Admin items no longer shown in sidebar — accessible via FloatingBar gear icon
          return items;
        })()}
      </div>

      <div className="sidebar-footer">
        {user && (
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', background: '#1492ff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 700, fontSize: 12, flexShrink: 0,
              }}>
                {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
              </div>
              {!collapsed && (
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.displayName || user.email || 'User'}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.4px' }}>
                    {user.role}{user.setupMode ? ' · Setup' : ''}
                  </div>
                </div>
              )}
            </div>
            {!collapsed && !user.setupMode && user?.role === 'all' && (
              <div style={{
                marginTop: 8,
                padding: '8px 10px',
                background: 'rgba(210, 153, 34, 0.1)',
                border: '1px solid rgba(210, 153, 34, 0.4)',
                borderRadius: 6,
                fontSize: 11,
              }}>
                <div style={{ color: 'var(--warning)', fontWeight: 600, marginBottom: 4 }}>
                  No role assigned
                </div>
                <div style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
                  Contact your admin to get access.
                  {branding.adminEmail && (
                    <> <a href={`mailto:${branding.adminEmail}`} style={{ color: 'var(--primary)' }}>
                      {branding.adminEmail}
                    </a></>
                  )}
                </div>
              </div>
            )}
            {!collapsed && !user.setupMode && (
              <button
                onClick={logout}
                style={{
                  marginTop: 8, width: '100%', background: 'transparent',
                  border: '1px solid var(--border)', color: 'var(--muted)',
                  padding: '4px 8px', fontSize: 11, cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                Sign out
              </button>
            )}
          </div>
        )}
        <div className="refresh-status">
          <span className="refresh-dot"></span>
          <span>{branding.appName || 'AV Dashboard'}</span>
        </div>
      </div>
    </nav>
  );
}
