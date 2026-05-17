import {
  SEC_COMPANYFACTS_ADAPTER_CONTRACT,
  normalizeSecCompanyFacts,
} from "./sec-companyfacts-adapter.mjs";
import {
  SEC_OWNERSHIP_ADAPTER_CONTRACT,
  normalizeSecOwnershipFilings,
} from "./sec-ownership-adapter.mjs";

const OFFICIAL_SOURCE_PRIORITY = Object.freeze([
  {
    id: "sec-companyfacts",
    label: "SEC companyfacts",
    coverage: "US stock fundamentals",
    access: "free-official-api",
    use: "revenue, earnings, assets, liabilities, cash flow, shares, and filings metadata",
    endpointPattern: "https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json",
  },
  {
    id: "sec-insider-transactions",
    label: "SEC insider transactions data sets",
    coverage: "Forms 3, 4, and 5 ownership transactions",
    access: "free-official-dataset",
    use: "director, officer, and 10-percent-holder transaction context",
  },
  {
    id: "sec-rss-ownership",
    label: "SEC latest filings RSS",
    coverage: "recent ownership filings filtered by company, CIK, or form type",
    access: "free-official-feed",
    use: "fresh Form 3/4/5 and 8-K awareness before dataset refresh",
  },
  {
    id: "sec-nport",
    label: "SEC N-PORT data sets",
    coverage: "registered fund and ETF portfolio holdings",
    access: "free-official-dataset",
    use: "ETF holdings and fund-level portfolio context where available",
  },
  {
    id: "issuer-factsheets",
    label: "ETF issuer factsheets",
    coverage: "ETF fees, holdings, sectors, geography, distribution data",
    access: "public-issuer-pages",
    use: "ETF display fields when official SEC fund data is too delayed or too heavy",
  },
  {
    id: "rss-news",
    label: "Public RSS/news APIs",
    coverage: "stocks, ETFs, commodities, forex, crypto",
    access: "free-api-or-rss-first",
    use: "portfolio news ticker and macro/context headlines",
  },
  {
    id: "allowlisted-scraping",
    label: "Allowlisted scraping fallback",
    coverage: "public pages without free APIs",
    access: "robots-and-terms-reviewed",
    use: "last resort for public facts or headlines; no bypass or full article storage",
  },
]);

const SCRAPING_POLICY = Object.freeze({
  priority: "api-first-scraping-fallback",
  allowed: [
    "public pages with robots and terms review",
    "server-side fetching only",
    "source allowlist and rate limits",
    "short normalized facts and summaries",
  ],
  blocked: [
    "paywall bypass",
    "captcha bypass",
    "proxy rotation for evasion",
    "full article storage",
    "browser-side scraping",
  ],
  finviz: {
    insiderTradingPage: "reference-only",
    reason: "Use SEC Form 3/4/5 sources first; no official Finviz API is assumed.",
  },
});

const COVERAGE_STATE_POLICY = Object.freeze({
  label: "Financial-record coverage state",
  states: ["sufficient-data", "mixed-records", "needs-review", "insufficient-data"],
  source: "normalized public financial records and synthetic placeholders until adapters exist",
  notAdvice:
    "Coverage state summarizes record completeness and consistency only. It is not personal financial advice, a recommendation, or an order trigger.",
  blockedUses: [
    "Money-maker-3000 execution input",
    "autonomous trading trigger",
    "personalized suitability assessment",
  ],
});

const FREE_API_OPTIONS = Object.freeze([
  Object.freeze({
    id: "etoro-public-api",
    label: "eToro Public API",
    fit: "first-party market, portfolio, watchlist, social, and demo/read dashboard data",
    access: "requires verified eToro account and API/user keys",
    implementation: "server-side-only via existing eToro client and normalized DTOs",
    defaultUse: "primary source for eToro-owned dashboard state",
  }),
  Object.freeze({
    id: "sec-companyfacts",
    label: "SEC companyfacts/submissions",
    fit: "US stock fundamentals, filing metadata, ticker/exchange metadata by CIK",
    access: "free official API, no authentication",
    implementation: "server-side cached adapter with SEC User-Agent policy",
    defaultUse: "Research Desk financial-record coverage states and issuer context",
  }),
  Object.freeze({
    id: "sec-ownership-rss",
    label: "SEC ownership filing RSS",
    fit: "recent Forms 3, 4, and 5 insider activity awareness",
    access: "free official RSS/search feeds",
    implementation: "server-side RSS ingestion with source links and short summaries",
    defaultUse: "insider activity preview before any scraping fallback",
  }),
  Object.freeze({
    id: "alpha-vantage",
    label: "Alpha Vantage",
    fit: "optional stock, forex, crypto, commodity, economic, and indicator enrichment",
    access: "free key available with tight quota; no browser key exposure",
    implementation: "optional cached server adapter after official terms/rate review",
    defaultUse: "fallback enrichment when eToro and SEC do not cover a needed market context",
  }),
  Object.freeze({
    id: "twelve-data",
    label: "Twelve Data",
    fit: "optional quote/time-series exploration across equities, forex, and crypto",
    access: "free Basic plan with per-minute credits; no browser key exposure",
    implementation: "optional cached server adapter after official terms/rate review",
    defaultUse: "secondary market-data fallback for Research Desk, not bot signals",
  }),
]);

