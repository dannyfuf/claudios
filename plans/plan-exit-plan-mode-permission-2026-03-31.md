# Implementation Plan: Require User Permission to Exit Plan Mode
Generated: 2026-03-31

---

## Summary

When the Claude agent is running in **plan mode**, it should **not** be able to exit plan mode autonomously by calling the `ExitPlanMode` tool. Instead, it must pause and ask the user for permission — the user explicitly approves or denies the transition. This prevents the agent from silently leaving plan mode without human oversight.

**Why:** Plan mode is a safety boundary. Letting the agent self-exit defeats its purpose. The permission gate ensures the user remains in control.

---

## Prerequisites

- **Runtime:** Bun (`bun run dev`, `bun run build`, `bun run typecheck`)
- **Language:** TypeScript 5, React (opentui)
- **SDK:** `@anthropic-ai/claude-agent-sdk`
- **Key directories:**
  - `src/state/` — state machine, reducer, service
  - `src/sdk/` — SDK type definitions
  - `src/ui/components/` — React components (including permission dialog)
  - `src/ui/App.tsx` — effect hooks wiring state → UI dialogs

### Background Reading

Before coding, read these files in full:

| File | Why |
|------|-----|
| `src/state/conversation-service.ts` lines 391–416 | The `buildCanUseTool` and `resolvePermission` implementation |
| `src/state/types.ts` lines 103–107, 133–137 | `SessionState` union and `PermissionRequest` type |
| `src/ui/App.tsx` lines 840–874 | `usePermissionDialog` effect hook wiring |
| `src/ui/components/PermissionModal.tsx` | Existing permission dialog component |

---

## Task Breakdown

### Task 1 — Intercept `ExitPlanMode` in `buildCanUseTool`
**Complexity:** Low  
**File:** `src/state/conversation-service.ts`

Modify `buildCanUseTool()` (lines 391–407) so that when `toolName === "ExitPlanMode"` **and** the current `permissionMode === "plan"`, the function pauses execution and dispatches `{ type: "set_session_state", state: { status: "awaiting_permission", request: ... } }` instead of auto-approving.

The `PermissionRequest.resolve` callback is what the SDK awaits — so the `buildCanUseTool` return value must not resolve until the user responds.

**Acceptance criteria:**
- `ExitPlanMode` calls while in plan mode open the permission dialog
- All other tool calls continue to auto-approve (existing behavior preserved)
- If the user denies, the agent receives `{ behavior: "deny" }` (or equivalent rejection)

**Pattern to follow:** The `awaiting_permission` state is already consumed by `usePermissionDialog` in `App.tsx` (lines 845–874), which opens `PermissionDialogContent` and calls `service.resolvePermission(allowed)` when done.

---

### Task 2 — Wire the `PermissionResult` deny path
**Complexity:** Low  
**File:** `src/state/conversation-service.ts`

Check what `PermissionResult` the SDK expects for a denied tool call. Look at the SDK types (`src/sdk/client.ts`, `@anthropic-ai/claude-agent-sdk` types) — it likely supports `{ behavior: "deny" }` or similar. Ensure the promise returned by `buildCanUseTool` resolves to the correct value when the user presses `n/Esc`.

**Acceptance criteria:**
- Denying causes the agent to receive a proper rejection signal
- The session state returns to `"running"` or `"idle"` appropriately after denial

---

### Task 3 — Customise the permission dialog message for `ExitPlanMode`
**Complexity:** Low  
**File:** `src/ui/components/PermissionModal.tsx`

The existing dialog renders:
> "Claude wants approval before running this tool."

For `ExitPlanMode`, the message should be clearer:
> "Claude wants to exit plan mode."

Add a conditional render inside `PermissionDialogContent` that shows a tailored description when `toolName === "ExitPlanMode"`. Everything else (y/Enter allow, n/Esc deny) stays the same.

**Acceptance criteria:**
- When prompted for `ExitPlanMode`, the dialog shows a specific, user-friendly message
- All other tool prompts continue to show the generic message

---

### Task 4 — Prevent race condition: block new permission dialogs while one is open
**Complexity:** Low  
**File:** `src/ui/App.tsx` lines 845–874

