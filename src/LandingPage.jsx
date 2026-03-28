import { useState } from 'react'

const FH = "'Bowlby One SC', sans-serif";
const FB = "'Barlow Semi Condensed', sans-serif";

const C = {
  orange:     "#FF3C00",
  orangeHov:  "#D93200",
  cream:      "#FBF5DF",
  creamDark:  "#EFE7C8",
  dark:       "#3C3C37",
  mid:        "#494843",
  border:     "#EAE6E5",
  white:      "#FFFFFF",
};

function Tile({ icon, title, description, subItems, action, isAdmin, onNavigate, isMobile }) {
  const [hovered, setHovered] = useState(false);
  const [hoveredSub, setHoveredSub] = useState(null);

  return (
    <div
      style={{
        backgroundColor: C.white,
        borderRadius: 16,
        border: `1.5px solid ${hovered && action ? C.orange : C.border}`,
        boxShadow: hovered && action
          ? '0 8px 32px rgba(255,60,0,0.12)'
          : '0 2px 10px rgba(0,0,0,0.06)',
        padding: isMobile ? '20px 18px' : '28px 24px',
        cursor: action ? 'pointer' : 'default',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={action || undefined}
    >
      <div style={{ fontSize: 32, marginBottom: 12 }}>{icon}</div>
      <div style={{
        fontFamily: FH,
        fontSize: isMobile ? 16 : 18,
        color: C.dark,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        lineHeight: 1.15,
        marginBottom: 8,
      }}>
        {title}
      </div>
      <div style={{
        fontFamily: FB,
        fontSize: 14,
        color: C.mid,
        lineHeight: 1.55,
        marginBottom: subItems ? 18 : 0,
        flex: subItems ? undefined : 1,
      }}>
        {description}
      </div>

      {subItems && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          {subItems.map(sub => (
            <button
              key={sub.tab}
              onClick={e => { e.stopPropagation(); onNavigate(sub.tab); }}
              onMouseEnter={() => setHoveredSub(sub.tab)}
              onMouseLeave={() => setHoveredSub(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                backgroundColor: hoveredSub === sub.tab ? '#FFF2EF' : C.creamDark,
                border: `1.5px solid ${hoveredSub === sub.tab ? C.orange : 'transparent'}`,
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: FB,
                fontSize: 13,
                fontWeight: 600,
                color: hoveredSub === sub.tab ? C.orange : C.dark,
                textAlign: 'left',
                transition: 'all 0.1s ease',
              }}
            >
              <span style={{ fontSize: 15, flexShrink: 0 }}>{sub.icon}</span>
              <span style={{ flex: 1 }}>{sub.label}</span>
              <span style={{ fontSize: 12, opacity: 0.4 }}>›</span>
            </button>
          ))}
        </div>
      )}

      {action && (
        <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontFamily: FB, fontSize: 13, fontWeight: 700, color: C.orange }}>Open</span>
          <span style={{ fontSize: 13, color: C.orange }}>→</span>
        </div>
      )}
    </div>
  );
}

export function LandingPage({ onNavigate, isAdmin, isMobile }) {
  const tiles = [
    {
      id: 'forecast',
      icon: '📐',
      title: 'Forecast & Planning',
      description: 'Configure stores, forecast parameters, and manage planning periods.',
      action: () => onNavigate('forecast-setup'),
    },
    {
      id: 'headcount',
      icon: '👥',
      title: 'Headcount Planning',
      description: 'Manage your team\'s labour costs, schedules, and headcount across all roles.',
      subItems: [
        { label: 'Headcount Forecaster', tab: 'forecast',  icon: '🔮' },
        { label: 'Schedule',             tab: 'plan',      icon: '📋' },
        { label: 'Insights',             tab: 'summary',   icon: '📊' },
        { label: 'Job Roles',            tab: 'roles',     icon: '👤' },
        { label: 'Taxes & Regs',         tab: 'settings',  icon: '⚖️' },
      ],
    },
    {
      id: 'system',
      icon: '⚙️',
      title: 'System Settings',
      description: 'Manage users, admin permissions, and system-wide configuration.',
      action: () => onNavigate(isAdmin ? 'admin' : 'settings'),
    },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: isMobile ? 28 : 40 }}>
        <div style={{
          fontFamily: FH,
          fontSize: isMobile ? 22 : 28,
          color: C.orange,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          lineHeight: 1.1,
        }}>
          Welcome Back
        </div>
        <div style={{ fontFamily: FB, fontSize: 15, color: C.mid, marginTop: 6 }}>
          Where would you like to go today?
        </div>
      </div>

      {/* Tiles */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
        gap: isMobile ? 16 : 20,
        alignItems: 'start',
      }}>
        {tiles.map(tile => (
          <Tile
            key={tile.id}
            {...tile}
            isAdmin={isAdmin}
            onNavigate={onNavigate}
            isMobile={isMobile}
          />
        ))}
      </div>
    </div>
  );
}
