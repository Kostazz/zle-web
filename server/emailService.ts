// Email service for ZLE e-commerce - order confirmations and shipping updates
import { getUncachableResendClient } from './resendClient';
import type { Order, CartItem } from '@shared/schema';

export async function sendOrderConfirmationEmail(order: Order): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    const items: CartItem[] = JSON.parse(order.items);
    
    const itemsList = items.map(item => 
      `${item.quantity}x ${item.name} (${item.size}) - ${item.price.toLocaleString()} Kč`
    ).join('<br>');
    
    const html = `
<!DOCTYPE html>
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
    .item-row { padding: 10px 0; border-bottom: 1px solid #333; }
    .total { font-size: 20px; font-weight: 700; text-align: right; padding: 20px 0; border-top: 2px solid #fff; }
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
        <div class="items">
          ${itemsList}
        </div>
        <div class="total">Celkem: ${order.total.toLocaleString()} Kč</div>
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
</html>
    `;

    const { error } = await client.emails.send({
      from: `ZLE <${fromEmail}>`,
      to: [order.customerEmail],
      subject: `ZLE - Potvrzení objednávky #${order.id.slice(0, 8)}`,
      html,
    });

    if (error) {
      console.error('Failed to send order confirmation email:', error);
      return false;
    }

    console.log(`Order confirmation email sent to ${order.customerEmail}`);
    return true;
  } catch (error) {
    console.error('Error sending order confirmation email:', error);
    return false;
  }
}

export async function sendShippingUpdateEmail(order: Order, status: string): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    
    let statusText = '';
    let statusMessage = '';
    
    switch (status) {
      case 'confirmed':
        statusText = 'Potvrzeno';
        statusMessage = 'Vaše objednávka byla potvrzena a připravuje se k odeslání.';
        break;
      case 'shipped':
        statusText = 'Odesláno';
        statusMessage = 'Vaše objednávka byla odeslána! Zásilka je na cestě k vám.';
        break;
      case 'delivered':
        statusText = 'Doručeno';
        statusMessage = 'Vaše objednávka byla úspěšně doručena. Děkujeme za nákup!';
        break;
      default:
        return false;
    }
    
    const html = `
<!DOCTYPE html>
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
</html>
    `;

    const { error } = await client.emails.send({
      from: `ZLE <${fromEmail}>`,
      to: [order.customerEmail],
      subject: `ZLE - Objednávka #${order.id.slice(0, 8)} - ${statusText}`,
      html,
    });

    if (error) {
      console.error('Failed to send shipping update email:', error);
      return false;
    }

    console.log(`Shipping update email (${status}) sent to ${order.customerEmail}`);
    return true;
  } catch (error) {
    console.error('Error sending shipping update email:', error);
    return false;
  }
}
