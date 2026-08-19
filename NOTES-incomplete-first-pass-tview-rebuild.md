# WIP: rebuilding a corrupted embedded-view TView after an interrupted first pass

Status as of this branch: **experimental, uncommitted, not ready to ship.** This file plus the
comment block in `packages/core/src/render3/view_manipulation.ts` (search for `EXPERIMENTAL`)
are meant to let you pick this back up cold, without re-deriving the investigation.

## Where this came from

Shipped already, on `fix/core-hydration-sibling-skip-crash` (merged/pushed): a fix for a real
production crash —

```
TypeError: Cannot read properties of null (reading 'parent')
```

— at `getParentRElement()` in `node_manipulation.ts`. That function's `tNode` parameter was typed
as always non-null but could actually be null at runtime. The shipped fix adds a guard that
throws a coded `NG0510` RuntimeError instead of crashing with a raw `TypeError`.

That fix is a symptom patch, not a root-cause fix, and it says so in its own commit message. This
branch is the start of exploring the root-cause fix, and documents why it's harder than it looks.

## The root cause (confirmed, not theorized)

Decoded the actual production minified stack trace against source (matched every frame
character-for-character — see the squashed commit message on
`fix/core-hydration-sibling-skip-crash` for the full decode). The real chain:

```
ɵɵconditional (an @if/@switch block)
  → getExistingTNode()          — reads hostTView.data[slot], ngDevMode-only guarded
  → createAndRenderEmbeddedLView()
    → renderView()
      → executeTemplate()
        → [the @if/@switch branch's own template function runs]
          → ɵɵtext() (or any other node-creation instruction)
            → appendChild()
              → getParentRElement()   ← crashes: tNode.parent, tNode is null
```

**The actual mechanism**, found in `packages/core/src/render3/instructions/render.ts`,
`renderView()`'s `catch` block:

```ts
} catch (error) {
  // If we didn't manage to get past the first template pass due to
  // an error, mark the view as corrupted so we can try to recover.
  if (tView.firstCreatePass) {
    tView.incompleteFirstPass = true;
    tView.firstCreatePass = false;
  }
  throw error;
}
```

An `@if`/`@switch` branch's content is its own embedded template, with its own `TView`, built
**lazily** — the first time that branch is actually selected and rendered
(`templateCreate()` in `instructions/template.ts`, called once, ever, per branch declaration,
tied to the _host_ template's own first pass — not tied to the embedded TView's own state at
all).

If an error is thrown partway through that embedded TView's first creation pass — in the
production case, a hydration node-mismatch on the branch's _second_ child, after the _first_
child's TNode was already successfully created — the `catch` block above still flips
`firstCreatePass = false` (and sets `incompleteFirstPass = true`) **before rethrowing**. Whatever
caught that rethrown error (in production: the app's hydration bootstrap, which apparently
recovers and keeps running rather than hard-crashing the whole page) leaves this TView
permanently marked "first pass complete," even though it isn't really.

The next time that _same branch_ is selected again — e.g. the user toggles whatever condition
controls it — its instructions no longer call `getOrCreateTNode()` (guarded by
`if (tView.firstCreatePass)`), they read straight from `tView.data[slot]` instead. Any node
**after** the point where the original error interrupted things is still `null` in that array,
forever. Whichever instruction hits that slot first gets a null TNode. In the production trace,
that was `ɵɵtext` → `appendChild` → `getParentRElement`. There is no reason to believe that's the
_only_ instruction exposed to this — anything reading `tView.data[slot]` under the
`!firstCreatePass` branch is equally exposed; this was never audited beyond the one path in the
trace.

**Why component TViews don't have this problem:** `getOrCreateComponentTView()`
(`view/construction.ts`) explicitly checks:

```ts
if (tView === null || tView.incompleteFirstPass) {
  return (def.tView = createTView(...));
}
```

Embedded views (the content of `@if`/`@for`/`@switch` branches, `<ng-template>`, etc.) have no
equivalent. `templateTNode.tView` is assigned exactly once and never revisited.

## The experiment on this branch

