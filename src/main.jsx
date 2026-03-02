import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider, useAuth } from '@clerk/clerk-react'
import App from './headcount_planner_1.jsx'
import { AuthGate } from './AuthGate.jsx'
import { UserBadge } from './UserBadge.jsx'
import { initStorage } from './storage.js'
import './index.css'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY — add it to your .env file')
}

// Holds rendering of the app until Supabase storage is ready.
// Prevents the planner's useEffect from reading localStorage before
// the Supabase shim has been installed.
function StorageInit({ children }) {
  const { isSignedIn, getToken } = useAuth()
  const [storageReady, setStorageReady] = useState(false)

  useEffect(() => {
    if (isSignedIn) {
      initStorage(getToken)
      setStorageReady(true)
    }
  }, [isSignedIn, getToken])

  if (!storageReady) return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#FAF4E4',
      fontFamily: 'DM Sans, sans-serif',
      color: '#7A6A58',
      fontSize: 14,
    }}>
      Loading…
    </div>
  )

  return children
}

function Root() {
  return (
    <AuthGate>
      <StorageInit>
        <App />
        <UserBadge />
      </StorageInit>
    </AuthGate>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      clerkJSUrl="https://unpkg.com/@clerk/clerk-js@5/dist/clerk.browser.js"
    >
      <Root />
    </ClerkProvider>
  </React.StrictMode>
)
