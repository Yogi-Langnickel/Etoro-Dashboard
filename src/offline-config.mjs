export const offlineEtoroConfig = Object.freeze({
  baseUrl: new URL("https://public-api.etoro.com"),
  apiKey: null,
  userKey: null,
  configured: false,
  readCacheTtlMs: 15_000,
  demoTradePreviewEnabled: false,
  credentialsFile: null,
  credentialFileLoaded: false,
  credentialSource: "none",
  missing: Object.freeze(["apiKey", "userKey"]),
});

export const loadOfflineEtoroConfig = async () => offlineEtoroConfig;

export const denyOfflineProviderFetch = async () => {
  throw new Error("Offline fixture mode cannot call the eToro provider.");
};
