/**
 * Minimal Telegram Bot API helper for outbound alerts.
 * Docs: https://core.telegram.org/bots/api#sendmessage
 */
import { generateTradingViewUrl } from "../../shared/tradingView";

export interface TelegramEnv {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

export async function sendTelegramMessage(
  env: TelegramEnv,
  text: string,
  opts?: { parseMode?: "HTML" },
): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    console.warn("Telegram secrets missing — skipping alert");
    return false;
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (opts?.parseMode) {
    payload.parse_mode = opts.parseMode;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(
      `Telegram sendMessage failed (${response.status}): ${body.slice(0, 500)}`,
    );
    return false;
  }

  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Short COBUTA ping — tickers link to TradingView charts. */
export function formatCobutaAlert(
  symbols: Array<{ symbol: string; exchange: string | null }>,
): string {
  const links = symbols.map((row) => {
    const href = generateTradingViewUrl({
      symbol: row.symbol,
      exchange: row.exchange,
    });
    const label = escapeHtml(row.symbol);
    return `<a href="${href}">${label}</a>`;
  });

  return `COBUTA\n${links.join("  ")}`;
}

export type SwatchAlertLine =
  | {
      kind: "move";
      symbol: string;
      exchange: string;
      movePct: number;
      windowHours: number;
      thresholdPct: number;
    }
  | {
      kind: "atr";
      symbol: string;
      exchange: string;
      pnl: number;
      pct: number;
      shares: number;
      avgCost: number;
      triggerUnit: "usd" | "pct";
      triggerValue: number;
    };

function formatUsd(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function formatPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/** SWATCH (Sell Watch) ping — move and/or all-time return lines. */
export function formatSwatchAlert(lines: SwatchAlertLine[]): string {
  const body = lines.map((row) => {
    const href = generateTradingViewUrl({
      symbol: row.symbol,
      exchange: row.exchange,
    });
    const label = escapeHtml(row.symbol);
    const link = `<a href="${href}">${label}</a>`;

    if (row.kind === "move") {
      const sign = row.movePct > 0 ? "+" : "";
      const move = `${sign}${row.movePct.toFixed(1)}%`;
      return `${link} ${escapeHtml(move)} in ${row.windowHours}h (thr ${row.thresholdPct}%)`;
    }

    const trigger =
      row.triggerUnit === "usd"
        ? formatUsd(row.triggerValue)
        : formatPct(row.triggerValue);
    const pnl = formatUsd(row.pnl);
    const pct = formatPct(row.pct);
    const sh = row.shares.toLocaleString("en-US", {
      maximumFractionDigits: 4,
    });
    const cost = `$${row.avgCost.toLocaleString("en-US", {
      maximumFractionDigits: 4,
    })}`;
    return `${link} ATR ${escapeHtml(pnl)} (trigger ${escapeHtml(trigger)}) · ${escapeHtml(sh)} sh @ ${escapeHtml(cost)} · ${escapeHtml(pct)}`;
  });

  return `SWATCH\n${body.join("\n")}`;
}
