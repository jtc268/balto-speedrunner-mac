export function routeEntry(config, dnsName, port) {
  return config?.Web?.[`${dnsName}:${port}`] || null
}

export function routeProxy(config, dnsName, port) {
  return routeEntry(config, dnsName, port)?.Handlers?.['/']?.Proxy || null
}

export function hasBaltoRoute(config, dnsName, port, target = port) {
  const proxy = routeProxy(config, dnsName, port)
  return proxy === `http://127.0.0.1:${target}` || proxy === `http://localhost:${target}`
}

export function routeIsOccupied(config, dnsName, port) {
  return Boolean(routeEntry(config, dnsName, port))
}
