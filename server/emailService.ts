// Email service for ZLE e-commerce - customer confirmations + fulfillment notifications
import { getUncachableResendClient } from "./resendClient";
import type { Order, CartItem } from "@shared/schema";

type ParsedOrderItems = {
  items: CartItem[];
  shippingMethod?: string;
  shippingLabel?: string;
  subtotalCzk?: number;
  shippingCzk?: number;
  codCzk?: number;
  totalCzk?: number;
};

function parseOrderItems(raw: string): ParsedOrderItems {
  try {
    const parsed = JSON.parse(raw);

    // Legacy: stored as plain CartItem[]
    if (Array.isArray(parsed)) {
      return { items: parsed as CartItem[] };
    }

    // Current: stored as object { items, shipping..., totals... }
    const items = Array.isArray(parsed?.items) ? (parsed.items as CartItem[]) : [];
    return {
      items,
      shippingMethod: parsed?.shippingMethod,
      shippingLabel: parsed?.shippingLabel,
      subtotalCzk: parsed?.subtotalCzk,
      shippingCzk: parsed?.shippingCzk,
      codCzk: parsed?.codCzk,
      totalCzk: parsed?.totalCzk,
    };
  } catch {
    return { items: [] };
  }
}

function formatItemsHtml(items: CartItem[]) {
  return items
    .map(
      (item) =>
        `${item.quantity}x ${item.name} (${item.size}) - ${(item.price || 0).toLocaleString()} Kč`
    )
    .join("<br />");
}

function formatItemsText(items: CartItem[]) {
  return items
    .map(
      (item) =>
        `${item.quantity}x ${item.name} (${item.size}) - ${(item.price || 0).toLocaleString()} Kč`
    )
    .join("\n");
}

function isResendTestFrom(fromEmail: string | undefined | null) {
  const v = (fromEmail || "").toLowerCase().trim();
  return v === "onboarding@resend.dev" || v.endsWith("@resend.dev");
}

function domainHint(fromEmail: string | undefined | null) {
  const v = (fromEmail || "").trim();
  const at = v.lastIndexOf("@");
  return at > -1 ? v.slice(at + 1) : "";
}

