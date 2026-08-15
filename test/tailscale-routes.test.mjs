import assert from 'node:assert/strict'
import test from 'node:test'
import { hasBaltoRoute, routeEntry, routeIsOccupied, routeProxy } from '../runtime/tailscale-routes.mjs'

const dnsName = 'mac.tailnet.ts.net'

test('recognizes only Balto-owned Tailscale Serve routes', () => {
  const config = {
    Web: {
      [`${dnsName}:3080`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3080' } } },
      [`${dnsName}:30100`]: { Handlers: { '/': { Proxy: 'http://localhost:30100' } } },
    },
  }
  assert.equal(hasBaltoRoute(config, dnsName, 3080), true)
  assert.equal(hasBaltoRoute(config, dnsName, 30100), true)
  assert.equal(hasBaltoRoute(config, dnsName, 9999), false)
})

test('treats any non-Balto route on a required port as occupied', () => {
  const config = {
    Web: {
      [`${dnsName}:3080`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:9000' } } },
      [`${dnsName}:30100`]: { Handlers: { '/other': { Proxy: 'http://127.0.0.1:8000' } } },
    },
  }
  assert.equal(routeIsOccupied(config, dnsName, 3080), true)
  assert.equal(routeProxy(config, dnsName, 3080), 'http://127.0.0.1:9000')
  assert.equal(hasBaltoRoute(config, dnsName, 3080), false)
  assert.equal(routeIsOccupied(config, dnsName, 30100), true)
  assert.deepEqual(routeEntry(config, dnsName, 30100), config.Web[`${dnsName}:30100`])
})
