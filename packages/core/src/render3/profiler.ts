/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {type Profiler} from '../../primitives/devtools';

/**
 * Internal counterpart of the public `ProfilerEvent` enum, used by the framework itself.
 *
 * TypeScript inlines `const enum` members, so these calls compile down to plain numbers and
 * applications no longer ship the runtime `ProfilerEvent` object, which only Angular DevTools
 * reads. The members must stay identical to `ProfilerEvent`, which `profiler_spec.ts` asserts.
 */
export const enum ProfilerEvent {
  TemplateCreateStart,
  TemplateCreateEnd,
  TemplateUpdateStart,
  TemplateUpdateEnd,
  LifecycleHookStart,
  LifecycleHookEnd,
  OutputStart,
  OutputEnd,
  BootstrapApplicationStart,
  BootstrapApplicationEnd,
  BootstrapComponentStart,
  BootstrapComponentEnd,
  ChangeDetectionStart,
  ChangeDetectionEnd,
  ChangeDetectionSyncStart,
  ChangeDetectionSyncEnd,
  AfterRenderHooksStart,
  AfterRenderHooksEnd,
  ComponentStart,
  ComponentEnd,
  DeferBlockStateStart,
  DeferBlockStateEnd,
  DynamicComponentStart,
  DynamicComponentEnd,
  HostBindingsUpdateStart,
  HostBindingsUpdateEnd,
}

// Callbacks take a plain `number`, because the `const enum` above and the `ProfilerEvent` of the
// public `Profiler` signature are two unrelated types for TypeScript.
type ProfilerCallback = (event: number, instance?: {} | null, eventFn?: Function) => void;

const profilerCallbacks: ProfilerCallback[] = [];

const NOOP_PROFILER_REMOVAL = () => {};

function removeProfiler(profiler: Profiler) {
  const profilerIdx = profilerCallbacks.indexOf(profiler);
  if (profilerIdx !== -1) {
    profilerCallbacks.splice(profilerIdx, 1);
  }
}

/**
 * Adds a callback function which will be invoked before and after performing certain actions at
 * runtime (for example, before and after running change detection). Multiple profiler callbacks can be set:
 * in this case profiling events are reported to every registered callback.
 *
 * Warning: this function is *INTERNAL* and should not be relied upon in application's code.
 * The contract of the function might be changed in any release and/or the function can be removed
 * completely.
 *
 * @param profiler function provided by the caller or null value to disable all profilers.
 * @returns a cleanup function that, when invoked, removes a given profiler callback.
 */
export function setProfiler(profiler: Profiler | null): () => void {
  if (profiler !== null) {
    if (!profilerCallbacks.includes(profiler)) {
      profilerCallbacks.push(profiler);
    }
    return () => removeProfiler(profiler);
  } else {
    profilerCallbacks.length = 0;
    return NOOP_PROFILER_REMOVAL;
  }
}

/**
 * Profiler function which wraps user code executed by the runtime.
 *
 * @param event ProfilerEvent corresponding to the execution context
 * @param instance component instance
 * @param eventFn function associated with event.
 *    For example a template function, lifecycle hook, or output listener.
 *    The value depends on the execution context
 */
export const profiler = function (
  event: ProfilerEvent,
  instance: {} | null = null,
  eventFn?: Function,
): void {
  for (let i = 0; i < profilerCallbacks.length; i++) {
    const profilerCallback = profilerCallbacks[i];
    profilerCallback(event, instance, eventFn);
  }
};
