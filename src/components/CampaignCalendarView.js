import React, { useState, useMemo } from 'react';
import { platformMeta } from '../utils';

export default function CampaignCalendarView({ campaigns = [], db, onSelectCampaign }) {
  const [currentDate, setCurrentDate] = useState(() => new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  // First day of current month & total days
  const firstDay = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const todayMonth = () => setCurrentDate(new Date());

  // Map campaigns to dates in this month
  const campaignsByDate = useMemo(() => {
    const map = {};
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayDate = new Date(year, month, day);

      const activeCamps = campaigns.filter(c => {
        const start = c.start_date ? new Date(c.start_date) : new Date(c.created_at);
        const end = c.deadline ? new Date(c.deadline) : null;
        if (!end) return false;

        // Strip time
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);

        return dayDate >= start && dayDate <= end;
      });

      const deadlines = campaigns.filter(c => {
        if (!c.deadline) return false;
        return c.deadline.startsWith(dateStr);
      });

      map[day] = { activeCamps, deadlines };
    }
    return map;
  }, [campaigns, year, month, daysInMonth]);

  // Calendar cells: empty padding days + actual days
  const calendarCells = [];
  for (let i = 0; i < firstDay; i++) {
    calendarCells.push({ empty: true, key: `empty-${i}` });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    calendarCells.push({ empty: false, day: d, key: `day-${d}`, ...campaignsByDate[d] });
  }

  const isToday = (day) => {
    const today = new Date();
    return today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
  };

  return (
    <div className="premium-card" style={{ padding: 20 }}>
      {/* Calendar Header Controls */}
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
            Campaign Schedule & Deadlines
          </h3>
          <p style={{ color: 'var(--ink3)', fontSize: 12, marginTop: 4 }}>
            Visual flight tracking across active deliverables
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={todayMonth} style={{ fontSize: 12 }}>
            Today
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="btn btn-ghost btn-sm" onClick={prevMonth} style={{ padding: '4px 10px' }}>
              ◀
            </button>
            <span style={{ fontWeight: 700, fontSize: 14, minWidth: 140, textAlign: 'center' }}>
              {monthName}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={nextMonth} style={{ padding: '4px 10px' }}>
              ▶
            </button>
          </div>
        </div>
      </div>

      {/* Days of Week Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 6,
        textAlign: 'center',
        fontWeight: 600,
        fontSize: 12,
        color: 'var(--ink3)',
        marginBottom: 8
      }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} style={{ padding: '4px 0' }}>{d}</div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 6
      }}>
        {calendarCells.map(cell => {
          if (cell.empty) {
            return (
              <div
                key={cell.key}
                style={{
                  minHeight: 90,
                  background: 'var(--bg2)',
                  opacity: 0.3,
                  borderRadius: 6
                }}
              />
            );
          }

          const hasDeadlines = cell.deadlines && cell.deadlines.length > 0;

          return (
            <div
              key={cell.key}
              style={{
                minHeight: 90,
                background: isToday(cell.day) ? 'rgba(37, 99, 235, 0.05)' : 'var(--bg)',
                border: isToday(cell.day) ? '2px solid var(--blue)' : '1px solid var(--border)',
                borderRadius: 6,
                padding: 6,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                overflow: 'hidden'
              }}
            >
              {/* Day Number Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 12,
                fontWeight: isToday(cell.day) ? 800 : 500,
                color: isToday(cell.day) ? 'var(--blue)' : 'var(--ink)'
              }}>
                <span>{cell.day}</span>
                {hasDeadlines && (
                  <span title="Deadline Day" style={{ fontSize: 10 }}>🚩</span>
                )}
              </div>

              {/* Deadlines Pills */}
              {cell.deadlines?.map(c => {
                return (
                  <div
                    key={`dl-${c.id}`}
                    onClick={() => onSelectCampaign && onSelectCampaign(c)}
                    style={{
                      background: 'var(--red)',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                    title={`Deadline: ${c.name}`}
                  >
                    🚩 {c.name}
                  </div>
                );
              })}

              {/* Active Campaigns Flight Bars */}
              {cell.activeCamps?.filter(c => !cell.deadlines?.some(d => d.id === c.id)).slice(0, 2).map(c => {
                const meta = platformMeta(c.format);
                return (
                  <div
                    key={`act-${c.id}`}
                    onClick={() => onSelectCampaign && onSelectCampaign(c)}
                    style={{
                      background: meta.bg,
                      color: meta.text,
                      border: `1px solid ${meta.border}`,
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 4px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                    title={`${c.name} (Flight Active)`}
                  >
                    {meta.icon} {c.name}
                  </div>
                );
              })}

              {cell.activeCamps?.length > 2 && (
                <div style={{ fontSize: 9, color: 'var(--ink3)', textAlign: 'center' }}>
                  +{cell.activeCamps.length - 2} more
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
