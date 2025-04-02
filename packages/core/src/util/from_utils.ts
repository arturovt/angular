/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {Observable} from 'rxjs';

export function fromPromise<T>(promise: Promise<T>): Observable<T> {
  return new Observable((subscriber) => {
    promise
      .then((v) => subscriber.next(v))
      .catch((e) => subscriber.error(e))
      .finally(() => subscriber.complete());
  });
}

export function fromArrayLike<T>(array: T[]): Observable<T> {
  return new Observable((subscriber) => {
    for (let i = 0; i < array.length && !subscriber.closed; i++) {
      subscriber.next(array[i]);
    }
    subscriber.complete();
  });
}