The existing `usePermissionDialog` effect already prevents double-opening via `permissionRequestRef` (line 855). Verify this guard works correctly for `ExitPlanMode` — no additional work should be needed, but confirm the ref key (`toolName:JSON(toolInput)`) is stable for `ExitPlanMode` calls (which likely have an empty input).

**Acceptance criteria:**
- No duplicate dialogs when `ExitPlanMode` is triggered

---

## Implementation Details

### Core change — `buildCanUseTool` in `src/state/conversation-service.ts`

Current code (lines 391–407):
```typescript
private buildCanUseTool() {
  return async (
    _toolName: string,
    _input: Record<string, unknown>,
    _options: { signal: AbortSignal; toolUseID: string; [key: string]: unknown },
  ): Promise<PermissionResult> => {
    // Yolo mode: auto-approve all tool calls without prompting
    return { behavior: "allow" }
  }
}
```

Target shape:
```typescript
private buildCanUseTool() {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal; toolUseID: string; [key: string]: unknown },
  ): Promise<PermissionResult> => {
    const isExitPlanMode =
      toolName === "ExitPlanMode" && this.state.permissionMode === "plan"

    if (isExitPlanMode) {
      const allowed = await new Promise<boolean>((resolve) => {
        this.dispatch({
          type: "set_session_state",
          state: {
            status: "awaiting_permission",
            request: { toolName, toolInput: input, resolve },
          },
        })
      })
      return allowed ? { behavior: "allow" } : { behavior: "deny" }
    }

    return { behavior: "allow" }
  }
}
```

> **Note:** Confirm the exact string `"ExitPlanMode"` matches what the SDK passes as `toolName`. Check by temporarily logging tool names during a plan mode session, or search `node_modules/@anthropic-ai/claude-agent-sdk` for the tool name constant.

### Customised dialog message in `src/ui/components/PermissionModal.tsx`

Inside `PermissionDialogContent`, replace the static description text:
```tsx
// Before
<text>
  <span fg={theme.text}>Claude wants approval before running this tool.</span>
</text>

// After
<text>
  <span fg={theme.text}>
    {toolName === "ExitPlanMode"
      ? "Claude wants to exit plan mode."
      : "Claude wants approval before running this tool."}
  </span>
</text>
```

---

## Testing Strategy

### Manual Testing

1. Start the app in plan mode:
   ```bash
   bun run dev --permission-mode plan
   ```
2. Send a prompt that causes the agent to attempt to exit plan mode (e.g. "Exit plan mode now").
3. **Expected:** Permission dialog appears with message "Claude wants to exit plan mode."
4. Press `y` → agent exits plan mode, session proceeds normally.
5. Repeat step 2–3, press `n` → agent remains in plan mode, receives denial.
6. In a **non-plan** permission mode (e.g. `default`), trigger `ExitPlanMode` → dialog should **not** appear (auto-approved).

### Edge Cases to Verify

| Scenario | Expected behaviour |
|----------|--------------------|
| User presses `Esc` on dialog | Permission denied, plan mode stays |
| Agent calls `ExitPlanMode` with no input `{}` | Dialog still opens correctly |
| Another tool called while `awaiting_permission` | Should not open a second dialog (blocked by `permissionRequestRef`) |
| `permissionMode` is not `"plan"` | `ExitPlanMode` is auto-approved (no dialog) |

### Type Checking & Linting

```bash
# Type check
bun run typecheck

# Lint
bun run lint
```

Ensure no TypeScript errors on the `PermissionResult` return type — specifically that `{ behavior: "deny" }` is a valid shape per the SDK type definitions.

---

## Definition of Done

- [ ] `buildCanUseTool` intercepts `ExitPlanMode` when `permissionMode === "plan"`
- [ ] Promise returned to SDK correctly resolves to `allow` or `deny` based on user input
- [ ] Permission dialog shows a specific message for `ExitPlanMode`
- [ ] All other tools remain auto-approved (no regression)
- [ ] Manual test scenarios above all pass
- [ ] `bun run typecheck` passes with no errors
- [ ] `bun run lint` passes with no offenses
