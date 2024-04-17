/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

/**
 * This represents a mapping of elements to a list of attributes that are hydration protected.
 * Values are implemented as a list in case they need to be expanded in the future to accommodate
 * more cases.
 */
const hydrationProtectedElementToAttrsMap = new Map<string, string[]>([
  ['iframe', ['src']],
  ['embed', ['src']],
  ['object', ['data']],
]);

export function getHydrationProtectedAttrs(tagName: string): string[]|undefined {
  return hydrationProtectedElementToAttrsMap.get(tagName);
}
