import React, { useState, useEffect, useMemo } from 'react';

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_year', label: 'This year' }
];

const WEEK_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function getPresetRange(presetId) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (presetId) {
    case 'today':
      return {
        startDate: new Date(today),
        endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999),
        label: 'Today'
      };
    case 'yesterday': {
      const yest = new Date(today.getTime() - 86400000);
      return {
        startDate: new Date(yest.getFullYear(), yest.getMonth(), yest.getDate()),
        endDate: new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59, 999),
        label: 'Yesterday'
      };
    }
    case 'this_week': {
      const day = today.getDay() || 7;
      const monday = new Date(today.getTime() - (day - 1) * 86400000);
      return {
        startDate: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate()),
        endDate: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999),
        label: 'This week'
      };
    }
    case 'last_week': {
      const day = today.getDay() || 7;
      const lastMonday = new Date(today.getTime() - (day - 1 + 7) * 86400000);
      const lastSunday = new Date(today.getTime() - day * 86400000);
      return {
        startDate: new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate()),
        endDate: new Date(lastSunday.getFullYear(), lastSunday.getMonth(), lastSunday.getDate(), 23, 59, 59, 999),
        label: 'Last week'
      };
    }
    case 'this_month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
      return {
        startDate: start,
        endDate: end,
        label: 'This month'
      };
    }
    case 'last_month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
      return {
        startDate: start,
        endDate: end,
        label: 'Last month'
      };
    }
    case 'this_year': {
      const start = new Date(today.getFullYear(), 0, 1);
      const end = new Date(today.getFullYear(), 11, 31, 23, 59, 59, 999);
      return {
        startDate: start,
        endDate: end,
        label: 'This year'
      };
    }
    default:
      return {
        startDate: null,
        endDate: null,
        label: 'All time'
      };
  }
}

function getMonthDays(year, month) {
  const firstDay = new Date(year, month, 1);
  const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const days = [];

  // Leading days from previous month
  for (let i = startingDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const date = new Date(year, month - 1, d);
    days.push({
      dayNumber: d,
      date,
      isCurrentMonth: false
    });
  }

  // Days in current month
  for (let i = 1; i <= daysInMonth; i++) {
    const date = new Date(year, month, i);
    days.push({
      dayNumber: i,
      date,
      isCurrentMonth: true
    });
  }

  // Trailing days from next month to reach 35 days (5 rows)
  const remaining = 35 - days.length;
  for (let i = 1; i <= (remaining > 0 ? remaining : 0); i++) {
    const date = new Date(year, month + 1, i);
    days.push({
      dayNumber: i,
      date,
      isCurrentMonth: false
    });
  }

  return days;
}

