import { SignIn, useAuth, useUser } from '@clerk/clerk-react'

const ALLOWED_DOMAIN = 'cheekynoodles.com'

export function AuthGate({ children }) {
  const { isLoaded, isSignedIn } = useAuth()
  const { user } = useUser()

  // Still loading Clerk session
  if (!isLoaded) {
    return (
      <div style={{ background: '#FAF4E4', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: 'DM Sans, sans-serif', color: '#7A6A58', fontSize: 16 }}>Loading…</div>
      </div>
    )
  }

  // Not signed in — show Clerk's hosted sign-in widget
  if (!isSignedIn) {
    return (
      <div style={{
        background: '#FAF4E4',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 24,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 32, fontWeight: 700, color: '#1C1208', letterSpacing: '-0.5px' }}>
            Cheeky Noodles
          </div>
          <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: 14, color: '#7A6A58', marginTop: 4 }}>
            Cheeky Forecaster — sign in with your @cheekynoodles.com account
          </div>
        </div>
        <SignIn
          routing="hash"
          appearance={{
            variables: {
              colorPrimary: '#F43A0A',
              colorBackground: '#FFFFFF',
              fontFamily: 'DM Sans, sans-serif',
              borderRadius: '8px',
            },
            elements: {
              card: { boxShadow: '0 2px 16px rgba(0,0,0,0.08)', border: '1px solid #E0D4BC' },
              headerTitle: { fontFamily: 'Barlow Condensed, sans-serif', fontSize: 22 },
            }
          }}
        />
      </div>
    )
  }

  // Signed in but wrong domain
  const email = user?.primaryEmailAddress?.emailAddress ?? ''
  const domain = email.split('@')[1] ?? ''

  if (domain !== ALLOWED_DOMAIN) {
    return (
      <div style={{
        background: '#FAF4E4',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        fontFamily: 'DM Sans, sans-serif',
      }}>
        <div style={{ fontSize: 32 }}>🚫</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#1C1208' }}>Access restricted</div>
        <div style={{ fontSize: 14, color: '#7A6A58', textAlign: 'center', maxWidth: 320 }}>
          <strong>{email}</strong> is not an authorised account. Sign in with your @cheekynoodles.com Google account.
        </div>
        <button
          onClick={() => window.Clerk?.signOut()}
          style={{
            marginTop: 8,
            padding: '10px 24px',
            background: '#F43A0A',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontFamily: 'DM Sans, sans-serif',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Sign out and try again
        </button>
      </div>
    )
  }

  // All good — render the app
  return children
}
