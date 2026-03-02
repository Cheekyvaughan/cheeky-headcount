import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useUser, useClerk } from '@clerk/clerk-react'

export function UserBadge() {
  const { user } = useUser()
  const { signOut } = useClerk()
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState(null)

  // Mount a container div into the app header's right-side flex row
  // We use a fixed-position overlay so we don't need to modify the planner source
  useEffect(() => {
    const el = document.createElement('div')
    el.id = 'cn-user-badge'
    el.style.cssText = `
      position: fixed;
      top: 14px;
      right: 24px;
      z-index: 1100;
      display: flex;
      align-items: center;
    `
    document.body.appendChild(el)
    setContainer(el)
    return () => document.body.removeChild(el)
  }, [])

  if (!container || !user) return null

  const name = user.fullName || user.firstName || user.primaryEmailAddress?.emailAddress
  const email = user.primaryEmailAddress?.emailAddress
  const avatar = user.imageUrl

  const badge = (
    <div style={{ position: 'relative', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Avatar button */}
      <button
        onClick={() => setOpen(v => !v)}
        title={email}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(255,255,255,0.18)',
          border: '1px solid rgba(255,255,255,0.38)',
          borderRadius: 8,
          padding: '5px 10px 5px 5px',
          cursor: 'pointer',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {avatar
          ? <img src={avatar} alt={name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
          : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700 }}>
              {(name?.[0] ?? '?').toUpperCase()}
            </div>
        }
        <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1099 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 240,
            background: '#fff',
            border: '1px solid #E0D4BC',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
            zIndex: 1200,
            overflow: 'hidden',
          }}>
            {/* User info */}
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #E0D4BC', background: '#FAF4E4' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1C1208', marginBottom: 2 }}>{name}</div>
              <div style={{ fontSize: 11, color: '#7A6A58' }}>{email}</div>
            </div>

            {/* Sign out */}
            <button
              onClick={() => signOut()}
              style={{
                display: 'block',
                width: '100%',
                padding: '11px 14px',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                fontSize: 13,
                fontWeight: 600,
                color: '#DC2626',
                cursor: 'pointer',
                fontFamily: "'DM Sans', sans-serif",
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#FEE2E2'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )

  return createPortal(badge, container)
}
