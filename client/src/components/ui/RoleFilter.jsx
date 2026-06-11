import useStore from '../../store/useStore.js';
import { getEffectiveRoleDefs } from '../../constants.js';

export default function RoleFilter() {
  const activeRole    = useStore(s => s.activeRole);
  const setActiveRole = useStore(s => s.setActiveRole);
  const customRoles   = useStore(s => s.customRoles);
  const roleDefs      = getEffectiveRoleDefs(customRoles);
  const rolesList     = Object.entries(roleDefs).map(([id, def]) => ({ id, ...def }));

  return (
    <div className="role-filter">
      {rolesList.map(r => (
        <button
          key={r.id}
          className={`role-pill${activeRole === r.id ? ' active' : ''}`}
          onClick={() => setActiveRole(r.id)}
          title={r.label}
        >
          <span className="icon-grey">{r.icon}</span> {r.label}
        </button>
      ))}
    </div>
  );
}
