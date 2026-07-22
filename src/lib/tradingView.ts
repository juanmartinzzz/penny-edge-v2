/**
 * Re-export shared TradingView helpers for the web app.
 * Canonical mapping lives in `shared/tradingView.ts` (also used by the API worker).
 */
export {
  generateTradingViewUrl,
  type TradingViewSymbol,
} from "../../shared/tradingView";
