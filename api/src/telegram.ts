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
