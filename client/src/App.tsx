import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CartProvider } from "@/lib/cart-context";
import { LogoProvider } from "@/lib/logoContext";
import Home from "@/pages/Home";
import Shop from "@/pages/Shop";
import Story from "@/pages/Story";
import Crew from "@/pages/Crew";
import Contact from "@/pages/Contact";
import Checkout from "@/pages/Checkout";
import CheckoutSuccess from "@/pages/checkout/Success";
import CheckoutCancel from "@/pages/checkout/Cancel";
import Orders from "@/pages/account/Orders";
import Addresses from "@/pages/account/Addresses";
import AdminDashboard from "@/pages/admin/Dashboard";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/shop" component={Shop} />
      <Route path="/story" component={Story} />
      <Route path="/crew" component={Crew} />
      <Route path="/contact" component={Contact} />
      <Route path="/checkout" component={Checkout} />
      <Route path="/checkout/success" component={CheckoutSuccess} />
      <Route path="/checkout/cancel" component={CheckoutCancel} />
      <Route path="/account/orders" component={Orders} />
      <Route path="/account/addresses" component={Addresses} />
      <Route path="/admin" component={AdminDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LogoProvider>
          <CartProvider>
            <Toaster />
            <Router />
          </CartProvider>
        </LogoProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
