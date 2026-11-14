import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import {
  ANY_AUTHENTICATED_KEY,
  IS_PUBLIC_KEY,
  PERMISSION_KEY,
} from '../src/access/decorators';

/** Every real route must state who may call it, so a forgotten decorator fails CI. */
describe('route access decorators (AppModule)', () => {
  it('gives every route exactly one of @Public, @RequirePermission, @AnyAuthenticated', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    const discovery = moduleRef.get(DiscoveryService);
    const reflector = moduleRef.get(Reflector);

    const routes: string[] = [];
    const offenders: string[] = [];
    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (method === undefined) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        const label = `${RequestMethod[method]} ${instance.constructor.name}.${name} (${path})`;
        routes.push(label);
        const targets = [handler, instance.constructor];
        const markers = [IS_PUBLIC_KEY, PERMISSION_KEY, ANY_AUTHENTICATED_KEY]
          .map((key) => reflector.getAllAndOverride<unknown>(key, targets))
          .filter((value) => value !== undefined && value !== false);
        if (markers.length !== 1) offenders.push(label);
      }
    }

    expect(routes.length).toBeGreaterThan(30);
    expect(offenders).toEqual([]);
    await moduleRef.close();
  });
});
