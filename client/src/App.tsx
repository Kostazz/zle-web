import { Switch, Route } from "wouter";
import { Suspense, lazy } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CartProvider } from "@/lib/cart-context";
import { LogoProvider } from "@/lib/logoContext";
import { ScrollToTop } from "@/components/layout/ScrollToTop";
import Home from "@/pages/Home";

// Route-level code splitting (mobile speed): keep Home eager, lazy-load the rest.
const Shop = lazy(() => import("@/pages/Shop"));
const Story = lazy(() => import("@/pages/Story"));
const Crew = lazy(() => import("@/pages/Crew"));
const Contact = lazy(() => import("@/pages/Contact"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const CheckoutSuccess = lazy(() => import("@/pages/checkout/Success"));
const CheckoutCancel = lazy(() => import("@/pages/checkout/Cancel"));
const OpsDashboard = lazy(() => import("@/pages/ops/OpsDashboard"));
const Orders = lazy(() => import("@/pages/account/Orders"));
const Addresses = lazy(() => import("@/pages/account/Addresses"));
const AdminDashboard = lazy(() => import("@/pages/admin/Dashboard"));
const LegalHub = lazy(() => import("@/pages/legal"));
const LegalTerms = lazy(() => import("@/pages/legal/terms"));
const LegalPrivacy = lazy(() => import("@/pages/legal/privacy"));
const LegalCookies = lazy(() => import("@/pages/legal/cookies"));
const LegalReturns = lazy(() => import("@/pages/legal/returns"));
const LegalContact = lazy(() => import("@/pages/legal/contact"));
const ServerError = lazy(() => import("@/pages/errors/ServerError"));
const NotFound = lazy(() => import("@/pages/not-found"));

const RouteFallback = () => (
  <div className="min-h-[40vh] flex items-center justify-center">
    <div className="text-sm opacity-70">loading…</div>
  </div>
);

function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/shop" component={Shop} />
        <Route path="/story" component={Story} />
        <Route path="/crew" component={Crew} />
        <Route path="/contact" component={Contact} />
        <Route path="/checkout" component={Checkout} />

        {/* Stripe default return URLs */}
        <Route path="/success" component={CheckoutSuccess} />
        <Route path="/cancel" component={CheckoutCancel} />

        <Route path="/checkout/success" component={CheckoutSuccess} />
        <Route path="/checkout/cancel" component={CheckoutCancel} />
        <Route path="/ops" component={OpsDashboard} />
        <Route path="/account/orders" component={Orders} />
        <Route path="/account/addresses" component={Addresses} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/legal" component={LegalHub} />
        <Route path="/legal/terms" component={LegalTerms} />
        <Route path="/legal/privacy" component={LegalPrivacy} />
        <Route path="/legal/cookies" component={LegalCookies} />
        <Route path="/legal/returns" component={LegalReturns} />
        <Route path="/legal/contact" component={LegalContact} />
        <Route path="/500" component={ServerError} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LogoProvider>
          <CartProvider>
            <ScrollToTop />
            <Toaster />
            <Router />
          </CartProvider>
        </LogoProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
