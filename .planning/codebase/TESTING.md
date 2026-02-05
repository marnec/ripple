# Testing Patterns

**Analysis Date:** 2026-02-05

## Test Framework

**Status:** No testing framework configured

**Analysis:**
This codebase does not currently have automated tests in place. No Jest, Vitest, Mocha, or other test runner is configured. The `package.json` contains no test scripts and no test dependencies are installed.

**Implications:**
- No unit tests for components, utilities, or backend functions
- No integration tests for API endpoints
- No end-to-end tests for workflows
- Testing relies entirely on manual verification
- All code changes require manual testing before deployment

## Run Commands

**No test commands available:**
```bash
npm test              # Not defined
npm run test:watch   # Not defined
npm run test:coverage # Not defined
```

## Test File Organization

**Current State:** Not applicable - no tests exist

**Recommended Approach (when implementing):**
- Co-locate tests with source: `Component.tsx` alongside `Component.test.tsx`
- Convex backend tests in `/convex/__tests__/` directory
- Common utilities in `/src/lib/__tests__/`
- Hooks in `/src/hooks/__tests__/`

## Test Structure

**Recommended Pattern (based on codebase needs):**

For React components:
```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Message } from './Message';

describe('Message', () => {
  it('should render message content', () => {
    // Test component rendering and interactions
  });

  it('should call delete handler when delete is clicked', async () => {
    // Test user interactions
  });
});
```

For Convex backend:
```typescript
import { v } from 'convex/values';
import { send } from './messages';

describe('messages.send', () => {
  it('should create a message for authenticated user', async () => {
    // Test mutation with mocked context
  });

  it('should throw error when user is not authenticated', async () => {
    // Test error handling
  });
});
```

## Mocking

**Currently Not Implemented**

**Recommended approach for this codebase:**

For React components:
- Mock Convex hooks: `useQuery`, `useMutation`, `useQuery`
- Use `jest.mock('@convex/react')` to stub API calls
- Mock `next-themes` for theme testing
- Mock router context with `react-router-dom` testing utilities

For Convex backend:
- Mock database context (`ctx.db`)
- Mock authentication with `getAuthUserId()` stubs
- Mock external services (Resend for emails, web-push for notifications)

**What to Mock:**
- Convex API calls and database operations
- Authentication and authorization checks
- External service integrations (email, push notifications)
- Router and navigation

**What NOT to Mock:**
- Core business logic
- Data transformation and validation
- Convex value validators (test with real validators)

## Fixtures and Factories

**Currently Not Implemented**

**Recommended structure for test data:**

```typescript
// /src/__tests__/fixtures/user.ts
export const mockUser = {
  _id: 'user_123' as Id<'users'>,
  _creationTime: 1234567890,
  name: 'Test User',
  email: 'test@example.com',
  image: 'https://example.com/avatar.jpg',
  tokenIdentifier: 'google|123',
};

// /src/__tests__/factories/message.ts
export function createMessage(overrides?: Partial<MessageWithAuthor>) {
  return {
    _id: 'msg_123' as Id<'messages'>,
    _creationTime: Date.now(),
    userId: 'user_123' as Id<'users'>,
    body: '<p>Test message</p>',
    plainText: 'Test message',
    channelId: 'channel_123' as Id<'channels'>,
    deleted: false,
    author: 'Test User',
    isomorphicId: 'client-123',
    ...overrides,
  };
}
```

**Location:** Store in `src/__tests__/fixtures/` and `src/__tests__/factories/`

## Coverage

**Current Status:** No coverage measurement in place

**Recommended Target:** 70-80% for critical paths
- 100% for authentication and authorization checks
- 90%+ for error handling paths
- 70%+ for UI components
- 80%+ for backend business logic

**View Coverage (when implemented):**
```bash
npm run test:coverage
```

## Test Types

**Unit Tests (Recommended Priority 1):**
- Test individual Convex functions (queries, mutations)
- Test utility functions (`cn()`, helper functions)
- Test custom hooks in isolation
- Scope: Single function behavior in multiple scenarios

**Integration Tests (Recommended Priority 2):**
- Test message sending workflow (compose → send → display)
- Test channel creation and membership flows
- Test workspace invitation and acceptance
- Scope: Multiple functions working together across layers

**E2E Tests (Recommended Priority 3):**
- Test complete user workflows from login to creating workspace/channel/document
- Test real-time collaboration features (presence, document sync)
- Test video call setup and messaging
- Framework: Playwright or Cypress (not configured)

## Common Patterns to Test

