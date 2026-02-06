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
        `${item.quantity}× ${item.name} (${item.size}) — ${(item.price || 0).toLocaleString()} Kč`
    )
    .join("<br>");
}

function formatItemsText(items: CartItem[]) {
  return items
    .map(
      (item) =>
        `${item.quantity}x ${item.name} (${item.size}) - ${(item.price || 0).toLocaleString()} Kč`
    )
    .join("\n");
}

function getFulfillmentRecipients(): string[] {
  // Comma separated list: "michal@..., ops@..."
  const raw = process.env.FULFILLMENT_EMAIL_TO || process.env.OPS_EMAIL_TO || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Customer confirmation email (paid / confirmed).
 */
export async function sendOrderConfirmationEmail(order: Order): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
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
    .total { font-size: 20px; font-weight: 700; text-align: right; padding: 20px 0; border-top: 2px solid #fff; }
    .meta { font-size: 12px; color: #aaa; margin-top: 10px; }
    .shipping { background-color: #1a1a1a; padding: 20px; margin-top: 20px; }
    .shipping-title { font-weight: 700; margin-bottom: 10px; text-transform: uppercase; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #333; }
    a { color: #fff; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">ZLE</div>
    </div>
    <div class="content">
      <div class="order-title">Děkujeme za objednávku!</div>
      <div class="order-info">
        <div class="order-id">Číslo objednávky: ${order.id}</div>
        <div class="items">${itemsList}</div>
        <div class="total">Celkem: ${totalCzk.toLocaleString()} Kč</div>
        <div class="meta">Doprava: ${shippingLabel} • Platba: ${paymentMethod}</div>
      </div>
      <div class="shipping">
        <div class="shipping-title">Doručovací adresa</div>
        <div>${order.customerName}</div>
        <div>${order.customerAddress}</div>
        <div>${order.customerZip} ${order.customerCity}</div>
      </div>
    </div>
    <div class="footer">
      <p>ZLE Underground Skate Brand</p>
      <p>Máte dotazy? Kontaktujte nás na info@zle.cz</p>
    </div>
  </div>
</body>
</html>`;

    const { error } = await client.emails.send({
      from: `ZLE <${fromEmail}>`,
      to: [order.customerEmail],
      subject: `ZLE - Potvrzení objednávky #${order.id.slice(0, 8)}`,
      html,
    });

    if (error) {
      console.error("Failed to send order confirmation email:", error);
      return false;
    }

    console.log(`Order confirmation email sent to ${order.customerEmail}`);
    return true;
  } catch (error) {
    console.error("Error sending order confirmation email:", error);
    return false;
  }
}

/**
 * Fulfillment email (Michal / TotalBoardShop).
 * Sends full order details for packing & shipping.
 */
export async function sendFulfillmentNewOrderEmail(order: Order): Promise<boolean> {
  try {
    const to = getFulfillmentRecipients();
    if (to.length === 0) {
      console.warn("[email] Fulfillment recipients missing (FULFILLMENT_EMAIL_TO / OPS_EMAIL_TO)");
      return false;
    }

    const { client, fromEmail } = await getUncachableResendClient();
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
      `Payment: ${paymentMethod}`,
      `Shipping: ${shippingLabel}`,
      "",
      "ITEMS:",
      itemsText || "(no items parsed)",
      "",
      "DELIVERY:",
      order.customerName,
      order.customerAddress,
      `${order.customerZip} ${order.customerCity}`,
      `Email: ${order.customerEmail}`,
      "",
      "TOTALS:",
      subtotal !== null ? `Subtotal: ${subtotal} CZK` : null,
      shipping !== null ? `Shipping: ${shipping} CZK` : null,
      cod !== null ? `COD fee: ${cod} CZK` : null,
      `TOTAL: ${total} CZK`,
    ]
      .filter(Boolean)
      .join("\n");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; background:#0b0b0b; color:#fff; padding:20px; }
    .wrap { max-width:680px; margin:0 auto; border:1px solid #222; background:#111; }
    .top { padding:18px 20px; border-bottom:1px solid #222; background:#000; }
    .top h1 { margin:0; font-size:18px; letter-spacing:1px; }
    .meta { padding:14px 20px; border-bottom:1px solid #222; font-size:12px; color:#bbb; }
    .section { padding:18px 20px; border-bottom:1px solid #222; }
    .label { font-weight:700; margin-bottom:8px; text-transform:uppercase; font-size:12px; color:#aaa; }
    .items { line-height:1.6; }
    .totals { font-weight:700; }
    .pill { display:inline-block; padding:4px 10px; border:1px solid #444; border-radius:999px; margin-right:8px; font-size:12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <h1>ZLE • NOVÁ OBJEDNÁVKA #${order.id.slice(0, 8)}</h1>
    </div>
    <div class="meta">
      <span class="pill">${shippingLabel}</span>
      <span class="pill">${paymentMethod}</span>
      <span class="pill">${orderStatus} / ${paymentStatus}</span>
    </div>
    <div class="section">
      <div class="label">Items</div>
      <div class="items">${itemsHtml || "<em>(no items parsed)</em>"}</div>
    </div>
    <div class="section">
      <div class="label">Doručení</div>
      <div>${order.customerName}</div>
      <div>${order.customerAddress}</div>
      <div>${order.customerZip} ${order.customerCity}</div>
      <div style="margin-top:8px; color:#bbb;">${order.customerEmail}</div>
    </div>
    <div class="section">
      <div class="label">Součty</div>
      <div>${subtotal !== null ? `Mezisoučet: ${subtotal.toLocaleString()} Kč<br>` : ""}</div>
      <div>${shipping !== null ? `Doprava: ${shipping.toLocaleString()} Kč<br>` : ""}</div>
      <div>${cod !== null ? `Dobírka: ${cod.toLocaleString()} Kč<br>` : ""}</div>
      <div class="totals">CELKEM: ${total.toLocaleString()} Kč</div>
    </div>
  </div>
</body>
</html>`;

    const { error } = await client.emails.send({
      from: `ZLE Ops <${fromEmail}>`,
      to,
      subject,
      text,
      html,
    });

    if (error) {
      console.error("Failed to send fulfillment email:", error);
      return false;
    }

    console.log(`[email] Fulfillment order email sent to ${to.join(", ")}`);
    return true;
  } catch (error) {
    console.error("Error sending fulfillment email:", error);
    return false;
  }
}

export async function sendShippingUpdateEmail(order: Order, status: string): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();

    let statusText = "";
    let statusMessage = "";

    switch (status) {
      case "confirmed":
        statusText = "Potvrzeno";
        statusMessage = "Vaše objednávka byla potvrzena a připravuje se k odeslání.";
        break;
      case "shipped":
        statusText = "Odesláno";
        statusMessage = "Vaše objednávka byla odeslána! Zásilka je na cestě k vám.";
        break;
      case "delivered":
        statusText = "Doručeno";
        statusMessage = "Vaše objednávka byla úspěšně doručena. Děkujeme za nákup!";
        break;
      default:
        return false;
    }

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
    .status-title { font-size: 24px; font-weight: 700; margin-bottom: 20px; text-transform: uppercase; }
    .status-badge { display: inline-block; background-color: #fff; color: #000; padding: 10px 20px; font-weight: 700; text-transform: uppercase; margin-bottom: 20px; }
    .message { font-size: 16px; line-height: 1.6; margin-bottom: 20px; }
    .order-info { background-color: #1a1a1a; padding: 20px; }
    .order-id { font-size: 12px; color: #888; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; border-top: 1px solid #333; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">ZLE</div>
    </div>
    <div class="content">
      <div class="status-title">Aktualizace objednávky</div>
      <div class="status-badge">${statusText}</div>
      <div class="message">${statusMessage}</div>
      <div class="order-info">
        <div class="order-id">Číslo objednávky: ${order.id}</div>
        <div style="margin-top: 10px;">
          <strong>${order.customerName}</strong><br>
          ${order.customerAddress}<br>
          ${order.customerZip} ${order.customerCity}
        </div>
      </div>
    </div>
    <div class="footer">
      <p>ZLE Underground Skate Brand</p>
      <p>Máte dotazy? Kontaktujte nás na info@zle.cz</p>
    </div>
  </div>
</body>
</html>`;

    const { error } = await client.emails.send({
      from: `ZLE <${fromEmail}>`,
      to: [order.customerEmail],
      subject: `ZLE - Objednávka #${order.id.slice(0, 8)} - ${statusText}`,
      html,
    });

    if (error) {
      console.error("Failed to send shipping update email:", error);
      return false;
    }

    console.log(`Shipping update email (${status}) sent to ${order.customerEmail}`);
    return true;
  } catch (error) {
    console.error("Error sending shipping update email:", error);
    return false;
  }
}
