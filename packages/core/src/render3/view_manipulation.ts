/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {setActiveConsumer} from '../../primitives/signals';

import {Injector} from '../di/injector';
import {DehydratedContainerView} from '../hydration/interfaces';
import {hasInSkipHydrationBlockFlag} from '../hydration/skip_hydration';
import {assertDefined} from '../util/assert';

import {assertLContainer, assertTNodeForLView} from './assert';
import {renderView} from './instructions/render';
import {TNode} from './interfaces/node';
import {
  DECLARATION_LCONTAINER,
  FLAGS,
  HEADER_OFFSET,
  LView,
  LViewFlags,
  QUERIES,
} from './interfaces/view';
import {createLView, createTView} from './view/construction';

export function createAndRenderEmbeddedLView<T>(
  declarationLView: LView<unknown>,
  templateTNode: TNode,
  context: T,
  options?: {
    injector?: Injector;
    embeddedViewInjector?: Injector;
    dehydratedView?: DehydratedContainerView | null;
  },
): LView<T> {
  const prevConsumer = setActiveConsumer(null);
  try {
    // =====================================================================================
    // EXPERIMENTAL — see NOTES-incomplete-first-pass-tview-rebuild.md at the repo root for
    // the full writeup (production trace decode, root cause, why this alone isn't a finished
    // fix). One-paragraph recap for orientation:
    //
    // An @if/@switch branch's content is its own embedded template with its own TView, built
    // lazily (templateCreate() in instructions/template.ts) the first time that branch is
    // actually selected. If an error interrupts that *first* creation pass — e.g. a hydration
    // mismatch on the branch's second child, after the first child's TNode was already
    // created — render.ts's `catch` block still flips `TView.firstCreatePass` to false and
    // sets `incompleteFirstPass = true` before rethrowing. Component TViews get rebuilt from
    // scratch next time via getOrCreateComponentTView()'s `incompleteFirstPass` check
    // (view/construction.ts), but *embedded* view TViews have no equivalent — nothing ever
    // reassigns `templateTNode.tView` again after templateCreate()'s one-time assignment. So
    // the next time this exact branch is selected again, its instructions read straight from
    // the corrupted (partially-null) `tView.data` instead of creating fresh TNodes, and
    // whichever instruction hits the first still-null slot crashes — `getParentRElement()`
    // (node_manipulation.ts, NG0510) is just the specific spot the production trace hit;
    // other instructions reading `tView.data[slot]` are presumably equally exposed.
    //
    // What this block does: mirrors getOrCreateComponentTView()'s rebuild-on-incompleteFirstPass
    // check, but for the embedded-view TView case. CONFIRMED (manually, not asserted by any
    // test in this branch) that this alone makes the NG0510 crash in
    // full_app_hydration_spec.ts's "re-entered after a hydration mismatch..." test disappear
    // entirely — no error at all on the retried tick().
    //
    // WHY THIS ISN'T SHIPPED: making the crash disappear is not the same as making the
    // behavior correct. With only this fix applied, the retried branch's DOM ended up as
    // `"firstorigfirstsecond-pass"` — the *aborted first attempt's* partially-created LView
    // (whose <span>first</span><span>orig</span> nodes DID get attached to the real DOM
    // before the interrupting error) is never torn down when the branch toggles off, so the
    // second attempt's fresh content gets appended alongside the orphaned leftovers instead
    // of replacing them. Rebuilding the TView fixes "which template shape to use" but exposes
    // that the LView from the failed attempt was never properly cleaned up either — trading a
    // loud, debuggable crash (current shipped fix: NG0510 in getParentRElement) for silent
    // content duplication, which is arguably worse.
    //
    // NEXT STEPS (not started):
    //   1. Figure out where a partially-created LView from an interrupted renderView() should
    //      be torn down — likely needs render.ts's `catch` block (or a caller of it, e.g.
    //      wherever createAndRenderEmbeddedLView()/ɵɵconditional's caller reacts to a thrown
    //      error) to explicitly detach/destroy whatever nodes DID get attached before
    //      rethrowing, not just mark the TView as corrupted for next time.
    //   2. Once that exists, re-verify this TView-rebuild block against a test that checks
    //      actual DOM *content* after the retry (not just "does it throw"), e.g. asserting
    //      `doc.querySelector('app')?.textContent` equals only the fresh second-pass content.
    //   3. Consider whether this rebuild belongs here at all, or higher up (e.g. wherever
    //      `ɵɵconditional`/`ɵɵrepeater` call `getExistingTNode` — control_flow.ts — since
    //      those also read potentially-corrupted TView-adjacent state via the same
    //      `!tView.firstCreatePass` pattern and were never audited for this).
    //   4. If pursued, this should replace (not sit alongside) the current shipped NG0510
    //      guard in node_manipulation.ts — that guard becomes unreachable dead code once
    //      embedded TViews are never corrupted-and-reused.
    // =====================================================================================
    let embeddedTView = templateTNode.tView!;
    ngDevMode && assertDefined(embeddedTView, 'TView must be defined for a template node.');
    if (embeddedTView.incompleteFirstPass) {
      embeddedTView = templateTNode.tView = createTView(
        embeddedTView.type,
        embeddedTView.declTNode,
        embeddedTView.template,
        embeddedTView.bindingStartIndex - HEADER_OFFSET,
        embeddedTView.expandoStartIndex - embeddedTView.bindingStartIndex,
        embeddedTView.directiveRegistry,
        embeddedTView.pipeRegistry,
        embeddedTView.viewQuery,
        embeddedTView.schemas,
        embeddedTView.consts,
        embeddedTView.ssrId,
      );
    }
    ngDevMode && assertTNodeForLView(templateTNode, declarationLView);

    // Embedded views follow the change detection strategy of the view they're declared in.
    const isSignalView = declarationLView[FLAGS] & LViewFlags.SignalView;
    const viewFlags = isSignalView ? LViewFlags.SignalView : LViewFlags.CheckAlways;
    const embeddedLView = createLView<T>(
      declarationLView,
      embeddedTView,
      context,
      viewFlags,
      null,
      templateTNode,
      null,
      null,
      options?.injector ?? null,
      options?.embeddedViewInjector ?? null,
      options?.dehydratedView ?? null,
    );

    const declarationLContainer = declarationLView[templateTNode.index];
    ngDevMode && assertLContainer(declarationLContainer);
    embeddedLView[DECLARATION_LCONTAINER] = declarationLContainer;

    const declarationViewLQueries = declarationLView[QUERIES];
    if (declarationViewLQueries !== null) {
      embeddedLView[QUERIES] = declarationViewLQueries.createEmbeddedView(embeddedTView);
    }

    // execute creation mode of a view
    renderView(embeddedTView, embeddedLView, context);

    return embeddedLView;
  } finally {
    setActiveConsumer(prevConsumer);
  }
}

/**
 * Returns whether an elements that belong to a view should be
 * inserted into the DOM. For client-only cases, DOM elements are
 * always inserted. For hydration cases, we check whether serialized
 * info is available for a view and the view is not in a "skip hydration"
 * block (in which case view contents was re-created, thus needing insertion).
 */
export function shouldAddViewToDom(
  tNode: TNode,
  dehydratedView?: DehydratedContainerView | null,
): boolean {
  return (
    !dehydratedView || dehydratedView.firstChild === null || hasInSkipHydrationBlockFlag(tNode)
  );
}
