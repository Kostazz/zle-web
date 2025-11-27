import { type User, type InsertUser, type Product, type InsertProduct, type Order, type InsertOrder } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  getProductsByCategory(category: string): Promise<Product[]>;
  
  getOrders(): Promise<Order[]>;
  getOrder(id: string): Promise<Order | undefined>;
  createOrder(order: InsertOrder): Promise<Order>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private products: Map<string, Product>;
  private orders: Map<string, Order>;

  constructor() {
    this.users = new Map();
    this.products = new Map();
    this.orders = new Map();
    
    this.initializeProducts();
  }

  private initializeProducts() {
    const initialProducts: Product[] = [
      {
        id: "zle-hoodie-alpha",
        name: "ZLE HOODIE ALPHA",
        price: 1290,
        sizes: ["S", "M", "L", "XL", "XXL"],
        image: "/api/images/hoodie",
        images: null,
        category: "hoodie",
        description: "Černá hoodie s bílým ZLE logem. Raw print. 100% bavlna, heavy weight.",
      },
      {
        id: "zle-hoodie-crew",
        name: "ZLE CREW HOODIE",
        price: 1390,
        sizes: ["S", "M", "L", "XL"],
        image: "/api/images/hoodie",
        images: null,
        category: "hoodie",
        description: "Limitovaná crew edice. Bílé logo + crew list na zádech. Premium quality.",
      },
      {
        id: "zle-tee-classic",
        name: "ZLE TEE CLASSIC",
        price: 590,
        sizes: ["S", "M", "L", "XL", "XXL"],
        image: "/api/images/tee",
        images: null,
        category: "tee",
        description: "Klasické černé tričko s bílým ZLE logem. 100% bavlna.",
      },
      {
        id: "zle-tee-underground",
        name: "ZLE UNDERGROUND TEE",
        price: 690,
        sizes: ["S", "M", "L", "XL"],
        image: "/api/images/tee",
        images: null,
        category: "tee",
        description: "Underground edice s velkým grafickým potiskem. Street vibe.",
      },
      {
        id: "zle-cap-og",
        name: "ZLE CAP OG",
        price: 490,
        sizes: ["ONE SIZE"],
        image: "/api/images/cap",
        images: null,
        category: "cap",
        description: "Černá kšiltovka s vyšitým ZLE logem. Nastavitelná velikost.",
      },
      {
        id: "zle-crewneck-heavy",
        name: "ZLE CREWNECK HEAVY",
        price: 1090,
        sizes: ["S", "M", "L", "XL"],
        image: "/api/images/crewneck",
        images: null,
        category: "crewneck",
        description: "Heavy weight crewneck. Minimalistický design. Raw print.",
      },
      {
        id: "zle-beanie-winter",
        name: "ZLE BEANIE",
        price: 390,
        sizes: ["ONE SIZE"],
        image: "/api/images/beanie",
        images: null,
        category: "beanie",
        description: "Černá beanie s vyšitým ZLE logem. Acryl/vlna mix.",
      },
      {
        id: "zle-tee-fire",
        name: "ZLE FIRE TEE",
        price: 650,
        sizes: ["S", "M", "L", "XL", "XXL"],
        image: "/api/images/tee",
        images: null,
        category: "tee",
        description: "Limitovaná edice s retro fire logem. Sběratelský kus.",
      },
    ];

    for (const product of initialProducts) {
      this.products.set(product.id, product);
    }
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getProducts(): Promise<Product[]> {
    return Array.from(this.products.values());
  }

  async getProduct(id: string): Promise<Product | undefined> {
    return this.products.get(id);
  }

  async getProductsByCategory(category: string): Promise<Product[]> {
    return Array.from(this.products.values()).filter(
      (product) => product.category === category
    );
  }

  async getOrders(): Promise<Order[]> {
    return Array.from(this.orders.values());
  }

  async getOrder(id: string): Promise<Order | undefined> {
    return this.orders.get(id);
  }

  async createOrder(insertOrder: InsertOrder): Promise<Order> {
    const id = randomUUID();
    const order: Order = { 
      ...insertOrder, 
      id,
      status: "pending",
    };
    this.orders.set(id, order);
    return order;
  }
}

export const storage = new MemStorage();
