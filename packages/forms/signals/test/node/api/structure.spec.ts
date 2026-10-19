/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  ApplicationRef,
  DestroyRef,
  inject,
  Injector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {apply, applyEach, form, required, schema} from '@angular/forms/signals';

describe('structure APIs', () => {
  describe('apply', () => {
    it('should maintain order when applying to child of root path', () => {
      const s = schema<{a: string}>((p) => {
        required(p.a, {message: 'before'});
        apply(p.a, (prop) => {
          required(prop, {message: 'apply'});
        });
        required(p.a, {message: 'after'});
      });

      const data = signal({a: ''});
      const f = form(data, s, {injector: TestBed.inject(Injector)});

      expect(f.a().errors()).toEqual([
        jasmine.objectContaining({message: 'before'}),
        jasmine.objectContaining({message: 'apply'}),
        jasmine.objectContaining({message: 'after'}),
      ]);
    });

    it('should maintain order when applying to root path', () => {
      const s = schema<{a: {b: string}}>((p) => {
        required(p.a.b, {message: 'before'});
        apply(p, (prop) => {
          required(prop.a.b, {message: 'apply'});
        });
        required(p.a.b, {message: 'after'});
      });

      const data = signal({a: {b: ''}});
      const f = form(data, s, {injector: TestBed.inject(Injector)});

      expect(f.a.b().errors()).toEqual([
        jasmine.objectContaining({message: 'before'}),
        jasmine.objectContaining({message: 'apply'}),
        jasmine.objectContaining({message: 'after'}),
      ]);
    });

    it('should apply logic to each property', () => {
      const s = schema<{a: string; b: string}>((p) => {
        applyEach(p, (prop) => {
          required(prop, {message: 'each'});
        });
      });

      const data = signal({a: '', b: ''});
      const f = form(data, s, {injector: TestBed.inject(Injector)});

      expect(f.a().errors()).toEqual([jasmine.objectContaining({message: 'each'})]);
      expect(f.b().errors()).toEqual([jasmine.objectContaining({message: 'each'})]);
    });

    it('should merge each property logic with specific property logic', () => {
      const s = schema<{a: string; b: string}>((p) => {
        required(p.a, {message: 'before'});
        applyEach(p, (prop) => {
          required(prop, {message: 'each'});
        });
        required(p.a, {message: 'after'});
      });

      const data = signal({a: '', b: ''});
      const f = form(data, s, {injector: TestBed.inject(Injector)});

      expect(f.a().errors()).toEqual([
        jasmine.objectContaining({message: 'before'}),
        jasmine.objectContaining({message: 'each'}),
        jasmine.objectContaining({message: 'after'}),
      ]);
      expect(f.b().errors()).toEqual([jasmine.objectContaining({message: 'each'})]);
    });
  });

  describe('lazy materialization', () => {
    it('should stay unmaterialized when children have no schema logic', () => {
      const s = schema<{a: {b: string}}>((p) => {
        // No logic applied
      });

      const data = signal({a: {b: 'test'}});
      const f = form(data, s, {injector: TestBed.inject(Injector)});

      // Cast to any to access the private helper method
      expect((f() as any).structure._areChildrenMaterialized()).toBeFalse();
    });

    it('should materialize children when explicitly accessed', () => {
      const s = schema<{a: {b: string}}>((p) => {
        // No logic applied
      });

      const data = signal({a: {b: 'test'}});
      const f = form(data, s, {injector: TestBed.inject(Injector)});

      // Initially false
      expect((f() as any).structure._areChildrenMaterialized()).toBeFalse();

      // Accessing 'a' forces materialization of root's children
      const childA = f.a;
      expect((f() as any).structure._areChildrenMaterialized()).toBeTrue();

      // 'a' itself should not have materialized its children ('b') yet
      expect((childA() as any).structure._areChildrenMaterialized()).toBeFalse();
    });

    it('should eagerly materialize children when they have schema logic', () => {
      const s = schema<{a: {b: string}}>((p) => {
        required(p.a.b, {message: 'required'});
      });

      const data = signal({a: {b: 'test'}});
      const f = form(data, s, {injector: TestBed.inject(Injector)});

      // Because 'a.b' has rules, 'a' and 'b' must be materialized up the tree
      expect((f() as any).structure._areChildrenMaterialized()).toBeTrue();
      expect((f.a() as any).structure._areChildrenMaterialized()).toBeTrue();
    });
  });

  describe('field cleanup', () => {
    function arrayForm() {
      const data = signal([{a: 1}, {a: 2}]);
      const f = form(
        data,
        (p) => {
          applyEach(p, (el) => {
            required(el.a);
          });
        },
        {injector: TestBed.inject(Injector)},
      );
      return {data, f};
    }

    it('should not create an injector for an orphaned field that never had one', () => {
      const {data, f} = arrayForm();
      const structure = (f[1]() as any).structure;
      expect(structure._injector).toBeUndefined();

      data.set([{a: 1}]);
      TestBed.inject(ApplicationRef).tick();

      expect(structure.isOrphaned()).toBeTrue();
      expect(structure._injector).toBeUndefined();
    });

    it('should destroy the injector of an orphaned field that has one', () => {
      const {data, f} = arrayForm();
      const structure = (f[1]() as any).structure;

      let destroyed = false;
      runInInjectionContext(structure.injector, () => {
        inject(DestroyRef).onDestroy(() => (destroyed = true));
      });

      data.set([{a: 1}]);
      TestBed.inject(ApplicationRef).tick();

      expect(destroyed).toBeTrue();
    });
  });
});
