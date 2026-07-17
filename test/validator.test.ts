import { describe, it, expect } from 'vitest';
import {
  resolveDependencyOrder,
  getMigrationPhases,
  createResourceIdMap,
  mapResourceId,
  getNewId,
  resolveLoadBalancerPoolIds,
  resolvePoolMonitorId,
  exportIdMapToJson,
  importIdMapFromJson,
} from '../src/validator';

describe('validator.ts', () => {
  describe('Dependency Graph Resolver', () => {
    it('resolves dependency order without circular dependencies', () => {
      const { order } = resolveDependencyOrder();
      expect(order).toContain('zone');
      expect(order).toContain('workers');
      expect(order).toContain('load_balancers');
    });

    it('zone comes before all other resources', () => {
      const { order } = resolveDependencyOrder();
      const zoneIndex = order.indexOf('zone');
      expect(zoneIndex).toBe(0);
    });

    it('workers come before worker_routes', () => {
      const { order } = resolveDependencyOrder();
      const workersIndex = order.indexOf('workers');
      const routesIndex = order.indexOf('worker_routes');
      expect(workersIndex).toBeLessThan(routesIndex);
    });

    it('pools come before load_balancers', () => {
      const { order } = resolveDependencyOrder();
      const poolsIndex = order.indexOf('pools');
      const lbIndex = order.indexOf('load_balancers');
      expect(poolsIndex).toBeLessThan(lbIndex);
    });

    it('monitors come before pools', () => {
      const { order } = resolveDependencyOrder();
      const monitorsIndex = order.indexOf('monitors');
      const poolsIndex = order.indexOf('pools');
      expect(monitorsIndex).toBeLessThan(poolsIndex);
    });

    it('access_apps come before access_policies', () => {
      const { order } = resolveDependencyOrder();
      const appsIndex = order.indexOf('access_apps');
      const policiesIndex = order.indexOf('access_policies');
      expect(appsIndex).toBeLessThan(policiesIndex);
    });
  });

  describe('getMigrationPhases', () => {
    it('returns phases with resources', () => {
      const phases = getMigrationPhases();
      expect(phases.length).toBeGreaterThan(0);
      expect(phases[0].phase).toBe(1);
      expect(phases[0].resources).toContain('zone');
    });

    it('each phase has a description', () => {
      const phases = getMigrationPhases();
      for (const phase of phases) {
        expect(phase.description).toBeDefined();
        expect(phase.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Resource ID Mapper', () => {
    it('creates empty ID map', () => {
      const idMap = createResourceIdMap();
      expect(idMap.zones.size).toBe(0);
      expect(idMap.workers.size).toBe(0);
      expect(idMap.pools.size).toBe(0);
    });

    it('maps old ID to new ID', () => {
      const idMap = createResourceIdMap();
      mapResourceId(idMap, 'workers', 'old-worker-id', 'new-worker-id');
      expect(getNewId(idMap, 'workers', 'old-worker-id')).toBe('new-worker-id');
    });

    it('returns undefined for unmapped IDs', () => {
      const idMap = createResourceIdMap();
      expect(getNewId(idMap, 'workers', 'nonexistent')).toBeUndefined();
    });

    it('maps multiple resources', () => {
      const idMap = createResourceIdMap();
      mapResourceId(idMap, 'workers', 'w1', 'new-w1');
      mapResourceId(idMap, 'workers', 'w2', 'new-w2');
      mapResourceId(idMap, 'pools', 'p1', 'new-p1');

      expect(getNewId(idMap, 'workers', 'w1')).toBe('new-w1');
      expect(getNewId(idMap, 'workers', 'w2')).toBe('new-w2');
      expect(getNewId(idMap, 'pools', 'p1')).toBe('new-p1');
    });
  });

  describe('resolveLoadBalancerPoolIds', () => {
    it('resolves default_pools array', () => {
      const idMap = createResourceIdMap();
      mapResourceId(idMap, 'pools', 'old-pool-1', 'new-pool-1');
      mapResourceId(idMap, 'pools', 'old-pool-2', 'new-pool-2');

      const lbConfig = {
        default_pools: ['old-pool-1', 'old-pool-2'],
      };

      const resolved = resolveLoadBalancerPoolIds(lbConfig, idMap);
      expect(resolved.default_pools).toEqual(['new-pool-1', 'new-pool-2']);
    });

    it('resolves fallback_pool', () => {
      const idMap = createResourceIdMap();
      mapResourceId(idMap, 'pools', 'old-fallback', 'new-fallback');

      const lbConfig = {
        fallback_pool: 'old-fallback',
      };

      const resolved = resolveLoadBalancerPoolIds(lbConfig, idMap);
      expect(resolved.fallback_pool).toBe('new-fallback');
    });

    it('preserves unmapped pool IDs', () => {
      const idMap = createResourceIdMap();

      const lbConfig = {
        fallback_pool: 'unmapped-pool',
      };

      const resolved = resolveLoadBalancerPoolIds(lbConfig, idMap);
      expect(resolved.fallback_pool).toBe('unmapped-pool');
    });

    it('resolves pop_pools', () => {
      const idMap = createResourceIdMap();
      mapResourceId(idMap, 'pools', 'p1', 'new-p1');
      mapResourceId(idMap, 'pools', 'p2', 'new-p2');

      const lbConfig = {
        pop_pools: {
          'LAX': ['p1', 'p2'],
          'ORD': ['p1'],
        },
      };

      const resolved = resolveLoadBalancerPoolIds(lbConfig, idMap);
      expect((resolved.pop_pools as Record<string, string[]>)['LAX']).toEqual(['new-p1', 'new-p2']);
      expect((resolved.pop_pools as Record<string, string[]>)['ORD']).toEqual(['new-p1']);
    });
  });

  describe('resolvePoolMonitorId', () => {
    it('resolves monitor ID in pool config', () => {
      const idMap = createResourceIdMap();
      mapResourceId(idMap, 'monitors', 'old-monitor', 'new-monitor');

      const poolConfig = {
        name: 'my-pool',
        monitor: 'old-monitor',
      };

      const resolved = resolvePoolMonitorId(poolConfig, idMap);
      expect(resolved.monitor).toBe('new-monitor');
    });

    it('preserves unmapped monitor IDs', () => {
      const idMap = createResourceIdMap();

      const poolConfig = {
        monitor: 'unmapped-monitor',
      };

      const resolved = resolvePoolMonitorId(poolConfig, idMap);
      expect(resolved.monitor).toBe('unmapped-monitor');
    });
  });

  describe('ID Map JSON Export/Import', () => {
    it('exports ID map to JSON', () => {
      const idMap = createResourceIdMap();
      mapResourceId(idMap, 'workers', 'w1', 'new-w1');
      mapResourceId(idMap, 'pools', 'p1', 'new-p1');

      const json = exportIdMapToJson(idMap);
      expect(json.workers).toEqual({ 'w1': 'new-w1' });
      expect(json.pools).toEqual({ 'p1': 'new-p1' });
    });

    it('imports ID map from JSON', () => {
      const json = {
        workers: { 'w1': 'new-w1' },
        pools: { 'p1': 'new-p1' },
      };

      const idMap = importIdMapFromJson(json);
      expect(getNewId(idMap, 'workers', 'w1')).toBe('new-w1');
      expect(getNewId(idMap, 'pools', 'p1')).toBe('new-p1');
    });

    it('round-trips export and import', () => {
      const original = createResourceIdMap();
      mapResourceId(original, 'workers', 'w1', 'new-w1');
      mapResourceId(original, 'monitors', 'm1', 'new-m1');

      const json = exportIdMapToJson(original);
      const imported = importIdMapFromJson(json);

      expect(getNewId(imported, 'workers', 'w1')).toBe('new-w1');
      expect(getNewId(imported, 'monitors', 'm1')).toBe('new-m1');
    });
  });
});