`view_manipulation.ts`, `createAndRenderEmbeddedLView()`: added the same
`incompleteFirstPass` → rebuild check that `getOrCreateComponentTView()` already does, using
`createTView()` fed from the corrupted TView's own retained metadata (`type`, `declTNode`,
`template`, `bindingStartIndex`/`expandoStartIndex` to recover `decls`/`vars`,
`directiveRegistry`, `pipeRegistry`, `viewQuery`, `schemas`, `consts`, `ssrId` — all fields a
`TView` object already carries, confirmed by reading `createTView()`'s own construction of the
object).

**Manually confirmed** (not covered by any test on this branch): with this change, and with the
`getParentRElement()` null check from the shipped fix _reverted_, the exact scenario in
`full_app_hydration_spec.ts`'s `"should throw a coded RuntimeError... when an @if branch is
re-entered..."` test **no longer throws at all**. The branch's TView gets rebuilt from scratch and
the retry proceeds using a clean, uncorrupted TView.

## Why this isn't shipped: it uncovers a second, separate bug

With the rebuild in place, I changed the test to check actual rendered content instead of just
"does it throw," and re-ran it. The DOM ended up as:

```
"firstorigfirstsecond-pass"
```

Expected: just the fresh second-pass content. What actually happened: the **first (aborted)
attempt's** `<span>first</span><span>orig</span>` — which _did_ get attached to the real DOM
before the interrupting hydration-mismatch error, since the first child was created successfully
before the second child's mismatch threw — is **never removed** when the branch's condition later
toggles off. So when the branch is re-entered, the fresh content from the successful retry gets
appended _alongside_ the orphaned leftovers instead of replacing them.

Rebuilding the TView fixes "which template shape/instructions to use" — but it does not fix
"what happened to the LView and DOM nodes from the attempt that never finished." That's a
separate, and arguably worse, bug: trading a loud, immediately-debuggable crash (current shipped
fix) for silent, duplicated content.

## Next steps (not started)

1. **Find where an interrupted `renderView()` should clean up after itself.** Right now
   `render.ts`'s `catch` block only marks the TView as corrupted; it does nothing about whatever
   DOM nodes/LView state the interrupted pass already produced. Likely needs to explicitly
   detach/destroy the partially-created LView (or hand that responsibility to whoever calls
   `createAndRenderEmbeddedLView()`/reacts to the thrown error) before — or as part of — rethrowing.
2. **Once LView cleanup exists, redo the manual verification as a real test.** Assert on
   `textContent` (or similar), not just "did it throw." The current shipped test in
   `full_app_hydration_spec.ts` only checks for `NG0510` — it would need a different assertion
   entirely if this fix ships (no throw, correct content).
3. **Audit other `!tView.firstCreatePass` read sites**, not just `getParentRElement`'s call path.
   `control_flow.ts`'s `getExistingTNode()` (used by both `ɵɵconditional` and `ɵɵrepeater`) has
   the exact same "type says non-null, ngDevMode-only guarded, actually nullable" shape and was
   never checked for whether _it_ can also observe corrupted state from this same root cause.
4. **Decide where the fix belongs** if pursued — this experiment puts it in
   `createAndRenderEmbeddedLView()`, but it might belong closer to where the corruption
   originates (`render.ts`) or where `getExistingTNode` reads `tView.data` (`control_flow.ts`).
5. **If shipped, remove the now-redundant `getParentRElement` guard** (`node_manipulation.ts`,
   `NG0510`) — it becomes dead code once embedded TViews are never corrupted-and-reused, since
   `tNode` would never be null there anymore. Removing it would also mean rewriting/removing the
   `full_app_hydration_spec.ts` test that currently asserts `NG0510` gets thrown, since the whole
   point would be that it _doesn't_ throw anymore.

## Where things stand on disk right now

- `view_manipulation.ts` has the experimental rebuild, heavily commented in place, matching this
  file's content in spirit (search for `EXPERIMENTAL`).
- Nothing is committed on this branch — everything described here is a working-tree diff only.
- The shipped fix (`getParentRElement` NG0510 guard + the real hydration reproduction test) is
  already on `fix/core-hydration-sibling-skip-crash`, force-pushed, not part of this branch's diff
  against it.
