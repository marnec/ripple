# External Integrations

**Analysis Date:** 2026-02-05

## APIs & External Services

**Email Delivery:**
- Resend - Transactional email provider for user authentication and workspace invitations
  - SDK/Client: `resend` 4.1.2
  - Auth: `AUTH_RESEND_KEY` environment variable
  - Implementation files: `convex/auth.ts`, `convex/emails.ts`
  - Usage:
    - OTP verification emails for sign-up (ResendOTP provider)
    - Password reset emails (ResendOTPPasswordReset provider)
    - Workspace invitation emails via `sendWorkspaceInvite` action

**OAuth / Social Auth:**
- GitHub - OAuth provider for user sign-in
  - SDK/Client: GitHub provider from @auth/core 0.37.4
  - Auth: GitHub OAuth credentials via Convex Auth
  - Configuration: `convex/auth.ts` line 64
  - Scope: Standard OAuth (profile, email implicit)

**Web Push Notifications:**
- Web Push Protocol (VAPID standard) - Browser push notifications
  - SDK/Client: `web-push` 3.6.7
  - Auth: VAPID credentials
    - `VAPID_SUBJECT` - Subject for VAPID identification
    - `VAPID_PUBLIC_KEY` - Public key for browser subscription
    - `VAPID_PRIVATE_KEY` - Private key for signing push messages
  - Implementation: `convex/pushNotifications.ts`
  - Database: `pushSubscriptions` table stores device subscriptions
  - Flow: Users subscribe via browser API → stored in DB → notifications sent on channel messages

## Data Storage

**Primary Database:**
- Convex Database (cloud-hosted)
  - Connection: via `VITE_CONVEX_URL` environment variable
  - Client: `convex` SDK (automatic via Convex React integration)
  - Type: Multi-table relational database
  - Schema file: `convex/schema.ts`

**Tables:**
- `users` - Auth users (via authTables from @convex-dev/auth)
- `workspaces` - Collaboration spaces (owner, name, description)
- `channels` - Chat channels within workspaces (public/private, role counts)
- `documents` - Collaborative documents (BlockNote-based)
- `diagrams` - Excalidraw diagrams
- `messages` - Chat messages with full-text search index
- `workspaceMembers` - Workspace membership with roles
- `channelMembers` - Channel membership with roles
- `documentMembers` - Document membership with roles
- `workspaceInvites` - Pending workspace invitations
- `pushSubscriptions` - Push notification subscriptions (device, endpoint, encryption keys)
- `signals` - WebRTC signaling data for video calls

**File Storage:**
- Not detected - No cloud file storage integration (S3, GCS, etc.)
- Local file handling via Excalidraw diagram content storage

**Caching:**
- None detected - Convex provides real-time caching via subscriptions

## Authentication & Identity

**Auth Provider:**
- Convex Auth (@convex-dev/auth 0.0.90) with multi-provider support
  - Implementation: `convex/auth.ts`, `convex/auth.config.ts`
  - HTTP routes: `convex/http.ts` (auth.addHttpRoutes)
  - Session management: Convex Auth automatic session handling
  - User context: Available via `getAuthUserId(ctx)` in server functions

**Providers:**
1. GitHub OAuth - Third-party sign-in
2. Email + OTP - Resend-based passwordless authentication
3. Password - Email/password with OTP-based reset via Resend

**Authorization:**
- Role-based access control (RBAC) at three levels:
  - `WorkspaceRole` - workspace level (admin/member)
  - `ChannelRole` - channel level (admin/member)
  - `DocumentRole` - document level (admin/member)
- Roles defined in `@shared/enums/roles.ts`
- Membership tables enforce access: `workspaceMembers`, `channelMembers`, `documentMembers`

## Monitoring & Observability

**Error Tracking:**
- Not detected - No Sentry, LogRocket, or external error tracking

**Logs:**
- Console logging via `console.info()` and `console.error()`
- Examples: `convex/pushNotifications.ts` logs notification delivery success/failure
- No centralized log aggregation detected

## CI/CD & Deployment

**Hosting:**
- Convex Cloud - Backend hosting for database and functions
- Static hosting not specified (Vercel, Netlify, or similar implied)

**CI Pipeline:**
- Not detected - Deployment via git push to main
- Deploy command: `git push origin main:main` (manual or platform webhook)
- Convex deployment: `npx convex deploy` (manual or automated)

**Deployment Environment:**
- Development: Local Convex deployment via `convex dev --until-success`
- Production: Convex cloud deployment via `npm run deploy:convex`

## Environment Configuration

**Required Environment Variables:**

**Frontend (.env.local visible to browser):**
- `VITE_CONVEX_URL` - Convex backend API endpoint (e.g., https://dutiful-pika-875.convex.cloud)
- `VITE_CONVEX_SITE_URL` - Convex auth site URL for OAuth redirects

**Backend (Convex server-only secrets):**
- `AUTH_RESEND_KEY` - Resend API key for email sending
- `VAPID_SUBJECT` - Push notification subject identifier
- `VAPID_PUBLIC_KEY` - Push notification public key
- `VAPID_PRIVATE_KEY` - Push notification private key
- `SITE_URL` - Deployed site URL for invite links (used in `convex/emails.ts`)

**Development:**
- `CONVEX_DEPLOYMENT` - Local development deployment identifier
- `SETUP_SCRIPT_RAN` - Flag for initialization script

**Secrets Location:**
- Local: `.env.local` (git-ignored, never committed)
- Production: Convex dashboard environment variables + hosting platform secrets

## Webhooks & Callbacks

**Incoming:**
- None detected

**Outgoing:**
- None detected (Resend email sending is API-based, not webhook)

**OAuth Redirects:**
- GitHub OAuth callback handled by Convex Auth HTTP routes
- Callback URL configured via `convex/auth.config.ts` domain: `process.env.CONVEX_SITE_URL`

---

*Integration audit: 2026-02-05*
