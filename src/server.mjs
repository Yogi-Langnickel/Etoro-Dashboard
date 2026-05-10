import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchReadOnlyEndpoint, readOnlyEndpointSummary } from "./etoro-client.mjs";
import { loadEtoroConfig, publicCredentialStatus } from "./etoro-config.mjs";

const STATIC_ROOT = fileURLToPath(new URL("./", import.meta.url));
const DEFAULT_PORT = 4173;

export const INTERNAL_API_ROUTES = Object.freeze([
  "/api/health",
  "/api/etoro/status",
  "/api/etoro/identity",
  "/api/etoro/demo/pnl",
  "/api/etoro/demo/trading/status",
]);

const PLANNED_DEMO_TRADING_ENDPOINTS = Object.freeze({
  marketOpenByAmount: Object.freeze({
    method: "POST",
    path: "/api/v1/trading/execution/demo/market-open-orders/by-amount",
  }),
  marketOpenByUnits: Object.freeze({
    method: "POST",
    path: "/api/v1/trading/execution/demo/market-open-orders/by-units",
  }),
  marketClosePosition: Object.freeze({
    method: "POST",
    path: "/api/v1/trading/execution/demo/market-close-orders/positions/{positionId}",
  }),
  orderInfo: Object.freeze({
    method: "GET",
    path: "/api/v1/trading/info/demo/orders/{orderId}",
  }),
});

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const STATIC_FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/app.js", "app.js"],
]);

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function safeErrorPayload(error) {
  return {
    code: error?.code ?? "UNEXPECTED_ERROR",
    message: error?.message ?? "Unexpected server error",
    status: error?.status ?? undefined,
    requestId: error?.requestId ?? undefined,
  };
}

function assertSafeStaticPath(pathname) {
  let decoded = "/";

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const assetName = STATIC_FILES.get(decoded);

  if (!assetName) {
    return null;
  }

  const resolved = resolve(STATIC_ROOT, assetName);
  const normalizedRoot = normalize(STATIC_ROOT.endsWith(sep) ? STATIC_ROOT : `${STATIC_ROOT}${sep}`);

  if (!resolved.startsWith(normalizedRoot)) {
    return null;
  }

  return resolved;
}

async function serveStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, {
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Only GET routes are available" },
    });
    return;
  }

  const filePath = assertSafeStaticPath(pathname);

  if (!filePath) {
    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Static asset not found" },
    });
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    sendJson(response, 404, {
      ok: false,
      error: { code: "NOT_FOUND", message: "Static asset not found" },
    });
  }
}

async function getConfig(loadConfig) {
  return loadConfig();
}

function credentialsMissingResponse(config) {
  return {
    ok: false,
    mode: "read-only",
    credentialStatus: publicCredentialStatus(config),
    error: {
      code: "ETORO_CREDENTIALS_MISSING",
      message: "eToro credentials are not configured on the server",
    },
  };
}

async function handleApiRoute(pathname, response, options) {
  const loadConfig = options.loadConfig ?? loadEtoroConfig;
  const fetchEndpoint = options.fetchEndpoint ?? fetchReadOnlyEndpoint;

  if (!INTERNAL_API_ROUTES.includes(pathname)) {
    sendJson(response, 404, {
      ok: false,
      mode: "read-only",
      error: { code: "ROUTE_NOT_ALLOWED", message: "Route is not in the read-only allow-list" },
    });
    return;
  }

  if (pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      mode: "read-only",
      mutationRoutesEnabled: false,
      routes: INTERNAL_API_ROUTES,
      checkedAt: new Date().toISOString(),
    });
    return;
  }

  try {
    const config = await getConfig(loadConfig);

    if (pathname === "/api/etoro/status") {
      sendJson(response, 200, {
        ok: true,
        mode: "read-only",
        credentialStatus: publicCredentialStatus(config),
        provider: {
          baseUrl: config.baseUrl,
          endpoints: readOnlyEndpointSummary(),
        },
      });
      return;
    }

    if (pathname === "/api/etoro/demo/trading/status") {
      sendJson(response, 200, {
        ok: true,
        mode: "demo-trading-planning",
        demoOnly: true,
        mutationRoutesEnabled: false,
        credentialStatus: publicCredentialStatus(config),
        plannedProviderEndpoints: PLANNED_DEMO_TRADING_ENDPOINTS,
        requiredControls: [
          "demo-only route namespace",
          "explicit feature flag",
          "confirmation step",
          "request id audit",
          "order result polling",
          "raw payload redaction",
        ],
      });
      return;
    }

    if (!config.configured) {
      sendJson(response, 503, credentialsMissingResponse(config));
      return;
    }

    const endpointName = pathname === "/api/etoro/identity" ? "identity" : "demoPnl";
    const result = await fetchEndpoint(endpointName, { credentials: config });
    sendJson(response, 200, {
      ok: true,
      mode: "read-only",
      ...result,
    });
  } catch (error) {
    sendJson(response, error?.status && error.status >= 400 ? error.status : 500, {
      ok: false,
      mode: "read-only",
      error: safeErrorPayload(error),
    });
  }
}

export function createRequestHandler(options = {}) {
  return async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      if (request.method !== "GET") {
        sendJson(response, 405, {
          ok: false,
          mode: "read-only",
          error: { code: "METHOD_NOT_ALLOWED", message: "Only GET routes are available" },
        });
        return;
      }

      await handleApiRoute(pathname, response, options);
      return;
    }

    await serveStatic(request, response, pathname);
  };
}

export function createServer(options = {}) {
  return createHttpServer(createRequestHandler(options));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const host = process.env.HOST || "127.0.0.1";
  const server = createServer();

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`eToro dashboard listening on http://${host}:${actualPort}`);
  });
}
