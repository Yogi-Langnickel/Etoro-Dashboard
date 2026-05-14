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

const INDICATOR_POLICY = Object.freeze({
  label: "Financial-data indicator",
  states: ["buy", "hold", "sell", "insufficient-data"],
  source: "normalized public financial records and synthetic placeholders until adapters exist",
  notAdvice:
    "Indicator is an informational summary of financial data only. It is not personal financial advice, a recommendation, or an order signal.",
  blockedUses: [
    "Money-maker-3000 execution input",
    "autonomous trading signal",
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
    defaultUse: "Research Desk financial-record indicators and issuer context",
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

export function researchIntelligenceStatus() {
  return {
    freeApiOptions: FREE_API_OPTIONS,
    sourcePriority: OFFICIAL_SOURCE_PRIORITY,
    scrapingPolicy: SCRAPING_POLICY,
    indicatorPolicy: INDICATOR_POLICY,
    financialRecordsPreview: [
      {
        symbol: "AAPL",
        assetClass: "Equity",
        sourceState: "planned-sec-companyfacts",
        indicator: "hold",
        indicatorBasis: [
          "strong profitability placeholder",
          "large cash-flow base placeholder",
          "valuation needs live SEC-derived denominator",
        ],
        keyFigures: [
          { label: "Revenue growth", value: "planned", source: "SEC companyfacts" },
          { label: "Free cash flow", value: "planned", source: "SEC companyfacts" },
          { label: "Debt to assets", value: "planned", source: "SEC companyfacts" },
          { label: "Valuation", value: "needs price + share data", source: "derived" },
        ],
      },
      {
        symbol: "SPY",
        assetClass: "ETF",
        sourceState: "planned-sec-nport-and-issuer",
        indicator: "hold",
        indicatorBasis: [
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
        indicator: "insufficient-data",
        indicatorBasis: [
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
      {
        symbol: "AAPL",
        sourceState: "planned-sec-forms-3-4-5",
        latestWindow: "30d placeholder",
        netDirection: "not-connected",
        notableActivity: "Use SEC ownership filings before any Finviz fallback.",
      },
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