const PROVIDER_FALLBACK_POLICY = Object.freeze({
  mode: "metadata-only",
  defaultProvider: "etoro-public-api",
  enabledByDefault: ["etoro-public-api", "sec-companyfacts", "sec-ownership-rss"],
  disabledUntilConfigured: ["alpha-vantage", "twelve-data", "allowlisted-scraping"],
  fallbackOrder: [
    "eToro first-party reads",
    "free official public records",
    "free RSS/API sources with reviewed terms",
    "optional key-based enrichment",
    "allowlisted scraping after robots and terms review",
  ],
  safety: [
    "server-side-only-provider-calls",
    "no-browser-keys",
    "no-secrets-in-status-payloads",
    "cache-and-rate-limit-before-live-fetch",
    "context-only-output",
    "no-trade-or-bot-signal-output",
  ],
});

const PROVIDER_READINESS = Object.freeze([
  Object.freeze({
    id: "etoro-public-api",
    label: "eToro Public API",
    defaultState: "server-credential-required",
    credentialHandling: "server-side provider keys only",
    requestMetadata: ["unique-request-id", "provider-auth-headers-redacted"],
    liveNetworkConnected: false,
    readOnlyDefault: true,
    termsStatus: "official-docs-required-before-new-live-behavior",
    fallbackRole: "primary first-party dashboard reads",
  }),
  Object.freeze({
    id: "sec-companyfacts",
    label: "SEC companyfacts/submissions",
    defaultState: "planned-free-official",
    credentialHandling: "no API key; server-side User-Agent policy required",
    requestMetadata: ["source-url", "retrieved-at", "cache-state"],
    liveNetworkConnected: false,
    readOnlyDefault: true,
    termsStatus: "official-public-api-terms-review-before-adapter",
    fallbackRole: "first fallback for US issuer fundamentals",
  }),
  Object.freeze({
    id: "sec-ownership-rss",
    label: "SEC ownership filing RSS",
    defaultState: "planned-free-official",
    credentialHandling: "no API key; server-side feed fetch only",
    requestMetadata: ["source-url", "retrieved-at", "cache-state"],
    liveNetworkConnected: false,
    readOnlyDefault: true,
    termsStatus: "official-feed-terms-review-before-adapter",
    fallbackRole: "first fallback for Forms 3, 4, and 5 insider activity",
  }),
  Object.freeze({
    id: "alpha-vantage",
    label: "Alpha Vantage",
    defaultState: "disabled-optional-key",
    credentialHandling: "server-side optional key; never browser-exposed",
    requestMetadata: ["provider", "quota-window", "cache-state"],
    liveNetworkConnected: false,
    readOnlyDefault: true,
    termsStatus: "blocked-until-quota-and-terms-reviewed",
    fallbackRole: "optional enrichment after official/free sources",
  }),
  Object.freeze({
    id: "twelve-data",
    label: "Twelve Data",
    defaultState: "disabled-optional-key",
    credentialHandling: "server-side optional key; never browser-exposed",
    requestMetadata: ["provider", "quota-window", "cache-state"],
    liveNetworkConnected: false,
    readOnlyDefault: true,
    termsStatus: "blocked-until-quota-and-terms-reviewed",
    fallbackRole: "secondary quote/time-series enrichment",
  }),
]);