export default function UGCDualDateRangePicker({
  isOpen,
  onClose,
  currentRange = {},
  onApply
}) {
  const [tempStartDate, setTempStartDate] = useState(currentRange.startDate || null);
  const [tempEndDate, setTempEndDate] = useState(currentRange.endDate || null);
  const [tempPreset, setTempPreset] = useState(currentRange.preset || 'all');
  const [hoverDate, setHoverDate] = useState(null);

  // Initialize base calendar month to current date or selected start date
  const [currentBaseMonth, setCurrentBaseMonth] = useState(() => {
    const initial = currentRange.startDate ? new Date(currentRange.startDate) : new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });

  useEffect(() => {
    if (isOpen) {
      setTempStartDate(currentRange.startDate || null);
      setTempEndDate(currentRange.endDate || null);
      setTempPreset(currentRange.preset || 'all');
      if (currentRange.startDate) {
        setCurrentBaseMonth(new Date(currentRange.startDate.getFullYear(), currentRange.startDate.getMonth(), 1));
      } else {
        const now = new Date();
        setCurrentBaseMonth(new Date(now.getFullYear(), now.getMonth(), 1));
      }
    }
  }, [isOpen, currentRange]);

  // Months for dual view
  const month1Year = currentBaseMonth.getFullYear();
  const month1Index = currentBaseMonth.getMonth();

  const month2Date = useMemo(() => {
    return new Date(month1Year, month1Index + 1, 1);
  }, [month1Year, month1Index]);

  const month2Year = month2Date.getFullYear();
  const month2Index = month2Date.getMonth();

  const month1Days = useMemo(() => getMonthDays(month1Year, month1Index), [month1Year, month1Index]);
  const month2Days = useMemo(() => getMonthDays(month2Year, month2Index), [month2Year, month2Index]);

  // Header Title e.g. "September - October 2026"
  const headerTitle = useMemo(() => {
    const m1 = currentBaseMonth.toLocaleString('default', { month: 'long' });
    const m2 = month2Date.toLocaleString('default', { month: 'long' });
    if (month1Year === month2Year) {
      return `${m1} - ${m2} ${month1Year}`;
    }
    return `${m1} ${month1Year} - ${m2} ${month2Year}`;
  }, [currentBaseMonth, month2Date, month1Year, month2Year]);

  // Navigation handlers
  const handlePrevMonth = () => {
    setCurrentBaseMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentBaseMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  // Date selection logic
  const handleDateClick = (date) => {
    const clicked = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (!tempStartDate || (tempStartDate && tempEndDate)) {
      setTempStartDate(clicked);
      setTempEndDate(null);
      setTempPreset(null);
    } else {
      if (clicked < tempStartDate) {
        setTempStartDate(clicked);
        setTempEndDate(new Date(tempStartDate.getFullYear(), tempStartDate.getMonth(), tempStartDate.getDate(), 23, 59, 59, 999));
      } else {
        setTempEndDate(new Date(clicked.getFullYear(), clicked.getMonth(), clicked.getDate(), 23, 59, 59, 999));
      }
      setTempPreset(null);
    }
  };

  const handlePresetClick = (presetId) => {
    setTempPreset(presetId);
    const range = getPresetRange(presetId);
    setTempStartDate(range.startDate);
    setTempEndDate(range.endDate);
    if (range.startDate) {
      setCurrentBaseMonth(new Date(range.startDate.getFullYear(), range.startDate.getMonth(), 1));
    }
  };

  const handleAllTimeClick = () => {
    setTempPreset('all');
    setTempStartDate(null);
    setTempEndDate(null);
  };

  const handleApply = () => {
    let label = 'Select date range';
    if (tempPreset && tempPreset !== 'all' && tempPreset !== 'custom') {
      label = PRESETS.find(p => p.id === tempPreset)?.label || 'Preset';
    } else if (tempStartDate && tempEndDate) {
      const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      label = tempStartDate.toDateString() === tempEndDate.toDateString()
        ? fmt(tempStartDate)
        : `${fmt(tempStartDate)} - ${fmt(tempEndDate)}`;
    } else if (tempPreset === 'all') {
      label = 'Select date range';
    }

    onApply({
      preset: tempPreset || (tempStartDate && tempEndDate ? 'custom' : 'all'),
      startDate: tempStartDate,
      endDate: tempEndDate,
      label
    });
    onClose();
  };

  // Footer status label
  const footerStatusText = useMemo(() => {
    if (!tempStartDate && !tempEndDate) {
      return 'No range selected';
    }
    if (tempStartDate && tempEndDate) {
      const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      if (tempStartDate.toDateString() === tempEndDate.toDateString()) {
        return fmt(tempStartDate);
      }
      return `${fmt(tempStartDate)} - ${fmt(tempEndDate)}`;
    }
    if (tempStartDate) {
      return `${tempStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ...`;
    }
    return 'No range selected';
  }, [tempStartDate, tempEndDate]);

  if (!isOpen) return null;

  const renderMonthCalendar = (days) => {
    const todayStr = new Date().toDateString();

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 224 }}>
        {/* Days of week header: S M T W T F S */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: 4 }}>
          {WEEK_DAYS.map((wd, i) => (
            <div key={i} style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {wd}
            </div>
          ))}
        </div>

        {/* Days Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 4, textAlign: 'center' }}>
          {days.map((item, idx) => {
            const itemDate = item.date;
            const isToday = itemDate.toDateString() === todayStr;
            const isStart = tempStartDate && itemDate.toDateString() === tempStartDate.toDateString();
            const isEnd = tempEndDate && itemDate.toDateString() === tempEndDate.toDateString();

            // Range calculation
            let inRange = false;
            if (tempStartDate && tempEndDate) {
              inRange = itemDate >= tempStartDate && itemDate <= tempEndDate;
            } else if (tempStartDate && !tempEndDate && hoverDate) {
              const start = tempStartDate <= hoverDate ? tempStartDate : hoverDate;
              const end = tempStartDate <= hoverDate ? hoverDate : tempStartDate;
              inRange = itemDate >= start && itemDate <= end;
            }

            // Cell colors & styles
            let bg = 'transparent';
            let color = item.isCurrentMonth ? '#e5e7eb' : '#4b5563';
            let borderRadius = '0';
            let fontWeight = 500;

            if (isStart || isEnd) {
              bg = '#2563eb';
              color = '#ffffff';
              fontWeight = 700;
              borderRadius = '50%';
            } else if (inRange) {
              bg = 'rgba(37, 99, 235, 0.22)';
              color = '#ffffff';
            }

            return (
              <div
                key={idx}
                onClick={() => handleDateClick(itemDate)}
                onMouseEnter={() => setHoverDate(itemDate)}
                style={{
                  height: 30,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  background: inRange && !isStart && !isEnd ? 'rgba(37, 99, 235, 0.22)' : 'transparent',
                  userSelect: 'none'
                }}
              >
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: borderRadius || (isToday ? '50%' : '4px'),
                  background: bg,
                  border: isToday && !isStart && !isEnd ? '1px solid rgba(255,255,255,0.45)' : 'none',
                  color: color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: fontWeight,
                  transition: 'background 0.1s ease'
                }}>
                  {item.dayNumber}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Invisible backdrop for outside click dismiss */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 199,
          background: 'transparent'
        }}
        onClick={onClose}
      />

      {/* Floating Dual-Month Date Picker Container */}
      <div
        style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          background: '#16181e',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 14,
          boxShadow: '0 20px 50px rgba(0,0,0,0.65)',
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
          width: 660,
          color: '#e5e7eb',
          fontFamily: 'inherit'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Main Content: Sidebar Presets + Dual Calendar */}
        <div style={{ display: 'flex', minHeight: 280 }}>
          {/* 1. Left Sidebar: Presets */}
          <div style={{
            width: 140,
            borderRight: '1px solid rgba(255,255,255,0.08)',
            padding: '16px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2
          }}>
            {PRESETS.map(p => {
              const active = tempPreset === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => handlePresetClick(p.id)}
                  style={{
                    background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                    color: active ? '#ffffff' : '#9ca3af',
                    border: 'none',
                    borderRadius: 6,
                    padding: '8px 12px',
                    textAlign: 'left',
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.12s ease'
                  }}
                  onMouseEnter={e => {
                    if (!active) e.currentTarget.style.color = '#ffffff';
                  }}
                  onMouseLeave={e => {
                    if (!active) e.currentTarget.style.color = '#9ca3af';
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* 2. Right Panel: Dual Month Calendar */}
          <div style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
            {/* Calendar Header with navigation arrows */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16
            }}>
              <button
                onClick={handlePrevMonth}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#9ca3af',
                  fontSize: 14,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: 4
                }}
                title="Previous month"
              >
                ‹
              </button>

              <div style={{ fontSize: 13, fontWeight: 700, color: '#ffffff', letterSpacing: '0.2px' }}>
                {headerTitle}
              </div>

              <button
                onClick={handleNextMonth}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#9ca3af',
                  fontSize: 14,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: 4
                }}
                title="Next month"
              >
                ›
              </button>
            </div>

            {/* Dual Calendars Side-by-Side */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
              {renderMonthCalendar(month1Days)}
              {renderMonthCalendar(month2Days)}
            </div>
          </div>
        </div>

        {/* 3. Bottom Footer Bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 20px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(0,0,0,0.2)',
          borderBottomLeftRadius: 14,
          borderBottomRightRadius: 14
        }}>
          {/* Status on Left */}
          <div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>
            {footerStatusText}
          </div>

          {/* Actions on Right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#9ca3af',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '6px 12px'
              }}
            >
              Cancel
            </button>

            <button
              onClick={handleAllTimeClick}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#e5e7eb',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '6px 14px',
                borderRadius: 6,
                transition: 'background 0.12s ease'
              }}
            >
              All Time
            </button>

            <button
              onClick={handleApply}
              style={{
                background: '#ffffff',
                border: 'none',
                color: '#000000',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                padding: '6px 18px',
                borderRadius: 6,
                transition: 'opacity 0.12s ease'
              }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
