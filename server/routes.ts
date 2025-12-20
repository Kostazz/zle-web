import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertOrderSchema, type CartItem, products, orders, ledgerEntries, orderPayouts, orderEvents, auditLog } from "@shared/schema";
import { z } from "zod";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { sendShippingUpdateEmail } from "./emailService";
import { atomicStockDeduction } from "./webhookHandlers";
import { finalizePaidOrder } from "./paymentPipeline";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  await setupAuth(app);

  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
  
  app.get("/api/products", async (req, res) => {
    try {
      const products = await storage.getProducts();
      res.json(products);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const product = await storage.getProduct(req.params.id);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch product" });
    }
  });

  app.get("/api/products/category/:category", async (req, res) => {
    try {
      const products = await storage.getProductsByCategory(req.params.category);
      res.json(products);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  app.post("/api/orders", async (req: any, res) => {
    try {
      const orderData = insertOrderSchema.parse(req.body);
      
      const items: CartItem[] = JSON.parse(orderData.items);
      
      // Validate stock availability (no deduction here - happens atomically in webhook after payment)
      for (const item of items) {
        const product = await storage.getProduct(item.productId);
        if (!product) {
          return res.status(400).json({ 
            error: `Produkt ${item.name} již není dostupný` 
          });
        }
        if (product.stock < item.quantity) {
          return res.status(400).json({ 
            error: `Nedostatečné množství produktu ${item.name}. Dostupné: ${product.stock}` 
          });
        }
      }
      
      // NOTE: Stock is NOT deducted here. Deduction happens atomically in webhook 
      // handler after successful payment (see webhookHandlers.ts atomicStockDeduction)
      
      const userId = req.user?.claims?.sub;
      const order = await storage.createOrder({
        ...orderData,
        userId: userId || null,
      });
      res.status(201).json(order);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Invalid order data", 
          details: error.errors 
        });
      }
      res.status(500).json({ error: "Failed to create order" });
    }
  });

  app.get("/api/orders/:id", async (req, res) => {
    try {
      const order = await storage.getOrder(req.params.id);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      res.json(order);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch order" });
    }
  });

  app.get("/api/orders", async (req, res) => {
    try {
      const orders = await storage.getOrders();
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  app.patch("/api/orders/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }
      const order = await storage.updateOrder(req.params.id, { status });
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      res.json(order);
    } catch (error) {
      res.status(500).json({ error: "Failed to update order" });
    }
  });

  app.get("/api/user/orders", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const orders = await storage.getOrdersByUser(userId);
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  app.get("/api/user/addresses", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const addresses = await storage.getAddresses(userId);
      res.json(addresses);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch addresses" });
    }
  });

  app.post("/api/user/addresses", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const address = await storage.createAddress({
        ...req.body,
        userId,
      });
      res.status(201).json(address);
    } catch (error) {
      res.status(500).json({ error: "Failed to create address" });
    }
  });

  app.delete("/api/user/addresses/:id", isAuthenticated, async (req: any, res) => {
    try {
      const success = await storage.deleteAddress(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Address not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete address" });
    }
  });

  // Stripe checkout routes
  app.get("/api/stripe/config", async (req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error) {
      console.error("Error getting Stripe config:", error);
      res.status(500).json({ error: "Stripe not configured" });
    }
  });

  // Create Stripe checkout session for one-time purchase
  app.post("/api/checkout/create-session", async (req: any, res) => {
    try {
      const { items, customerEmail, customerName, customerAddress, customerCity, customerZip } = req.body;

      if (!items || items.length === 0) {
        return res.status(400).json({ error: "No items in cart" });
      }

      // Validate stock before creating session
      const cartItems: CartItem[] = items;
      for (const item of cartItems) {
        const product = await storage.getProduct(item.productId);
        if (!product) {
          return res.status(400).json({ 
            error: `Produkt ${item.name} již není dostupný` 
          });
        }
        if (product.stock < item.quantity) {
          return res.status(400).json({ 
            error: `Nedostatečné množství produktu ${item.name}. Dostupné: ${product.stock}` 
          });
        }
      }

      // Calculate total
      const total = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

      // Create order in pending state
      const userId = req.user?.claims?.sub || null;
      const order = await storage.createOrder({
        userId,
        customerName,
        customerEmail,
        customerAddress,
        customerCity,
        customerZip,
        items: JSON.stringify(cartItems),
        total,
      });

      // Create Stripe checkout session
      const stripe = await getUncachableStripeClient();
      
      // Build line items for Stripe
      const lineItems = cartItems.map(item => ({
        price_data: {
          currency: 'czk',
          product_data: {
            name: item.name,
            description: `Velikost: ${item.size}`,
            images: item.image ? [item.image.startsWith('http') ? item.image : `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}${item.image}`] : undefined,
          },
          unit_amount: item.price * 100, // Convert to cents
        },
        quantity: item.quantity,
      }));

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: 'payment',
        success_url: `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}/checkout/success?session_id={CHECKOUT_SESSION_ID}&order_id=${order.id}`,
        cancel_url: `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}/checkout/cancel?order_id=${order.id}`,
        customer_email: customerEmail,
        metadata: {
          orderId: order.id,
        },
        payment_intent_data: {
          metadata: {
            orderId: order.id,
          },
        },
        shipping_address_collection: {
          allowed_countries: ['CZ', 'SK'],
        },
      });

      res.json({ 
        sessionId: session.id,
        url: session.url,
        orderId: order.id,
      });
    } catch (error) {
      console.error("Error creating checkout session:", error);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  // Verify payment success
  app.get("/api/checkout/verify/:sessionId", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const stripe = await getUncachableStripeClient();
      
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const orderId = session.metadata?.orderId;
      
      if (session.payment_status === 'paid' && orderId) {
        const order = await storage.getOrder(orderId);
        if (order && order.paymentStatus !== 'paid') {
          // Check if stock already deducted (by webhook or previous verification call)
          const [currentOrder] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
          
          if (!currentOrder?.stockDeductedAt) {
            // Webhook hasn't processed yet - perform atomic stock deduction here
            const items: CartItem[] = JSON.parse(order.items);
            const stockResult = await atomicStockDeduction(orderId, items);
            
            if (!stockResult.success) {
              // Some stock deductions failed - flag for manual review
              console.warn(`[verify] Stock deduction issues for order ${orderId}:`, stockResult.failures);
              await storage.updateOrder(orderId, {
                paymentStatus: 'paid',
                paymentIntentId: session.payment_intent as string,
                status: 'confirmed',
                manualReview: true,
                stockDeductedAt: new Date(),
              });
            } else {
              await storage.updateOrder(orderId, {
                paymentStatus: 'paid',
                paymentIntentId: session.payment_intent as string,
                status: 'confirmed',
                stockDeductedAt: new Date(),
              });
            }
            console.log(`Order ${orderId} payment verified and stock deducted via verification endpoint`);
            
            // Finalize order: create ledger entry, payouts, events (idempotent)
            await finalizePaidOrder({
              orderId,
              provider: 'stripe',
              providerEventId: `verify-${sessionId}`,
              meta: { source: 'verify', sessionId },
            });
          } else {
            // Stock already deducted - just update payment status if needed
            await storage.updateOrder(orderId, {
              paymentStatus: 'paid',
              paymentIntentId: session.payment_intent as string,
              status: 'confirmed',
            });
            console.log(`Order ${orderId} payment verified (stock already deducted)`);
            
            // Still finalize if not done yet (idempotent - will skip if already finalized)
            await finalizePaidOrder({
              orderId,
              provider: 'stripe',
              providerEventId: `verify-${sessionId}`,
              meta: { source: 'verify-followup', sessionId },
            });
          }
        }
        
        res.json({ 
          success: true, 
          orderId,
          paymentStatus: session.payment_status,
        });
      } else {
        res.json({ 
          success: false, 
          orderId,
          paymentStatus: session.payment_status,
        });
      }
    } catch (error) {
      console.error("Error verifying payment:", error);
      res.status(500).json({ error: "Failed to verify payment" });
    }
  });

  // Cancel order
  app.post("/api/checkout/cancel/:orderId", async (req, res) => {
    try {
      const { orderId } = req.params;
      const order = await storage.getOrder(orderId);
      
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      if (order.paymentStatus === 'paid') {
        return res.status(400).json({ error: "Cannot cancel paid order" });
      }
      
      await storage.updateOrder(orderId, {
        status: 'cancelled',
        paymentStatus: 'cancelled',
      });
      
      res.json({ success: true });
    } catch (error) {
      console.error("Error cancelling order:", error);
      res.status(500).json({ error: "Failed to cancel order" });
    }
  });

  // Admin middleware to check admin status
  const isAdmin = async (req: any, res: any, next: any) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user || !user.isAdmin) {
        return res.status(403).json({ error: "Forbidden - Admin access required" });
      }
      next();
    } catch (error) {
      res.status(500).json({ error: "Server error" });
    }
  };

  // Admin - Get dashboard stats
  app.get("/api/admin/stats", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const orders = await storage.getOrders();
      const products = await storage.getAllProducts();
      const users = await storage.getAllUsers();
      
      const totalRevenue = orders
        .filter(o => o.paymentStatus === 'paid')
        .reduce((sum, o) => sum + o.total, 0);
      
      const pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'confirmed').length;
      const paidOrders = orders.filter(o => o.paymentStatus === 'paid').length;
      const lowStockProducts = products.filter(p => p.stock < 10 && p.isActive).length;
      
      res.json({
        totalRevenue,
        totalOrders: orders.length,
        pendingOrders,
        paidOrders,
        totalProducts: products.filter(p => p.isActive).length,
        lowStockProducts,
        totalUsers: users.length,
      });
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Admin - Get all products (including inactive)
  app.get("/api/admin/products", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const products = await storage.getAllProducts();
      res.json(products);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  // Admin - Create product
  app.post("/api/admin/products", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id, name, price, sizes, image, category, description, stock, isActive } = req.body;
      
      if (!id || !name || typeof price !== 'number' || !sizes || !image || !category || !description) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      const product = await storage.createProduct({
        id,
        name,
        price: Number(price),
        sizes: Array.isArray(sizes) ? sizes : [],
        image,
        images: null,
        category,
        description,
        stock: Number(stock) || 100,
        isActive: isActive !== false,
        // Waterfall payout fields (ZLE v1.2.2) - defaults
        productModel: req.body.productModel || "legacy",
        unitCost: req.body.unitCost || null,
        stockOwner: req.body.stockOwner || null,
        pricingMode: req.body.pricingMode || null,
        pricingPercent: req.body.pricingPercent || null,
      });
      res.json(product);
    } catch (error) {
      console.error("Error creating product:", error);
      res.status(500).json({ error: "Failed to create product" });
    }
  });

  // Admin - Update product
  app.patch("/api/admin/products/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, price, sizes, image, category, description, stock, isActive } = req.body;
      
      const updates: Partial<typeof products.$inferSelect> = {};
      if (name !== undefined) updates.name = name;
      if (price !== undefined) updates.price = Number(price);
      if (sizes !== undefined) updates.sizes = Array.isArray(sizes) ? sizes : sizes.split(',').map((s: string) => s.trim());
      if (image !== undefined) updates.image = image;
      if (category !== undefined) updates.category = category;
      if (description !== undefined) updates.description = description;
      if (stock !== undefined) updates.stock = Math.max(0, Number(stock));
      if (isActive !== undefined) updates.isActive = isActive;
      
      const product = await storage.updateProduct(id, updates);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      console.error("Error updating product:", error);
      res.status(500).json({ error: "Failed to update product" });
    }
  });

  // Admin - Delete product (soft delete)
  app.delete("/api/admin/products/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const success = await storage.deleteProduct(id);
      if (!success) {
        return res.status(404).json({ error: "Product not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting product:", error);
      res.status(500).json({ error: "Failed to delete product" });
    }
  });

  // Admin - Set stock level
  app.patch("/api/admin/products/:id/stock", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { stock } = req.body;
      if (typeof stock !== 'number' || stock < 0) {
        return res.status(400).json({ error: "Invalid stock value" });
      }
      const product = await storage.setStock(id, stock);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }
      res.json(product);
    } catch (error) {
      console.error("Error updating stock:", error);
      res.status(500).json({ error: "Failed to update stock" });
    }
  });

  // Admin - Get all orders
  app.get("/api/admin/orders", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const orders = await storage.getOrders();
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Admin - Update order status
  app.patch("/api/admin/orders/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { status, paymentStatus } = req.body;
      
      // Get current order to check if status changed
      const currentOrder = await storage.getOrder(id);
      if (!currentOrder) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      // Only include fields that are explicitly provided
      const updates: Record<string, any> = {};
      if (status !== undefined) updates.status = status;
      if (paymentStatus !== undefined) updates.paymentStatus = paymentStatus;
      
      // Only update if there are actual changes
      if (Object.keys(updates).length === 0) {
        return res.json(currentOrder);
      }
      
      const order = await storage.updateOrder(id, updates);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      // Send shipping update email if status changed to a notifiable status
      if (status && status !== currentOrder.status) {
        const notifiableStatuses = ['confirmed', 'shipped', 'delivered'];
        if (notifiableStatuses.includes(status)) {
          sendShippingUpdateEmail(order, status).catch(err => 
            console.error('Failed to send shipping update email:', err)
          );
        }
      }
      
      res.json(order);
    } catch (error) {
      console.error("Error updating order:", error);
      res.status(500).json({ error: "Failed to update order" });
    }
  });

  // Admin - Get all users
  app.get("/api/admin/users", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Admin - Update user (toggle admin, etc)
  app.patch("/api/admin/users/:id", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      const user = await storage.updateUser(id, updates);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // Admin - GDPR anonymize user (ZLE EU + OPS PACK v1.0)
  app.post("/api/admin/gdpr/anonymize-user", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ error: "userId is required" });
      }
      
      const { anonymizeUser } = await import("./gdpr");
      const actorId = req.user?.claims?.sub;
      const result = await anonymizeUser(userId, actorId);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json(result);
    } catch (error) {
      console.error("Error anonymizing user:", error);
      res.status(500).json({ error: "Failed to anonymize user" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CSV EXPORT ENDPOINTS (ZLE v1.2.3)
  // ═══════════════════════════════════════════════════════════════════════════

  // Admin - Export ledger as CSV
  app.get("/api/admin/exports/ledger.csv", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { exportLedgerCsv } = await import("./exports");
      const csv = await exportLedgerCsv();
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=ledger.csv");
      res.send(csv);
    } catch (error) {
      console.error("Error exporting ledger:", error);
      res.status(500).json({ error: "Failed to export ledger" });
    }
  });

  // Admin - Export orders as CSV
  app.get("/api/admin/exports/orders.csv", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { exportOrdersCsv } = await import("./exports");
      const csv = await exportOrdersCsv();
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=orders.csv");
      res.send(csv);
    } catch (error) {
      console.error("Error exporting orders:", error);
      res.status(500).json({ error: "Failed to export orders" });
    }
  });

  // Admin - Export payouts as CSV
  app.get("/api/admin/exports/payouts.csv", isAuthenticated, isAdmin, async (req, res) => {
    try {
      const { exportPayoutsCsv } = await import("./exports");
      const csv = await exportPayoutsCsv();
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=payouts.csv");
      res.send(csv);
    } catch (error) {
      console.error("Error exporting payouts:", error);
      res.status(500).json({ error: "Failed to export payouts" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // REFUND ENDPOINT (ZLE v1.2.2)
  // ═══════════════════════════════════════════════════════════════════════════

  // Admin - Apply refund for order
  app.post("/api/admin/orders/:id/refund", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { amount, reason } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Valid refund amount is required" });
      }
      
      const { applyRefundForOrder } = await import("./refunds");
      const actorId = req.user?.claims?.sub;
      const providerEventId = `manual-refund-${id}-${Date.now()}`;
      
      const result = await applyRefundForOrder(id, amount, reason || "Admin refund", providerEventId, actorId);
      
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json(result);
    } catch (error) {
      console.error("Error applying refund:", error);
      res.status(500).json({ error: "Failed to apply refund" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEV-ONLY TEST HELPERS (ZLE Pre-Launch Test Runner v1.0.1)
  // Restricted to: NODE_ENV !== "production" AND (admin OR dev token)
  // ═══════════════════════════════════════════════════════════════════════════

  const isDevEnvironment = process.env.NODE_ENV !== "production";
  const DEV_TEST_TOKEN = process.env.DEV_TEST_TOKEN || "zle-dev-test-2024";
  
  // Dev-only payout fail flag (auto-resets after triggering once)
  let devPayoutFailEnabled = false;
  
  // Middleware for dev-only endpoints
  const isDevAllowed = async (req: any, res: any, next: any) => {
    if (!isDevEnvironment) {
      return res.status(403).json({ error: "Dev endpoints disabled in production" });
    }
    
    // Allow if admin authenticated
    if (req.user?.claims?.sub) {
      try {
        const userId = req.user.claims.sub;
        const user = await storage.getUser(userId);
        if (user?.isAdmin) {
          return next();
        }
      } catch (e) {
        // Continue to token check
      }
    }
    
    // Allow if dev token matches
    const token = req.headers["x-dev-test-token"];
    if (token === DEV_TEST_TOKEN) {
      return next();
    }
    
    return res.status(401).json({ error: "Unauthorized: admin auth or dev token required" });
  };

  // GET /api/admin/dev/latest-order - Get latest order summary
  app.get("/api/admin/dev/latest-order", isDevAllowed, async (req, res) => {
    try {
      const allOrders = await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(1);
      
      if (allOrders.length === 0) {
        return res.status(404).json({ error: "No orders found" });
      }
      
      const order = allOrders[0];
      res.json({
        id: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        createdAt: order.createdAt,
        total: order.total,
        stockDeductedAt: order.stockDeductedAt,
        manualReview: order.manualReview,
      });
    } catch (error) {
      console.error("[dev] Error fetching latest order:", error);
      res.status(500).json({ error: "Failed to fetch latest order" });
    }
  });

  // GET /api/admin/dev/order/:id/debug - Full debug info for an order
  app.get("/api/admin/dev/order/:id/debug", isDevAllowed, async (req, res) => {
    try {
      const { id } = req.params;
      
      // Fetch order
      const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      // Fetch ledger entries
      const ledger = await db.select().from(ledgerEntries).where(eq(ledgerEntries.orderId, id));
      
      // Fetch payouts
      const payouts = await db.select().from(orderPayouts).where(eq(orderPayouts.orderId, id));
      
      // Fetch idempotency events
      const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, id));
      
      // Fetch audit log entries (entityId = orderId for order-related audits)
      const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, id));
      
      res.json({
        order: {
          id: order.id,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentIntentId: order.paymentIntentId,
          total: order.total,
          createdAt: order.createdAt,
          stockDeductedAt: order.stockDeductedAt,
          manualReview: order.manualReview,
          refundAmount: order.refundAmount,
          refundReason: order.refundReason,
        },
        ledger: {
          count: ledger.length,
          saleCount: ledger.filter(l => l.type === 'sale').length,
          refundCount: ledger.filter(l => l.type === 'refund').length,
          chargebackCount: ledger.filter(l => l.type === 'chargeback').length,
          entries: ledger.map(l => ({
            id: l.id,
            type: l.type,
            amount: l.amount,
            dedupeKey: l.dedupeKey,
            createdAt: l.createdAt,
          })),
        },
        payouts: {
          count: payouts.length,
          entries: payouts.map(p => ({
            id: p.id,
            partnerCode: p.partnerCode,
            amount: p.amount,
            status: p.status,
            createdAt: p.createdAt,
          })),
        },
        events: {
          count: events.length,
          entries: events.map(e => ({
            id: e.id,
            provider: e.provider,
            providerEventId: e.providerEventId,
            type: e.type,
            createdAt: e.createdAt,
          })),
        },
        audits: {
          count: audits.length,
          entries: audits.map(a => ({
            id: a.id,
            action: a.action,
            createdAt: a.createdAt,
          })),
        },
      });
    } catch (error) {
      console.error("[dev] Error fetching order debug:", error);
      res.status(500).json({ error: "Failed to fetch order debug info" });
    }
  });

  // POST /api/admin/dev/simulate-payout-fail - Enable payout fail simulation
  app.post("/api/admin/dev/simulate-payout-fail", isDevAllowed, async (req, res) => {
    devPayoutFailEnabled = true;
    console.log("[dev] Payout fail simulation ENABLED (will auto-reset after one trigger)");
    res.json({ 
      enabled: true, 
      message: "Payout fail simulation enabled. Next payout will fail then auto-reset." 
    });
  });

  // GET /api/admin/dev/payout-fail-status - Check if payout fail is enabled
  app.get("/api/admin/dev/payout-fail-status", isDevAllowed, async (req, res) => {
    res.json({ enabled: devPayoutFailEnabled });
  });

  // Export the payout fail flag getter/consumer for use in payouts.ts
  (global as any).__devPayoutFailEnabled = () => {
    if (devPayoutFailEnabled) {
      devPayoutFailEnabled = false; // Auto-reset
      console.log("[dev] Payout fail simulation CONSUMED and AUTO-RESET");
      return true;
    }
    return false;
  };

  // POST /api/admin/dev/replay-webhook-guidance - Provide Stripe CLI guidance
  app.post("/api/admin/dev/replay-webhook-guidance", isDevAllowed, async (req, res) => {
    res.json({
      message: "To replay a webhook event, use Stripe CLI:",
      steps: [
        "1. Install Stripe CLI: https://stripe.com/docs/stripe-cli",
        "2. Login: stripe login",
        "3. Forward webhooks: stripe listen --forward-to localhost:5000/api/stripe/webhook/<UUID>",
        "4. Trigger event: stripe trigger checkout.session.completed",
        "5. Or resend from Stripe Dashboard > Developers > Webhooks > Select event > Resend"
      ],
      note: "Signature verification is intact. Use Stripe CLI or Dashboard for authentic events."
    });
  });

  // POST /api/admin/dev/finalize-order/:id - Manually trigger finalizePaidOrder (for testing)
  app.post("/api/admin/dev/finalize-order/:id", isDevAllowed, async (req, res) => {
    try {
      const { id } = req.params;
      const order = await storage.getOrder(id);
      
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }
      
      if (order.paymentStatus !== 'paid') {
        return res.status(400).json({ error: "Order is not paid yet" });
      }
      
      const result = await finalizePaidOrder({
        orderId: id,
        provider: 'manual',
        providerEventId: `manual-finalize-${id}-${Date.now()}`,
        meta: { source: 'dev-finalize' },
      });
      
      console.log(`[dev] Manual finalize for order ${id}:`, result);
      res.json(result);
    } catch (error) {
      console.error("[dev] Error finalizing order:", error);
      res.status(500).json({ error: "Failed to finalize order" });
    }
  });

  return httpServer;
}
