import React, { useEffect, useState, useMemo, useRef } from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider, useAuth, useUser } from '@clerk/clerk-react'
import App from './headcount_planner_1.jsx'
import { AuthGate } from './AuthGate.jsx'
import { UserBadge } from './UserBadge.jsx'
import { initStorage } from './storage.js'
import './index.css'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!CLERK_PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY — add it to your .env file')
}

const Loading = () => (
  <div style={{
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FAF4E4', fontFamily: 'DM Sans, sans-serif', color: '#7A6A58', fontSize: 14,
  }}>Loading…</div>
)

function StorageInit() {
  const { isSignedIn, getToken } = useAuth()
  const { user, isLoaded } = useUser()
  const [storageReady, setStorageReady] = useState(false)
  // initStorage must only be called once — guard against StrictMode double-fire
  const initDone = useRef(false)

  // ALL hooks must come before any conditional return (Rules of Hooks)
  // Memoize on stable primitives so currentUser ref doesn't change between renders
  const currentUser = useMemo(() => {
    if (!user) return null
    return {
      id: user.id,
      email: user.primaryEmailAddress?.emailAddress || '',
      name: user.fullName || user.firstName || user.primaryEmailAddress?.emailAddress || '',
      avatar: user.imageUrl || null,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user?.id,
    user?.primaryEmailAddress?.emailAddress,
    user?.fullName,
    user?.firstName,
    user?.imageUrl,
  ])

  useEffect(() => {
    if (isSignedIn && !initDone.current) {
      initDone.current = true
      initStorage(getToken)
      setStorageReady(true)
    }
  }, [isSignedIn, getToken])

  if (!storageReady || !isLoaded || !user || !currentUser) return <Loading />

  return (
    <>
      <App currentUser={currentUser} />
      <UserBadge />
    </>
  )
}

function Root() {
  return (
    <AuthGate>
      <StorageInit />
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