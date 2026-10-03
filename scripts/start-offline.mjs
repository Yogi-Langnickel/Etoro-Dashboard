import { denyOfflineProviderFetch, loadOfflineEtoroConfig } from "../src/offline-config.mjs";
import { createServer } from "../src/server.mjs";

const host = "127.0.0.1";
const port = Number(process.env.PORT) || 4173;
const server = createServer({
  botConfigFile: process.env.DASHBOARD_OFFLINE_CONFIG_FILE,
  moneyMakerRuntimeRoot: process.env.DASHBOARD_OFFLINE_RUNTIME_ROOT,
  moneyMakerStateRoot: process.env.DASHBOARD_OFFLINE_STATE_ROOT,
  fetchEndpoint: denyOfflineProviderFetch,
  fetchFxReference: denyOfflineProviderFetch,
  loadConfig: loadOfflineEtoroConfig,
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`eToro dashboard offline fixture mode listening on http://${host}:${actualPort}`);
});
