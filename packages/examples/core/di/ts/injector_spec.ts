/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  inject,
  InjectionToken,
  InjectOptions,
  Injector,
  ProviderToken,
  runInInjectionContext,
} from '@angular/core';

// TODO(crisbeto): change the `options` parameter of `MockRootScopeInjector.get` to be
// `InjectOptions` once #60318 is released.

class MockRootScopeInjector implements Injector {
  constructor(readonly parent: Injector) {}

  get<T>(token: ProviderToken<T>, defaultValue?: any, options?: any): T {
    if ((token as any).ɵprov && (token as any).ɵprov.providedIn === 'root') {
      return runInInjectionContext(this, () => {
        return (token as any).ɵprov.factory();
      });
    }
    return this.parent.get(token, defaultValue, options);
  }
}

{
  describe('injector metadata examples', () => {
    it('works', () => {
      // #docregion Injector
      const injector: Injector = Injector.create({
        providers: [{provide: 'validToken', useValue: 'Value'}],
      });
      expect(injector.get('validToken')).toEqual('Value');
      expect(() => injector.get('invalidToken')).toThrowError();
      expect(injector.get('invalidToken', 'notFound')).toEqual('notFound');
      // #enddocregion
    });

    it('injects injector', () => {
      // #docregion injectInjector
      const injector = Injector.create({providers: []});
      expect(injector.get(Injector)).toBe(injector);
      // #enddocregion
    });

    it('should infer type', () => {
      // #docregion InjectionToken
      const BASE_URL = new InjectionToken<string>('BaseUrl');
      const injector = Injector.create({
        providers: [{provide: BASE_URL, useValue: 'http://localhost'}],
      });
      const url = injector.get(BASE_URL);
      // Note: since `BASE_URL` is `InjectionToken<string>`
      // `url` is correctly inferred to be `string`
      expect(url).toBe('http://localhost');
      // #enddocregion
    });

    it('injects a tree-shakeable InjectionToken', () => {
      class MyDep {}
      const injector = new MockRootScopeInjector(
        Injector.create({providers: [{provide: MyDep, deps: []}]}),
      );

      // #docregion ShakableInjectionToken
      class MyService {
        constructor(readonly myDep: MyDep) {}
      }

      const MY_SERVICE_TOKEN = new InjectionToken<MyService>('Manually constructed MyService', {
        providedIn: 'root',
        factory: () => new MyService(inject(MyDep)),
      });

      const instance = injector.get(MY_SERVICE_TOKEN);
      expect(instance instanceof MyService).toBeTruthy();
      expect(instance.myDep instanceof MyDep).toBeTruthy();
      // #enddocregion
    });
  });
}
