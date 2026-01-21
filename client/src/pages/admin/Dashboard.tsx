import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Redirect, Link } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { 
  Package, 
  ShoppingCart, 
  Users, 
  TrendingUp,
  AlertTriangle,
  Plus,
  Edit,
  Trash2,
  ArrowLeft,
  Shield,
  CheckCircle,
  XCircle,
  Clock,
} from "lucide-react";
import type { Product, Order, User } from "@shared/schema";

interface AdminStats {
  totalRevenue: number;
  totalOrders: number;
  pendingOrders: number;
  paidOrders: number;
  totalProducts: number;
  lowStockProducts: number;
  totalUsers: number;
}

function StatsCards({ stats }: { stats: AdminStats }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Celkové tržby</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-total-revenue">
            {stats.totalRevenue.toLocaleString()} Kč
          </div>
          <p className="text-xs text-muted-foreground">
            {stats.paidOrders} zaplacených objednávek
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Objednávky</CardTitle>
          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-total-orders">
            {stats.totalOrders}
          </div>
          <p className="text-xs text-muted-foreground">
            {stats.pendingOrders} čeká na vyřízení
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Produkty</CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-total-products">
            {stats.totalProducts}
          </div>
          {stats.lowStockProducts > 0 && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {stats.lowStockProducts} s nízkým skladem
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Uživatelé</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-total-users">
            {stats.totalUsers}
          </div>
          <p className="text-xs text-muted-foreground">
            Registrovaných účtů
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ProductsTab() {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [stockEdit, setStockEdit] = useState<{ id: string; stock: number } | null>(null);

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ['/api/admin/products'],
  });

  const createMutation = useMutation({
    mutationFn: (product: Partial<Product>) => 
      apiRequest('POST', '/api/admin/products', product),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/products'] });
      setIsAddOpen(false);
      toast({ title: "Produkt vytvořen" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Product> }) =>
      apiRequest('PATCH', `/api/admin/products/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/products'] });
      setEditingProduct(null);
      toast({ title: "Produkt aktualizován" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest('DELETE', `/api/admin/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/products'] });
      toast({ title: "Produkt odstraněn" });
    },
  });

  const stockMutation = useMutation({
    mutationFn: ({ id, stock }: { id: string; stock: number }) =>
      apiRequest('PATCH', `/api/admin/products/${id}/stock`, { stock }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/products'] });
      setStockEdit(null);
      toast({ title: "Sklad aktualizován" });
    },
  });

  if (isLoading) {
    return <div className="text-center py-8">Načítám produkty...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Správa produktů</h2>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-product">
              <Plus className="h-4 w-4 mr-2" />
              Přidat produkt
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nový produkt</DialogTitle>
            </DialogHeader>
            <ProductForm 
              onSubmit={(data) => createMutation.mutate(data)} 
              isLoading={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Název</TableHead>
            <TableHead>Cena</TableHead>
            <TableHead>Sklad</TableHead>
            <TableHead>Kategorie</TableHead>
            <TableHead>Stav</TableHead>
            <TableHead>Akce</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products?.map((product) => (
            <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
              <TableCell className="font-mono text-xs">{product.id}</TableCell>
              <TableCell className="font-medium">{product.name}</TableCell>
              <TableCell>{product.price.toLocaleString()} Kč</TableCell>
              <TableCell>
                {stockEdit?.id === product.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      className="w-20"
                      value={stockEdit.stock}
                      onChange={(e) => setStockEdit({ ...stockEdit, stock: parseInt(e.target.value) || 0 })}
                      data-testid={`input-stock-${product.id}`}
                    />
                    <Button 
                      size="sm" 
                      onClick={() => stockMutation.mutate(stockEdit)}
                      disabled={stockMutation.isPending}
                      data-testid={`button-save-stock-${product.id}`}
                    >
                      OK
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => setStockEdit(null)}
                    >
                      X
                    </Button>
                  </div>
                ) : (
                  <div 
                    className={`cursor-pointer ${product.stock < 10 ? 'text-destructive font-bold' : ''}`}
                    onClick={() => setStockEdit({ id: product.id, stock: product.stock })}
                  >
                    {product.stock}
                    {product.stock < 10 && <AlertTriangle className="h-3 w-3 inline ml-1" />}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{product.category}</Badge>
              </TableCell>
              <TableCell>
                {product.isActive ? (
                  <Badge variant="default">Aktivní</Badge>
                ) : (
                  <Badge variant="outline">Neaktivní</Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Dialog open={editingProduct?.id === product.id} onOpenChange={(open) => !open && setEditingProduct(null)}>
                    <DialogTrigger asChild>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        onClick={() => setEditingProduct(product)}
                        data-testid={`button-edit-${product.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Upravit produkt</DialogTitle>
                      </DialogHeader>
                      <ProductForm 
                        product={product}
                        onSubmit={(data) => updateMutation.mutate({ id: product.id, updates: data })} 
                        isLoading={updateMutation.isPending}
                      />
                    </DialogContent>
                  </Dialog>
                  <Button 
                    size="icon" 
                    variant="ghost"
                    onClick={() => {
                      if (confirm('Opravdu chcete smazat tento produkt?')) {
                        deleteMutation.mutate(product.id);
                      }
                    }}
                    data-testid={`button-delete-${product.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ProductForm({ 
  product, 
  onSubmit, 
  isLoading 
}: { 
  product?: Product; 
  onSubmit: (data: Partial<Product>) => void; 
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    id: product?.id || '',
    name: product?.name || '',
    price: product?.price || 0,
    sizes: product?.sizes?.join(', ') || 'S, M, L, XL',
    image: product?.image || '/api/images/tee',
    category: product?.category || 'tee',
    description: product?.description || '',
    stock: product?.stock || 100,
    isActive: product?.isActive ?? true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      sizes: formData.sizes.split(',').map(s => s.trim()),
      price: Number(formData.price),
      stock: Number(formData.stock),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!product && (
        <div>
          <Label htmlFor="id">ID produktu</Label>
          <Input
            id="id"
            value={formData.id}
            onChange={(e) => setFormData({ ...formData, id: e.target.value })}
            placeholder="zle-tee-new"
            required
            data-testid="input-product-id"
          />
        </div>
      )}
      <div>
        <Label htmlFor="name">Název</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
          data-testid="input-product-name"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="price">Cena (Kč)</Label>
          <Input
            id="price"
            type="number"
            value={formData.price}
            onChange={(e) => setFormData({ ...formData, price: parseInt(e.target.value) || 0 })}
            required
            data-testid="input-product-price"
          />
        </div>
        <div>
          <Label htmlFor="stock">Sklad</Label>
          <Input
            id="stock"
            type="number"
            value={formData.stock}
            onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })}
            required
            data-testid="input-product-stock"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="category">Kategorie</Label>
        <Select 
          value={formData.category} 
          onValueChange={(value) => setFormData({ ...formData, category: value })}
        >
          <SelectTrigger data-testid="select-product-category">
            <SelectValue placeholder="Vyberte kategorii" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tee">Tričko</SelectItem>
            <SelectItem value="hoodie">Hoodie</SelectItem>
            <SelectItem value="crewneck">Crewneck</SelectItem>
            <SelectItem value="cap">Čepice</SelectItem>
            <SelectItem value="beanie">Beanie</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="sizes">Velikosti (oddělené čárkou)</Label>
        <Input
          id="sizes"
          value={formData.sizes}
          onChange={(e) => setFormData({ ...formData, sizes: e.target.value })}
          placeholder="S, M, L, XL"
          data-testid="input-product-sizes"
        />
      </div>
      <div>
        <Label htmlFor="image">URL obrázku</Label>
        <Input
          id="image"
          value={formData.image}
          onChange={(e) => setFormData({ ...formData, image: e.target.value })}
          data-testid="input-product-image"
        />
      </div>
      <div>
        <Label htmlFor="description">Popis</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          data-testid="input-product-description"
        />
      </div>
      <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-submit-product">
        {isLoading ? 'Ukládám...' : (product ? 'Uložit změny' : 'Vytvořit produkt')}
      </Button>
    </form>
  );
}

function OrdersTab() {
  const { toast } = useToast();

  const { data: orders, isLoading } = useQuery<Order[]>({
    queryKey: ['/api/admin/orders'],
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Order> }) =>
      apiRequest('PATCH', `/api/admin/orders/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
      toast({ title: "Objednávka aktualizována" });
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'shipped':
        return <Package className="h-4 w-4 text-blue-500" />;
      case 'delivered':
        return <CheckCircle className="h-4 w-4 text-green-700" />;
      case 'cancelled':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getPaymentBadge = (status: string | null) => {
    switch (status) {
      case 'paid':
        return <Badge variant="default" className="bg-green-600">Zaplaceno</Badge>;
      case 'failed':
        return <Badge variant="destructive">Selhalo</Badge>;
      case 'cancelled':
        return <Badge variant="outline">Zrušeno</Badge>;
      default:
        return <Badge variant="secondary">Nezaplaceno</Badge>;
    }
  };

  if (isLoading) {
    return <div className="text-center py-8">Načítám objednávky...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Správa objednávek</h2>
      
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Zákazník</TableHead>
            <TableHead>Položky</TableHead>
            <TableHead>Celkem</TableHead>
            <TableHead>Platba</TableHead>
            <TableHead>Stav</TableHead>
            <TableHead>Datum</TableHead>
            <TableHead>Akce</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders?.map((order) => {
            const items = JSON.parse(order.items);
            return (
              <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}...</TableCell>
                <TableCell>
                  <div className="font-medium">{order.customerName}</div>
                  <div className="text-xs text-muted-foreground">{order.customerEmail}</div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">
                    {items.map((item: any, i: number) => (
                      <div key={i}>{item.quantity}x {item.name} ({item.size})</div>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="font-bold">{order.total.toLocaleString()} Kč</TableCell>
                <TableCell>{getPaymentBadge(order.paymentStatus)}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(order.status)}
                    <span className="capitalize">{order.status}</span>
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {order.createdAt ? new Date(order.createdAt).toLocaleDateString('cs') : '-'}
                </TableCell>
                <TableCell>
                  <Select 
                    value={order.status} 
                    onValueChange={(value) => updateMutation.mutate({ id: order.id, updates: { status: value } })}
                  >
                    <SelectTrigger className="w-32" data-testid={`select-order-status-${order.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Čeká</SelectItem>
                      <SelectItem value="confirmed">Potvrzeno</SelectItem>
                      <SelectItem value="shipped">Odesláno</SelectItem>
                      <SelectItem value="delivered">Doručeno</SelectItem>
                      <SelectItem value="cancelled">Zrušeno</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function UsersTab() {
  const { toast } = useToast();

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['/api/admin/users'],
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<User> }) =>
      apiRequest('PATCH', `/api/admin/users/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
      toast({ title: "Uživatel aktualizován" });
    },
  });

  if (isLoading) {
    return <div className="text-center py-8">Načítám uživatele...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Správa uživatelů</h2>
      
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Jméno</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Admin</TableHead>
            <TableHead>Registrace</TableHead>
            <TableHead>Akce</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users?.map((user) => (
            <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
              <TableCell className="font-mono text-xs">{user.id.slice(0, 8)}...</TableCell>
              <TableCell className="font-medium">
                {user.firstName} {user.lastName}
              </TableCell>
              <TableCell>{user.email || '-'}</TableCell>
              <TableCell>
                {user.isAdmin ? (
                  <Badge variant="default" className="bg-purple-600">
                    <Shield className="h-3 w-3 mr-1" />
                    Admin
                  </Badge>
                ) : (
                  <Badge variant="secondary">Uživatel</Badge>
                )}
              </TableCell>
              <TableCell className="text-xs">
                {user.createdAt ? new Date(user.createdAt).toLocaleDateString('cs') : '-'}
              </TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant={user.isAdmin ? "outline" : "default"}
                  onClick={() => updateMutation.mutate({ id: user.id, updates: { isAdmin: !user.isAdmin } })}
                  disabled={updateMutation.isPending}
                  data-testid={`button-toggle-admin-${user.id}`}
                >
                  {user.isAdmin ? 'Odebrat admin' : 'Udělit admin'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function AdminDashboard() {
  const { user, isLoading: authLoading } = useAuth();
  
  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ['/api/admin/stats'],
    enabled: !!user?.isAdmin,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="text-white text-xl font-bold">Načítám...</div>
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/" />;
  }

  if (!user.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-center flex items-center justify-center gap-2">
              <Shield className="h-6 w-6" />
              Přístup odepřen
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              Pro přístup do administrace potřebujete administrátorská práva.
            </p>
            <Link href="/">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Zpět na hlavní stránku
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-black tracking-tighter">ADMIN DASHBOARD</h1>
              <p className="text-muted-foreground">ZLE Underground Management</p>
            </div>
          </div>
          <Badge variant="outline" className="text-lg py-2 px-4">
            <Shield className="h-4 w-4 mr-2" />
            {user.firstName} {user.lastName}
          </Badge>
        </div>

        {statsLoading ? (
          <div className="text-center py-8">Načítám statistiky...</div>
        ) : stats ? (
          <StatsCards stats={stats} />
        ) : null}

        <Tabs defaultValue="orders" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="orders" data-testid="tab-orders">Objednávky</TabsTrigger>
            <TabsTrigger value="products" data-testid="tab-products">Produkty</TabsTrigger>
            <TabsTrigger value="users" data-testid="tab-users">Uživatelé</TabsTrigger>
          </TabsList>
          <TabsContent value="orders">
            <Card>
              <CardContent className="pt-6">
                <OrdersTab />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="products">
            <Card>
              <CardContent className="pt-6">
                <ProductsTab />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="users">
            <Card>
              <CardContent className="pt-6">
                <UsersTab />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
