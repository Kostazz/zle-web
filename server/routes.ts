import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertOrderSchema, type CartItem, products } from "@shared/schema";
import { z } from "zod";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";

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
      
      for (const item of items) {
        await storage.updateStock(item.productId, item.quantity);
      }
      
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
        // Deduct stock for paid order
        const order = await storage.getOrder(orderId);
        if (order && order.paymentStatus !== 'paid') {
          const items: CartItem[] = JSON.parse(order.items);
          for (const item of items) {
            await storage.updateStock(item.productId, item.quantity);
          }
          
          await storage.updateOrder(orderId, {
            paymentStatus: 'paid',
            paymentIntentId: session.payment_intent as string,
            status: 'confirmed',
          });
          console.log(`Order ${orderId} payment verified and confirmed`);
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
      const updates = req.body;
      const order = await storage.updateOrder(id, updates);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
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

  return httpServer;
}
