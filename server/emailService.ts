// server/emailService.ts
// Email service for ZLE e-commerce - customer confirmations + fulfillment notifications
import { getUncachableResendClient } from "./resendClient";
import { storage } from "./storage";
import type { Order } from "@shared/schema";

type EmailLineItem = {
  productId?: string;
  name: string;
  size?: string;
  quantity: number;
  unitPriceCzk: number;
};

type ParsedOrderItems = {
  // Can be legacy CartItem[] OR current CheckoutItem[] ({ productId, quantity, size })
  items: any[];
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

    // Legacy: stored as plain array (either CartItem[] OR CheckoutItem[])
    if (Array.isArray(parsed)) {
      return { items: parsed as any[] };
    }

    // Current: stored as object { items, shipping..., totals... }
    const items = Array.isArray(parsed?.items) ? (parsed.items as any[]) : [];
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

function safeStr(v: unknown, fallback = "-") {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : fallback;
}

function safeNum(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getCustomerFromOrder(order: Order) {
  // Current DB schema
  const name = (order as any).customerName ?? (order as any).name;
  const email = (order as any).customerEmail ?? (order as any).email;
  const address = (order as any).customerAddress ?? (order as any).address;
  const city = (order as any).customerCity ?? (order as any).city;
  const zip = (order as any).customerZip ?? (order as any).zip;
  const phone = (order as any).customerPhone ?? (order as any).phone;

  return {
    name: safeStr(name),
    email: safeStr(email),
    address: safeStr(address),
    city: safeStr(city),
    zip: safeStr(zip),
    phone: safeStr(phone),
  };
}

async function normalizeEmailItems(rawItems: any[]): Promise<EmailLineItem[]> {
  // Supports:
  // A) legacy CartItem[] { name, price, size, quantity, productId? }
  // B) current checkout items { productId, quantity, size? }
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];

  const productCache = new Map<string, { name: string; price: number }>();

  return Promise.all(
    rawItems.map(async (raw) => {
      const productId = typeof raw?.productId === "string" ? raw.productId : undefined;

      // If we already have full data, keep it (legacy)
      const legacyName = typeof raw?.name === "string" ? raw.name : undefined;
      const legacyPrice = raw?.price;

      const quantity = Math.max(1, Math.min(99, Math.floor(safeNum(raw?.quantity, 1))));
      const sizeRaw = typeof raw?.size === "string" ? raw.size : raw?.size == null ? "" : String(raw.size);
      const size = safeStr(sizeRaw, "-");

      if (legacyName) {
        return {
          productId,
          name: safeStr(legacyName, productId ? `Produkt (${productId})` : "Produkt"),
          size: size === "-" ? undefined : size,
          quantity,
          unitPriceCzk: Math.max(0, Math.round(safeNum(legacyPrice, 0))),
        };
      }

      if (!productId) {
        return {
          name: "Produkt",
          size: size === "-" ? undefined : size,
          quantity,
          unitPriceCzk: 0,
        };
      }

      // Fetch product details (server-side truth)
      try {
        if (!productCache.has(productId)) {
          const product = await storage.getProduct(productId);
          productCache.set(productId, {
            name: product?.name ? String(product.name) : `Neznámý produkt (${productId})`,
            price: Math.max(0, Math.round(safeNum((product as any)?.price, 0))),
          });
        }
      } catch {
        if (!productCache.has(productId)) {
          productCache.set(productId, {
            name: `Neznámý produkt (${productId})`,
            price: 0,
          });
        }
      }

      const p = productCache.get(productId)!;
      return {
        productId,
        name: safeStr(p.name, `Produkt (${productId})`),
        size: size === "-" ? undefined : size,
        quantity,
        unitPriceCzk: p.price,
      };
    }),
  );
}

function formatItemsHtml(items: EmailLineItem[]) {
  return items
    .map((item) => {
      const sizePart = item.size ? ` (${item.size})` : "";
      return `${item.quantity}× <b>${safeStr(item.name, "Produkt")}</b>${sizePart} — ${(
        item.unitPriceCzk || 0
      ).toLocaleString()} Kč`;
    })
    .join("<br />");
}

function formatItemsText(items: EmailLineItem[]) {
  return items
    .map((item) => {
      const sizePart = item.size ? ` (${item.size})` : "";
      return `${item.quantity}x ${safeStr(item.name, "Produkt")}${sizePart} - ${(
        item.unitPriceCzk || 0
      ).toLocaleString()} Kč`;
    })
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
  const raw = process.env.FULFILLMENT_EMAIL_TO || process.env.OPS_EMAIL_TO || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function sendOrderConfirmationEmail(order: Order): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();

    if (isResendTestFrom(fromEmail)) {
      console.warn(
        `[email] Resend is in TEST mode (from=${fromEmail}). ` +
          `To deliver real emails, verify your domain in Resend and set RESEND_FROM_EMAIL ` +
          `(e.g. shop@${domainHint(fromEmail) || "YOUR_DOMAIN"}).`
      );
    }

    const parsed = parseOrderItems(order.items);
    const items = await normalizeEmailItems(parsed.items);

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

    const customer = getCustomerFromOrder(order);
    const to = customer.email;
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

    if (isResendTestFrom(fromEmail)) {
      console.warn(
        `[email] Resend is in TEST mode (from=${fromEmail}). ` +
          `To deliver real emails, verify your domain in Resend and set RESEND_FROM_EMAIL ` +
          `(e.g. shop@${domainHint(fromEmail) || "YOUR_DOMAIN"}).`
      );
    }

    const parsed = parseOrderItems(order.items);
    const items = await normalizeEmailItems(parsed.items);

    const shippingLabel = parsed.shippingLabel || "Doprava";
    const paymentMethod = (order.paymentMethod || "card").toUpperCase();
    const paymentStatus = (order.paymentStatus || "unpaid").toUpperCase();
    const orderStatus = (order.status || "pending").toUpperCase();

    const subtotal = typeof parsed.subtotalCzk === "number" ? Math.round(parsed.subtotalCzk) : null;
    const shipping = typeof parsed.shippingCzk === "number" ? Math.round(parsed.shippingCzk) : null;
    const cod = typeof parsed.codCzk === "number" ? Math.round(parsed.codCzk) : null;
    const total =
      typeof parsed.totalCzk === "number"
        ? Math.round(parsed.totalCzk)
        : Math.round(Number(order.total) || 0);

    const shortId = order.id.slice(0, 8).toUpperCase();

    const itemsText = formatItemsText(items);

    const customer = getCustomerFromOrder(order);

    const itemsRowsHtml = items
      .map((item) => {
        const qty = Math.max(0, item.quantity || 0);
        const unit = Math.max(0, item.unitPriceCzk || 0);
        const lineTotal = unit * qty;
        const sizeLabel = item.size ? safeStr(item.size, "-") : "-";
        return `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e8e8e8;">
              <div style="font-weight:800;color:#111;">${safeStr(item.name, "Produkt")}</div>
              <div style="font-size:12px;color:#666;margin-top:2px;">Velikost: ${sizeLabel}</div>
              <div style="font-size:12px;color:#666;margin-top:2px;">Cena/ks: ${unit.toLocaleString()} Kč</div>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #e8e8e8;text-align:center;color:#111;font-weight:700;">${qty}×</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e8e8e8;text-align:right;color:#111;font-weight:800;">
              ${(lineTotal || 0).toLocaleString()} Kč
            </td>
          </tr>
        `;
      })
      .join("");

    const subject = `ZLE • NOVÁ OBJEDNÁVKA #${shortId} • ${shippingLabel} • ${paymentMethod}`;

    const text = [
      "ZLE — NOVÁ OBJEDNÁVKA",
      `Číslo objednávky: #${shortId}`,
      `ID: ${order.id}`,
      `Stav: ${orderStatus} / platba: ${paymentStatus}`,
      "",
      `Zákazník: ${customer.name} (${customer.email})`,
      `Telefon: ${customer.phone}`,
      `Adresa: ${customer.address}, ${customer.city} ${customer.zip}`,
      "",
      `Doprava: ${shippingLabel}`,
      `Platba: ${paymentMethod}`,
      "",
      "Položky:",
      itemsText,
      "",
      `Mezisoučet: ${subtotal ?? "-"} Kč`,
      `Doprava: ${shipping ?? "-"} Kč`,
      `Dobírka: ${cod ?? "-"} Kč`,
      `CELKEM: ${total} Kč`,
    ].join("\n");

    // B) Kompromis: světlé + čitelné + lehce ZLE vibe (černý header, výrazný order number)
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
  <style>
    body { margin:0; padding:0; background:#f4f4f4; }
    table { border-collapse:collapse; }
    a { color:inherit; text-decoration:none; }
  </style>
</head>
<body>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f4;padding:18px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="720" cellspacing="0" cellpadding="0" style="max-width:720px;width:100%;background:#ffffff;border:1px solid #e6e6e6;">
          <!-- Header -->
          <tr>
            <td style="background:#000000;padding:18px 20px;">
              <div style="font-family:Arial, sans-serif;font-weight:900;letter-spacing:3px;color:#ffffff;font-size:18px;line-height:1;">
                ZLE
              </div>
              <div style="font-family:Arial, sans-serif;color:#cfcfcf;font-size:12px;margin-top:8px;">
                NOVÁ OBJEDNÁVKA • ${shippingLabel} • ${paymentMethod}
              </div>
            </td>
          </tr>

          <!-- Big Order Number -->
          <tr>
            <td style="padding:16px 20px;border-bottom:1px solid #eeeeee;background:#ffffff;">
              <div style="font-family:Arial, sans-serif;font-size:12px;color:#666;letter-spacing:1px;text-transform:uppercase;">
                Číslo objednávky
              </div>
              <div style="font-family:Arial, sans-serif;font-size:28px;color:#111;font-weight:900;letter-spacing:1px;margin-top:6px;">
                #${shortId}
              </div>
              <div style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
                          font-size:12px;color:#444;margin-top:6px;">
                ID: ${order.id}
                <span style="color:#999;"> • </span>
                Stav: <b style="color:#111;">${orderStatus}</b>
                <span style="color:#999;"> / </span>
                Platba: <b style="color:#111;">${paymentStatus}</b>
              </div>
            </td>
          </tr>

          <!-- Customer + Address -->
          <tr>
            <td style="padding:18px 20px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td valign="top" style="padding-right:12px;">
                    <div style="font-family:Arial, sans-serif;font-size:12px;color:#666;letter-spacing:1px;text-transform:uppercase;">Zákazník</div>
                    <div style="font-family:Arial, sans-serif;font-size:14px;color:#111;margin-top:6px;line-height:1.5;">
                      <b>${customer.name}</b><br/>
                      ${customer.email}<br/>
                      ${customer.phone}
                    </div>
                  </td>
                  <td valign="top" style="padding-left:12px;border-left:1px solid #eeeeee;">
                    <div style="font-family:Arial, sans-serif;font-size:12px;color:#666;letter-spacing:1px;text-transform:uppercase;">Doručení</div>
                    <div style="font-family:Arial, sans-serif;font-size:14px;color:#111;margin-top:6px;line-height:1.5;">
                      ${customer.address}<br/>
                      ${customer.city} ${customer.zip}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Items -->
          <tr>
            <td style="padding:0 20px 18px 20px;">
              <div style="font-family:Arial, sans-serif;font-size:12px;color:#666;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">
                Položky
              </div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e8e8e8;">
                <tr>
                  <th align="left" style="padding:10px 12px;background:#fafafa;border-bottom:1px solid #e8e8e8;font-family:Arial,sans-serif;font-size:12px;color:#444;text-transform:uppercase;letter-spacing:1px;">
                    Produkt
                  </th>
                  <th align="center" style="padding:10px 12px;background:#fafafa;border-bottom:1px solid #e8e8e8;font-family:Arial,sans-serif;font-size:12px;color:#444;text-transform:uppercase;letter-spacing:1px;">
                    Ks
                  </th>
                  <th align="right" style="padding:10px 12px;background:#fafafa;border-bottom:1px solid #e8e8e8;font-family:Arial,sans-serif;font-size:12px;color:#444;text-transform:uppercase;letter-spacing:1px;">
                    Cena
                  </th>
                </tr>
                ${itemsRowsHtml}
              </table>
            </td>
          </tr>

          <!-- Totals -->
          <tr>
            <td style="padding:0 20px 20px 20px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:12px 14px;border:1px solid #e8e8e8;background:#ffffff;">
                    <div style="font-family:Arial,sans-serif;font-size:12px;color:#666;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">
                      Souhrn
                    </div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-family:Arial,sans-serif;font-size:14px;color:#111;">
                      <tr>
                        <td style="padding:4px 0;color:#444;">Mezisoučet</td>
                        <td align="right" style="padding:4px 0;">${subtotal ?? "-"} Kč</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:#444;">Doprava</td>
                        <td align="right" style="padding:4px 0;">${shipping ?? "-"} Kč</td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0;color:#444;">Dobírka</td>
                        <td align="right" style="padding:4px 0;">${cod ?? "-"} Kč</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top:10px;border-top:1px dashed #d9d9d9;"></td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;font-weight:900;letter-spacing:0.5px;">CELKEM</td>
                        <td align="right" style="padding:8px 0;font-weight:900;font-size:18px;">${total} Kč</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:14px 20px;border-top:1px solid #eeeeee;background:#fafafa;">
              <div style="font-family:Arial,sans-serif;font-size:12px;color:#666;">
                ZLE • provozní email pro fulfillment • <span style="color:#111;font-weight:700;">JEDˇ TO ZLE</span>
              </div>
              <div style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
                          font-size:11px;color:#888;margin-top:6px;">
                #${shortId} • ${shippingLabel} • ${paymentMethod}
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
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
