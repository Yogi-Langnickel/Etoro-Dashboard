(() => {
  "use strict";

  // Explicitly watermarked synthetic fixtures are retained only for the separate Watchlist tab.
  const watchlistPeriodChanges = { AAPL: { "24h": "+0.8%", "1w": "+1.6%", "1m": "+4.6%", "1y": "+18.4%", "5y": "+312.0%", max: "+988.0%" } };
  const watchlistChartPoints = { AAPL: { "24h": "0,204 64,190 128,198 192,166 256,174 320,140 384,128 448,102 512,112 576,84 640,74", "1w": "0,198 64,184 128,176 192,154 256,162 320,132 384,120 448,104 512,86 576,78 640,70", "1m": "0,210 64,196 128,182 192,190 256,154 320,138 384,126 448,96 512,104 576,74 640,62", "1y": "0,226 64,210 128,198 192,176 256,148 320,130 384,108 448,92 512,74 576,58 640,46", "5y": "0,240 64,226 128,212 192,186 256,158 320,130 384,102 448,80 512,58 576,38 640,24", max: "0,246 64,232 128,218 192,198 256,162 320,132 384,96 448,72 512,52 576,32 640,20" } };
  const watchlistContextReceipts = { AAPL: ["Equity watch", "Nasdaq quote fixture", "Fresh synthetic", "Companyfacts and news receipts are context only."] };
  globalThis.EtoroBrowserFixtures = Object.freeze({ watchlistChartPoints, watchlistContextReceipts, watchlistPeriodChanges });
})();