const SEC_COMPANYFACTS_FIXTURE_PREVIEW = Object.freeze({
  cik: 320193,
  entityName: "Apple Inc.",
  tickers: ["AAPL"],
  facts: {
    "us-gaap": {
      Revenues: {
        units: {
          USD: [
            { val: 391035000000, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", end: "2024-09-28" },
          ],
        },
      },
      NetIncomeLoss: {
        units: {
          USD: [
            { val: 93736000000, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", end: "2024-09-28" },
          ],
        },
      },
      Assets: {
        units: {
          USD: [
            { val: 364980000000, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", end: "2024-09-28" },
          ],
        },
      },
      Liabilities: {
        units: {
          USD: [
            { val: 308030000000, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", end: "2024-09-28" },
          ],
        },
      },
      StockholdersEquity: {
        units: {
          USD: [
            { val: 56950000000, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", end: "2024-09-28" },
          ],
        },
      },
    },
    dei: {
      EntityCommonStockSharesOutstanding: {
        units: {
          shares: [
            { val: 15115823000, fy: 2024, fp: "FY", form: "10-K", filed: "2024-11-01", end: "2024-10-18" },
          ],
        },
      },
    },
  },
});

const SEC_COMPANYFACTS_NORMALIZED_PREVIEW = Object.freeze(
  normalizeSecCompanyFacts({
    companyFacts: SEC_COMPANYFACTS_FIXTURE_PREVIEW,
    sourceUrl: "fixture://sec/companyfacts/CIK0000320193.json",
    retrievedAt: "2026-05-17T00:00:00.000Z",
  }),
);

const SEC_OWNERSHIP_NORMALIZED_PREVIEW = Object.freeze(
  normalizeSecOwnershipFilings({
    symbol: "AAPL",
    issuerName: "Apple Inc.",
    sourceUrl: "fixture://sec/ownership/AAPL/forms-3-4-5.json",
    filings: [
      {
        formType: "4",
        filedAt: "2026-01-08T00:00:00.000Z",
        reportingOwner: "Example Director",
        relationship: "Director",
        transactionCode: "P",
        shares: 1200,
      },
      {
        formType: "4",
        filedAt: "2026-01-03T00:00:00.000Z",
        reportingOwner: "Example Officer",
        relationship: "Officer",
        transactionCode: "S",
        shares: 500,
      },
    ],
  }),
);

export function researchIntelligenceStatus() {
  return {
    freeApiOptions: FREE_API_OPTIONS,
    providerFallbackPolicy: PROVIDER_FALLBACK_POLICY,
    providerReadiness: PROVIDER_READINESS,
    adapterContracts: [
      SEC_COMPANYFACTS_ADAPTER_CONTRACT,
      SEC_OWNERSHIP_ADAPTER_CONTRACT,
    ],
    sourcePriority: OFFICIAL_SOURCE_PRIORITY,
    scrapingPolicy: SCRAPING_POLICY,
    coverageStatePolicy: COVERAGE_STATE_POLICY,
    financialRecordsPreview: [
      SEC_COMPANYFACTS_NORMALIZED_PREVIEW,
      {
        symbol: "SPY",
        assetClass: "ETF",
        sourceState: "planned-sec-nport-and-issuer",
        coverageState: "needs-review",
        coverageBasis: [
          "broad-market ETF placeholder",
          "expense and concentration metrics pending",
          "holdings source not connected",
        ],
        keyFigures: [
          { label: "Expense ratio", value: "planned", source: "issuer factsheet" },
          { label: "Top holdings", value: "planned", source: "issuer or N-PORT" },
          { label: "Sector exposure", value: "planned", source: "issuer or N-PORT" },
          { label: "Distribution yield", value: "planned", source: "issuer factsheet" },
        ],
      },
      {
        symbol: "BTC",
        assetClass: "Crypto",
        sourceState: "news-and-market-context-only",
        coverageState: "insufficient-data",
        coverageBasis: [
          "no public financial statements",
          "use news, liquidity, volatility, and macro context instead",
        ],
        keyFigures: [
          { label: "Relevant news", value: "planned", source: "RSS/API" },
          { label: "Volatility context", value: "planned", source: "market data" },
        ],
      },
    ],
    insiderActivityPreview: [
      SEC_OWNERSHIP_NORMALIZED_PREVIEW,
    ],
    newsTickerPreview: [
      {
        symbol: "EURUSD",
        assetClass: "Forex",
        headline: "Central-bank calendar context placeholder",
        source: "synthetic",
        relevance: "portfolio-position",
      },
      {
        symbol: "USOIL",
        assetClass: "Commodity",
        headline: "Inventory and supply-demand headline placeholder",
        source: "synthetic",
        relevance: "portfolio-position",
      },
      {
        symbol: "BTC",
        assetClass: "Crypto",
        headline: "Crypto regulatory and liquidity headline placeholder",
        source: "synthetic",
        relevance: "portfolio-position",
      },
    ],
  };
}
