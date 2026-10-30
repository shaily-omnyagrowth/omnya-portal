import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { NavLink } from '../app/Sidebar';
import Icon from '../ui/Icon';

// Cards that both report a number and take you to the page that deals with it.
export default function AttentionCards({ items, onNavigate }) {
  return (
    <div className="stats-grid" style={{ marginBottom: 24 }}>
      {items.map(i => {
        const body = (
          <>
            <div className="flex-between"><span className="stat-label">{i.label}</span>{i.to && <Icon icon={ArrowRight01Icon} size={14} style={{ color: 'var(--ink4)' }} />}</div>
            <div className="stat-value" style={i.alert && i.value > 0 ? { color: 'var(--amber)' } : undefined}>{i.value}</div>
            {i.sub && <div className="stat-sub">{i.sub}</div>}
          </>
        );
        return i.to && onNavigate
          ? <NavLink key={i.label} id={i.to} onNavigate={onNavigate} className="stat-card stat-link">{body}</NavLink>
          : <div key={i.label} className="stat-card">{body}</div>;
      })}
    </div>
  );
}