function getFulfillmentRecipients(): string[] {
  // Comma separated list: "michal@..., ops@..."
  const raw = process.env.FULFILLMENT_EMAIL_TO || process.env.OPS_EMAIL_TO || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendOrderConfirmationEmail(order: Order): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();

    // Resend test-mode hardening: onboarding@resend.dev can only send to the account email.
    // If you see 403 validation_error, you must verify a domain in Resend and set RESEND_FROM_EMAIL to that domain.
    if (isResendTestFrom(fromEmail)) {
      console.warn(
        `[email] Resend is in TEST mode (from=${fromEmail}). ` +
          `To deliver real emails, verify your domain in Resend and set RESEND_FROM_EMAIL ` +
          `(e.g. shop@${domainHint(fromEmail) || "YOUR_DOMAIN"}).`
      );
    }

    const parsed = parseOrderItems(order.items);
    const items = parsed.items;

    const itemsList = formatItemsHtml(items);

    const shippingLabel = parsed.shippingLabel || "Doprava";
    const paymentMethod = (order.paymentMethod || "card").toUpperCase();

    const totalCzk =
      typeof parsed.totalCzk === "number"
        ? Math.round(parsed.totalCzk)
        : Math.round(Number(order.total) || 0);

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; background-color: #000; color: #fff; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background-color: #111; border: 1px solid #333; }
    .header { background-color: #000; padding: 30px; text-align: center; border-bottom: 1px solid #333; }
    .logo { font-size: 36px; font-weight: 900; letter-spacing: 4px; color: #fff; }
    .content { padding: 30px; }
    .order-title { font-size: 24px; font-weight: 700; margin-bottom: 20px; text-transform: uppercase; }
    .order-info { background-color: #1a1a1a; padding: 20px; margin-bottom: 20px; }
    .order-id { font-size: 12px; color: #888; margin-bottom: 10px; }
    .items { margin-bottom: 20px; }
    .total { font-size: 20px; font-weight: 700; padding: 15px; background-color: #fff; color: #000; text-align: center; }
    .footer { font-size: 12px; color: #888; padding: 20px; text-align: center; border-top: 1px solid #333; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">ZLE</div>
    </div>
    <div class="content">
      <div class="order-title">OBJEDNÁVKA PŘIJATA</div>
      <div class="order-info">
        <div class="order-id">ID: ${order.id}</div>
        <div>Doprava: <b>${shippingLabel}</b></div>
        <div>Platba: <b>${paymentMethod}</b></div>
      </div>
      <div class="items">
        <b>Položky:</b><br />
        ${itemsList}
      </div>
      <div class="total">CELKEM: ${totalCzk} Kč</div>
    </div>
    <div class="footer">
      ZLE • JEDˇ TO ZLE
    </div>
  </div>
</body>
</html>`;

    const subject = `ZLE • Objednávka přijatá #${order.id.slice(0, 8)} • ${shippingLabel}`;

    const to = order.email;
    if (!to) return false;

    await client.emails.send({
      from: fromEmail,
      to,
      subject,
      html,
    });

    return true;
  } catch (err) {
    console.error("Failed to send confirmation email:", err);
    return false;
  }
}

export async function sendFulfillmentNewOrderEmail(order: Order): Promise<boolean> {
  try {
    const to = getFulfillmentRecipients();
    if (to.length === 0) {
      console.warn("[email] Fulfillment recipients missing (FULFILLMENT_EMAIL_TO / OPS_EMAIL_TO)");
      return false;
    }

    const { client, fromEmail } = await getUncachableResendClient();

    // Resend test-mode hardening: onboarding@resend.dev can only send to the account email.
    // If you see 403 validation_error, you must verify a domain in Resend and set RESEND_FROM_EMAIL to that domain.
    if (isResendTestFrom(fromEmail)) {
      console.warn(
        `[email] Resend is in TEST mode (from=${fromEmail}). ` +
          `To deliver real emails, verify your domain in Resend and set RESEND_FROM_EMAIL ` +
          `(e.g. shop@${domainHint(fromEmail) || "YOUR_DOMAIN"}).`
      );
    }

    const parsed = parseOrderItems(order.items);
    const items = parsed.items;

    const shippingLabel = parsed.shippingLabel || "Doprava";
    const paymentMethod = (order.paymentMethod || "card").toUpperCase();
    const paymentStatus = (order.paymentStatus || "unpaid").toUpperCase();
    const orderStatus = (order.status || "pending").toUpperCase();

    const subtotal = typeof parsed.subtotalCzk === "number" ? Math.round(parsed.subtotalCzk) : null;
    const shipping = typeof parsed.shippingCzk === "number" ? Math.round(parsed.shippingCzk) : null;
    const cod = typeof parsed.codCzk === "number" ? Math.round(parsed.codCzk) : null;
    const total = typeof parsed.totalCzk === "number" ? Math.round(parsed.totalCzk) : Math.round(Number(order.total) || 0);

    const itemsText = formatItemsText(items);
    const itemsHtml = formatItemsHtml(items);

    const subject = `ZLE • NOVÁ OBJEDNÁVKA #${order.id.slice(0, 8)} • ${shippingLabel} • ${paymentMethod}`;

    const text = [
      "ZLE — NOVÁ OBJEDNÁVKA",
      `Order ID: ${order.id}`,
      `Status: ${orderStatus} / ${paymentStatus}`,
      "",
      `Customer: ${order.name || "-"} (${order.email || "-"})`,
      `Phone: ${order.phone || "-"}`,
      `Address: ${order.address || "-"}, ${order.city || "-"} ${order.zip || "-"}`,
      "",
      `Shipping: ${shippingLabel}`,
      `Payment: ${paymentMethod}`,
      "",
      "Items:",
      itemsText,
      "",
      `Subtotal: ${subtotal ?? "-"} Kč`,
      `Shipping: ${shipping ?? "-"} Kč`,
      `COD: ${cod ?? "-"} Kč`,
      `TOTAL: ${total} Kč`,
    ].join("\n");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; background:#0b0b0b; color:#fff; padding:20px; }
    .wrap { max-width:720px; margin:0 auto; background:#111; border:1px solid #2a2a2a; }
    .head { padding:18px 20px; border-bottom:1px solid #2a2a2a; font-weight:900; letter-spacing:2px; }
    .sec { padding:20px; border-bottom:1px solid #222; }
    .k { color:#aaa; font-size:12px; text-transform:uppercase; letter-spacing:1px; }
    .v { font-size:14px; margin-top:6px; }
    .items { margin-top:10px; line-height:1.6; }
    .total { font-size:18px; font-weight:900; padding:14px 20px; background:#fff; color:#000; text-align:right; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">ZLE • NOVÁ OBJEDNÁVKA</div>
    <div class="sec">
      <div class="k">Order</div>
      <div class="v">#${order.id.slice(0, 8)} • ${orderStatus} / ${paymentStatus}</div>
    </div>
    <div class="sec">
      <div class="k">Customer</div>
      <div class="v">${order.name || "-"} • ${order.email || "-"}</div>
      <div class="v">${order.phone || "-"}</div>
      <div class="v">${order.address || "-"}, ${order.city || "-"} ${order.zip || "-"}</div>
    </div>
    <div class="sec">
      <div class="k">Shipping / Payment</div>
      <div class="v">${shippingLabel} • ${paymentMethod}</div>
    </div>
    <div class="sec">
      <div class="k">Items</div>
      <div class="items">${itemsHtml}</div>
    </div>
    <div class="sec">
      <div class="k">Totals</div>
      <div class="v">Subtotal: ${subtotal ?? "-"} Kč</div>
      <div class="v">Shipping: ${shipping ?? "-"} Kč</div>
      <div class="v">COD: ${cod ?? "-"} Kč</div>
    </div>
    <div class="total">TOTAL: ${total} Kč</div>
  </div>
</body>
</html>`;

    await client.emails.send({
      from: fromEmail,
      to,
      subject,
      text,
      html,
    });

    return true;
  } catch (err) {
    console.error("Failed to send fulfillment email:", err);
    return false;
  }
}
