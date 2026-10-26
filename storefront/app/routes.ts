import {flatRoutes} from '@react-router/fs-routes';
import {type RouteConfig} from '@react-router/dev/routes';

// Hydrogen 2026.10 no longer adds virtual dev routes (`hydrogenRoutes`); the file-based routes are the whole table.
export default [
  ...(await flatRoutes()),
  // Manual route definitions can be added to this array, in addition to or instead of using the `flatRoutes` file-based routing convention.
  // See https://reactrouter.com/api/framework-conventions/routes.ts#routests
] satisfies RouteConfig;