**Async Testing (Critical in this codebase):**
```typescript
// Pattern observed: handlers are async with await
handler: async (ctx, { id, body, plainText }) => {
  const userId = await getAuthUserId(ctx);  // Async auth check
  if (!userId) throw new ConvexError("Not authenticated");

  const message = await ctx.db.get(id);    // Async DB operations
  await ctx.db.patch(id, { body, plainText }); // Async updates
  return null;
}

// Test with async/await:
it('should update message when user is author', async () => {
  const result = await update(mockCtx, { id: 'msg_123', body: '...', plainText: '...' });
  expect(result).toBeNull();
});
```

**Error Testing (Critical - extensively used):**
```typescript
// Pattern observed: ConvexError thrown for various failures
if (!userId) throw new ConvexError("Not authenticated");
if (!message) throw new ConvexError("Message not found");
if (message.userId !== userId) throw new ConvexError("Not authorized to update this message");

// Test error cases:
it('should throw ConvexError when message not found', async () => {
  expect(async () => {
    await update(mockCtx, { id: 'nonexistent', body: '...', plainText: '...' });
  }).rejects.toThrow(ConvexError);
});

it('should include descriptive error message', async () => {
  expect(async () => {
    await remove(mockCtx, { id: 'msg_123' }); // User not author
  }).rejects.toThrow("Not authorized to delete this message");
});
```

**Authorization/Permission Testing (Critical):**
```typescript
// Pattern observed: Multiple membership checks in every handler
- Check workspace membership before allowing channel operations
- Check channel membership for private channels
- Check document membership
- Check admin role for deletions

// Test patterns:
it('should prevent non-members from accessing channel', async () => {
  // mockCtx user is not in workspace
  expect(async () => {
    await list(mockCtx, { channelId: 'channel_in_other_workspace' });
  }).rejects.toThrow("not a member");
});

it('should allow workspace members to access public channels', async () => {
  // User is workspace member, channel is public
  const result = await list(mockCtx, { workspaceId: 'workspace_123' });
  expect(result).toBeDefined();
});
```

**Batch Fetch Pattern Testing:**
```typescript
// Pattern observed: Using convex-helpers getAll() to avoid N+1
const userIds = [...new Set(messagesPage.page.map((m) => m.userId))];
const users = await getAll(ctx.db, userIds);
const userMap = new Map(users.map((u, i) => [userIds[i], u]));

// Test that enrichment works correctly:
it('should enrich messages with author names', async () => {
  const result = await list(mockCtx, { channelId: 'channel_123', paginationOpts: {...} });
  expect(result.page[0].author).toBe('Test User');
  expect(result.page[1].author).toBe('Another User');
});
```

**React Component Testing Patterns:**
```typescript
// Pattern observed: Components use Convex hooks and context
import { useMutation } from "convex/react";
import { UserContext } from "@/pages/App/App";

// Test with mocked hooks:
jest.mock('convex/react', () => ({
  useMutation: jest.fn(),
}));

it('should call delete mutation when delete is clicked', async () => {
  const mockDelete = jest.fn();
  useMutation.mockReturnValue(mockDelete);

  render(<Message message={mockMessage} />);
  const deleteButton = screen.getByText('Delete');
  await userEvent.click(deleteButton);

  expect(mockDelete).toHaveBeenCalledWith({ id: 'msg_123' });
});
```

## Testing Gaps and Risks

**High Priority Gaps:**
- **Authentication/Authorization:** No tests for permission checks in Convex functions - high risk for security issues
- **Data Integrity:** No tests for cascade deletes (e.g., deleting channel also deletes messages and memberships)
- **Error Handling:** No tests verifying ConvexError messages are appropriate and helpful
- **Message Search:** Search functionality with full-text index not tested

**Medium Priority Gaps:**
- **Real-time Sync:** Presence updates, collaborative document sync, message pagination - complex to test without infrastructure
- **Email Integration:** Invitation and password reset emails not tested
- **Push Notifications:** Complex subscription and notification sending logic not tested
- **Video Call Signaling:** WebRTC signaling and peer connection logic not tested

**Component Testing Gaps:**
- Modal dialogs (CreateChannelDialog, InviteUserDialog, RenameDiagramDialog) not tested for form submission
- Message composition and formatting not tested
- Sidebar and navigation components not tested

---

*Testing analysis: 2026-02-05*

**Note:** No testing infrastructure exists. To implement testing, start with:
1. Install Jest/Vitest and testing libraries: `npm install --save-dev jest @testing-library/react @testing-library/user-event`
2. Create Jest config
3. Write tests for critical paths: authentication, authorization, data mutations
4. Add CI/CD integration to run tests on pull requests
