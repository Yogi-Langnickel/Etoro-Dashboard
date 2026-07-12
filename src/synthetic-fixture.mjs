export function syntheticFixtureWatermark(surface) {
  return {
    surface,
    kind: "synthetic-fixture",
    label: "Synthetic fixture",
    detail: "No live provider response, account identifier, or raw payload is present.",
    sourceLineage: {
      providerResponses: "absent",
      accountLinkedData: "absent",
      persistence: "not-persisted",
      generatedFrom: "repo-local synthetic status DTO",
    },
    liveProviderConnected: false,
    containsPrivateAccountData: false,
    containsRawProviderPayloads: false,
    safeForPublicDemo: true,
  };
}
