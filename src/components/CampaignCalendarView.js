import { useMemo, useState } from 'react';
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';
import Icon from '../ui/Icon';
import { fmtDate } from '../utils';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function CampaignCalendarView({ campaigns = [], onSelectCampaign }) {
  const [cursor, setCursor] = useState(() => new Date());
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = ymd(new Date());

  const byDay = useMemo(() => {
    const map = {};
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const key = ymd(date);
      const deadlines = campaigns.filter(c => c.deadline && c.deadline.startsWith(key));
      const active = campaigns.filter(c => {
        if (!c.deadline || deadlines.includes(c)) return false;
        const start = new Date(c.start_date || c.created_at); start.setHours(0, 0, 0, 0);
        const end = new Date(c.deadline); end.setHours(23, 59, 59, 999);
        return date >= start && date <= end;
      });
      map[day] = { key, deadlines, active };
    }
    return map;
  }, [campaigns, year, month, daysInMonth]);

  const agenda = Object.entries(byDay).filter(([, v]) => v.deadlines.length).map(([day, v]) => ({ day: Number(day), ...v }));
  const pick = (c) => onSelectCampaign?.(c);

  return (
    <section className="card">
      <div className="card-head" style={{ alignItems: 'center' }}>
        <div><h2 className="card-title">{cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</h2><p className="card-desc">Flights run from start to deadline. Deadlines are marked.</p></div>
        <div className="flex-center gap-4">
          <button className="btn btn-ghost btn-sm" onClick={() => setCursor(new Date())}>Today</button>
          <button className="btn btn-ghost btn-icon btn-sm" aria-label="Previous month" onClick={() => setCursor(new Date(year, month - 1, 1))}><Icon icon={ArrowLeft01Icon} size={16} /></button>
          <button className="btn btn-ghost btn-icon btn-sm" aria-label="Next month" onClick={() => setCursor(new Date(year, month + 1, 1))}><Icon icon={ArrowRight01Icon} size={16} /></button>
        </div>
      </div>

      <div className="cal desktop-cal">
        {DAYS.map(d => <div key={d} className="cal-dow">{d}</div>)}
        {Array.from({ length: firstDay }, (_, i) => <div key={`e${i}`} className="cal-cell empty" />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const cell = byDay[day];
          return (
            <div key={day} className={`cal-cell ${cell.key === today ? 'today' : ''}`}>
              <span className="cal-num">{day}</span>
              {cell.deadlines.map(c => <button key={c.id} className="cal-pill due" onClick={() => pick(c)} title={`Deadline: ${c.name}`}>{c.name}</button>)}
              {cell.active.slice(0, 2).map(c => <button key={c.id} className="cal-pill" onClick={() => pick(c)} title={c.name}>{c.name}</button>)}
              {cell.active.length > 2 && <span className="cal-more">+{cell.active.length - 2} more</span>}
            </div>
          );
        })}
      </div>

      <div className="mobile-cal">
        {agenda.length === 0 ? <p className="fs-13 text-muted">No deadlines this month.</p> : agenda.map(a => (
          <div key={a.day} className="list-item" style={{ alignItems: 'flex-start' }}>
            <span className="cal-date"><span>{new Date(year, month, a.day).toLocaleDateString('en-US', { weekday: 'short' })}</span><strong>{a.day}</strong></span>
            <div className="flex-1">{a.deadlines.map(c => <button key={c.id} className="text-btn fs-14" style={{ display: 'block', textAlign: 'left', fontWeight: 600 }} onClick={() => pick(c)}>{c.name}</button>)}<span className="fs-12 text-muted">Due {fmtDate(a.key)}</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}
